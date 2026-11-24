// Checks a plan view's content (`window.createPlanView`) into the plain, capped,
// frozen data the host draws. Anything malformed is dropped, never thrown.
import type * as omnigent from "omnigent";
import { isRailViewIconName } from "@/shell/railViewIcons";

const MAX_TEXT = 10_000;
const MAX_LABEL = 500;
const MAX_TASKS = 500;
const MAX_HISTORY = 500;
const MAX_IDS = 100;
const MAX_ARGS = 8;
const MAX_ARGS_JSON = 8192;
const COMMAND_ID = /^[A-Za-z0-9._-]{1,200}$/;

const TASK_STATES = new Set<omnigent.TaskState>([
  "waiting",
  "ready",
  "running",
  "stopped",
  "needs_input",
  "done",
  "failed",
]);
const STATUSES = new Set<omnigent.TaskStatus["status"]>([
  "started",
  "done",
  "needs_input",
  "failed",
]);
const ACTIONS = new Set<omnigent.PlanTaskAction["action"]>([
  "run",
  "continue",
  "proceed",
  "retry",
  "stop",
]);

type Record_ = Record<string, unknown>;

const isRecord = (value: unknown): value is Record_ => typeof value === "object" && value !== null;

function text(value: unknown, max = MAX_TEXT): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function nullableText(value: unknown, max = MAX_TEXT): string | null {
  return text(value, max) ?? null;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .flatMap((id) => (typeof id === "string" ? [id.slice(0, MAX_LABEL)] : []))
        .slice(0, MAX_IDS)
    : [];
}

/** A `vscode.Command`-shaped value with JSON arguments, or undefined. */
export function planCommandOf(value: unknown): omnigent.Command | undefined {
  if (!isRecord(value) || typeof value.command !== "string" || !COMMAND_ID.test(value.command)) {
    return undefined;
  }
  let args: unknown[] = [];
  if (Array.isArray(value.arguments)) {
    try {
      const json = JSON.stringify(value.arguments.slice(0, MAX_ARGS));
      if (json.length > MAX_ARGS_JSON) return undefined;
      args = JSON.parse(json) as unknown[];
    } catch {
      return undefined;
    }
  }
  Object.freeze(args);
  return Object.freeze({ command: value.command, arguments: args });
}

function statusOf(value: unknown): omnigent.TaskStatus | null {
  if (!isRecord(value)) return null;
  const status = value.status as omnigent.TaskStatus["status"];
  const createdAt = finite(value.createdAt);
  if (!STATUSES.has(status) || createdAt === undefined) return null;
  return Object.freeze({
    id: text(value.id, MAX_LABEL) ?? "",
    status,
    text: nullableText(value.text),
    createdAt,
    restart: value.restart === true,
  });
}

function taskOf(value: unknown): omnigent.SessionTask | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id, MAX_LABEL);
  const name = text(value.name, MAX_TEXT);
  const state = value.state as omnigent.TaskState;
  if (!id || name === undefined || !TASK_STATES.has(state)) return undefined;
  const history = Array.isArray(value.history)
    ? value.history.slice(0, MAX_HISTORY).flatMap((entry) => {
        const status = statusOf(entry);
        return status ? [status] : [];
      })
    : [];
  return Object.freeze({
    id,
    name,
    goal: nullableText(value.goal),
    dependsOn: Object.freeze(ids(value.dependsOn)),
    state,
    status: statusOf(value.status),
    startedAt: finite(value.startedAt) ?? null,
    native: value.native === true,
    activeForm: nullableText(value.activeForm),
    history: Object.freeze(history),
    chatMarker: text(value.chatMarker, MAX_LABEL) || undefined,
    question: text(value.question, MAX_LABEL) || undefined,
    blockedBy: Object.freeze(ids(value.blockedBy)),
  });
}

function planTaskOf(value: unknown): omnigent.PlanViewTask | undefined {
  if (!isRecord(value)) return undefined;
  const task = taskOf(value.task);
  if (!task) return undefined;
  const actionRecord = isRecord(value.action) ? value.action : undefined;
  const actionCommand = planCommandOf(actionRecord?.command);
  const action =
    actionRecord &&
    ACTIONS.has(actionRecord.action as omnigent.PlanTaskAction["action"]) &&
    actionCommand
      ? Object.freeze({
          action: actionRecord.action as omnigent.PlanTaskAction["action"],
          command: actionCommand,
        })
      : undefined;
  const command = planCommandOf(value.command);
  return Object.freeze({
    task,
    ...(action ? { action } : {}),
    ...(command ? { command } : {}),
  });
}

function menuItemOf(value: unknown): omnigent.PlanMenuItem | undefined {
  if (!isRecord(value)) return undefined;
  const title = text(value.title, MAX_LABEL);
  const command = planCommandOf(value.command);
  if (!title || !command) return undefined;
  const disabledReason = text(value.disabledReason, MAX_LABEL);
  return Object.freeze({
    title,
    ...(isRailViewIconName(value.icon) ? { icon: value.icon } : {}),
    command,
    ...(disabledReason ? { disabledReason } : {}),
  });
}

const EMPTY: omnigent.PlanViewContent = Object.freeze({ kind: "loading", label: "Loading" });

/** The content as the host draws it; malformed content is a loading state. */
export function planContentOf(value: unknown): omnigent.PlanViewContent {
  if (!isRecord(value)) return EMPTY;
  switch (value.kind) {
    case "loading":
      return Object.freeze({ kind: "loading", label: text(value.label, MAX_LABEL) ?? "Loading" });
    case "error": {
      const retry = planCommandOf(value.retry);
      const sessionId = text(value.sessionId, MAX_LABEL);
      return Object.freeze({
        kind: "error",
        ...(sessionId ? { sessionId } : {}),
        message: text(value.message) ?? "",
        ...(retry ? { retry } : {}),
      });
    }
    case "empty": {
      const sessionId = text(value.sessionId, MAX_LABEL);
      return Object.freeze({
        kind: "empty",
        ...(sessionId ? { sessionId } : {}),
        title: text(value.title, MAX_LABEL) ?? "",
        message: text(value.message) ?? "",
        ...(isRailViewIconName(value.icon) ? { icon: value.icon } : {}),
      });
    }
    case "plan": {
      const sessionId = text(value.sessionId, MAX_LABEL);
      if (!sessionId) return EMPTY;
      const tasks = Array.isArray(value.tasks)
        ? value.tasks.slice(0, MAX_TASKS).flatMap((entry) => {
            const task = planTaskOf(entry);
            return task ? [task] : [];
          })
        : [];
      const workflow = isRecord(value.workflow) ? value.workflow : undefined;
      const workflowId = text(workflow?.id, MAX_LABEL);
      const control = isRecord(value.runControl) ? value.runControl : undefined;
      const controlCommand = planCommandOf(control?.command);
      const runControl =
        control?.kind === "stopping"
          ? Object.freeze({ kind: "stopping" as const })
          : (control?.kind === "stop" || control?.kind === "play") && controlCommand
            ? Object.freeze({ kind: control.kind, command: controlCommand })
            : undefined;
      const counts = Array.isArray(value.counts)
        ? value.counts.flatMap((entry) =>
            isRecord(entry) &&
            TASK_STATES.has(entry.state as omnigent.TaskState) &&
            finite(entry.count) !== undefined
              ? [
                  Object.freeze({
                    state: entry.state as omnigent.TaskState,
                    count: entry.count as number,
                  }),
                ]
              : [],
          )
        : [];
      const menu = Array.isArray(value.menu)
        ? value.menu.slice(0, 16).flatMap((entry) => {
            const item = menuItemOf(entry);
            return item ? [item] : [];
          })
        : [];
      const title = text(value.title, MAX_LABEL);
      const paused = text(value.paused, MAX_LABEL);
      const updatedAt = finite(value.updatedAt);
      const runsOfWorkflow = text(value.runsOfWorkflow, MAX_LABEL);
      return Object.freeze({
        kind: "plan",
        sessionId,
        ...(title ? { title } : {}),
        ...(workflowId
          ? {
              workflow: Object.freeze({
                id: workflowId,
                tooltip: text(workflow?.tooltip, MAX_LABEL) ?? "",
                linked: workflow?.linked === true,
              }),
            }
          : {}),
        ...(updatedAt === undefined ? {} : { updatedAt }),
        summary: text(value.summary, MAX_LABEL) ?? "",
        counts: Object.freeze(counts),
        ...(paused ? { paused } : {}),
        ...(runControl ? { runControl } : {}),
        graph: value.graph === true,
        menu: Object.freeze(menu),
        tasks: Object.freeze(tasks),
        dependencies: value.dependencies === true,
        ...(runsOfWorkflow ? { runsOfWorkflow } : {}),
      });
    }
    default:
      return EMPTY;
  }
}
