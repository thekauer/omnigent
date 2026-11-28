// What the user changed about contributed views (layout plan L3): a stacked view collapsed or
// expanded, a view hidden or shown again, kept in the layout state over the contribution's
// `visibility`. Plain data; React reads it through `useViewsLayout`.

import { useCallback, useSyncExternalStore } from "react";
import { LAYOUT_SLOTS, type LayoutStateStore } from "./layoutState";
import { isViewRemovedByProduct, type ProductLayoutPolicy } from "./productLayout";
import { createStableSnapshot } from "./stableSnapshot";
import { useWorkbenchScope } from "./workbenchScope";

export interface ViewLayout {
  readonly collapsed?: boolean;
  readonly hidden?: boolean;
}

export type ViewsLayout = Readonly<Record<string, ViewLayout>>;

const EMPTY: ViewsLayout = Object.freeze({});

/**
 * The stored view layout, keeping only well-formed entries; the user's hidden views come back
 * while the product locks view locations.
 */
export function readViewsLayout(store: LayoutStateStore, policy: ProductLayoutPolicy): ViewsLayout {
  const locked = policy.viewLocationsLocked();
  const stored = store.get(LAYOUT_SLOTS.views);
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return EMPTY;
  const views: Record<string, ViewLayout> = {};
  for (const [viewId, value] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const { collapsed, hidden } = value as Record<string, unknown>;
    const entry: { collapsed?: boolean; hidden?: boolean } = {};
    if (typeof collapsed === "boolean") entry.collapsed = collapsed;
    if (typeof hidden === "boolean" && !locked) entry.hidden = hidden;
    if (Object.keys(entry).length > 0) views[viewId] = entry;
  }
  return Object.freeze(views);
}

/**
 * Changes one view's layout; an empty entry is dropped. Hiding or showing is refused (false)
 * while the product locks view locations.
 */
export function updateViewLayout(
  viewId: string,
  patch: ViewLayout,
  store: LayoutStateStore,
  policy: ProductLayoutPolicy,
): boolean {
  if (patch.hidden !== undefined && policy.viewLocationsLocked()) return false;
  // The stored entry as written, so a lock lifted later finds the user's hidden views again.
  const current = readViewsLayout(store, UNLOCKED);
  const entry = { ...current[viewId], ...patch };
  const kept = Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined),
  ) as ViewLayout;
  const next = new Map(Object.entries(current));
  if (Object.keys(kept).length === 0) next.delete(viewId);
  else next.set(viewId, kept);
  store.set(LAYOUT_SLOTS.views, next.size === 0 ? undefined : Object.fromEntries(next));
  return true;
}

const UNLOCKED = { viewLocationsLocked: () => false } as ProductLayoutPolicy;

/** Whether a view is collapsed: the user's choice, else its contribution's `visibility`. */
export function isViewCollapsed(
  view: { readonly id: string; readonly visibility?: string },
  layout: ViewsLayout,
): boolean {
  return layout[view.id]?.collapsed ?? view.visibility === "collapsed";
}

/**
 * Whether a view is hidden: removed by the product (`hiddenViews`, or its own container in
 * `hiddenContainers`), else the user's choice, else its contribution's `visibility`. `policy` is
 * the product policy of the mount the view is drawn in.
 */
export function isViewHidden(
  view: {
    readonly id: string;
    readonly visibility?: string;
    readonly containerId?: string | undefined;
  },
  layout: ViewsLayout,
  policy: ProductLayoutPolicy,
): boolean {
  if (isViewRemovedByProduct(view, policy)) return true;
  return layout[view.id]?.hidden ?? view.visibility === "hidden";
}

const snapshot = createStableSnapshot<ViewsLayout>();

export function useViewsLayout(
  given?: LayoutStateStore,
  policy?: ProductLayoutPolicy,
): ViewsLayout {
  // The mount's own layout state and product policy unless given.
  const scope = useWorkbenchScope();
  const store = given ?? scope.state;
  const productPolicy = policy ?? scope.productLayout;
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribers = [store.subscribe(listener), productPolicy.subscribe(listener)];
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
    [store, productPolicy],
  );
  return useSyncExternalStore(
    subscribe,
    () => snapshot(store, productPolicy, () => readViewsLayout(store, productPolicy)),
    () => EMPTY,
  );
}
