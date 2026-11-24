// Commands the host itself provides, as VS Code's built-in commands: `setContext`
// for `when` clauses, the workspace's file opener and changed-files refresh, and
// opening a session or sub-agent.
import type { WorkspaceBridge } from "@/shell/workspaceBridge";
import { Disposable } from "./base";
import type { CommandRegistry } from "./commands";
import type { ContextKeyService } from "./contextKeys";

export const BUILT_IN_COMMAND_OWNER = "omnigent";
export const SET_CONTEXT_COMMAND = "setContext";
export const OPEN_FILE_COMMAND = "omnigent.openFile";
export const REFRESH_CHANGED_FILES_COMMAND = "omnigent.refreshChangedFiles";
export const OPEN_SESSION_COMMAND = "omnigent.openSession";
export const OPEN_SUBAGENT_COMMAND = "omnigent.openSubagent";

const MAX_PATH = 4096;
const MAX_SESSION_ID = 500;

function positionOf(value: unknown): { line?: number; column?: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { line, column } = value as { line?: unknown; column?: unknown };
  const valid = (number: unknown) => Number.isInteger(number) && (number as number) > 0;
  const position = {
    ...(valid(line) ? { line: line as number } : {}),
    ...(valid(column) ? { column: column as number } : {}),
  };
  return position.line === undefined && position.column === undefined ? undefined : position;
}

function sessionIdOf(command: string, value: unknown): string {
  if (typeof value !== "string" || value === "" || value.length > MAX_SESSION_ID) {
    throw new TypeError(`${command} needs a session id`);
  }
  return value;
}

export function registerBuiltInCommands(
  commands: CommandRegistry,
  services: { contextKeys: ContextKeyService; workspace: WorkspaceBridge },
): Disposable {
  return Disposable.from(
    commands.register(BUILT_IN_COMMAND_OWNER, SET_CONTEXT_COMMAND, (key, value) => {
      services.contextKeys.set(key, value);
    }),
    commands.register(BUILT_IN_COMMAND_OWNER, OPEN_FILE_COMMAND, (path, position) => {
      if (typeof path !== "string" || path === "" || path.length > MAX_PATH) {
        throw new TypeError(`${OPEN_FILE_COMMAND} needs a workspace path`);
      }
      const at = positionOf(position);
      if (at) services.workspace.openFile(path, at);
      else services.workspace.openFile(path);
    }),
    commands.register(BUILT_IN_COMMAND_OWNER, OPEN_SESSION_COMMAND, (sessionId) => {
      services.workspace.openSession(sessionIdOf(OPEN_SESSION_COMMAND, sessionId), {
        asSubagent: false,
      });
    }),
    commands.register(BUILT_IN_COMMAND_OWNER, OPEN_SUBAGENT_COMMAND, (sessionId) => {
      services.workspace.openSession(sessionIdOf(OPEN_SUBAGENT_COMMAND, sessionId), {
        asSubagent: true,
      });
    }),
    commands.register(BUILT_IN_COMMAND_OWNER, REFRESH_CHANGED_FILES_COMMAND, () =>
      services.workspace.refreshChangedFiles(),
    ),
  );
}
