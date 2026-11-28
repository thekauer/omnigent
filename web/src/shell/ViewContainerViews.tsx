// A side bar's view container, drawn (layout plan L3): its views stacked in order, each whose
// `when` holds and that the user didn't hide. A built-in view's body is its host component
// (`builtInView`), drawn as is; a contributed tree view is a pane whose header collapses it, as
// VS Code stacks views. A built-in container drawn before the extension host registered its
// views draws them from its manifest.

import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  type MouseEvent,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useWorkbenchScope } from "@/workbench/workbenchScope";
import { NO_DEFAULT_HIDDEN, useDefaultHiddenViews } from "@/workbench/defaultHiddenViews";
import { allBuiltInContainerViews } from "@/builtinExtensions/builtInContainers";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  isContainerHiddenByProduct,
  isViewRemovedByProduct,
  type ProductLayoutPolicy,
  useProductLayout,
} from "@/workbench/productLayout";
import {
  canMoveView,
  generatedContainers,
  readViewLocations,
  useViewLocations,
  type ViewLocations,
} from "@/workbench/viewLocations";
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
import { setViewHidden, viewDragProps, ViewMoveMenuItems } from "./viewMoves";
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

/** The registered views, then the built-in containers' manifest views not registered yet. */
function withManifestViews(
  registered: readonly RailViewContribution[],
): readonly RailViewContribution[] {
  const registeredIds = new Set(registered.map((view) => view.id));
  return [
    ...allBuiltInContainerViews().filter((view) => !registeredIds.has(view.id)),
    ...registered,
  ];
}

/**
 * The views of `containerId` drawn now, in order: the registered ones (a built-in container's
 * from its manifest until they are) that are there, moved there included, the container's own
 * extension's first, each whose `when` holds and that isn't hidden. The defaults (`defaults`) hide
 * views too, but never a container's last shown view: where they would hide them all, they don't
 * apply to that container.
 */
export function containerViews(
  registered: readonly RailViewContribution[],
  containerId: string,
  owner: string | undefined,
  layout: ViewsLayout,
  locations: ViewLocations,
  policy: ProductLayoutPolicy,
  defaults: readonly string[],
): readonly RailViewContribution[] {
  // A container the product removed draws nothing.
  if (isContainerHiddenByProduct(containerId, policy)) return [];
  const views = withManifestViews(registered).filter(
    (view) => viewContainerOf(view, locations, policy) === containerId,
  );
  const ordered = [
    ...views.filter((view) => view.extensionId === owner),
    ...views.filter((view) => view.extensionId !== owner),
  ];
  const candidates = ordered.filter((view) =>
    isRegistered(view) ? view.active : whenHolds(view.when, workbenchContext.snapshot()),
  );
  const drawn = candidates.filter((view) => !isViewHidden(view, layout, policy, defaults));
  if (drawn.length > 0) return drawn;
  return candidates.filter((view) => !isViewHidden(view, layout, policy, NO_DEFAULT_HIDDEN));
}

/** The views of `containerId` drawn now, in order. */
export function useContainerViews(
  containerId: string,
  registry: RailViewRegistry = railViews,
  containers: ViewContainerRegistry = viewContainers,
): readonly RailViewContribution[] {
  const { views: registered } = useRailViews(registry, null);
  const layout = useViewsLayout();
  const locations = useViewLocations();
  const owner = useViewContainers(containers).containers.find(
    (container) => container.id === containerId,
  )?.extensionId;
  // The product's hidden views and containers (this mount's) are part of what is drawn.
  const { productLayout: policy } = useWorkbenchScope();
  const product = useProductLayout(policy);
  const defaults = useDefaultHiddenViews();
  return useMemo(
    () => containerViews(registered, containerId, owner, layout, locations, policy, defaults),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registered, containerId, owner, layout, locations, product, defaults],
  );
}

/** The side bar's containers that have a view to show, each with its views, in order. */
export function useSideBarContainers(
  registry: RailViewRegistry = railViews,
  containers: ViewContainerRegistry = viewContainers,
): readonly { container: ViewContainerDescriptor; views: readonly RailViewContribution[] }[] {
  const { views: registered } = useRailViews(registry, null);
  const layout = useViewsLayout();
  const locations = useViewLocations();
  const snapshot = useViewContainers(containers);
  const { productLayout: policy } = useWorkbenchScope();
  const product = useProductLayout(policy);
  const defaults = useDefaultHiddenViews();
  return useMemo(
    () => sideBarContainersOf(registered, snapshot.containers, layout, locations, policy, defaults),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registered, layout, snapshot, locations, product, defaults],
  );
}

function sideBarContainersOf(
  registered: readonly RailViewContribution[],
  all: readonly ViewContainerDescriptor[],
  layout: ViewsLayout,
  locations: ViewLocations,
  policy: ProductLayoutPolicy,
  defaults: readonly string[],
): { container: ViewContainerDescriptor; views: readonly RailViewContribution[] }[] {
  // The side bar entries moving a view made follow the registered containers.
  const sideBar = [
    ...all.filter(
      (container) =>
        container.location === "sidebar" && !isContainerHiddenByProduct(container.id, policy),
    ),
    ...generatedContainers(withManifestViews(registered), locations, policy),
  ];
  // Before the host registered the built-ins, the sessions container is there anyway.
  const listed = sideBar.some((container) => container.id === CONVERSATIONS_CONTAINER)
    ? sideBar
    : [CONVERSATIONS_FALLBACK, ...sideBar];
  return listed
    .map((container) => ({
      container,
      views: containerViews(
        registered,
        container.id,
        container.extensionId,
        layout,
        locations,
        policy,
        defaults,
      ),
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
  const { state: store, productLayout: policy } = useWorkbenchScope();
  const defaults = useDefaultHiddenViews();
  const read = () =>
    JSON.stringify(
      sideBarContainersOf(
        registry.getSnapshot().views,
        containers.getSnapshot().containers,
        readViewsLayout(store, policy),
        readViewLocations(store, policy),
        policy,
        defaults,
      ).map(({ container }) => container),
    );
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribers = [
        registry.subscribe(listener),
        containers.subscribe(listener),
        store.subscribe(listener),
        policy.subscribe(listener),
      ];
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
    [registry, containers, store, policy],
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
  const { state: store, productLayout: policy } = useWorkbenchScope();
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
              onToggle: () => updateViewLayout(view.id, { collapsed: !collapsed }, store, policy),
              wrapTitle: (title) => (
                <PaneHeaderMenu view={view} title={title} canHide={views.length > 1} />
              ),
            }}
          />
        </RenderErrorBoundary>
      </div>
    );
  });
}

/** A stacked view's header: drag it to another container, right-click to hide or move it. */
function PaneHeaderMenu({
  view,
  title,
  canHide,
}: {
  view: RailViewContribution;
  title: ReactElement;
  canHide: boolean;
}) {
  const { productLayout: policy } = useWorkbenchScope();
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        disabled={!canMoveView(view, policy)}
        onContextMenuCapture={keepLinkMenus}
        {...viewDragProps(view, policy)}
      >
        {title}
      </ContextMenuTrigger>
      <ContextMenuContent data-testid="view-pane-menu">
        <ViewMoveMenuItems view={view} canHide={canHide} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

const NO_VIEWS_LAYOUT: ViewsLayout = Object.freeze({});

/**
 * A link keeps the browser's own menu (open in a new tab, copy the link): stopped before the
 * menu's trigger sees the event, which leaves its default alone.
 */
function keepLinkMenus(event: MouseEvent<HTMLElement>): void {
  if ((event.target as Element).closest?.("a[href]")) event.stopPropagation();
}

/**
 * The side bar's header row as its container's title (layout plan L6): its right-click menu
 * lists the container's views, hidden ones too, to hide and show them, and moves one. A link
 * keeps the browser's own menu.
 */
export function ContainerViewsMenu({
  containerId,
  children,
  registry = railViews,
}: {
  containerId: string;
  children: ReactElement;
  registry?: RailViewRegistry;
}) {
  const { views: registered } = useRailViews(registry, null);
  const layout = useViewsLayout();
  const locations = useViewLocations();
  const owner = useViewContainers().containers.find(
    (container) => container.id === containerId,
  )?.extensionId;
  // A view the product removed isn't offered to show again.
  const scope = useWorkbenchScope();
  const { productLayout: policy, moveViewPicker } = scope;
  const defaults = useDefaultHiddenViews();
  // Every view the container has, default-hidden ones too, so the menu can show them again.
  const listed = containerViews(
    registered,
    containerId,
    owner,
    NO_VIEWS_LAYOUT,
    locations,
    policy,
    NO_DEFAULT_HIDDEN,
  ).filter((view) => canMoveView(view, policy) && !isViewRemovedByProduct(view, policy));
  const drawn = new Set(
    containerViews(registered, containerId, owner, layout, locations, policy, defaults).map(
      (view) => view.id,
    ),
  );
  const shown = listed.filter((view) => drawn.has(view.id)).length;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        disabled={listed.length === 0}
        onContextMenuCapture={keepLinkMenus}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent data-testid="view-container-menu">
        <ContextMenuLabel>Views</ContextMenuLabel>
        {listed.map((view) => {
          const checked = drawn.has(view.id);
          return (
            <ContextMenuCheckboxItem
              key={view.id}
              checked={checked}
              // The last view shown stays: a container with none leaves the side bar.
              disabled={checked && shown === 1}
              onCheckedChange={(next) => setViewHidden(view.id, !next, scope)}
            >
              {view.name}
            </ContextMenuCheckboxItem>
          );
        })}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => moveViewPicker.open()}>Move View…</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
