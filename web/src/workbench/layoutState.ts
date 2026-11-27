// The layout state store (layout plan L2): what the user dragged and toggled, as VS Code keeps
// in storage rather than settings (and Theia's `ShellLayoutRestorer` restores): the side bar's
// open state, panel widths, the conversation list's view and collapsed sections. One versioned
// document under `omnigent:layout-state`, by slot; each slot's owner checks what it reads. The
// keys these lived under before are carried into it on the first read and removed once the
// document is written.

/** The document's storage key: `{ version: 1, state: { <slot>: <value> } }`. */
export const LAYOUT_STATE_STORAGE_KEY = "omnigent:layout-state";

/** The slots the built-in layout keeps. */
export const LAYOUT_SLOTS = Object.freeze({
  /** `{ visible: boolean }`: the primary side bar's desktop open state. */
  sidebar: "workbench.parts.sidebar",
  /** The resizable panels' widths and shares (`lib/panelSizePreferences.ts`). */
  panelSizes: "workbench.panelSizes",
  /** The conversation list's grouping, ordering and fields (`lib/sidebarViewPreferences.ts`). */
  conversationsView: "omnigent.conversations.list.view",
  /** Titles of the conversation list's collapsed sections. */
  collapsedSections: "omnigent.conversations.list.collapsedSections",
  /** Names of the expanded project folders. */
  expandedProjects: "omnigent.conversations.list.expandedProjects",
  /** Ids of the collapsed session families. */
  collapsedFamilies: "omnigent.conversations.list.collapsedFamilies",
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

export class LayoutStateStore {
  private readonly storageKey: string;
  private readonly legacy: Readonly<Record<string, string>>;
  private readonly listeners = new Set<(change: LayoutStateChange) => void>();
  private cache: { stored: readonly (string | null)[]; values: LayoutStateValues } | null = null;
  /** The values while storage refuses writes (quota, privacy mode), so the window keeps them. */
  private unsaved: LayoutStateValues | null = null;

  constructor(
    storageKey: string = LAYOUT_STATE_STORAGE_KEY,
    legacy: Readonly<Record<string, string>> = LEGACY_LAYOUT_STORAGE_KEYS,
  ) {
    this.storageKey = storageKey;
    this.legacy = legacy;
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
        if (value !== undefined && !Object.hasOwn(merged, slot)) merged[slot] = value;
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

  /** Writes the document; false when storage refused it. */
  private persist(values: LayoutStateValues): boolean {
    const text = JSON.stringify({ version: VERSION, state: values });
    if (text.length > LAYOUT_STATE_MAX_CHARS) return false;
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
      this.unsaved = values;
    }
    this.fire({ slots: [slot] });
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
