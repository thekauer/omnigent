// A side bar's view container, drawn (layout plan L3): its views stacked in order, each whose
// `when` holds and that the user didn't hide. A built-in view's body is its host component
// (`builtInView`), drawn as is; a contributed tree view is a pane whose header collapses it, as
// VS Code stacks views. A built-in container drawn before the extension host registered its
// views draws them from its manifest.

import { type CSSProperties, useCallback, useMemo, useSyncExternalStore } from "react";
import { layoutState } from "@/workbench/layoutState";
import { builtInContainerViews } from "@/builtinExtensions/builtInContainers";
import { RenderErrorBoundary } from "@/components/RenderErrorBoundary";
import { whenHolds, workbenchContext } from "@/workbench/workbenchContext";
import {
  CONVERSATIONS_CONTAINER,
  type ViewContainerDescriptor,
  type ViewContainerRegistry,
  useViewContainers,
  viewContainers,
} from "@/workbench/viewContainers";
import {
  isViewCollapsed,
  isViewHidden,
  readViewsLayout,
  updateViewLayout,
  useViewsLayout,
  type ViewsLayout,
} from "@/workbench/viewsLayout";
import { builtInViewComponent } from "./builtInViews";
import { ExtensionRailView } from "./extensionViews/ExtensionRailView";
import {
  type RailView,
  type RailViewContribution,
  type RailViewRegistry,
  railViews,
  useRailViews,
  viewContainerOf,
} from "./railViews";

function isRegistered(view: RailViewContribution): view is RailView {
  return "active" in view;
}

/**
 * The views of `containerId` drawn now, in order: the registered ones (a built-in container's
 * from its manifest until they are), the container's own extension's first, each whose
 * `when` holds and that isn't hidden.
 */
export function containerViews(
  registered: readonly RailViewContribution[],
  containerId: string,
  owner: string | undefined,
  layout: ViewsLayout,
): readonly RailViewContribution[] {
  const inContainer = registered.filter((view) => viewContainerOf(view) === containerId);
  // The manifest's views not registered yet are drawn from it, before the rest.
  const registeredIds = new Set(inContainer.map((view) => view.id));
  const views = [
    ...builtInContainerViews(containerId).filter((view) => !registeredIds.has(view.id)),
    ...inContainer,
  ];
  const ordered = [
    ...views.filter((view) => view.extensionId === owner),
    ...views.filter((view) => view.extensionId !== owner),
  ];
  return ordered.filter(
    (view) =>
      (isRegistered(view) ? view.active : whenHolds(view.when, workbenchContext.snapshot())) &&
      !isViewHidden(view, layout),
  );
}

/** The views of `containerId` drawn now, in order. */
export function useContainerViews(
  containerId: string,
  registry: RailViewRegistry = railViews,
  containers: ViewContainerRegistry = viewContainers,
): readonly RailViewContribution[] {
  const { views: registered } = useRailViews(registry, null);
  const layout = useViewsLayout();
  const owner = useViewContainers(containers).containers.find(
    (container) => container.id === containerId,
  )?.extensionId;
  return useMemo(
    () => containerViews(registered, containerId, owner, layout),
    [registered, containerId, owner, layout],
  );
}

/** The side bar's containers that have a view to show, each with its views, in order. */
export function useSideBarContainers(
  registry: RailViewRegistry = railViews,
  containers: ViewContainerRegistry = viewContainers,
): readonly { container: ViewContainerDescriptor; views: readonly RailViewContribution[] }[] {
  const { views: registered } = useRailViews(registry, null);
  const layout = useViewsLayout();
  const snapshot = useViewContainers(containers);
  return useMemo(
    () => sideBarContainersOf(registered, snapshot.containers, layout),
    [registered, layout, snapshot],
  );
}

function sideBarContainersOf(
  registered: readonly RailViewContribution[],
  all: readonly ViewContainerDescriptor[],
  layout: ViewsLayout,
): { container: ViewContainerDescriptor; views: readonly RailViewContribution[] }[] {
  const sideBar = all.filter((container) => container.location === "sidebar");
  // Before the host registered the built-ins, the sessions container is there anyway.
  const listed = sideBar.some((container) => container.id === CONVERSATIONS_CONTAINER)
    ? sideBar
    : [CONVERSATIONS_FALLBACK, ...sideBar];
  return listed
    .map((container) => ({
      container,
      views: containerViews(registered, container.id, container.extensionId, layout),
    }))
    .filter((entry) => entry.views.length > 0);
}

/**
 * The side bar's containers that have a view to show, without their views: the side bar reads
 * this, so a view's badge or tree changing doesn't re-render it.
 */
export function useSideBarContainerList(
  registry: RailViewRegistry = railViews,
  containers: ViewContainerRegistry = viewContainers,
): readonly ViewContainerDescriptor[] {
  const read = () =>
    JSON.stringify(
      sideBarContainersOf(
        registry.getSnapshot().views,
        containers.getSnapshot().containers,
        readViewsLayout(),
      ).map(({ container }) => container),
    );
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribers = [
        registry.subscribe(listener),
        containers.subscribe(listener),
        layoutState.subscribe(listener),
      ];
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
    [registry, containers],
  );
  const key = useSyncExternalStore(subscribe, read, read);
  return useMemo(() => JSON.parse(key) as ViewContainerDescriptor[], [key]);
}

const CONVERSATIONS_FALLBACK: ViewContainerDescriptor = Object.freeze({
  id: CONVERSATIONS_CONTAINER,
  title: "Sessions",
  icon: "messages-square",
  location: "sidebar",
  extensionId: CONVERSATIONS_CONTAINER,
  builtIn: true,
  order: 0,
});

export function ViewContainerViews({
  containerId,
  registry = railViews,
  containers = viewContainers,
}: {
  containerId: string;
  registry?: RailViewRegistry;
  containers?: ViewContainerRegistry;
}) {
  const views = useContainerViews(containerId, registry, containers);
  const layout = useViewsLayout();
  const { settled } = useRailViews(registry, null);
  return views.map((view) => {
    const BuiltInView = builtInViewComponent(view.builtInView);
    if (view.builtInView !== undefined) {
      // A built-in view draws its own chrome; nothing wraps it, so the side bar's markup stays.
      return BuiltInView ? <BuiltInView key={view.id} view={view} /> : null;
    }
    const collapsed = isViewCollapsed(view, layout);
    return (
      <div
        key={view.id}
        data-view={view.id}
        data-collapsed={collapsed || undefined}
        className="flex min-h-0 flex-col border-t border-border"
        style={{ flex: collapsed ? "0 0 auto" : `${view.initialSize ?? 1} 1 0` } as CSSProperties}
      >
        <RenderErrorBoundary name={view.name}>
          <ExtensionRailView
            viewId={view.id}
            registry={registry}
            settled={settled}
            conversationId={undefined}
            visible={!collapsed}
            collapse={{
              collapsed,
              onToggle: () => updateViewLayout(view.id, { collapsed: !collapsed }),
            }}
          />
        </RenderErrorBoundary>
      </div>
    );
  });
}
