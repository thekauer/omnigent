// Checks a plan view's content (`window.createPlanView`) into the plain, capped,
// frozen data the host draws. Anything malformed is dropped, never thrown.
//
// Caps: a task's goal keeps 200,000 characters (all goals together 4,000,000), cut
// at a Markdown block boundary with a "(truncated)" line; a task name keeps 2,000;
// a plan draws its first 1,000 tasks. Rows are not virtualized and each update
// redraws them all: in jsdom a row costs about 0.9 ms to mount and 0.5 ms to
// update (5,000 rows: 4.4 s and 2.7 s), so the cap stays at 1,000.
import type * as omnigent from "omnigent";
import { isRailViewIconName } from "@/shell/railViewIcons";

const MAX_TEXT = 10_000;
/** A task's goal: a whole plan step in Markdown, mermaid blocks included. */
export const MAX_GOAL = 200_000;
/** All the goals of one plan together; later goals are cut to what is left. */
export const MAX_GOALS_TOTAL = 4_000_000;
export const MAX_NAME = 2_000;
const MAX_LABEL = 500;
/** Tasks a plan draws; the rest are dropped. */
export const MAX_TASKS = 1_000;
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

/** The line that ends cut text. */
export const TRUNCATED_MARKER = "(truncated)";

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * `markdown` in at most `max` characters, cut at a block boundary (a blank line
 * outside a fenced block) and ended with a "(truncated)" paragraph, so no code or
 * mermaid block is left open. Text that fits is returned as is.
 */
export function truncateMarkdown(markdown: string, max: number): string {
  if (markdown.length <= max) return markdown;
  const marker = `\n\n${TRUNCATED_MARKER}`;
  const budget = Math.max(0, max - marker.length);
  let fence: string | undefined;
  /** The end of the last block that closed within the budget. */
  let boundary = 0;
  /** The end of the last line outside a fence, a fallback without blank lines. */
  let lineEnd = 0;
  let position = 0;
  while (position <= budget) {
    const newline = markdown.indexOf("\n", position);
    const end = newline === -1 ? markdown.length : newline;
    if (end > budget) break;
    const line = markdown.slice(position, end);
    const opener = FENCE.exec(line)?.[1];
    if (fence === undefined) {
      if (opener !== undefined) fence = opener;
      else if (line.trim() === "" && position > 0) boundary = position;
      if (fence === undefined) lineEnd = end;
    } else if (
      opener !== undefined &&
      opener[0] === fence[0] &&
      opener.length >= fence.length &&
      line.trim() === opener
    ) {
      // A closing fence ends its block too.
      fence = undefined;
      boundary = end;
      lineEnd = end;
    }
    if (newline === -1) break;
    position = newline + 1;
  }
  let cut = boundary > 0 ? boundary : lineEnd;
  // One long first line outside a fence: cut it at a word.
  if (cut === 0 && fence === undefined && !FENCE.test(markdown)) {
    const space = markdown.lastIndexOf(" ", budget);
    cut = space > budget / 2 ? space : budget;
  }
  const head = markdown.slice(0, cut).trimEnd();
  return head === "" ? TRUNCATED_MARKER : `${head}${marker}`;
}

/** Plain `value` in at most `max` characters, cut at a word with "… (truncated)". */
function plainText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length <= max) return value;
  const suffix = `… ${TRUNCATED_MARKER}`;
  const head = value.slice(0, Math.max(0, max - suffix.length));
  const space = head.lastIndexOf(" ");
  return `${(space > head.length / 2 ? head.slice(0, space) : head).trimEnd()}${suffix}`;
}

/** How many goal characters a plan has left to give. */
interface GoalBudget {
  left: number;
}

function goalOf(value: unknown, budget: GoalBudget): string | null {
  if (typeof value !== "string") return null;
  const goal = truncateMarkdown(value, Math.min(MAX_GOAL, Math.max(budget.left, 0)));
  budget.left -= goal.length;
  return goal;
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
    text: typeof value.text === "string" ? truncateMarkdown(value.text, MAX_TEXT) : null,
    createdAt,
    restart: value.restart === true,
  });
}

function taskOf(value: unknown, budget: GoalBudget): omnigent.SessionTask | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id, MAX_LABEL);
  const name = plainText(value.name, MAX_NAME);
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
    goal: goalOf(value.goal, budget),
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

function planTaskOf(value: unknown, budget: GoalBudget): omnigent.PlanViewTask | undefined {
  if (!isRecord(value)) return undefined;
  const task = taskOf(value.task, budget);
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

/**
 * The content as the host draws it; malformed content is a loading state. Content
 * that throws while it is read (a Proxy, a throwing getter) is a loading state too,
 * reported to `onError`.
 */
export function planContentOf(
  value: unknown,
  onError?: (message: string, error: unknown) => void,
): omnigent.PlanViewContent {
  try {
    return readPlanContent(value);
  } catch (error) {
    try {
      onError?.("plan view content could not be read; showing it as loading", error);
    } catch {
      // A reporter that throws changes nothing.
    }
    return EMPTY;
  }
}

function readPlanContent(value: unknown): omnigent.PlanViewContent {
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
      const budget: GoalBudget = { left: MAX_GOALS_TOTAL };
      const tasks = Array.isArray(value.tasks)
        ? value.tasks.slice(0, MAX_TASKS).flatMap((entry) => {
            const task = planTaskOf(entry, budget);
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
      // One count per known state, the first given; so at most one per state.
      const counted = new Set<omnigent.TaskState>();
      const counts = Array.isArray(value.counts)
        ? value.counts.slice(0, MAX_IDS).flatMap((entry) => {
            if (!isRecord(entry)) return [];
            const state = entry.state as omnigent.TaskState;
            const count = finite(entry.count);
            if (!TASK_STATES.has(state) || counted.has(state) || count === undefined) return [];
            counted.add(state);
            return [Object.freeze({ state, count })];
          })
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
