// Window-wide registry of extension-contributed session header items. The chat
// header renders its snapshot; extensions only ever see SessionHeaderItem handles.
import type * as omnigent from "omnigent";

export const SessionHeaderItemAlignment = { Left: 1, Right: 2 } as const;
type Alignment = (typeof SessionHeaderItemAlignment)[keyof typeof SessionHeaderItemAlignment];

export const MAX_HEADER_ITEM_TEXT_LENGTH = 40;
export const MAX_HEADER_ITEM_TOOLTIP_LENGTH = 200;

/** What the header renders for one visible item. Immutable. */
export interface SessionHeaderItemSnapshot {
  /** Unique across the window; also the React key and the test id suffix. */
  readonly key: string;
  readonly extensionId: string;
  readonly alignment: Alignment;
  readonly priority: number | undefined;
  readonly text: string;
  readonly tooltip: string | undefined;
}

/** Collapse to one line and cap the length, counting code points. */
export function boundText(value: unknown, maxLength: number): string {
  const singleLine = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const codePoints = Array.from(singleLine);
  if (codePoints.length <= maxLength) return singleLine;
  return `${codePoints.slice(0, maxLength - 1).join("")}…`;
}

/**
 * Left-aligned items come first, then right-aligned ones, which sit next to the
 * anchor (the agent info button). Within a group, higher priority is closer to
 * that group's edge, as in the VS Code status bar; ties fall back to the key.
 */
export function compareHeaderItems(
  a: SessionHeaderItemSnapshot,
  b: SessionHeaderItemSnapshot,
): number {
  if (a.alignment !== b.alignment) return a.alignment - b.alignment;
  const priorityA = a.priority ?? 0;
  const priorityB = b.priority ?? 0;
  if (priorityA !== priorityB) {
    return a.alignment === SessionHeaderItemAlignment.Left
      ? priorityB - priorityA
      : priorityA - priorityB;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

interface ItemState {
  snapshot: SessionHeaderItemSnapshot;
  visible: boolean;
}

const EMPTY: readonly SessionHeaderItemSnapshot[] = Object.freeze([]);

export class SessionHeaderItemRegistry {
  private readonly items = new Map<string, ItemState>();
  private readonly listeners = new Set<() => void>();
  private visibleItems: readonly SessionHeaderItemSnapshot[] = EMPTY;
  private generatedIds = 0;

  /** For `useSyncExternalStore`. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Visible items in display order; a stable reference until something changes. */
  readonly getSnapshot = (): readonly SessionHeaderItemSnapshot[] => this.visibleItems;

  create(
    extensionId: string,
    id: string | undefined,
    alignment: number | undefined,
    priority: number | undefined,
  ): omnigent.SessionHeaderItem {
    let key = `${extensionId}.${id ?? `item${++this.generatedIds}`}`;
    if (this.items.has(key)) {
      console.warn(`[omnigent-extensions] ${extensionId}: duplicate session header item ${key}`);
      let suffix = 2;
      while (this.items.has(`${key}#${suffix}`)) suffix += 1;
      key = `${key}#${suffix}`;
    }
    const state: ItemState = {
      snapshot: {
        key,
        extensionId,
        alignment:
          alignment === SessionHeaderItemAlignment.Right
            ? SessionHeaderItemAlignment.Right
            : SessionHeaderItemAlignment.Left,
        priority: typeof priority === "number" && Number.isFinite(priority) ? priority : undefined,
        text: "",
        tooltip: undefined,
      },
      visible: false,
    };
    this.items.set(key, state);
    return this.createHandle(state);
  }

  private createHandle(state: ItemState): omnigent.SessionHeaderItem {
    let disposed = false;
    const update = (patch: Partial<SessionHeaderItemSnapshot>, visible = state.visible) => {
      if (disposed) return;
      const changed =
        visible !== state.visible ||
        Object.entries(patch).some(
          ([field, value]) => state.snapshot[field as keyof SessionHeaderItemSnapshot] !== value,
        );
      if (!changed) return;
      const wasVisible = state.visible;
      state.snapshot = { ...state.snapshot, ...patch };
      state.visible = visible;
      if (wasVisible || visible) this.publish();
    };
    const { key, alignment, priority } = state.snapshot;
    return {
      id: key,
      alignment: alignment as omnigent.SessionHeaderItemAlignment,
      priority,
      get text() {
        return state.snapshot.text;
      },
      set text(value: string) {
        update({ text: boundText(value, MAX_HEADER_ITEM_TEXT_LENGTH) });
      },
      get tooltip() {
        return state.snapshot.tooltip;
      },
      set tooltip(value: string | undefined) {
        const tooltip =
          value === undefined || value === null
            ? undefined
            : boundText(value, MAX_HEADER_ITEM_TOOLTIP_LENGTH) || undefined;
        update({ tooltip });
      },
      show: () => update({}, true),
      hide: () => update({}, false),
      dispose: () => {
        if (disposed) return;
        const wasVisible = state.visible;
        disposed = true;
        this.items.delete(key);
        if (wasVisible) this.publish();
      },
    };
  }

  private publish(): void {
    const visible = [...this.items.values()]
      // An item with no text would be an empty box; it renders once it has some.
      .filter((item) => item.visible && item.snapshot.text !== "")
      .map((item) => item.snapshot)
      .sort(compareHeaderItems);
    this.visibleItems = visible.length === 0 ? EMPTY : Object.freeze(visible);
    for (const listener of [...this.listeners]) listener();
  }
}

/** The window's registry, shared by the extension host and the chat header. */
export const sessionHeaderItems = new SessionHeaderItemRegistry();
