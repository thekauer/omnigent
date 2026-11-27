// The layout's commands under VS Code's ids (layout plan L2), registered as built-ins so
// extensions and keybindings run them through `commands.executeCommand`. The ⌘K palette's
// rows and the shortcuts run the same toggles; their old ids stay as aliases.

import { Disposable } from "@/vscodeExtensions/base";
import { BUILT_IN_COMMAND_OWNER } from "@/vscodeExtensions/builtinCommands";
import type { CommandRegistry } from "@/vscodeExtensions/commands";
import { ContextKeyService } from "@/vscodeExtensions/contextKeys";
import { type LayoutService, Parts } from "./layoutService";
import { toggleActivityBarVisibility } from "./activityBar";
import { type LayoutStateStore, layoutState } from "./layoutState";
import { type ViewContainerRegistry, viewContainers } from "./viewContainers";
import type { ConfigurationService } from "@/configuration/configurationService";
import { isDesktopLayout } from "@/hooks/useIsMobileViewport";

export const TOGGLE_SIDEBAR_COMMAND = "workbench.action.toggleSidebarVisibility";
export const CLOSE_SIDEBAR_COMMAND = "workbench.action.closeSidebar";
export const TOGGLE_AUXILIARY_BAR_COMMAND = "workbench.action.toggleAuxiliaryBar";
export const CLOSE_AUXILIARY_BAR_COMMAND = "workbench.action.closeAuxiliaryBar";
export const TOGGLE_ACTIVITY_BAR_COMMAND = "workbench.action.toggleActivityBarVisibility";
export const FOCUS_ACTIVITY_BAR_COMMAND = "workbench.action.focusActivityBar";
export const RESET_LAYOUT_COMMAND = "workbench.action.resetLayout";

/** VS Code's `workbench.view.<container>`: shows the container. */
export function viewContainerCommand(containerId: string): string {
  return `workbench.view.${containerId}`;
}

/**
 * View: Reset Layout: what the user dragged and toggled goes (the layout state), the settings
 * stay; the side bar opens again on its default container.
 */
export function resetLayout(layout: LayoutService, store: LayoutStateStore = layoutState): void {
  store.reset();
  // A phone's side bar is a drawer: it stays as it is.
  if (isDesktopLayout()) layout.setPartHidden(false, Parts.SIDEBAR_PART);
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
    [TOGGLE_ACTIVITY_BAR_COMMAND]: () => {
      if (configuration) toggleActivityBarVisibility(configuration);
    },
    [FOCUS_ACTIVITY_BAR_COMMAND]: () => {
      layout.focusPart(Parts.ACTIVITYBAR_PART);
    },
    [RESET_LAYOUT_COMMAND]: () => resetLayout(layout, store),
  };
  const registrations = [
    ...Object.entries(handlers).map(([id, run]) => register(id, run)),
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
      const open =
        container.location === "sidebar"
          ? () => layout.openViewContainer(container.id)
          : () => layout.setPartHidden(false, Parts.AUXILIARYBAR_PART);
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
