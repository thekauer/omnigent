// The layout's commands under VS Code's ids (layout plan L2), registered as built-ins so
// extensions and keybindings run them through `commands.executeCommand`. The ⌘K palette's
// rows and the shortcuts run the same toggles; their old ids stay as aliases.

import { Disposable } from "@/vscodeExtensions/base";
import { BUILT_IN_COMMAND_OWNER } from "@/vscodeExtensions/builtinCommands";
import type { CommandRegistry } from "@/vscodeExtensions/commands";
import { ContextKeyService } from "@/vscodeExtensions/contextKeys";
import { findPartElement, type LayoutService, type Part, Parts } from "./layoutService";
import { toggleActivityBarVisibility } from "./activityBar";
import { type LayoutStateStore, layoutState, RESETTABLE_LAYOUT_SLOTS } from "./layoutState";
import { toast } from "sonner";
import { type ViewContainerRegistry, viewContainers } from "./viewContainers";
import { resetViewLocations } from "./viewLocations";
import { isContainerHiddenByProduct } from "./productLayout";
import type { ConfigurationService } from "@/configuration/configurationService";
import { isDesktopLayout } from "@/hooks/useIsMobileViewport";
import { workbenchScopeOfState } from "./workbenchScope";
import { layoutWidthOf } from "./layoutViewport";

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
 * its default container. A toast in the mount that was reset offers to undo it there, whichever
 * mount is active by then.
 */
export function resetLayout(layout: LayoutService, store: LayoutStateStore = layoutState): void {
  // The mount active now, not when the undo is clicked.
  const target = store.resolve();
  const service = layout.resolve();
  const removed = target.resetSlots(RESETTABLE_LAYOUT_SLOTS);
  // A phone's side bar is a drawer: it stays as it is.
  if (isDesktopLayout()) service.setPartHidden(false, Parts.SIDEBAR_PART);
  if (Object.keys(removed).length === 0) return;
  const toasterId = workbenchScopeOfState(target)?.toasterId;
  toast.success("Layout reset", {
    ...(toasterId ? { toasterId } : {}),
    action: { label: "Undo", onClick: () => target.restoreSlots(removed) },
  });
}

/** The palette's ids for the same toggles, before the VS Code ids. */
export const LAYOUT_COMMAND_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "toggle-left-sidebar": TOGGLE_SIDEBAR_COMMAND,
  "toggle-right-sidebar": TOGGLE_AUXILIARY_BAR_COMMAND,
});

/** VS Code's context keys for the parts' visibility (the title bar's is Omnigent's). */
export const PART_VISIBILITY_CONTEXT_KEYS = Object.freeze({
  [Parts.SIDEBAR_PART]: "sideBarVisible",
  [Parts.AUXILIARYBAR_PART]: "auxiliaryBarVisible",
  [Parts.ACTIVITYBAR_PART]: "activityBarVisible",
  [Parts.TITLEBAR_PART]: "titleBarVisible",
} as const);

/** VS Code's key for the container the open side bar shows. */
export const ACTIVE_VIEWLET_CONTEXT_KEY = "activeViewlet";
/** VS Code's keys for the secondary side bar's maximized state and focus, and the focused view. */
export const AUXILIARY_BAR_MAXIMIZED_CONTEXT_KEY = "auxiliaryBarMaximized";
export const SIDE_BAR_FOCUS_CONTEXT_KEY = "sideBarFocus";
export const AUXILIARY_BAR_FOCUS_CONTEXT_KEY = "auxiliaryBarFocus";
export const FOCUSED_VIEW_CONTEXT_KEY = "focusedView";
/** Omnigent's width class (`phone`, `band`, `desktop`) of the layout the parts draw. */
export const LAYOUT_WIDTH_CONTEXT_KEY = "omnigent.layoutWidth";

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

/** The view a drawn element belongs to: a side bar view (`data-view`) or a rail tab's page. */
function viewIdOf(element: Element | null): string | undefined {
  const drawn = element?.closest?.('[data-view], [data-testid^="extension-view-"]');
  if (!drawn) return undefined;
  const id =
    drawn.getAttribute("data-view") ??
    drawn.getAttribute("data-testid")?.slice("extension-view-".length);
  return id || undefined;
}

/** The view keyboard focus is in. */
export function focusedViewId(): string | undefined {
  return viewIdOf(typeof document === "undefined" ? null : document.activeElement);
}

/**
 * The focused element, when it is inside the layout's root, or without a root (the standalone
 * app) outside every embed.
 */
function focusInActiveLayout(layout: LayoutService): Element | null {
  if (typeof document === "undefined") return null;
  const active = document.activeElement;
  if (!active) return null;
  const root = layout.getRoot();
  if (root) return root.contains(active) ? active : null;
  // The window's layout: the page's focus outside every embed (an embed's views are its own).
  return active.closest(".omnigent-app") === null ? active : null;
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
      contextKeys.setHost(
        AUXILIARY_BAR_MAXIMIZED_CONTEXT_KEY,
        layout.isVisible(Parts.AUXILIARYBAR_PART) && layout.isMaximized(Parts.AUXILIARYBAR_PART),
      );
      contextKeys.setHost(LAYOUT_WIDTH_CONTEXT_KEY, layoutWidthOf(layout.getViewport()));
      // Focus is read where it is: inside the part's element of the active mount.
      const focused = focusInActiveLayout(layout);
      const inPart = (part: Part) => {
        const element = findPartElement(part, layout.getRoot());
        return focused !== null && element !== null && element.contains(focused);
      };
      contextKeys.setHost(SIDE_BAR_FOCUS_CONTEXT_KEY, inPart(Parts.SIDEBAR_PART));
      contextKeys.setHost(AUXILIARY_BAR_FOCUS_CONTEXT_KEY, inPart(Parts.AUXILIARYBAR_PART));
      contextKeys.setHost(FOCUSED_VIEW_CONTEXT_KEY, viewIdOf(focused));
    };
    sync();
    // Focus moves inside the page, so it is read as it moves; the active mount's own focus
    // (which activates it) follows through the layout's switch.
    const onFocusChange = () => sync();
    const onDocument = typeof document === "undefined" ? null : document;
    onDocument?.addEventListener("focusin", onFocusChange, true);
    onDocument?.addEventListener("focusout", onFocusChange, true);
    registrations.push(
      new Disposable(layout.onDidChangePartVisibility(sync)),
      new Disposable(layout.onDidChangeSideBar(sync)),
      new Disposable(layout.onDidChangeLayout(sync)),
      new Disposable(layout.onDidChangeViewport(sync)),
      new Disposable(() => {
        onDocument?.removeEventListener("focusin", onFocusChange, true);
        onDocument?.removeEventListener("focusout", onFocusChange, true);
      }),
    );
  }
  return Disposable.from(...registrations);
}
