// The layout's commands under VS Code's ids (layout plan L2), registered as built-ins so
// extensions and keybindings run them through `commands.executeCommand`. The ⌘K palette's
// rows and the shortcuts run the same toggles; their old ids stay as aliases.

import { Disposable } from "@/vscodeExtensions/base";
import { BUILT_IN_COMMAND_OWNER } from "@/vscodeExtensions/builtinCommands";
import type { CommandRegistry } from "@/vscodeExtensions/commands";
import type { ContextKeyService } from "@/vscodeExtensions/contextKeys";
import { type LayoutService, Parts } from "./layoutService";

export const TOGGLE_SIDEBAR_COMMAND = "workbench.action.toggleSidebarVisibility";
export const CLOSE_SIDEBAR_COMMAND = "workbench.action.closeSidebar";
export const TOGGLE_AUXILIARY_BAR_COMMAND = "workbench.action.toggleAuxiliaryBar";
export const CLOSE_AUXILIARY_BAR_COMMAND = "workbench.action.closeAuxiliaryBar";

/** The palette's ids for the same toggles, before the VS Code ids. */
export const LAYOUT_COMMAND_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "toggle-left-sidebar": TOGGLE_SIDEBAR_COMMAND,
  "toggle-right-sidebar": TOGGLE_AUXILIARY_BAR_COMMAND,
});

/** VS Code's context keys for the parts' visibility. */
export const PART_VISIBILITY_CONTEXT_KEYS = Object.freeze({
  [Parts.SIDEBAR_PART]: "sideBarVisible",
  [Parts.AUXILIARYBAR_PART]: "auxiliaryBarVisible",
} as const);

/** Registers the layout commands and keeps the visibility context keys; returns the removal. */
export function registerLayoutCommands(
  commands: CommandRegistry,
  layout: LayoutService,
  contextKeys?: ContextKeyService,
): Disposable {
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
  };
  const registrations = [
    ...Object.entries(handlers).map(([id, run]) => register(id, run)),
    ...Object.entries(LAYOUT_COMMAND_ALIASES).map(([alias, id]) => register(alias, handlers[id]!)),
  ];
  if (contextKeys) {
    const sync = () => {
      for (const [part, key] of Object.entries(PART_VISIBILITY_CONTEXT_KEYS)) {
        contextKeys.setHost(
          key,
          layout.isVisible(part as keyof typeof PART_VISIBILITY_CONTEXT_KEYS),
        );
      }
    };
    sync();
    registrations.push(new Disposable(layout.onDidChangePartVisibility(sync)));
  }
  return Disposable.from(...registrations);
}
