// Moving and hiding views from the shell (layout plan L6): the views a move can name (the
// registered ones and the built-in containers' manifest views not registered yet), dragging a
// view's header or tab onto a container, the right-click menu's Hide, Move View... and Reset
// Location, and the Move View picker's open state.

import { type DragEvent, useCallback, useState } from "react";
import { toast } from "sonner";
import { allBuiltInContainerViews } from "@/builtinExtensions/builtInContainers";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { currentExtensionHost } from "@/vscodeExtensions/extensionHost";
import { Parts } from "@/workbench/layoutService";
import type { ProductLayoutPolicy } from "@/workbench/productLayout";
import {
  canMoveView,
  containerLocation,
  defaultContainerOf,
  isViewMoved,
  moveView,
  readViewLocations,
  useViewLocations,
  viewContainerFor,
} from "@/workbench/viewLocations";
import { updateViewLayout } from "@/workbench/viewsLayout";
import { type RailViewContribution, type RailViewRegistry, railViews } from "./railViews";
import { useWorkbenchScope, type WorkbenchScope } from "@/workbench/workbenchScope";

/** Every view a move can name: the registered ones, then manifest views not registered yet. */
export function allViews(registry: RailViewRegistry = railViews): readonly RailViewContribution[] {
  const registered = registry.getSnapshot().views;
  const ids = new Set(registered.map((view) => view.id));
  return [...registered, ...allBuiltInContainerViews().filter((view) => !ids.has(view.id))];
}

export function findView(
  viewId: string,
  registry: RailViewRegistry = railViews,
): RailViewContribution | undefined {
  return allViews(registry).find((view) => view.id === viewId);
}

/**
 * Shows `viewId` where it is now: its container in the mount's side bar, or its tab in the rail.
 * An extension host's own focus command reaches the window's active mount.
 */
export function revealView(viewId: string, scope: WorkbenchScope): void {
  const host = currentExtensionHost();
  if (host) {
    void host.commands.execute(`${viewId}.focus`, [], () => {}).catch(() => {});
    return;
  }
  const view = findView(viewId);
  const containerId = view
    ? viewContainerFor(
        view,
        readViewLocations(scope.state, scope.productLayout),
        scope.productLayout,
      )
    : undefined;
  if (containerId && containerLocation(containerId) === "sidebar") {
    scope.layout.openViewContainer(containerId);
  } else scope.layout.setPartHidden(false, Parts.AUXILIARYBAR_PART);
}

/**
 * Moves `viewId` to `containerId` in the mount's layout and shows it there; says why when it
 * can't. `scope` is the mount whose view it is (its layout state and product policy).
 */
export function moveViewTo(viewId: string, containerId: string, scope: WorkbenchScope): boolean {
  const view = findView(viewId);
  if (!view) return false;
  const { state: store, productLayout: policy } = scope;
  // A view moved somewhere shows there, hidden before or not (a default-hidden one too).
  if (moveView(view, containerId, { store, policy })) {
    updateViewLayout(viewId, { hidden: false }, store, policy);
  } else {
    toast.warning(
      policy.viewLocationsLocked()
        ? "Views can't be moved in this product"
        : `${view.name} can't be moved there`,
    );
    return false;
  }
  revealView(viewId, scope);
  return true;
}

/** Hides or shows a view in the mount's layout state, unless the product keeps views in place. */
export function setViewHidden(viewId: string, hidden: boolean, scope: WorkbenchScope): void {
  if (!updateViewLayout(viewId, { hidden }, scope.state, scope.productLayout)) {
    toast.warning(
      hidden ? "Views can't be hidden in this product" : "Views can't be shown in this product",
    );
  }
}

// --- drag and drop -------------------------------------------------------------------

/** The drag's data type: a view's id. */
export const VIEW_DRAG_TYPE = "application/vnd.omnigent.view";

/** The view being dragged in this window (a drag's data can't be read before its drop). */
let draggedView: string | null = null;

// A drag whose source unmounted before it ended still ends.
if (typeof document !== "undefined") {
  document.addEventListener("dragend", () => {
    draggedView = null;
  });
}

/**
 * What makes a view's header or tab draggable; nothing for a view that can't move (`policy`: the
 * rendering mount's product layout).
 */
export function viewDragProps(
  view: RailViewContribution,
  policy: ProductLayoutPolicy,
): {
  draggable?: true;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
} {
  if (!canMoveView(view, policy)) return {};
  return {
    draggable: true,
    onDragStart: (event) => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(VIEW_DRAG_TYPE, view.id);
      event.dataTransfer.setData("text/plain", view.name);
      draggedView = view.id;
    },
    onDragEnd: () => {
      draggedView = null;
    },
  };
}

function isViewDrag(event: DragEvent<HTMLElement>): boolean {
  return draggedView !== null && [...event.dataTransfer.types].includes(VIEW_DRAG_TYPE);
}

export interface ViewDropTarget {
  readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
  readonly onDragLeave: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLElement>) => void;
  /** Set while a view that may land here is over it. */
  readonly "data-view-drop-target"?: true;
}

/**
 * A place a dragged view can be dropped on: it moves into the container `target` names for
 * it (read at the drop). Other drags pass through.
 */
export function useViewDropTarget(target: (viewId: string) => string | undefined): ViewDropTarget {
  const [over, setOver] = useState(false);
  const scope = useWorkbenchScope();
  const { productLayout: policy } = scope;
  const accepts = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!isViewDrag(event) || draggedView === null) return false;
      const containerId = target(draggedView);
      const view = findView(draggedView);
      if (!containerId || !view || !canMoveView(view, policy)) return false;
      const location = containerLocation(containerId);
      return location !== undefined && (view.builtInView === undefined || location === "sidebar");
    },
    [target, policy],
  );
  return {
    onDragOver: (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setOver(true);
    },
    onDragLeave: (event) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setOver(false);
    },
    onDrop: (event) => {
      setOver(false);
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const viewId = event.dataTransfer.getData(VIEW_DRAG_TYPE) || draggedView;
      draggedView = null;
      const containerId = viewId ? target(viewId) : undefined;
      if (viewId && containerId) moveViewTo(viewId, containerId, scope);
    },
    ...(over ? { "data-view-drop-target": true as const } : {}),
  };
}

// --- the menu ------------------------------------------------------------------------

/** A view's right-click entries: Hide, Move View... and, for a moved view, Reset Location. */
export function ViewMoveMenuItems({
  view,
  canHide,
  separatorBefore = false,
}: {
  view: RailViewContribution;
  /** False for the last view shown where it is: hiding it would leave nothing to show it from. */
  canHide: boolean;
  separatorBefore?: boolean;
}) {
  const locations = useViewLocations();
  const scope = useWorkbenchScope();
  const { productLayout: policy, moveViewPicker } = scope;
  if (!canMoveView(view, policy)) return null;
  const moved = isViewMoved(view, locations, policy);
  return (
    <>
      {separatorBefore && <ContextMenuSeparator />}
      <ContextMenuItem
        data-view-action="hide"
        disabled={!canHide}
        onSelect={() => setViewHidden(view.id, true, scope)}
      >
        Hide &lsquo;{view.name}&rsquo;
      </ContextMenuItem>
      <ContextMenuItem data-view-action="move" onSelect={() => moveViewPicker.open(view.id)}>
        Move View…
      </ContextMenuItem>
      {moved && (
        <ContextMenuItem
          data-view-action="reset-location"
          onSelect={() => moveViewTo(view.id, defaultContainerOf(view), scope)}
        >
          Reset Location
        </ContextMenuItem>
      )}
    </>
  );
}
