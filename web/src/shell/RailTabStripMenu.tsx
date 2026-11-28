// The secondary side bar's tab strip as a place for views (layout plan L6): a view dragged onto
// it moves into the secondary side bar; its right-click menu hides or moves the tab's view and
// lists the contributed views it can show, hidden ones too, to show them again.

import { type ReactElement, useCallback, useState } from "react";
import { flushSync } from "react-dom";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { RIGHT_PANEL_CONTAINER } from "@/workbench/viewContainers";
import { canMoveView } from "@/workbench/viewLocations";
import { isViewRemovedByProduct } from "@/workbench/productLayout";
import { isViewHidden, useViewsLayout } from "@/workbench/viewsLayout";
import { useWorkbenchScope } from "@/workbench/workbenchScope";
import { extensionRailTabViewId, type RightRailTab } from "./railTabs";
import type { RailView } from "./railViews";
import { setViewHidden, useViewDropTarget, ViewMoveMenuItems } from "./viewMoves";

export function RailTabStripMenu({
  views,
  children,
}: {
  /** The views the secondary side bar draws (its containers', moved ones included). */
  views: readonly RailView[];
  children: ReactElement;
}) {
  const layout = useViewsLayout();
  const scope = useWorkbenchScope();
  const { productLayout: policy } = scope;
  const drop = useViewDropTarget(useCallback(() => RIGHT_PANEL_CONTAINER, []));
  const listed = views.filter(
    (view) =>
      view.builtInTab === undefined &&
      view.active &&
      canMoveView(view, policy) &&
      !isViewRemovedByProduct(view, policy),
  );
  // The view of the tab the menu opened on, if any.
  const [target, setTarget] = useState<RailView | undefined>(undefined);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        disabled={listed.length === 0}
        // Read from the menu's own event, so a keyboard or touch menu names its tab too.
        onContextMenuCapture={(event) => {
          const tab = (event.target as Element).closest?.("[data-workspace-tab]");
          const viewId = extensionRailTabViewId(
            (tab?.getAttribute("data-workspace-tab") ?? null) as RightRailTab | null,
          );
          flushSync(() => setTarget(listed.find((view) => view.id === viewId)));
        }}
        {...drop}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent data-testid="rail-views-menu">
        {target && (
          <>
            {/* The strip stays (the built-in tabs), and lists hidden views to show again. */}
            <ViewMoveMenuItems view={target} canHide />
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuLabel>Views</ContextMenuLabel>
        {listed.map((view) => (
          <ContextMenuCheckboxItem
            key={view.id}
            checked={!isViewHidden(view, layout, policy)}
            onCheckedChange={(checked) => setViewHidden(view.id, !checked, scope)}
          >
            {view.name}
          </ContextMenuCheckboxItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
