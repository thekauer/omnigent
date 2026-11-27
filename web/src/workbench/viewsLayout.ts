// What the user changed about contributed views (layout plan L3): a stacked view collapsed or
// expanded, a view hidden or shown again, kept in the layout state over the contribution's
// `visibility`. Plain data; React reads it through `useViewsLayout`.

import { useCallback, useSyncExternalStore } from "react";
import { LAYOUT_SLOTS, type LayoutStateStore, layoutState } from "./layoutState";

export interface ViewLayout {
  readonly collapsed?: boolean;
  readonly hidden?: boolean;
}

export type ViewsLayout = Readonly<Record<string, ViewLayout>>;

const EMPTY: ViewsLayout = Object.freeze({});

/** The stored view layout, keeping only well-formed entries. */
export function readViewsLayout(store: LayoutStateStore = layoutState): ViewsLayout {
  const stored = store.get(LAYOUT_SLOTS.views);
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return EMPTY;
  const views: Record<string, ViewLayout> = {};
  for (const [viewId, value] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const { collapsed, hidden } = value as Record<string, unknown>;
    const entry: { collapsed?: boolean; hidden?: boolean } = {};
    if (typeof collapsed === "boolean") entry.collapsed = collapsed;
    if (typeof hidden === "boolean") entry.hidden = hidden;
    if (Object.keys(entry).length > 0) views[viewId] = entry;
  }
  return Object.freeze(views);
}

/** Changes one view's layout; an empty entry is dropped. */
export function updateViewLayout(
  viewId: string,
  patch: ViewLayout,
  store: LayoutStateStore = layoutState,
): void {
  const current = readViewsLayout(store);
  const entry = { ...current[viewId], ...patch };
  const kept = Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined),
  ) as ViewLayout;
  const next = new Map(Object.entries(current));
  if (Object.keys(kept).length === 0) next.delete(viewId);
  else next.set(viewId, kept);
  store.set(LAYOUT_SLOTS.views, next.size === 0 ? undefined : Object.fromEntries(next));
}

/** Whether a view is collapsed: the user's choice, else its contribution's `visibility`. */
export function isViewCollapsed(
  view: { readonly id: string; readonly visibility?: string },
  layout: ViewsLayout,
): boolean {
  return layout[view.id]?.collapsed ?? view.visibility === "collapsed";
}

/** Whether a view is hidden: the user's choice, else its contribution's `visibility`. */
export function isViewHidden(
  view: { readonly id: string; readonly visibility?: string },
  layout: ViewsLayout,
): boolean {
  return layout[view.id]?.hidden ?? view.visibility === "hidden";
}

let cache: { text: string; layout: ViewsLayout } | undefined;

function snapshot(store: LayoutStateStore): ViewsLayout {
  const layout = readViewsLayout(store);
  const text = JSON.stringify(layout);
  if (cache?.text !== text) cache = { text, layout };
  return cache.layout;
}

export function useViewsLayout(store: LayoutStateStore = layoutState): ViewsLayout {
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  return useSyncExternalStore(
    subscribe,
    () => snapshot(store),
    () => EMPTY,
  );
}
