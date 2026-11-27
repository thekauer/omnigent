// The side bar's navigation (layout plan L5, decision 10): the `omnigent.conversations.navigation`
// view draws the entries of the `sidebar/navigation` menu, each a command with a title and an
// icon, gated by its `when`. The built-in entries (New session, Automations, Workflows, Inbox,
// Canvas, the extension pages, Usage) are the sessions container's own menu, drawn as the host's
// rows; other extensions add command entries after them. The user hides entries (layout state,
// by command id, e.g. `omnigent.newSession`); products will too (layout plan L8).

import { useCallback, useSyncExternalStore } from "react";
import conversationsManifest from "@/builtinExtensions/omnigent.conversations/package.json";
import { parseContributions } from "@/vscodeExtensions/contributions";
import type { WhenClause } from "@/vscodeExtensions/when";
import { LAYOUT_SLOTS, type LayoutStateStore, layoutState } from "./layoutState";
import { useWorkbenchScope } from "./workbenchScope";

export interface NavigationEntry {
  /** The command the entry runs (and its id for hiding). */
  readonly id: string;
  readonly title: string;
  /** A name from the view icon allowlist. */
  readonly icon: string | undefined;
  readonly when: WhenClause | undefined;
  readonly extensionId: string;
  /** The sessions container's own: drawn as the host's row. */
  readonly builtIn: boolean;
}

/** The ids of the built-in entries. */
export const NavigationEntries = Object.freeze({
  newSession: "omnigent.newSession",
  automations: "omnigent.openAutomations",
  workflows: "omnigent.openWorkflows",
  inbox: "omnigent.openInbox",
  canvas: "omnigent.openCanvas",
  extensionPages: "omnigent.showExtensionPages",
  usage: "omnigent.openUsage",
});

let builtIns: readonly NavigationEntry[] | undefined;

/** The sessions container's own entries, in its manifest's order. */
export function builtInNavigationEntries(): readonly NavigationEntry[] {
  builtIns ??= (() => {
    const { contributions } = parseContributions(
      "omnigent.conversations",
      conversationsManifest.contributes,
      { builtIn: true },
    );
    return Object.freeze(
      contributions.navigationMenu.map((item) => {
        const command = contributions.commands.find((info) => info.command === item.command);
        return Object.freeze({
          id: item.command,
          title: command?.title ?? item.command,
          icon: command?.icon,
          when: item.when,
          extensionId: "omnigent.conversations",
          builtIn: true,
        });
      }),
    );
  })();
  return builtIns;
}

/** Other extensions' entries, as the views service keeps them under the context keys. */
export interface ContributedNavigationEntry extends NavigationEntry {
  /** Whether its `when` holds now. */
  readonly active: boolean;
}

class ContributedNavigation {
  private entries: readonly ContributedNavigationEntry[] = Object.freeze([]);
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): readonly ContributedNavigationEntry[] => this.entries;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(entries: readonly ContributedNavigationEntry[]): void {
    if (JSON.stringify(entries.map(keyOf)) === JSON.stringify(this.entries.map(keyOf))) return;
    this.entries = Object.freeze([...entries]);
    for (const listener of [...this.listeners]) listener();
  }
}

function keyOf(entry: ContributedNavigationEntry): unknown[] {
  return [entry.id, entry.title, entry.icon, entry.extensionId, entry.active];
}

/** The window's contributed navigation entries. */
export const contributedNavigation = new ContributedNavigation();

export function useContributedNavigation(): readonly ContributedNavigationEntry[] {
  return useSyncExternalStore(
    contributedNavigation.subscribe,
    contributedNavigation.getSnapshot,
    contributedNavigation.getSnapshot,
  );
}

const NO_HIDDEN: readonly string[] = Object.freeze([]);

/** The entries the user hid, by id. */
export function readHiddenNavigationEntries(
  store: LayoutStateStore = layoutState,
): readonly string[] {
  const stored = store.get(LAYOUT_SLOTS.hiddenNavigationEntries);
  return Array.isArray(stored)
    ? Object.freeze([...new Set(stored.filter((id): id is string => typeof id === "string"))])
    : NO_HIDDEN;
}

export function setNavigationEntryHidden(
  id: string,
  hidden: boolean,
  store: LayoutStateStore = layoutState,
): void {
  const others = readHiddenNavigationEntries(store).filter((entry) => entry !== id);
  const next = hidden ? [...others, id] : others;
  store.set(LAYOUT_SLOTS.hiddenNavigationEntries, next.length > 0 ? next : undefined);
}

let hiddenCache: { text: string; ids: readonly string[] } | undefined;

export function useHiddenNavigationEntries(given?: LayoutStateStore): readonly string[] {
  // The mount's own layout state unless one is given.
  const scoped = useWorkbenchScope().state;
  const store = given ?? scoped;
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  return useSyncExternalStore(
    subscribe,
    () => {
      const ids = readHiddenNavigationEntries(store);
      const text = ids.join("\n");
      if (hiddenCache?.text !== text) hiddenCache = { text, ids };
      return hiddenCache.ids;
    },
    () => NO_HIDDEN,
  );
}
