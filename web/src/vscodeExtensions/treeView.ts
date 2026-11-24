// Turns an extension's TreeDataProvider into the plain-data tree model the rail
// draws (`RailTreeModel`). Elements stay on this side; the rail only sees
// handles and checked, size-capped tree items.
import type * as omnigent from "omnigent";
import { isThenable } from "@/lib/thenable";
import type {
  RailTreeDecorationTone,
  RailTreeItemCollapsible,
  RailTreeItemStatus,
  RailTreeModel,
  RailTreeNode,
} from "@/shell/railViews";
import { isRailViewIconName } from "@/shell/railViewIcons";

const MAX_LABEL = 200;
const MAX_DESCRIPTION = 200;
const MAX_TOOLTIP = 500;
const MAX_PATH = 4096;
const MAX_ID = 500;
const MAX_CHILDREN = 10_000;
const MAX_DECORATION_PARTS = 8;
const MAX_DECORATION_TEXT = 24;
const MAX_ELEMENTS = 50_000;

const COLLAPSIBLE: Record<number, RailTreeItemCollapsible> = {
  0: "none",
  1: "collapsed",
  2: "expanded",
};
const STATUSES = new Set<RailTreeItemStatus>(["added", "modified", "deleted"]);
const TONES = new Set<RailTreeDecorationTone>(["added", "removed", "muted"]);

export interface TreeViewModelOptions {
  /** Runs a row's command; arguments are copied as JSON by the command registry. */
  executeCommand: (command: string, args: readonly unknown[]) => Promise<unknown>;
  logError: (message: string, error?: unknown) => void;
  /** The session the provider's data is for (the workspace on screen). */
  dataSessionId?: () => string | undefined;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

function dirname(path: string): string {
  const slash = path.replace(/\/+$/, "").lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : "";
}

function resourcePathOf(value: unknown): string | undefined {
  if (typeof value === "string") return value.slice(0, MAX_PATH);
  if (typeof value === "object" && value !== null) {
    return text((value as { path?: unknown }).path, MAX_PATH);
  }
  return undefined;
}

function decorationOf(value: unknown): RailTreeNode["decoration"] {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { text?: unknown; parts?: unknown; title?: unknown };
  const parts = Array.isArray(record.parts)
    ? record.parts.slice(0, MAX_DECORATION_PARTS).flatMap((part: unknown) => {
        if (typeof part !== "object" || part === null) return [];
        const { text: partText, tone } = part as { text?: unknown; tone?: unknown };
        if (typeof partText !== "string") return [];
        return [
          Object.freeze({
            text: partText.slice(0, MAX_DECORATION_TEXT),
            ...(TONES.has(tone as RailTreeDecorationTone)
              ? { tone: tone as RailTreeDecorationTone }
              : {}),
          }),
        ];
      })
    : [];
  const plain = text(record.text, MAX_DECORATION_TEXT);
  if (parts.length === 0 && !plain) return undefined;
  return Object.freeze({
    text: plain,
    parts: Object.freeze(parts),
    title: text(record.title, MAX_TOOLTIP),
  });
}

function labelOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const label = (value as { label?: unknown }).label;
    if (typeof label === "string") return label;
  }
  return undefined;
}

/** A tree item as plain, capped data; `handle` is assigned by the caller. */
export function sanitizeTreeItem(
  item: omnigent.TreeItem,
  handle: string,
): { node: RailTreeNode; command: { command: string; args: unknown[] } | undefined } {
  const resourcePath = resourcePathOf(item.resourceUri);
  const label = (labelOf(item.label) ?? (resourcePath ? basename(resourcePath) : "")).slice(
    0,
    MAX_LABEL,
  );
  const description =
    (item.description as unknown) === true && resourcePath !== undefined
      ? dirname(resourcePath)
      : text(item.description, MAX_DESCRIPTION);
  const icon =
    item.iconPath === "file" || item.iconPath === "folder" || isRailViewIconName(item.iconPath)
      ? item.iconPath
      : undefined;
  const status = STATUSES.has(item.gitStatus as RailTreeItemStatus)
    ? (item.gitStatus as RailTreeItemStatus)
    : undefined;
  const rawCommand = item.command;
  const command =
    rawCommand && typeof rawCommand.command === "string" && rawCommand.command !== ""
      ? {
          command: rawCommand.command,
          args: Array.isArray(rawCommand.arguments) ? [...rawCommand.arguments] : [],
        }
      : undefined;
  const node: RailTreeNode = Object.freeze({
    handle,
    label,
    description,
    tooltip: text(item.tooltip, MAX_TOOLTIP),
    resourcePath,
    icon,
    decoration: decorationOf(item.decoration),
    status,
    collapsible: COLLAPSIBLE[item.collapsibleState ?? 0] ?? "none",
    hasCommand: command !== undefined,
    contextValue: text(item.contextValue, MAX_LABEL),
    size:
      typeof item.size === "number" && Number.isFinite(item.size) && item.size >= 0
        ? Math.floor(item.size)
        : undefined,
  });
  return { node, command };
}

async function settle<T>(value: T | PromiseLike<T>): Promise<T> {
  return isThenable<T>(value) ? await value : value;
}

interface RowCommand {
  command: string;
  args: unknown[];
}

/** The rail-side model of one tree view; `dispose` stops change events. */
export function createTreeViewModel<T>(
  provider: omnigent.TreeDataProvider<T>,
  options: TreeViewModelOptions,
): { model: RailTreeModel; dispose: () => void; refresh: () => void } {
  // Handles of the current root load and the one before it (rows still on screen
  // while a reload runs); older ones are dropped, so the maps do not grow.
  let elements = new Map<string, T>();
  let commands = new Map<string, RowCommand>();
  let previousElements = new Map<string, T>();
  let previousCommands = new Map<string, RowCommand>();
  const elementOf = (handle: string) =>
    elements.has(handle)
      ? { found: true, element: elements.get(handle) }
      : previousElements.has(handle)
        ? { found: true, element: previousElements.get(handle) }
        : { found: false, element: undefined };
  const listeners = new Set<() => void>();
  let disposed = false;
  const subscription =
    typeof provider.onDidChangeTreeData === "function"
      ? provider.onDidChangeTreeData(() => {
          if (disposed) return;
          for (const listener of [...listeners]) listener();
        })
      : undefined;

  const getChildren = async (parent: string | undefined): Promise<readonly RailTreeNode[]> => {
    if (disposed) return [];
    let element: T | undefined;
    if (parent !== undefined) {
      const lookup = elementOf(parent);
      if (!lookup.found) return [];
      element = lookup.element;
    } else {
      previousElements = elements;
      previousCommands = commands;
      elements = new Map();
      commands = new Map();
    }
    let children: T[] | null | undefined;
    try {
      children = await settle(provider.getChildren(element));
    } catch (error) {
      options.logError("getChildren failed", error);
      return [];
    }
    if (!Array.isArray(children)) return [];
    if (elements.size > MAX_ELEMENTS) elements.clear();
    // Children load after their parent's generation; keep them in the generation that has it.
    const targetElements =
      parent === undefined || elements.has(parent) ? elements : previousElements;
    const targetCommands = targetElements === elements ? commands : previousCommands;
    // Items resolve in parallel; handles are then assigned in order.
    const items = await Promise.all(
      children.slice(0, MAX_CHILDREN).map(async (child) => {
        try {
          return { child, item: await settle(provider.getTreeItem(child)) };
        } catch (error) {
          options.logError("getTreeItem failed", error);
          return undefined;
        }
      }),
    );
    if (disposed) return [];
    const used = new Set<string>();
    const nodes: RailTreeNode[] = [];
    for (const entry of items) {
      if (!entry || typeof entry.item !== "object" || entry.item === null) continue;
      const { child, item } = entry;
      // An item's id names it across refreshes; otherwise its label under its parent does.
      const base =
        typeof item.id === "string" && item.id !== ""
          ? `id:${item.id.slice(0, MAX_ID)}`
          : `${parent ?? ""}/${labelOf(item.label) ?? resourcePathOf(item.resourceUri) ?? ""}`;
      let handle = base;
      for (let copy = 2; used.has(handle); copy += 1) handle = `${base}#${copy}`;
      used.add(handle);
      const { node, command } = sanitizeTreeItem(item, handle);
      targetElements.set(handle, child);
      if (command) targetCommands.set(handle, command);
      else targetCommands.delete(handle);
      nodes.push(node);
    }
    return Object.freeze(nodes);
  };

  const model: RailTreeModel = {
    getChildren,
    ...(options.dataSessionId ? { dataSessionId: options.dataSessionId } : {}),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    runCommand: (handle) => {
      const command = commands.get(handle) ?? previousCommands.get(handle);
      if (!command || disposed) return;
      options.executeCommand(command.command, command.args).catch((error: unknown) => {
        options.logError(`command '${command.command}' failed`, error);
      });
    },
  };
  return {
    model,
    refresh: () => {
      if (disposed) return;
      for (const listener of [...listeners]) listener();
    },
    dispose: () => {
      disposed = true;
      listeners.clear();
      subscription?.dispose();
      elements.clear();
      commands.clear();
      previousElements.clear();
      previousCommands.clear();
    },
  };
}
