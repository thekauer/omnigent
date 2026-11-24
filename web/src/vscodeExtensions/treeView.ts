// Turns an extension's TreeDataProvider into the plain-data tree model the rail
// draws (`RailTreeModel`). Elements stay on this side; the rail only sees
// handles and checked, size-capped tree items.
import type * as omnigent from "omnigent";
import { isThenable } from "@/lib/thenable";
import type {
  RailRevealRequest,
  RailAgentState,
  RailAgentStatus,
  RailTreeDecorationTone,
  RailTreeItemCollapsible,
  RailTreeItemStatus,
  RailTreeModel,
  RailTreeNode,
} from "@/shell/railViews";
import { isRailViewIconName } from "@/shell/railViewIcons";

const MAX_LABEL = 200;
// Text-match lines and path labels keep their tail (a match past column 200, a deep path).
const MAX_LONG_LABEL = 2000;
const MAX_REVEAL_DEPTH = 64;
const MAX_REVEAL_EXPAND = 3;
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
const AGENT_STATES = new Set<RailAgentState>([
  "launching",
  "working",
  "awaiting",
  "done",
  "failed",
  "disconnected",
  "idle",
  "other",
]);
const MAX_HIGHLIGHTS = 32;
const MAX_AGENT_NAME = 100;

export interface TreeViewModelOptions {
  /** Runs a row's command; arguments are copied as JSON by the command registry. */
  executeCommand: (command: string, args: readonly unknown[]) => Promise<unknown>;
  logError: (message: string, error?: unknown) => void;
  /** The session the provider's data is for (the workspace on screen). */
  dataSessionId?: () => string | undefined;
}

/** The handle an element with a `TreeItem.id` gets (others are named by their label). */
export function handleOfId(id: string): string {
  return `id:${id.slice(0, MAX_ID)}`;
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

function isSessionResource(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { scheme?: unknown }).scheme === "session"
  );
}

function resourcePathOf(value: unknown): string | undefined {
  if (typeof value === "string") return value.slice(0, MAX_PATH);
  if (typeof value === "object" && value !== null && !isSessionResource(value)) {
    return text((value as { path?: unknown }).path, MAX_PATH);
  }
  return undefined;
}

function sessionIdOf(value: unknown): string | undefined {
  if (!isSessionResource(value)) return undefined;
  const path = text((value as { path?: unknown }).path, MAX_ID);
  return path ? path : undefined;
}

function highlightsOf(value: unknown, label: string): RailTreeNode["highlights"] {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = (value as { highlights?: unknown }).highlights;
  if (!Array.isArray(raw)) return undefined;
  const ranges = raw.slice(0, MAX_HIGHLIGHTS).flatMap((range: unknown) => {
    if (!Array.isArray(range) || range.length !== 2) return [];
    const [start, end] = range as unknown[];
    if (!Number.isInteger(start) || !Number.isInteger(end)) return [];
    const from = Math.max(0, Math.min(label.length, start as number));
    const to = Math.max(from, Math.min(label.length, end as number));
    return to > from ? [Object.freeze([from, to] as const)] : [];
  });
  return ranges.length > 0 ? Object.freeze(ranges) : undefined;
}

function agentIconOf(value: unknown): RailTreeNode["agentIcon"] {
  if (typeof value !== "object" || value === null) return undefined;
  const { agent, harness } = value as { agent?: unknown; harness?: unknown };
  if (typeof agent !== "string") return undefined;
  return Object.freeze({
    agent: agent.slice(0, MAX_AGENT_NAME),
    harness: typeof harness === "string" ? harness.slice(0, MAX_AGENT_NAME) : null,
  });
}

function agentStatusOf(value: unknown): RailAgentStatus | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { state, label, detail } = value as { state?: unknown; label?: unknown; detail?: unknown };
  if (!AGENT_STATES.has(state as RailAgentState)) return undefined;
  return Object.freeze({
    state: state as RailAgentState,
    label: text(label, MAX_LABEL) ?? String(state),
    detail: text(detail, MAX_TOOLTIP),
  });
}

function decorationOf(value: unknown): RailTreeNode["decoration"] {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { text?: unknown; parts?: unknown; title?: unknown };
  const parts = Array.isArray(record.parts)
    ? record.parts.slice(0, MAX_DECORATION_PARTS).flatMap((part: unknown) => {
        if (typeof part !== "object" || part === null) return [];
        const {
          text: partText,
          tone,
          tooltip,
        } = part as { text?: unknown; tone?: unknown; tooltip?: unknown };
        if (typeof partText !== "string") return [];
        const partTooltip = text(tooltip, MAX_TOOLTIP);
        return [
          Object.freeze({
            text: partText.slice(0, MAX_DECORATION_TEXT),
            ...(TONES.has(tone as RailTreeDecorationTone)
              ? { tone: tone as RailTreeDecorationTone }
              : {}),
            ...(partTooltip === undefined ? {} : { tooltip: partTooltip }),
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
  const rawLabel = labelOf(item.label) ?? (resourcePath ? basename(resourcePath) : "");
  const longLabel =
    Number.isInteger((item as { line?: unknown }).line) ||
    (resourcePath !== undefined && rawLabel.includes("/"));
  const label = rawLabel.slice(0, longLabel ? MAX_LONG_LABEL : MAX_LABEL);
  const description =
    (item.description as unknown) === true && resourcePath !== undefined
      ? dirname(resourcePath)
      : text(item.description, MAX_DESCRIPTION);
  const icon =
    item.iconPath === "file" || item.iconPath === "folder" || isRailViewIconName(item.iconPath)
      ? (item.iconPath as string)
      : undefined;
  const accessible = (item as { accessibilityInformation?: { label?: unknown } })
    .accessibilityInformation;
  const line = (item as { line?: unknown }).line;
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
    highlights: highlightsOf(item.label, label),
    line: Number.isInteger(line) && (line as number) > 0 ? (line as number) : undefined,
    accessibleLabel: text(accessible?.label, MAX_TOOLTIP),
    sessionId: sessionIdOf(item.resourceUri),
    agentIcon: agentIconOf(item.iconPath),
    agentStatus: agentStatusOf((item as { status?: unknown }).status),
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

export interface TreeViewModelHandle<T> {
  model: RailTreeModel;
  dispose: () => void;
  refresh: () => void;
  /** Asks the drawn tree of `sessionId` to reveal `element` (now, or once drawn). */
  reveal: (
    element: T,
    options: omnigent.TreeViewRevealOptions | undefined,
    sessionId: string | undefined,
  ) => Promise<void>;
  /** The selected elements, from the latest selection the drawn tree reported. */
  readonly selection: () => readonly T[];
  /** Fires with the new selection when the drawn tree changes it. */
  onSelection: (listener: (selection: readonly T[]) => void) => () => void;
}

const sessionKeyOf = (sessionId: string | undefined) => sessionId ?? "";

/** The rail-side model of one tree view; `dispose` stops change events. */
export function createTreeViewModel<T>(
  provider: omnigent.TreeDataProvider<T>,
  options: TreeViewModelOptions,
): TreeViewModelHandle<T> {
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
          ? handleOfId(item.id)
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

  // Reveals waiting for their session's tree to be drawn, one per session (the latest wins).
  const pendingReveals = new Map<string, RailRevealRequest>();
  const revealListeners = new Set<() => void>();
  let selection: readonly T[] = Object.freeze([]);
  const selectionListeners = new Set<(selection: readonly T[]) => void>();

  const handleOf = async (element: T): Promise<string> => {
    const item = await settle(provider.getTreeItem(element));
    if (typeof item?.id !== "string" || item.id === "") {
      throw new Error("reveal needs a TreeItem.id on the element and its ancestors");
    }
    return handleOfId(item.id);
  };

  const reveal = async (
    element: T,
    revealOptions: omnigent.TreeViewRevealOptions | undefined,
    sessionId: string | undefined,
  ): Promise<void> => {
    if (disposed) return;
    if (typeof provider.getParent !== "function") {
      throw new Error("reveal needs a TreeDataProvider with getParent");
    }
    const handle = await handleOf(element);
    const ancestors: string[] = [];
    let current: T | null | undefined = await settle(provider.getParent(element));
    while (current !== null && current !== undefined) {
      if (ancestors.length >= MAX_REVEAL_DEPTH) throw new Error("reveal: the tree is too deep");
      // Each parent is only known once its child's lookup answered: one level at a time.
      // oxlint-disable-next-line no-await-in-loop
      ancestors.unshift(await handleOf(current));
      // oxlint-disable-next-line no-await-in-loop
      current = await settle(provider.getParent(current));
    }
    const expand = revealOptions?.expand;
    const request: RailRevealRequest = Object.freeze({
      handle,
      ancestors: Object.freeze(ancestors),
      select: revealOptions?.select !== false,
      focus: revealOptions?.focus === true,
      expand:
        expand === true
          ? 1
          : typeof expand === "number" && Number.isFinite(expand)
            ? Math.max(0, Math.min(MAX_REVEAL_EXPAND, Math.floor(expand)))
            : 0,
    });
    if (disposed) return;
    pendingReveals.set(sessionKeyOf(sessionId), request);
    for (const listener of [...revealListeners]) listener();
  };

  const model: RailTreeModel = {
    getChildren,
    takeReveal: (sessionId) => {
      const key = sessionKeyOf(sessionId);
      const request = pendingReveals.get(key);
      pendingReveals.delete(key);
      return request;
    },
    subscribeReveal: (listener) => {
      revealListeners.add(listener);
      return () => revealListeners.delete(listener);
    },
    select: (handles) => {
      if (disposed) return;
      const next = handles.flatMap((handle) => {
        const lookup = elementOf(handle);
        return lookup.found ? [lookup.element as T] : [];
      });
      if (
        next.length === selection.length &&
        next.every((value, index) => value === selection[index])
      ) {
        return;
      }
      selection = Object.freeze(next);
      for (const listener of [...selectionListeners]) listener(selection);
    },
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
    reveal,
    selection: () => selection,
    onSelection: (listener) => {
      selectionListeners.add(listener);
      return () => selectionListeners.delete(listener);
    },
    refresh: () => {
      if (disposed) return;
      for (const listener of [...listeners]) listener();
    },
    dispose: () => {
      disposed = true;
      listeners.clear();
      revealListeners.clear();
      selectionListeners.clear();
      pendingReveals.clear();
      subscription?.dispose();
      elements.clear();
      commands.clear();
      previousElements.clear();
      previousCommands.clear();
    },
  };
}
