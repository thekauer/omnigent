// The layout state store (layout plan L2): what the user dragged and toggled, as VS Code keeps
// in storage rather than settings (and Theia's `ShellLayoutRestorer` restores): the side bar's
// open state, panel widths, the conversation list's view and collapsed sections. One versioned
// document under `omnigent:layout-state`, by slot; each slot's owner checks what it reads. The
// keys these lived under before are carried into it on the first read and removed once the
// document is written.

import { toast } from "sonner";

/** The document's storage key: `{ version: 1, state: { <slot>: <value> } }`. */
export const LAYOUT_STATE_STORAGE_KEY = "omnigent:layout-state";

/** The slots the built-in layout keeps. */
export const LAYOUT_SLOTS = Object.freeze({
  /** `{ visible: boolean }`: the primary side bar's desktop open state. */
  sidebar: "workbench.parts.sidebar",
  /** The view container the primary side bar shows (absent: the sessions). */
  activeViewContainer: "workbench.sideBar.activeViewContainer",
  /** `"open"` or `"collapsed"`: how the secondary side bar was last left, for new sessions. */
  auxiliaryBarLastVisibility: "workbench.auxiliaryBar.lastVisibility",
  /** `{ order?: string[], hidden?: string[] }`: the activity bar's items the user moved or hid. */
  activityBar: "workbench.activityBar",
  /** The resizable panels' widths and shares (`lib/panelSizePreferences.ts`). */
  panelSizes: "workbench.panelSizes",
  /** The conversation list's grouping, ordering and fields (`lib/sidebarViewPreferences.ts`). */
  conversationsView: "omnigent.conversations.list.view",
  /** Titles of the conversation list's collapsed sections. */
  collapsedSections: "omnigent.conversations.list.collapsedSections",
  /** Names of the expanded project folders. */
  expandedProjects: "omnigent.conversations.list.expandedProjects",
  /** Ids of the side bar's navigation entries the user hid (`sidebar/navigation` commands). */
  hiddenNavigationEntries: "omnigent.conversations.navigation.hidden",
  /** Ids of the collapsed session families. */
  collapsedFamilies: "omnigent.conversations.list.collapsedFamilies",
  /** `{ [view id]: { collapsed?: boolean, hidden?: boolean } }`: stacked views the user changed. */
  views: "workbench.views",
  /** `{ [view id]: container id }`: the views the user moved to another container. */
  viewLocations: "workbench.views.locations",
});

/** The keys each slot was stored under before the layout state document. */
export const LEGACY_LAYOUT_STORAGE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  "omnigent:panel-size-preferences": LAYOUT_SLOTS.panelSizes,
  "omnigent:sidebar-view": LAYOUT_SLOTS.conversationsView,
  "omnigent:collapsed-sidebar-sections": LAYOUT_SLOTS.collapsedSections,
  "omnigent:expanded-project-sections": LAYOUT_SLOTS.expandedProjects,
  "omnigent:collapsed-session-families": LAYOUT_SLOTS.collapsedFamilies,
});

/** The largest document stored: a write past it is dropped (the in-memory state stays). */
export const LAYOUT_STATE_MAX_CHARS = 1_048_576;

const VERSION = 1;

type LayoutStateValues = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** The stored document's slots, or none for anything unreadable or of another version. */
export function readLayoutStateText(raw: string | null): LayoutStateValues {
  const record = parseJson(raw);
  if (!isRecord(record) || record.version !== VERSION || !isRecord(record.state)) {
    return Object.freeze({});
  }
  const state: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [slot, value] of Object.entries(record.state)) {
    if (slot !== "__proto__" && value !== undefined) state[slot] = value;
  }
  return Object.freeze(state);
}

/** What a slot change says: the slots written (every one on a reset or another tab's write). */
export interface LayoutStateChange {
  readonly slots?: readonly string[];
}

/** The layout state scope of an embed mounted at `basename`: its own document. */
export function embedLayoutScope(basename: string | undefined): string {
  return `embed:${basename && basename !== "" ? basename : "/"}`;
}

export class LayoutStateStore {
  private readonly baseKey: string;
  private readonly baseLegacy: Readonly<Record<string, string>>;
  /** Whose document this is: "" for the standalone app, `embed:<basename>` for an embed. */
  private scope = "";
  private readonly listeners = new Set<(change: LayoutStateChange) => void>();
  private cache: { stored: readonly (string | null)[]; values: LayoutStateValues } | null = null;
  /** The values while storage refuses writes (quota, privacy mode), so the window keeps them. */
  private unsaved: LayoutStateValues | null = null;

  constructor(
    storageKey: string = LAYOUT_STATE_STORAGE_KEY,
    legacy: Readonly<Record<string, string>> = LEGACY_LAYOUT_STORAGE_KEYS,
  ) {
    this.baseKey = storageKey;
    this.baseLegacy = legacy;
  }

  private get storageKey(): string {
    return this.scope === "" ? this.baseKey : `${this.baseKey}@${this.scope}`;
  }

  /** The old keys are the standalone app's: only its document carries them in. */
  private get legacy(): Readonly<Record<string, string>> {
    return this.scope === "" ? this.baseLegacy : {};
  }

  getScope(): string {
    return this.scope;
  }

  /**
   * Keeps the state of `scope` from now on (an embed's own, by its basename, so an embed and
   * the standalone app on one origin don't share their layout); listeners hear every slot.
   */
  setScope(scope: string): void {
    if (scope === this.scope) return;
    this.scope = scope;
    this.cache = null;
    this.unsaved = null;
    this.fire({});
  }

  private storedTexts(): (string | null)[] {
    return [this.storageKey, ...Object.keys(this.legacy)].map(readStorage);
  }

  /** Every slot, after carrying the legacy keys in (a slot the document has keeps its value). */
  private values(): LayoutStateValues {
    if (typeof window === "undefined") return Object.freeze({});
    if (this.unsaved) return this.unsaved;
    const stored = this.storedTexts();
    if (this.cache && this.cache.stored.every((text, index) => text === stored[index])) {
      return this.cache.values;
    }
    const [raw = null, ...legacyRaw] = stored;
    let values = readLayoutStateText(raw);
    const legacyKeys = Object.keys(this.legacy);
    if (legacyRaw.some((text) => text !== null)) {
      const merged: Record<string, unknown> = { ...values };
      legacyKeys.forEach((legacyKey, index) => {
        const slot = this.legacy[legacyKey]!;
        const value = parseJson(legacyRaw[index] ?? null);
        // Carrying a key in removes it, so one still there was written since: by a build from
        // before the document (rolled back to), and it is newer than the document's slot.
        if (value !== undefined) merged[slot] = value;
      });
      values = Object.freeze(merged);
      if (this.persist(values)) {
        for (const legacyKey of legacyKeys) {
          try {
            window.localStorage.removeItem(legacyKey);
          } catch {
            // Read again next time.
          }
        }
      }
    }
    this.cache = { stored: this.storedTexts(), values };
    return values;
  }

  /**
   * Writes the document; false when storage refused it, or holds a newer version's document
   * (a build rolled back keeps its changes in memory rather than erase the newer one's).
   */
  private persist(values: LayoutStateValues): boolean {
    const text = JSON.stringify({ version: VERSION, state: values });
    if (text.length > LAYOUT_STATE_MAX_CHARS) return false;
    const existing = parseJson(readStorage(this.storageKey));
    // Only a well-formed newer version is kept: `1e999` or `1.5` is a corrupt document.
    if (
      isRecord(existing) &&
      Number.isSafeInteger(existing.version) &&
      (existing.version as number) > VERSION
    ) {
      return false;
    }
    try {
      window.localStorage.setItem(this.storageKey, text);
      return true;
    } catch {
      return false;
    }
  }

  /** The value of `slot`, as stored (its owner checks it), or undefined. */
  get(slot: string): unknown {
    const values = this.values();
    return Object.hasOwn(values, slot) ? values[slot] : undefined;
  }

  /** Stores `value` (undefined removes it) at `slot`. */
  set(slot: string, value: unknown): void {
    if (typeof window === "undefined") return;
    const current = this.values();
    if (value === undefined && !Object.hasOwn(current, slot)) return;
    const next = Object.fromEntries(Object.entries(current).filter(([key]) => key !== slot));
    if (value !== undefined) next[slot] = value;
    const values = Object.freeze(next);
    if (this.persist(values)) {
      this.unsaved = null;
      this.cache = { stored: this.storedTexts(), values };
    } else {
      if (this.unsaved === null) this.warnUnsaved();
      this.unsaved = values;
    }
    this.fire({ slots: [slot] });
  }

  private warnedUnsaved = false;

  /** The layout can't be stored (over the size cap, storage refused): say so, once. */
  private warnUnsaved(): void {
    if (this.warnedUnsaved) return;
    this.warnedUnsaved = true;
    console.warn("[layout] the layout state can't be stored; changes last for this window only");
    toast.warning("Layout changes last for this window only", {
      description: "The browser's storage refused them, or they are too large to keep.",
    });
  }

  /** Removes every slot (View: Reset Layout). */
  reset(): void {
    if (typeof window === "undefined") return;
    this.unsaved = null;
    this.cache = null;
    try {
      window.localStorage.removeItem(this.storageKey);
      for (const legacyKey of Object.keys(this.legacy)) window.localStorage.removeItem(legacyKey);
    } catch {
      // Storage refused: nothing to clear.
    }
    this.fire({});
  }

  subscribe(listener: (change: LayoutStateChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private fire(change: LayoutStateChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        console.error("[layout] a layout state listener failed", error);
      }
    }
  }
}

/** The window's layout state. */
export const layoutState = new LayoutStateStore();
