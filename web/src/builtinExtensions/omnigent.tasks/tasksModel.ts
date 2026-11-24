// What the Tasks tab shows for a session's tasks, as plain plan-view content: the
// words of its summary and empty state, which controls and menu entries apply,
// and the command each runs. Pure, so it is tested without the host.
import type * as Omnigent from "omnigent";

export const SHOW_IN_CHAT = "omnigent.showInChat";
export const RUN_TASK_ACTION = "omnigent.tasks.runTaskAction";
export const STOP = "omnigent.tasks.stop";
export const CONTINUE_PLAN = "omnigent.tasks.continuePlan";
export const SAVE_AS_WORKFLOW = "omnigent.tasks.saveAsWorkflow";
export const RELOAD = "omnigent.tasks.reload";

const LOADING: Omnigent.PlanViewContent = { kind: "loading", label: "Loading tasks" };

// What a task's ⋯ menu offers: Run while it's ready, Continue once it's stopped or
// while it waits for you, Retry once it failed, Stop while it runs.
const TASK_ACTION_FOR_STATE: Partial<
  Record<Omnigent.TaskState, "run" | "continue" | "proceed" | "retry">
> = {
  ready: "run",
  stopped: "continue",
  needs_input: "proceed",
  failed: "retry",
};

// The counts after the summary, in this order, when there are any.
const COUNTED: readonly Omnigent.TaskState[] = ["needs_input", "running", "failed"];

const command = (id: string, ...args: unknown[]): Omnigent.Command => ({
  command: id,
  arguments: args,
});

/** "2 of 5 finished", "All 5 tasks finished" or "All 5 tasks done"; failed tasks are finished too. */
export function summaryOf(tasks: readonly Omnigent.SessionTask[]): string {
  const done = tasks.filter((task) => task.state === "done").length;
  const finished = tasks.filter((task) => task.state === "done" || task.state === "failed").length;
  if (done === tasks.length) return `All ${tasks.length} tasks done`;
  if (finished === tasks.length) return `All ${tasks.length} tasks finished`;
  return `${finished} of ${tasks.length} finished`;
}

/**
 * A task's menu action for its state, when the viewer can take it. The agent
 * cannot read a message while it waits on a task's question, so that task's
 * Continue shows the question in the chat instead.
 *
 * @param canStop - Whether a Stop applies: the session works and is not stopping.
 */
export function taskActionOf(
  tasks: Omnigent.SessionTasks,
  task: Omnigent.SessionTask,
  canStop: boolean,
): Omnigent.PlanTaskAction | undefined {
  const sessionId = tasks.sessionId;
  if (task.state === "running") {
    return canStop ? { action: "stop", command: command(STOP, sessionId) } : undefined;
  }
  const action = TASK_ACTION_FOR_STATE[task.state];
  if (action === undefined || !tasks.actions.taskAction) return undefined;
  if (action === "proceed" && task.question !== undefined) {
    return { action, command: command(SHOW_IN_CHAT, sessionId, task.question) };
  }
  return { action, command: command(RUN_TASK_ACTION, sessionId, action, task.name) };
}

/** The Tasks tab's content for `tasks`, the session on screen's. */
export function planContent(tasks: Omnigent.SessionTasks | undefined): Omnigent.PlanViewContent {
  if (!tasks || tasks.loading) return LOADING;
  const { sessionId, plan } = tasks;
  if (tasks.error !== undefined) {
    return { kind: "error", sessionId, message: tasks.error, retry: command(RELOAD, sessionId) };
  }
  if (tasks.tasks.length === 0) {
    return {
      kind: "empty",
      sessionId,
      icon: "list-checks",
      title: "No tasks yet",
      message: `Tasks show up here when the agent makes a to-do list${
        tasks.actions.startWorkflow ? " or you [run a workflow](picker:workflow)" : ""
      }.`,
    };
  }
  const complete = plan?.complete ?? false;
  // A run that is already stopping offers no Stop, so its stop message isn't sent twice.
  const canStop = tasks.working && !tasks.stopping && tasks.actions.stopWork;
  let runControl: Extract<Omnigent.PlanViewContent, { kind: "plan" }>["runControl"];
  if (!complete && tasks.stopping && tasks.actions.stopWork) runControl = { kind: "stopping" };
  else if (!complete && canStop) runControl = { kind: "stop", command: command(STOP, sessionId) };
  else if (tasks.actions.continuePlan && tasks.paused !== undefined) {
    runControl = { kind: "play", command: command(CONTINUE_PLAN, sessionId, plan?.name ?? null) };
  }
  const updatedAt = Math.max(
    plan?.createdAt ?? 0,
    ...tasks.tasks.map((task) => task.status?.createdAt ?? 0),
  );
  const workflowId = plan?.workflowId ?? null;
  return {
    kind: "plan",
    sessionId,
    ...(plan?.name ? { title: plan.name } : {}),
    ...(workflowId === null
      ? {}
      : {
          workflow: {
            id: workflowId,
            tooltip: plan?.workflowName
              ? `Saved workflow “${plan.workflowName}”`
              : "From a saved workflow",
            linked: tasks.workflowsLinked,
          },
        }),
    ...(updatedAt > 0 ? { updatedAt } : {}),
    summary: summaryOf(tasks.tasks),
    counts: COUNTED.flatMap((state) => {
      const count = tasks.tasks.filter((task) => task.state === state).length;
      return count > 0 ? [{ state, count }] : [];
    }),
    ...(tasks.paused === undefined ? {} : { paused: tasks.paused }),
    ...(runControl ? { runControl } : {}),
    graph: plan !== undefined,
    menu:
      tasks.actions.saveWorkflow && plan
        ? [
            {
              title: "Save as workflow…",
              icon: "workflow",
              command: command(SAVE_AS_WORKFLOW, sessionId, plan.name ?? ""),
              ...(workflowId === null
                ? {}
                : { disabledReason: "Already saved as a workflow. Open the workflow to edit it." }),
            },
          ]
        : [],
    tasks: tasks.tasks.map((task) => {
      const action = taskActionOf(tasks, task, canStop);
      return {
        task,
        ...(action ? { action } : {}),
        ...(task.chatMarker === undefined
          ? {}
          : { command: command(SHOW_IN_CHAT, sessionId, task.chatMarker) }),
      };
    }),
    dependencies: plan !== undefined,
    ...(workflowId === null ? {} : { runsOfWorkflow: workflowId }),
  };
}
