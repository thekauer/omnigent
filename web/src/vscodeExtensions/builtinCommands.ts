// Commands the host itself provides, as VS Code's built-in commands: `setContext`
// for `when` clauses, and the workspace's file opener and changed-files refresh.
import type { WorkspaceBridge } from "@/shell/workspaceBridge";
import { Disposable } from "./base";
import type { CommandRegistry } from "./commands";
import type { ContextKeyService } from "./contextKeys";

export const BUILT_IN_COMMAND_OWNER = "omnigent";
export const SET_CONTEXT_COMMAND = "setContext";
export const OPEN_FILE_COMMAND = "omnigent.openFile";
export const REFRESH_CHANGED_FILES_COMMAND = "omnigent.refreshChangedFiles";

const MAX_PATH = 4096;

export function registerBuiltInCommands(
  commands: CommandRegistry,
  services: { contextKeys: ContextKeyService; workspace: WorkspaceBridge },
): Disposable {
  return Disposable.from(
    commands.register(BUILT_IN_COMMAND_OWNER, SET_CONTEXT_COMMAND, (key, value) => {
      services.contextKeys.set(key, value);
    }),
    commands.register(BUILT_IN_COMMAND_OWNER, OPEN_FILE_COMMAND, (path) => {
      if (typeof path !== "string" || path === "" || path.length > MAX_PATH) {
        throw new TypeError(`${OPEN_FILE_COMMAND} needs a workspace path`);
      }
      services.workspace.openFile(path);
    }),
    commands.register(BUILT_IN_COMMAND_OWNER, REFRESH_CHANGED_FILES_COMMAND, () =>
      services.workspace.refreshChangedFiles(),
    ),
  );
}
