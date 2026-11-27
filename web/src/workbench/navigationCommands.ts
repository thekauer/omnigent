// The built-in navigation entries' commands (layout plan L5): each opens its page through the
// shell's navigator, so an extension's `executeCommand("omnigent.openInbox")` and the side bar's
// row go to the same place. The extension pages entry is the host's group of rows: no page.

import { Disposable } from "@/vscodeExtensions/base";
import { BUILT_IN_COMMAND_OWNER } from "@/vscodeExtensions/builtinCommands";
import type { CommandRegistry } from "@/vscodeExtensions/commands";
import { NavigationEntries } from "./sidebarNavigation";

/** Where each built-in entry goes. */
export const NAVIGATION_PATHS: Readonly<Record<string, string>> = Object.freeze({
  [NavigationEntries.newSession]: "/",
  [NavigationEntries.automations]: "/tasks",
  [NavigationEntries.workflows]: "/workflows",
  [NavigationEntries.inbox]: "/inbox",
  [NavigationEntries.canvas]: "/canvas",
  [NavigationEntries.usage]: "/usage",
});

let navigator: ((path: string) => void) | null = null;

/** The shell's navigation (its router's), while it is mounted; returns the removal. */
export function setShellNavigator(navigate: (path: string) => void): () => void {
  navigator = navigate;
  return () => {
    if (navigator === navigate) navigator = null;
  };
}

/** How the side bar's row goes, when it does more than open a path (it switches a tab). */
export type NavigationHandler = (navigate: (path: string) => void) => void;

const handlers = new Map<string, NavigationHandler>();

/**
 * Runs `handler` for `command` instead of opening its path, while the side bar that set it is
 * mounted, so the command does what its row does; returns the removal.
 */
export function setNavigationHandler(command: string, handler: NavigationHandler): () => void {
  handlers.set(command, handler);
  return () => {
    if (handlers.get(command) === handler) handlers.delete(command);
  };
}

/** Opens the entry `command` names: as its row does, else its path. */
export function runNavigationEntry(command: string): void {
  const navigate = navigator;
  const path = NAVIGATION_PATHS[command];
  if (!navigate || path === undefined) return;
  const handler = handlers.get(command);
  if (handler) handler(navigate);
  else navigate(path);
}

export function registerNavigationCommands(commands: CommandRegistry): Disposable {
  return Disposable.from(
    ...Object.keys(NAVIGATION_PATHS).map((command) =>
      commands.register(BUILT_IN_COMMAND_OWNER, command, () => runNavigationEntry(command), {
        builtIn: true,
      }),
    ),
    commands.register(BUILT_IN_COMMAND_OWNER, NavigationEntries.extensionPages, () => {}, {
      builtIn: true,
    }),
  );
}
