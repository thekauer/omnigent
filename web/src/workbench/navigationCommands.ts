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

export function registerNavigationCommands(commands: CommandRegistry): Disposable {
  return Disposable.from(
    ...Object.entries(NAVIGATION_PATHS).map(([command, path]) =>
      commands.register(BUILT_IN_COMMAND_OWNER, command, () => navigator?.(path), {
        builtIn: true,
      }),
    ),
    commands.register(BUILT_IN_COMMAND_OWNER, NavigationEntries.extensionPages, () => {}, {
      builtIn: true,
    }),
  );
}
