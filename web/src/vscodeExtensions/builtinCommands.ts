// Commands the host itself provides, as VS Code's built-in commands: `setContext`
// for `when` clauses, the workspace's file opener and changed-files refresh, and
// opening a session or sub-agent.
import type { WorkspaceBridge, WorkspaceTaskAction } from "@/shell/workspaceBridge";
import { Disposable } from "./base";
import type { CommandRegistry } from "./commands";
import type { ContextKeyService } from "./contextKeys";

export const BUILT_IN_COMMAND_OWNER = "omnigent";
export const SET_CONTEXT_COMMAND = "setContext";
export const OPEN_FILE_COMMAND = "omnigent.openFile";
export const REFRESH_CHANGED_FILES_COMMAND = "omnigent.refreshChangedFiles";
export const OPEN_SESSION_COMMAND = "omnigent.openSession";
export const OPEN_SUBAGENT_COMMAND = "omnigent.openSubagent";
export const SHOW_IN_CHAT_COMMAND = "omnigent.showInChat";
export const OPEN_WORKFLOW_COMMAND = "omnigent.openWorkflow";
export const TASKS_RUN_ACTION_COMMAND = "omnigent.tasks.runTaskAction";
export const TASKS_STOP_COMMAND = "omnigent.tasks.stop";
export const TASKS_CONTINUE_PLAN_COMMAND = "omnigent.tasks.continuePlan";
export const TASKS_SAVE_AS_WORKFLOW_COMMAND = "omnigent.tasks.saveAsWorkflow";
export const TASKS_START_WORKFLOW_COMMAND = "omnigent.tasks.startWorkflow";
export const TASKS_RELOAD_COMMAND = "omnigent.tasks.reload";

const TASK_ACTIONS: readonly WorkspaceTaskAction[] = ["run", "continue", "proceed", "retry"];
const MAX_TEXT = 4096;

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

function textOf(command: string, name: string, value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_TEXT) {
    throw new TypeError(`${command} needs ${name}`);
  }
  return value;
}

function optionalText(command: string, name: string, value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : textOf(command, name, value);
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
    commands.register(BUILT_IN_COMMAND_OWNER, SHOW_IN_CHAT_COMMAND, (sessionId, markerId) => {
      const id = sessionIdOf(SHOW_IN_CHAT_COMMAND, sessionId);
      const marker = textOf(SHOW_IN_CHAT_COMMAND, "a marker id", markerId);
      if (marker === "") throw new TypeError(`${SHOW_IN_CHAT_COMMAND} needs a marker id`);
      services.workspace.tasksActions(id).showInChat(marker);
    }),
    commands.register(BUILT_IN_COMMAND_OWNER, OPEN_WORKFLOW_COMMAND, (workflowId) => {
      const id = textOf(OPEN_WORKFLOW_COMMAND, "a workflow id", workflowId);
      if (id === "") throw new TypeError(`${OPEN_WORKFLOW_COMMAND} needs a workflow id`);
      services.workspace.tasksActions().openWorkflow(id);
    }),
    commands.register(
      BUILT_IN_COMMAND_OWNER,
      TASKS_RUN_ACTION_COMMAND,
      (sessionId, action, taskName) => {
        const id = sessionIdOf(TASKS_RUN_ACTION_COMMAND, sessionId);
        if (!TASK_ACTIONS.includes(action as WorkspaceTaskAction)) {
          throw new TypeError(
            `${TASKS_RUN_ACTION_COMMAND} needs one of ${TASK_ACTIONS.join(", ")}`,
          );
        }
        services.workspace
          .tasksActions(id)
          .taskAction(
            action as WorkspaceTaskAction,
            textOf(TASKS_RUN_ACTION_COMMAND, "a task name", taskName),
          );
      },
    ),
    commands.register(BUILT_IN_COMMAND_OWNER, TASKS_STOP_COMMAND, (sessionId) => {
      services.workspace.tasksActions(sessionIdOf(TASKS_STOP_COMMAND, sessionId)).stopWork();
    }),
    commands.register(BUILT_IN_COMMAND_OWNER, TASKS_CONTINUE_PLAN_COMMAND, (sessionId, name) => {
      services.workspace
        .tasksActions(sessionIdOf(TASKS_CONTINUE_PLAN_COMMAND, sessionId))
        .continuePlan(optionalText(TASKS_CONTINUE_PLAN_COMMAND, "a plan name", name) ?? null);
    }),
    commands.register(BUILT_IN_COMMAND_OWNER, TASKS_SAVE_AS_WORKFLOW_COMMAND, (sessionId, name) => {
      services.workspace
        .tasksActions(sessionIdOf(TASKS_SAVE_AS_WORKFLOW_COMMAND, sessionId))
        .saveWorkflow(optionalText(TASKS_SAVE_AS_WORKFLOW_COMMAND, "a plan name", name) ?? "");
    }),
    commands.register(BUILT_IN_COMMAND_OWNER, TASKS_START_WORKFLOW_COMMAND, (sessionId, choice) => {
      const id = sessionIdOf(TASKS_START_WORKFLOW_COMMAND, sessionId);
      const record = (typeof choice === "object" && choice !== null ? choice : {}) as {
        description?: unknown;
        workflowId?: unknown;
      };
      const description = optionalText(
        TASKS_START_WORKFLOW_COMMAND,
        "a description",
        record.description,
      );
      const workflowId = optionalText(
        TASKS_START_WORKFLOW_COMMAND,
        "a workflow id",
        record.workflowId,
      );
      services.workspace.tasksActions(id).startWorkflow({
        ...(description === undefined ? {} : { description }),
        ...(workflowId === undefined ? {} : { workflowId }),
      });
    }),
    commands.register(BUILT_IN_COMMAND_OWNER, TASKS_RELOAD_COMMAND, (sessionId) => {
      services.workspace.tasksActions(sessionIdOf(TASKS_RELOAD_COMMAND, sessionId)).reload();
    }),
  );
}
