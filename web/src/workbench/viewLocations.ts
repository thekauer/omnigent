// Where views are (layout plan L6), VS Code's view descriptor service: a view the user moved
// to another container ("Move View...", drag and drop) is kept in the layout state by id; its
// contribution keeps where its extension put it, so "Reset Location" and "Reset View
// Locations" go back there. Moving a view to a new side bar entry makes a generated container
// that exists while a view is in it. A product's `lockViewLocations` keeps every view where its
// extension put it. Plain data, plus the React read.

import { useCallback, useSyncExternalStore } from "react";
import { LAYOUT_SLOTS, type LayoutStateStore, layoutState } from "./layoutState";
import {
  isContainerHiddenByProduct,
  isViewRemovedByProduct,
  type ProductLayoutPolicy,
  productLayout,
} from "./productLayout";
import { useWorkbenchScope } from "./workbenchScope";
import {
  HOST_CONTAINER_OWNER,
  RIGHT_PANEL_CONTAINER,
  type ViewContainerDescriptor,
  type ViewContainerLocation,
  type ViewContainerRegistry,
  viewContainers,
} from "./viewContainers";

/** `{ [view id]: container id }`: the views the user moved. */
export type ViewLocations = Readonly<Record<string, string>>;

/** What moving reads of a view: its id, where its extension put it, and how it is drawn. */
export interface MovableView {
  readonly id: string;
  readonly name: string;
  readonly icon?: string | undefined;
  readonly containerId?: string | undefined;
  /** A host component's view: drawn in side bars only. */
  readonly builtInView?: string | undefined;
  /** A rail tab's built-in view: the rail draws it, so it doesn't move. */
  readonly builtInTab?: string | undefined;
}

const EMPTY: ViewLocations = Object.freeze({});

/** A side bar entry made by moving a view to a new one: its id names its first view. */
export const GENERATED_CONTAINER_PREFIX = "workbench.view.generated.";

export function generatedContainerId(viewId: string): string {
  return `${GENERATED_CONTAINER_PREFIX}${viewId}`;
}

export function isGeneratedContainer(id: string): boolean {
  return id.startsWith(GENERATED_CONTAINER_PREFIX) && id.length > GENERATED_CONTAINER_PREFIX.length;
}

/** The container a view's extension put it in. */
export function defaultContainerOf(view: Pick<MovableView, "containerId">): string {
  return view.containerId ?? RIGHT_PANEL_CONTAINER;
}

/** The stored moves, well-formed ones only; none while the product locks view locations. */
export function readViewLocations(
  store: LayoutStateStore = layoutState,
  policy: ProductLayoutPolicy = productLayout,
): ViewLocations {
  if (policy.viewLocationsLocked()) return EMPTY;
  const stored = store.get(LAYOUT_SLOTS.viewLocations);
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return EMPTY;
  const locations: Record<string, string> = {};
  for (const [viewId, containerId] of Object.entries(stored as Record<string, unknown>)) {
    if (viewId !== "__proto__" && typeof containerId === "string" && containerId !== "") {
      locations[viewId] = containerId;
    }
  }
  return Object.keys(locations).length > 0 ? Object.freeze(locations) : EMPTY;
}

/** Where a container draws its views: the registry's, `sidebar` for a generated one. */
export function containerLocation(
  containerId: string,
  registry: ViewContainerRegistry = viewContainers,
): ViewContainerLocation | undefined {
  if (isGeneratedContainer(containerId)) return "sidebar";
  return registry.get(containerId)?.location;
}

/** The locations a view may be drawn at: side bars only for a host component's view. */
export function allowedLocations(view: MovableView): readonly ViewContainerLocation[] {
  return view.builtInView !== undefined ? ["sidebar"] : ["sidebar", "auxiliarybar"];
}

/**
 * The container a view is drawn in: where the user moved it, when that container exists and
 * may draw it, else where its extension put it.
 */
export function viewContainerFor(
  view: MovableView,
  locations: ViewLocations,
  registry: ViewContainerRegistry = viewContainers,
): string {
  const moved = Object.hasOwn(locations, view.id) ? locations[view.id] : undefined;
  if (moved !== undefined && view.builtInTab === undefined) {
    const location = containerLocation(moved, registry);
    if (
      location !== undefined &&
      allowedLocations(view).includes(location) &&
      !isContainerHiddenByProduct(moved)
    ) {
      return moved;
    }
  }
  return defaultContainerOf(view);
}

/**
 * Whether the user may move or hide `view`: not a rail tab's built-in, not under a lock, and not
 * removed by the product.
 */
export function canMoveView(
  view: MovableView,
  policy: ProductLayoutPolicy = productLayout,
): boolean {
  return (
    view.builtInTab === undefined &&
    !policy.viewLocationsLocked() &&
    !isViewRemovedByProduct(view, policy)
  );
}

/** Whether `view` was moved away from where its extension put it. */
export function isViewMoved(
  view: MovableView,
  locations: ViewLocations,
  registry: ViewContainerRegistry = viewContainers,
): boolean {
  return viewContainerFor(view, locations, registry) !== defaultContainerOf(view);
}

/**
 * Moves `view` to `containerId` (its own container drops the move). Refused, returning false,
 * for a view that can't move, a location it can't be drawn at, or a container that isn't there
 * or that the product removed.
 */
export function moveView(
  view: MovableView,
  containerId: string,
  options: {
    readonly store?: LayoutStateStore;
    readonly policy?: ProductLayoutPolicy;
    readonly registry?: ViewContainerRegistry;
  } = {},
): boolean {
  const { store = layoutState, policy = productLayout, registry = viewContainers } = options;
  if (!canMoveView(view, policy)) return false;
  const location = containerLocation(containerId, registry);
  if (location === undefined || !allowedLocations(view).includes(location)) return false;
  if (isContainerHiddenByProduct(containerId, policy)) return false;
  const next: Record<string, string> = Object.fromEntries(
    Object.entries(readViewLocations(store, policy)).filter(([viewId]) => viewId !== view.id),
  );
  if (containerId !== defaultContainerOf(view)) next[view.id] = containerId;
  store.set(LAYOUT_SLOTS.viewLocations, Object.keys(next).length > 0 ? next : undefined);
  return true;
}

/** VS Code's Reset View Locations: every view goes back where its extension put it. */
export function resetViewLocations(store: LayoutStateStore = layoutState): void {
  store.set(LAYOUT_SLOTS.viewLocations, undefined);
}

/**
 * The generated side bar entries with a view in them, in the order their first views come:
 * titled and drawn with that view's name and icon.
 */
export function generatedContainers(
  views: readonly MovableView[],
  locations: ViewLocations,
  registry: ViewContainerRegistry = viewContainers,
): readonly ViewContainerDescriptor[] {
  const seen = new Map<string, ViewContainerDescriptor>();
  for (const view of views) {
    // A view the product removed makes no entry.
    if (isViewRemovedByProduct(view)) continue;
    const containerId = viewContainerFor(view, locations, registry);
    if (!isGeneratedContainer(containerId) || seen.has(containerId)) continue;
    // The view the entry was made for names it while it is there; another view otherwise.
    const owner =
      views.find(
        (candidate) =>
          generatedContainerId(candidate.id) === containerId &&
          viewContainerFor(candidate, locations, registry) === containerId,
      ) ?? view;
    seen.set(
      containerId,
      Object.freeze({
        id: containerId,
        title: owner.name,
        icon: owner.icon,
        location: "sidebar",
        extensionId: HOST_CONTAINER_OWNER,
        builtIn: false,
        order: seen.size,
      }),
    );
  }
  return [...seen.values()];
}

let cache: { text: string; locations: ViewLocations } | undefined;

function snapshot(store: LayoutStateStore, policy: ProductLayoutPolicy): ViewLocations {
  const locations = readViewLocations(store, policy);
  const text = JSON.stringify(locations);
  if (cache?.text !== text) cache = { text, locations };
  return cache.locations;
}

/** The stored moves, kept current (the same object while they don't change). */
export function useViewLocations(
  given?: LayoutStateStore,
  policy: ProductLayoutPolicy = productLayout,
): ViewLocations {
  // The mount's own layout state unless one is given.
  const scoped = useWorkbenchScope().state;
  const store = given ?? scoped;
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribers = [store.subscribe(listener), policy.subscribe(listener)];
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
    [store, policy],
  );
  return useSyncExternalStore(
    subscribe,
    () => snapshot(store, policy),
    () => EMPTY,
  );
}
