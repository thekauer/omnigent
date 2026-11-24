// Commands the host itself provides, as VS Code's built-in commands: `setContext`
// for `when` clauses, the workspace's file opener and changed-files refresh, and
// opening a session or sub-agent.
import type { WorkspaceBridge, WorkspaceTaskAction } from "@/shell/workspaceBridge";
import { Disposable } from "./base";
import type { CommandHandler, CommandRegistry } from "./commands";
import type { ContextKeyService } from "./contextKeys";

export const BUILT_IN_COMMAND_OWNER = "omnigent";
export const SET_CONTEXT_COMMAND = "setContext";
export const OPEN_FILE_COMMAND = "omnigent.openFile";
export const REFRESH_CHANGED_FILES_COMMAND = "omnigent.refreshChangedFiles";
/** Reloads the listings, searches and changed files of the workspace on screen. */
export const REFRESH_FILES_COMMAND = "omnigent.refreshFiles";
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
export const PULL_REQUESTS_LINK_COMMAND = "omnigent.pullRequests.link";
export const PULL_REQUESTS_UNLINK_COMMAND = "omnigent.pullRequests.unlink";
export const PULL_REQUESTS_REFRESH_COMMAND = "omnigent.pullRequests.refresh";
export const PULL_REQUESTS_MERGE_COMMAND = "omnigent.pullRequests.merge";
export const PULL_REQUESTS_UPDATE_LABELS_COMMAND = "omnigent.pullRequests.updateLabels";
export const PULL_REQUESTS_UPDATE_REVIEWERS_COMMAND = "omnigent.pullRequests.updateReviewers";
export const PULL_REQUESTS_POST_COMMENT_COMMAND = "omnigent.pullRequests.postComment";

const MERGE_METHODS = new Set(["merge", "squash", "rebase"]);
const MAX_LIST = 100;

function urlOf(command: string, value: unknown): string {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value) || value.length > 4096) {
    throw new TypeError(`${command} needs a pull request link`);
  }
  return value;
}

function namesOf(command: string, name: string, value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LIST) {
    throw new TypeError(`${command} needs ${name} as a list of names`);
  }
  return value.map((item) => textOf(command, name, item));
}

function reviewersOf(
  command: string,
  name: string,
  value: unknown,
): { login: string; kind: "user" | "team" }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LIST) {
    throw new TypeError(`${command} needs ${name} as a list of reviewers`);
  }
  return value.map((item) => {
    const record =
      typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const login = textOf(command, `${name} logins`, record.login);
    const kind = record.kind === "team" ? "team" : record.kind === "user" ? "user" : undefined;
    if (!login || !kind) throw new TypeError(`${command} needs each reviewer's login and kind`);
    return { login, kind };
  });
}

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
  const register = (id: string, handler: CommandHandler) =>
    commands.register(BUILT_IN_COMMAND_OWNER, id, handler, { builtIn: true });
  return Disposable.from(
    register(SET_CONTEXT_COMMAND, (key, value) => {
      services.contextKeys.set(key, value);
    }),
    register(OPEN_FILE_COMMAND, (path, position) => {
      if (typeof path !== "string" || path === "" || path.length > MAX_PATH) {
        throw new TypeError(`${OPEN_FILE_COMMAND} needs a workspace path`);
      }
      const at = positionOf(position);
      if (at) services.workspace.openFile(path, at);
      else services.workspace.openFile(path);
    }),
    register(OPEN_SESSION_COMMAND, (sessionId) => {
      services.workspace.openSession(sessionIdOf(OPEN_SESSION_COMMAND, sessionId), {
        asSubagent: false,
      });
    }),
    register(OPEN_SUBAGENT_COMMAND, (sessionId) => {
      services.workspace.openSession(sessionIdOf(OPEN_SUBAGENT_COMMAND, sessionId), {
        asSubagent: true,
      });
    }),
    register(REFRESH_CHANGED_FILES_COMMAND, () => services.workspace.refreshChangedFiles()),
    register(REFRESH_FILES_COMMAND, () => services.workspace.refreshFiles()),
    register(SHOW_IN_CHAT_COMMAND, (sessionId, markerId) => {
      const id = sessionIdOf(SHOW_IN_CHAT_COMMAND, sessionId);
      const marker = textOf(SHOW_IN_CHAT_COMMAND, "a marker id", markerId);
      if (marker === "") throw new TypeError(`${SHOW_IN_CHAT_COMMAND} needs a marker id`);
      services.workspace.tasksActions(id).showInChat(marker);
    }),
    register(OPEN_WORKFLOW_COMMAND, (workflowId) => {
      const id = textOf(OPEN_WORKFLOW_COMMAND, "a workflow id", workflowId);
      if (id === "") throw new TypeError(`${OPEN_WORKFLOW_COMMAND} needs a workflow id`);
      services.workspace.tasksActions().openWorkflow(id);
    }),
    register(TASKS_RUN_ACTION_COMMAND, (sessionId, action, taskName) => {
      const id = sessionIdOf(TASKS_RUN_ACTION_COMMAND, sessionId);
      if (!TASK_ACTIONS.includes(action as WorkspaceTaskAction)) {
        throw new TypeError(`${TASKS_RUN_ACTION_COMMAND} needs one of ${TASK_ACTIONS.join(", ")}`);
      }
      services.workspace
        .tasksActions(id)
        .taskAction(
          action as WorkspaceTaskAction,
          textOf(TASKS_RUN_ACTION_COMMAND, "a task name", taskName),
        );
    }),
    register(TASKS_STOP_COMMAND, (sessionId) => {
      services.workspace.tasksActions(sessionIdOf(TASKS_STOP_COMMAND, sessionId)).stopWork();
    }),
    register(TASKS_CONTINUE_PLAN_COMMAND, (sessionId, name) => {
      services.workspace
        .tasksActions(sessionIdOf(TASKS_CONTINUE_PLAN_COMMAND, sessionId))
        .continuePlan(optionalText(TASKS_CONTINUE_PLAN_COMMAND, "a plan name", name) ?? null);
    }),
    register(TASKS_SAVE_AS_WORKFLOW_COMMAND, (sessionId, name) => {
      services.workspace
        .tasksActions(sessionIdOf(TASKS_SAVE_AS_WORKFLOW_COMMAND, sessionId))
        .saveWorkflow(optionalText(TASKS_SAVE_AS_WORKFLOW_COMMAND, "a plan name", name) ?? "");
    }),
    register(TASKS_START_WORKFLOW_COMMAND, (sessionId, choice) => {
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
    register(TASKS_RELOAD_COMMAND, (sessionId) => {
      services.workspace.tasksActions(sessionIdOf(TASKS_RELOAD_COMMAND, sessionId)).reload();
    }),
    // The pull requests of the workspace on screen; each refuses another session.
    register(PULL_REQUESTS_LINK_COMMAND, (sessionId, url) => {
      const id = sessionIdOf(PULL_REQUESTS_LINK_COMMAND, sessionId);
      const link = textOf(PULL_REQUESTS_LINK_COMMAND, "a pull request link", url).trim();
      if (!link) throw new TypeError(`${PULL_REQUESTS_LINK_COMMAND} needs a pull request link`);
      return services.workspace.pullRequestsActions(id).link(link);
    }),
    register(PULL_REQUESTS_UNLINK_COMMAND, (sessionId, url) =>
      services.workspace
        .pullRequestsActions(sessionIdOf(PULL_REQUESTS_UNLINK_COMMAND, sessionId))
        .unlink(urlOf(PULL_REQUESTS_UNLINK_COMMAND, url)),
    ),
    register(PULL_REQUESTS_REFRESH_COMMAND, (sessionId) =>
      services.workspace
        .pullRequestsActions(sessionIdOf(PULL_REQUESTS_REFRESH_COMMAND, sessionId))
        .refresh(),
    ),
    register(PULL_REQUESTS_MERGE_COMMAND, (sessionId, url, options) => {
      const command = PULL_REQUESTS_MERGE_COMMAND;
      const id = sessionIdOf(command, sessionId);
      const record =
        typeof options === "object" && options !== null ? (options as Record<string, unknown>) : {};
      const method = record.method;
      if (typeof method !== "string" || !MERGE_METHODS.has(method)) {
        throw new TypeError(`${command} needs a method: merge, squash or rebase`);
      }
      const expectedHead = textOf(command, "the expected head commit", record.expectedHead);
      if (!expectedHead) throw new TypeError(`${command} needs the expected head commit`);
      const account = optionalText(command, "an account", record.account);
      return services.workspace.pullRequestsActions(id).merge(urlOf(command, url), {
        method: method as "merge" | "squash" | "rebase",
        expectedHead,
        ...(account === undefined ? {} : { account }),
      });
    }),
    register(PULL_REQUESTS_UPDATE_LABELS_COMMAND, (sessionId, url, change) => {
      const command = PULL_REQUESTS_UPDATE_LABELS_COMMAND;
      const record =
        typeof change === "object" && change !== null ? (change as Record<string, unknown>) : {};
      return services.workspace
        .pullRequestsActions(sessionIdOf(command, sessionId))
        .updateLabels(urlOf(command, url), {
          add: namesOf(command, "labels to add", record.add),
          remove: namesOf(command, "labels to remove", record.remove),
        });
    }),
    register(PULL_REQUESTS_UPDATE_REVIEWERS_COMMAND, (sessionId, url, change) => {
      const command = PULL_REQUESTS_UPDATE_REVIEWERS_COMMAND;
      const record =
        typeof change === "object" && change !== null ? (change as Record<string, unknown>) : {};
      return services.workspace
        .pullRequestsActions(sessionIdOf(command, sessionId))
        .updateReviewers(urlOf(command, url), {
          add: reviewersOf(command, "reviewers to add", record.add),
          remove: reviewersOf(command, "reviewers to remove", record.remove),
        });
    }),
    register(PULL_REQUESTS_POST_COMMENT_COMMAND, (sessionId, url, body) => {
      const command = PULL_REQUESTS_POST_COMMENT_COMMAND;
      // The host refuses comments past its limit with the reason; this only bounds the copy.
      if (typeof body !== "string" || !body.trim() || body.length > 262_144) {
        throw new TypeError(`${command} needs a comment`);
      }
      const text = body;
      return services.workspace
        .pullRequestsActions(sessionIdOf(command, sessionId))
        .postComment(urlOf(command, url), text);
    }),
  );
}
