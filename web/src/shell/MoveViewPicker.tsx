// VS Code's "View: Move View..." (layout plan L6): pick a view (unless the command named one),
// then where it goes: another side bar container, a new side bar entry, or the secondary side
// bar. The move is layout state; Reset Location and Reset View Locations undo it.

import { type QuickPickItem, QuickPickDialog, useQuickPickPages } from "@/components/ui/quick-pick";
import {
  RIGHT_PANEL_CONTAINER,
  useViewContainers,
  type ViewContainerDescriptor,
} from "@/workbench/viewContainers";
import {
  allowedLocations,
  canMoveView,
  containerLocation,
  generatedContainerId,
  useViewLocations,
  viewContainerFor,
} from "@/workbench/viewLocations";
import { useRailViews, type RailViewContribution } from "./railViews";
import { useSideBarContainers } from "./ViewContainerViews";
import { useStore } from "zustand";
import { useWorkbenchScope } from "@/workbench/workbenchScope";
import { allViews, moveViewTo } from "./viewMoves";
import { isViewRemovedByProduct } from "@/workbench/productLayout";

type PageId = "views" | "destinations";

type Value =
  | { readonly kind: "view"; readonly viewId: string }
  | { readonly kind: "destination"; readonly containerId: string };

const SIDE_BAR_GROUP = "Side Bar";
const SECONDARY_SIDE_BAR_GROUP = "Secondary Side Bar";

/** Where `view` can go from `current`: the side bar's other containers, a new entry, the rail. */
export function moveViewDestinations(
  view: RailViewContribution,
  current: string,
  sideBarContainers: readonly ViewContainerDescriptor[],
): QuickPickItem<Value>[] {
  const items: QuickPickItem<Value>[] = sideBarContainers
    .filter((container) => container.id !== current)
    .map((container) => ({
      id: `container:${container.id}`,
      label: container.title,
      group: SIDE_BAR_GROUP,
      value: { kind: "destination", containerId: container.id },
    }));
  const ownEntry = generatedContainerId(view.id);
  if (current !== ownEntry) {
    items.push({
      id: "new-side-bar-entry",
      label: "New Side Bar Entry",
      group: SIDE_BAR_GROUP,
      value: { kind: "destination", containerId: ownEntry },
    });
  }
  if (
    allowedLocations(view).includes("auxiliarybar") &&
    containerLocation(current) !== "auxiliarybar"
  ) {
    items.push({
      id: "secondary-side-bar",
      label: "Secondary Side Bar",
      group: SECONDARY_SIDE_BAR_GROUP,
      value: { kind: "destination", containerId: RIGHT_PANEL_CONTAINER },
    });
  }
  return items;
}

/** Mounted while open (the overlays mount it), so each opening starts on its first page. */
export function MoveViewPicker() {
  // This mount's picker and product policy.
  const { moveViewPicker, productLayout: policy } = useWorkbenchScope();
  const { store } = moveViewPicker;
  const open = useStore(store, (state) => state.open);
  const givenViewId = useStore(store, (state) => state.viewId);
  const chosenViewId = useStore(store, (state) => state.chosenViewId);
  const pages = useQuickPickPages<PageId>(givenViewId === undefined ? "views" : "destinations");
  // Read so the lists follow registrations and moves.
  useRailViews(undefined, null);
  useViewContainers();
  const locations = useViewLocations();
  const sideBar = useSideBarContainers().map((entry) => entry.container);
  const views = allViews().filter(
    (view) => canMoveView(view, policy) && !isViewRemovedByProduct(view, policy),
  );
  const titleOf = (containerId: string) =>
    sideBar.find((container) => container.id === containerId)?.title ??
    (containerLocation(containerId) === "auxiliarybar" ? SECONDARY_SIDE_BAR_GROUP : containerId);
  const onDestinations = pages.page.id === "destinations" || givenViewId !== undefined;
  const view = views.find((candidate) => candidate.id === (givenViewId ?? chosenViewId));
  const items: QuickPickItem<Value>[] = onDestinations
    ? view
      ? moveViewDestinations(view, viewContainerFor(view, locations), sideBar)
      : []
    : views.map((candidate) => ({
        id: `view:${candidate.id}`,
        label: candidate.name,
        group: titleOf(viewContainerFor(candidate, locations)),
        opensPage: true,
        value: { kind: "view", viewId: candidate.id },
      }));
  return (
    <QuickPickDialog<Value>
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) moveViewPicker.close();
      }}
      title="Move View"
      description="Choose a view, then where it goes."
      label={onDestinations ? `Move ${view?.name ?? "view"} to` : "Select a view to move"}
      placeholder={onDestinations ? "Select a destination…" : "Select a view to move…"}
      backLabel="Back to views"
      segments={[{ sourceId: "move-view", ranking: "client", items }]}
      {...pages.pickerProps}
      emptyMessage={onDestinations ? "Nowhere else to move this view" : "No views to move"}
      acceptLabel={onDestinations ? "Move" : "Select"}
      onAccept={(item) => {
        if (item.value.kind === "view") {
          store.setState({ chosenViewId: item.value.viewId });
          pages.push("destinations");
          return "keepOpen" as const;
        }
        const viewId = givenViewId ?? chosenViewId;
        if (viewId !== undefined) moveViewTo(viewId, item.value.containerId);
        moveViewPicker.close();
        return undefined;
      }}
    />
  );
}
