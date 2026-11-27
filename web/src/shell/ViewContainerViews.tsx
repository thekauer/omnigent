// A side bar's view container, drawn (layout plan L3): its views stacked in order, each whose
// `when` holds and that the user didn't hide. A built-in view's body is its host component
// (`builtInView`), drawn as is; a contributed tree view is a pane whose header collapses it, as
// VS Code stacks views. A built-in container drawn before the extension host registered its
// views draws them from its manifest.

import type { CSSProperties } from "react";
import { builtInContainerViews } from "@/builtinExtensions/builtInContainers";
import { RenderErrorBoundary } from "@/components/RenderErrorBoundary";
import { whenHolds, workbenchContext } from "@/workbench/workbenchContext";
import {
  type ViewContainerRegistry,
  useViewContainers,
  viewContainers,
} from "@/workbench/viewContainers";
import {
  isViewCollapsed,
  isViewHidden,
  updateViewLayout,
  useViewsLayout,
} from "@/workbench/viewsLayout";
import { builtInViewComponent } from "./builtInViews";
import { ExtensionRailView } from "./extensionViews/ExtensionRailView";
import {
  type RailView,
  type RailViewContribution,
  type RailViewRegistry,
  railViews,
  useRailViews,
} from "./railViews";

function isRegistered(view: RailViewContribution): view is RailView {
  return "active" in view;
}

/** The views of `containerId` drawn now, in order. */
export function useContainerViews(
  containerId: string,
  registry: RailViewRegistry = railViews,
  containers: ViewContainerRegistry = viewContainers,
): readonly RailViewContribution[] {
  const { views: registered } = useRailViews(registry, containerId);
  const layout = useViewsLayout();
  const owner = useViewContainers(containers).containers.find(
    (container) => container.id === containerId,
  )?.extensionId;
  // The manifest's views not registered yet are drawn from it, before the rest.
  const registeredIds = new Set(registered.map((view) => view.id));
  const views = [
    ...builtInContainerViews(containerId).filter((view) => !registeredIds.has(view.id)),
    ...registered,
  ];
  // The container's own extension's views first, then others' in the registry's order.
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
  const { settled } = useRailViews(registry, containerId);
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
