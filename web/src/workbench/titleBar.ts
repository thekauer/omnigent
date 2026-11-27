// The title bar (layout plan L7): a part above the workbench with three regions, `left`,
// `center` and `right`. Each region draws, in order, the built-in items (the built-in
// `omnigent.workbench` extension's `titleBar/*` menu entries the host draws itself: the brand,
// the command center, the layout controls, the account), other extensions' `titleBar/*` command
// entries, and the text items extensions create (`window.createTitleBarItem`). Hidden by default
// (`window.titleBar.visible`); never on phones. Plain data, plus the React reads.

import { useSyncExternalStore } from "react";
import workbenchManifest from "@/builtinExtensions/omnigent.workbench/package.json";
import {
  type ConfigurationService,
  configurationService,
} from "@/configuration/configurationService";
import { useConfigurationValue } from "@/configuration/useConfiguration";
import {
  parseContributions,
  type TitleBarItemKind,
  type TitleBarRegion,
} from "@/vscodeExtensions/contributions";
import {
  type SessionHeaderItemSnapshot,
  SessionHeaderItemRegistry,
} from "@/vscodeExtensions/sessionHeaderItems";
import type { WhenClause } from "@/vscodeExtensions/when";
import type * as omnigent from "omnigent";

export const TITLE_BAR_VISIBLE_SETTING = "window.titleBar.visible";
export const COMMAND_CENTER_SETTING = "window.commandCenter";
export const LAYOUT_CONTROL_SETTING = "workbench.layoutControl.enabled";

export const TITLE_BAR_REGIONS: readonly TitleBarRegion[] = Object.freeze([
  "left",
  "center",
  "right",
]);

/** Whether the title bar is on (`window.titleBar.visible`); off when nothing sets it. */
export function useTitleBarSetting(service: ConfigurationService = configurationService): boolean {
  return useConfigurationValue(TITLE_BAR_VISIBLE_SETTING, service) === true;
}

/** One `titleBar/*` menu entry: a built-in item, or a command button. */
export interface TitleBarMenuEntry {
  readonly region: TitleBarRegion;
  /** The command a button runs; empty for a built-in item. */
  readonly command: string;
  readonly builtInItem: TitleBarItemKind | undefined;
  readonly title: string;
  readonly icon: string | undefined;
  readonly tooltip: string | undefined;
  readonly when: WhenClause | undefined;
  readonly extensionId: string;
  /** VS Code's `group` (with an `@order`), which orders the region's buttons. */
  readonly group?: string | undefined;
}

let builtIns: readonly TitleBarMenuEntry[] | undefined;

/** The built-in items, as the workbench extension's manifest lists them. */
export function builtInTitleBarEntries(): readonly TitleBarMenuEntry[] {
  builtIns ??= (() => {
    const { contributions } = parseContributions(
      "omnigent.workbench",
      workbenchManifest.contributes,
      { builtIn: true },
    );
    return Object.freeze(
      contributions.titleBarMenu.map((item) =>
        Object.freeze({
          region: item.region,
          command: item.command,
          builtInItem: item.builtInItem,
          title: item.builtInItem ?? item.command,
          icon: undefined,
          tooltip: item.tooltip,
          when: item.when,
          extensionId: "omnigent.workbench",
        }),
      ),
    );
  })();
  return builtIns;
}

/** Another extension's command entry, as the views service keeps it under the context keys. */
export interface ContributedTitleBarEntry extends TitleBarMenuEntry {
  /** Whether its `when` holds now. */
  readonly active: boolean;
}

class ContributedTitleBarEntries {
  private entries: readonly ContributedTitleBarEntry[] = Object.freeze([]);
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): readonly ContributedTitleBarEntry[] => this.entries;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(entries: readonly ContributedTitleBarEntry[]): void {
    const key = (list: readonly ContributedTitleBarEntry[]) =>
      JSON.stringify(
        list.map((entry) => [
          entry.region,
          entry.command,
          entry.title,
          entry.icon,
          entry.tooltip,
          entry.extensionId,
          entry.active,
        ]),
      );
    if (key(entries) === key(this.entries)) return;
    this.entries = Object.freeze([...entries]);
    for (const listener of [...this.listeners]) listener();
  }
}

/** VS Code's menu order: by group (`navigation` first, then by name), then `@order`. */
export function compareTitleBarEntries(
  left: { readonly group?: string | undefined },
  right: { readonly group?: string | undefined },
): number {
  const parse = (group: string | undefined) => {
    const [name = "", order] = (group ?? "").split("@");
    return { name, order: order === undefined ? 0 : Number(order) || 0 };
  };
  const a = parse(left.group);
  const b = parse(right.group);
  const rank = (name: string) => (name === "navigation" ? 0 : name === "" ? 2 : 1);
  return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name) || a.order - b.order;
}

/** The window's contributed `titleBar/*` entries. */
export const contributedTitleBarEntries = new ContributedTitleBarEntries();

export function useContributedTitleBarEntries(): readonly ContributedTitleBarEntry[] {
  return useSyncExternalStore(
    contributedTitleBarEntries.subscribe,
    contributedTitleBarEntries.getSnapshot,
    contributedTitleBarEntries.getSnapshot,
  );
}

// --- text items (`window.createTitleBarItem`) -----------------------------------------

/** What a title bar item runs when clicked: a command id, or VS Code's `Command`. */
export interface TitleBarItemCommand {
  readonly command: string;
  readonly arguments: readonly unknown[];
}

export interface TitleBarItemSnapshot extends SessionHeaderItemSnapshot {
  readonly region: TitleBarRegion;
  readonly command: TitleBarItemCommand | undefined;
}

/** A title bar item's command as given: a command id, or `{ command, arguments? }`. */
export function titleBarItemCommandOf(value: unknown): TitleBarItemCommand | undefined {
  if (typeof value === "string")
    return value === "" ? undefined : { command: value, arguments: [] };
  if (typeof value !== "object" || value === null) return undefined;
  const { command, arguments: args } = value as { command?: unknown; arguments?: unknown };
  if (typeof command !== "string" || command === "") return undefined;
  // Copied as JSON, as a tree item's command is.
  let copied: unknown[];
  try {
    copied = Array.isArray(args) ? (JSON.parse(JSON.stringify(args)) as unknown[]) : [];
  } catch {
    copied = [];
  }
  return Object.freeze({ command, arguments: copied });
}

/**
 * The text items extensions create, per region: each region is a session header item
 * registry (the same text, tooltip and colour handling, higher priority further left), and
 * the item's command is kept beside it.
 */
export class TitleBarItemRegistry {
  private readonly regions = new Map<TitleBarRegion, SessionHeaderItemRegistry>(
    TITLE_BAR_REGIONS.map((region) => [region, new SessionHeaderItemRegistry()]),
  );
  private readonly commands = new Map<string, TitleBarItemCommand>();
  /** Every item's id, across the regions: ids are unique in the window, as VS Code's. */
  private readonly ids = new Set<string>();
  private generatedIds = 0;
  private readonly listeners = new Set<() => void>();
  private snapshot: ReadonlyMap<TitleBarRegion, readonly TitleBarItemSnapshot[]> = new Map();

  constructor() {
    for (const registry of this.regions.values()) registry.subscribe(() => this.publish());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ReadonlyMap<TitleBarRegion, readonly TitleBarItemSnapshot[]> => this.snapshot;

  create(
    extensionId: string,
    id: string | undefined,
    region: unknown,
    priority: number | undefined,
    colorOf?: (value: unknown) => string | undefined,
  ): omnigent.TitleBarItem {
    const known = region === "left" || region === "center" || region === "right";
    if (region !== undefined && !known) {
      console.warn(
        `[omnigent-extensions] ${extensionId}: title bar region ${JSON.stringify(region)} is not left, center or right; using right`,
      );
    }
    const where: TitleBarRegion = known ? region : "right";
    // One id space for every region: a second item named the same gets a suffix.
    let local = id ?? `item${++this.generatedIds}`;
    if (this.ids.has(`${extensionId}.${local}`)) {
      console.warn(
        `[omnigent-extensions] ${extensionId}: duplicate title bar item ${extensionId}.${local}`,
      );
      let suffix = 2;
      while (this.ids.has(`${extensionId}.${local}#${suffix}`)) suffix += 1;
      local = `${local}#${suffix}`;
    }
    this.ids.add(`${extensionId}.${local}`);
    const item = this.regions.get(where)!.create(extensionId, local, 1, priority, colorOf);
    const ids = this.ids;
    let given: string | omnigent.Command | undefined;
    const commands = this.commands;
    const publish = () => this.publish();
    return {
      id: item.id,
      region: where,
      priority: item.priority,
      get text() {
        return item.text;
      },
      set text(value: string) {
        item.text = value;
      },
      get tooltip() {
        return item.tooltip;
      },
      set tooltip(value: string | undefined) {
        item.tooltip = value;
      },
      get color() {
        return item.color;
      },
      set color(value: string | omnigent.ThemeColor | undefined) {
        item.color = value;
      },
      get command() {
        return given;
      },
      set command(value: string | omnigent.Command | undefined) {
        given = value ?? undefined;
        const command = titleBarItemCommandOf(value);
        if (command) commands.set(item.id, command);
        else commands.delete(item.id);
        publish();
      },
      show: () => item.show(),
      hide: () => item.hide(),
      dispose: () => {
        commands.delete(item.id);
        ids.delete(item.id);
        item.dispose();
      },
    };
  }

  private publish(): void {
    const next = new Map<TitleBarRegion, readonly TitleBarItemSnapshot[]>();
    for (const [region, registry] of this.regions) {
      const items = registry.getSnapshot();
      if (items.length === 0) continue;
      next.set(
        region,
        Object.freeze(
          items.map((item) =>
            Object.freeze({ ...item, region, command: this.commands.get(item.key) }),
          ),
        ),
      );
    }
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }
}

/** The window's title bar items. */
export const titleBarItems = new TitleBarItemRegistry();

export function useTitleBarItems(
  registry: TitleBarItemRegistry = titleBarItems,
): ReadonlyMap<TitleBarRegion, readonly TitleBarItemSnapshot[]> {
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
}
