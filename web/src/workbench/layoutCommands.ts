// The layout's commands under VS Code's ids (layout plan L2), registered as built-ins so
// extensions and keybindings run them through `commands.executeCommand`. The ⌘K palette's
// rows and the shortcuts run the same toggles; their old ids stay as aliases.

import { Disposable } from "@/vscodeExtensions/base";
import { BUILT_IN_COMMAND_OWNER } from "@/vscodeExtensions/builtinCommands";
import type { CommandRegistry } from "@/vscodeExtensions/commands";
import { ContextKeyService } from "@/vscodeExtensions/contextKeys";
import { type LayoutService, Parts } from "./layoutService";
import { toggleActivityBarVisibility } from "./activityBar";
import { type LayoutStateStore, layoutState, RESETTABLE_LAYOUT_SLOTS } from "./layoutState";
import { toast } from "sonner";
import { type ViewContainerRegistry, viewContainers } from "./viewContainers";
import { resetViewLocations } from "./viewLocations";
import { isContainerHiddenByProduct } from "./productLayout";
import type { ConfigurationService } from "@/configuration/configurationService";
import { isDesktopLayout } from "@/hooks/useIsMobileViewport";

export const TOGGLE_SIDEBAR_COMMAND = "workbench.action.toggleSidebarVisibility";
export const CLOSE_SIDEBAR_COMMAND = "workbench.action.closeSidebar";
export const TOGGLE_AUXILIARY_BAR_COMMAND = "workbench.action.toggleAuxiliaryBar";
export const CLOSE_AUXILIARY_BAR_COMMAND = "workbench.action.closeAuxiliaryBar";
export const TOGGLE_MAXIMIZED_AUXILIARY_BAR_COMMAND =
  "workbench.action.toggleMaximizedAuxiliaryBar";
export const TOGGLE_ACTIVITY_BAR_COMMAND = "workbench.action.toggleActivityBarVisibility";
export const FOCUS_ACTIVITY_BAR_COMMAND = "workbench.action.focusActivityBar";
export const RESET_LAYOUT_COMMAND = "workbench.action.resetLayout";
export const MOVE_VIEW_COMMAND = "workbench.action.moveView";
export const MOVE_FOCUSED_VIEW_COMMAND = "workbench.action.moveFocusedView";
export const RESET_VIEW_LOCATIONS_COMMAND = "workbench.action.resetViewLocations";

/** VS Code's `workbench.view.<container>`: shows the container. */
export function viewContainerCommand(containerId: string): string {
  return `workbench.view.${containerId}`;
}

/**
 * View: Reset Layout: what the user dragged and toggled goes (the layout state's layout slots),
 * the settings and the conversation list's own preferences stay; the side bar opens again on
 * its default container. A toast offers to undo it.
 */
export function resetLayout(layout: LayoutService, store: LayoutStateStore = layoutState): void {
  const removed = store.resetSlots(RESETTABLE_LAYOUT_SLOTS);
  // A phone's side bar is a drawer: it stays as it is.
  if (isDesktopLayout()) layout.setPartHidden(false, Parts.SIDEBAR_PART);
  if (Object.keys(removed).length === 0) return;
  toast.success("Layout reset", {
    action: { label: "Undo", onClick: () => store.restoreSlots(removed) },
  });
}

/** The palette's ids for the same toggles, before the VS Code ids. */
export const LAYOUT_COMMAND_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "toggle-left-sidebar": TOGGLE_SIDEBAR_COMMAND,
  "toggle-right-sidebar": TOGGLE_AUXILIARY_BAR_COMMAND,
});

/** VS Code's context keys for the parts' visibility. */
export const PART_VISIBILITY_CONTEXT_KEYS = Object.freeze({
  [Parts.SIDEBAR_PART]: "sideBarVisible",
  [Parts.AUXILIARYBAR_PART]: "auxiliaryBarVisible",
  [Parts.ACTIVITYBAR_PART]: "activityBarVisible",
} as const);

/** VS Code's key for the container the open side bar shows. */
export const ACTIVE_VIEWLET_CONTEXT_KEY = "activeViewlet";

export interface LayoutCommandOptions {
  readonly contextKeys?: ContextKeyService;
  /** The activity bar's toggle writes its setting here. */
  readonly configuration?: ConfigurationService;
  /** Each container gets its `workbench.view.<id>` command. */
  readonly containers?: ViewContainerRegistry;
  readonly store?: LayoutStateStore;
  /** Opens the Move View picker, for the view given (else it asks for one). */
  readonly openMoveView?: (viewId?: string) => void;
}

/** The view keyboard focus is in, by its drawn element (a side bar pane or a rail tab's page). */
export function focusedViewId(): string | undefined {
  const active = typeof document === "undefined" ? null : document.activeElement;
  const drawn = active?.closest?.('[data-testid^="extension-view-"]');
  return drawn?.getAttribute("data-testid")?.slice("extension-view-".length) || undefined;
}

/** Registers the layout commands and keeps the visibility context keys; returns the removal. */
export function registerLayoutCommands(
  commands: CommandRegistry,
  layout: LayoutService,
  options: LayoutCommandOptions | ContextKeyService = {},
): Disposable {
  const {
    contextKeys,
    configuration,
    containers = viewContainers,
    store = layoutState,
    openMoveView,
  } = options instanceof ContextKeyService ? { contextKeys: options } : options;
  const register = (id: string, run: () => void) =>
    commands.register(BUILT_IN_COMMAND_OWNER, id, () => run(), { builtIn: true });
  const handlers: Record<string, () => void> = {
    [TOGGLE_SIDEBAR_COMMAND]: () => layout.togglePart(Parts.SIDEBAR_PART),
    [CLOSE_SIDEBAR_COMMAND]: () => layout.setPartHidden(true, Parts.SIDEBAR_PART),
    [TOGGLE_AUXILIARY_BAR_COMMAND]: () => layout.togglePart(Parts.AUXILIARYBAR_PART),
    [CLOSE_AUXILIARY_BAR_COMMAND]: () => {
      if (layout.isVisible(Parts.AUXILIARYBAR_PART)) {
        layout.setPartHidden(true, Parts.AUXILIARYBAR_PART);
      }
    },
    [TOGGLE_MAXIMIZED_AUXILIARY_BAR_COMMAND]: () => {
      layout.toggleMaximized(Parts.AUXILIARYBAR_PART);
    },
    [TOGGLE_ACTIVITY_BAR_COMMAND]: () => {
      if (configuration) toggleActivityBarVisibility(configuration);
    },
    [FOCUS_ACTIVITY_BAR_COMMAND]: () => {
      layout.focusPart(Parts.ACTIVITYBAR_PART);
    },
    [RESET_LAYOUT_COMMAND]: () => resetLayout(layout, store),
    [RESET_VIEW_LOCATIONS_COMMAND]: () => resetViewLocations(store),
    [MOVE_FOCUSED_VIEW_COMMAND]: () => {
      const viewId = focusedViewId();
      if (viewId !== undefined) openMoveView?.(viewId);
    },
  };
  const registrations = [
    ...Object.entries(handlers).map(([id, run]) => register(id, run)),
    // VS Code's `workbench.action.moveView` takes the view's id as its argument.
    commands.register(
      BUILT_IN_COMMAND_OWNER,
      MOVE_VIEW_COMMAND,
      (viewId?: unknown) => openMoveView?.(typeof viewId === "string" ? viewId : undefined),
      { builtIn: true },
    ),
    ...Object.entries(LAYOUT_COMMAND_ALIASES).map(([alias, id]) => register(alias, handlers[id]!)),
  ];
  // `workbench.view.<id>` for each side bar and secondary side bar container, as they come.
  const viewCommands = new Map<string, Disposable>();
  const syncViewCommands = () => {
    const current = new Set<string>();
    for (const container of containers.getSnapshot().containers) {
      if (container.location === "panel") continue;
      current.add(container.id);
      if (viewCommands.has(container.id)) continue;
      const show =
        container.location === "sidebar"
          ? () => layout.openViewContainer(container.id)
          : () => layout.setPartHidden(false, Parts.AUXILIARYBAR_PART);
      // A container the product removed doesn't show.
      const open = () => {
        if (!isContainerHiddenByProduct(container.id)) show();
      };
      try {
        viewCommands.set(container.id, register(viewContainerCommand(container.id), open));
      } catch {
        // An extension registered the id first: theirs stands.
      }
    }
    for (const [id, registration] of viewCommands) {
      if (current.has(id)) continue;
      registration.dispose();
      viewCommands.delete(id);
    }
  };
  syncViewCommands();
  registrations.push(
    new Disposable(containers.subscribe(syncViewCommands)),
    new Disposable(() => {
      for (const registration of viewCommands.values()) registration.dispose();
      viewCommands.clear();
    }),
  );
  if (contextKeys) {
    const sync = () => {
      for (const [part, key] of Object.entries(PART_VISIBILITY_CONTEXT_KEYS)) {
        contextKeys.setHost(
          key,
          layout.isVisible(part as keyof typeof PART_VISIBILITY_CONTEXT_KEYS),
        );
      }
      contextKeys.setHost(
        ACTIVE_VIEWLET_CONTEXT_KEY,
        layout.isVisible(Parts.SIDEBAR_PART) ? layout.getActiveViewContainer() : undefined,
      );
    };
    sync();
    registrations.push(
      new Disposable(layout.onDidChangePartVisibility(sync)),
      new Disposable(layout.onDidChangeSideBar(sync)),
    );
  }
  return Disposable.from(...registrations);
}
