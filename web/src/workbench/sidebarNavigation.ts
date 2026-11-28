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
import { useDefaultHiddenViews } from "./defaultHiddenViews";
import { LAYOUT_SLOTS, type LayoutStateStore, layoutState } from "./layoutState";
import { matchesIdPattern } from "./productLayout";
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

/**
 * What the user chose for each navigation entry, by command id: `true` hidden, `false` shown.
 * An entry not here takes the defaults (`workbench.view.defaultHidden`). The slot used to hold
 * the hidden ids as a list; a list reads as hidden.
 */
export type NavigationEntryChoices = Readonly<Record<string, boolean>>;

const NO_CHOICES: NavigationEntryChoices = Object.freeze({});

export function readNavigationEntryChoices(store: LayoutStateStore): NavigationEntryChoices {
  const stored: unknown = store.get(LAYOUT_SLOTS.hiddenNavigationEntries);
  if (Array.isArray(stored)) {
    const ids = [...new Set(stored.filter((id): id is string => typeof id === "string"))];
    return withoutProto(Object.fromEntries(ids.map((id) => [id, true])));
  }
  if (typeof stored !== "object" || stored === null) return NO_CHOICES;
  return withoutProto(
    Object.fromEntries(
      Object.entries(stored).filter(([, value]) => typeof value === "boolean"),
    ) as Record<string, boolean>,
  );
}

function withoutProto(choices: Record<string, boolean>): NavigationEntryChoices {
  const kept = Object.fromEntries(Object.entries(choices).filter(([id]) => id !== "__proto__"));
  return Object.keys(kept).length === 0 ? NO_CHOICES : Object.freeze(kept);
}

/** The entries the user hid (not the ones the defaults hide). */
export function readHiddenNavigationEntries(
  store: LayoutStateStore = layoutState,
): readonly string[] {
  const choices = readNavigationEntryChoices(store);
  return Object.freeze(Object.keys(choices).filter((id) => choices[id] === true));
}

/** Shows or hides an entry; the choice is stored either way, so a default doesn't undo it. */
export function setNavigationEntryHidden(
  id: string,
  hidden: boolean,
  store: LayoutStateStore = layoutState,
): void {
  const choices = { ...readNavigationEntryChoices(store), [id]: hidden };
  store.set(LAYOUT_SLOTS.hiddenNavigationEntries, choices);
}

/** Whether the user's choice, or failing one the defaults, hides the entry `id`. */
export function isNavigationEntryHidden(
  id: string,
  choices: NavigationEntryChoices,
  defaults: readonly string[],
): boolean {
  return Object.hasOwn(choices, id) ? choices[id] === true : matchesIdPattern(id, defaults);
}

/** The last choices read per store: each mount's snapshot stays stable on its own. */
const choicesCaches = new WeakMap<
  LayoutStateStore,
  { text: string; choices: NavigationEntryChoices }
>();

function useNavigationEntryChoices(given?: LayoutStateStore): NavigationEntryChoices {
  // The mount's own layout state unless one is given.
  const scoped = useWorkbenchScope().state;
  const store = given ?? scoped;
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  return useSyncExternalStore(
    subscribe,
    () => {
      const choices = readNavigationEntryChoices(store);
      const text = JSON.stringify(choices);
      const cached = choicesCaches.get(store);
      if (cached?.text === text) return cached.choices;
      choicesCaches.set(store, { text, choices });
      return choices;
    },
    () => NO_CHOICES,
  );
}

/** Whether an entry is hidden now, by the user's choice or the defaults; re-read on a change. */
export function useNavigationEntryHidden(given?: LayoutStateStore): (id: string) => boolean {
  const choices = useNavigationEntryChoices(given);
  const defaults = useDefaultHiddenViews();
  return useCallback(
    (id: string) => isNavigationEntryHidden(id, choices, defaults),
    [choices, defaults],
  );
}
