// @vitest-environment node
// The Tasks tab's content as pure data: what each state of a session's tasks shows,
// which controls apply and which command each runs.
import type * as Omnigent from "omnigent";
import { describe, expect, it } from "vitest";
import {
  CONTINUE_PLAN,
  planContent,
  RELOAD,
  RUN_TASK_ACTION,
  SAVE_AS_WORKFLOW,
  SHOW_IN_CHAT,
  STOP,
  summaryOf,
  taskActionOf,
} from "./tasksModel";

const NO_ACTIONS: Omnigent.SessionTaskActions = {
  startWorkflow: false,
  saveWorkflow: false,
  continuePlan: false,
  stopWork: false,
  taskAction: false,
};
const ALL_ACTIONS: Omnigent.SessionTaskActions = {
  startWorkflow: true,
  saveWorkflow: true,
  continuePlan: true,
  stopWork: true,
  taskAction: true,
};

function task(id: string, state: Omnigent.TaskState, extra: Partial<Omnigent.SessionTask> = {}) {
  return {
    id,
    name: `Task ${id}`,
    goal: null,
    dependsOn: [],
    state,
    status: null,
    startedAt: null,
    native: false,
    activeForm: null,
    history: [],
    chatMarker: undefined,
    question: undefined,
    blockedBy: [],
    ...extra,
  } satisfies Omnigent.SessionTask;
}

function tasksOf(extra: Partial<Omnigent.SessionTasks> = {}): Omnigent.SessionTasks {
  return {
    sessionId: "conv",
    loading: false,
    error: undefined,
    plan: undefined,
    tasks: [],
    paused: undefined,
    working: false,
    stopping: false,
    actions: NO_ACTIONS,
    workflowsLinked: false,
    ...extra,
  };
}

const plan = (extra: Partial<Omnigent.SessionPlan> = {}): Omnigent.SessionPlan => ({
  name: "Ship it",
  createdAt: 100,
  workflowId: null,
  workflowName: undefined,
  complete: false,
  ...extra,
});

const asPlan = (content: Omnigent.PlanViewContent) => {
  if (content.kind !== "plan") throw new Error(`expected a plan, got ${content.kind}`);
  return content;
};

describe("planContent", () => {
  it("loads without tasks, and while they load", () => {
    expect(planContent(undefined)).toEqual({ kind: "loading", label: "Loading tasks" });
    expect(planContent(tasksOf({ loading: true }))).toEqual({
      kind: "loading",
      label: "Loading tasks",
    });
  });

  it("shows a failure with a Retry that reloads the journal", () => {
    expect(planContent(tasksOf({ error: "502 Bad Gateway" }))).toEqual({
      kind: "error",
      sessionId: "conv",
      message: "502 Bad Gateway",
      retry: { command: RELOAD, arguments: ["conv"] },
    });
  });

  it("says where tasks come from, linking Run a workflow when the composer offers it", () => {
    expect(planContent(tasksOf())).toMatchObject({
      kind: "empty",
      title: "No tasks yet",
      icon: "list-checks",
      message: "Tasks show up here when the agent makes a to-do list.",
    });
    expect(planContent(tasksOf({ actions: { ...NO_ACTIONS, startWorkflow: true } }))).toMatchObject(
      {
        message:
          "Tasks show up here when the agent makes a to-do list or you [run a workflow](picker:workflow).",
      },
    );
  });

  it("heads a plan with its name, its workflow and when it last changed", () => {
    const content = asPlan(
      planContent(
        tasksOf({
          plan: plan({ workflowId: "wf", workflowName: "Triage" }),
          workflowsLinked: true,
          tasks: [
            task("a", "done", {
              status: { id: "s1", status: "done", text: null, createdAt: 250, restart: false },
            }),
          ],
        }),
      ),
    );
    expect(content).toMatchObject({
      title: "Ship it",
      workflow: { id: "wf", tooltip: "Saved workflow “Triage”", linked: true },
      updatedAt: 250,
      graph: true,
      dependencies: true,
      runsOfWorkflow: "wf",
    });
    const unnamed = asPlan(
      planContent(tasksOf({ plan: plan({ workflowId: "wf" }), tasks: [task("a", "ready")] })),
    );
    expect(unnamed.workflow).toEqual({ id: "wf", tooltip: "From a saved workflow", linked: false });
  });

  it("leaves the graph, the dependencies and the runs out of the agent's own list", () => {
    const content = asPlan(
      planContent(tasksOf({ tasks: [task("a", "waiting", { native: true })] })),
    );
    expect(content.title).toBeUndefined();
    expect(content.graph).toBe(false);
    expect(content.dependencies).toBe(false);
    expect(content.runsOfWorkflow).toBeUndefined();
    expect(content.updatedAt).toBeUndefined();
  });

  it("counts tasks waiting for you, running and failed, in that order", () => {
    const content = asPlan(
      planContent(
        tasksOf({
          tasks: [
            task("a", "failed"),
            task("b", "running"),
            task("c", "needs_input"),
            task("d", "running"),
          ],
        }),
      ),
    );
    expect(content.counts).toEqual([
      { state: "needs_input", count: 1 },
      { state: "running", count: 2 },
      { state: "failed", count: 1 },
    ]);
  });

  it("offers Stop while the session works, Stopping… after it, and Continue once paused", () => {
    const working = tasksOf({
      plan: plan(),
      tasks: [task("a", "running")],
      working: true,
      actions: ALL_ACTIONS,
    });
    expect(asPlan(planContent(working)).runControl).toEqual({
      kind: "stop",
      command: { command: STOP, arguments: ["conv"] },
    });
    expect(asPlan(planContent({ ...working, stopping: true })).runControl).toEqual({
      kind: "stopping",
    });
    const paused = tasksOf({
      plan: plan(),
      tasks: [task("a", "ready")],
      paused: "Stopped",
      actions: ALL_ACTIONS,
    });
    expect(asPlan(planContent(paused))).toMatchObject({
      paused: "Stopped",
      runControl: {
        kind: "play",
        command: { command: CONTINUE_PLAN, arguments: ["conv", "Ship it"] },
      },
    });
    // A complete plan has nothing to stop; without the composer's actions, nothing applies.
    expect(asPlan(planContent({ ...working, plan: plan({ complete: true }) })).runControl).toBe(
      undefined,
    );
    expect(asPlan(planContent({ ...working, actions: NO_ACTIONS })).runControl).toBeUndefined();
  });

  it("offers Save as workflow, disabled once the plan is a workflow", () => {
    const save = tasksOf({ plan: plan(), tasks: [task("a", "ready")], actions: ALL_ACTIONS });
    expect(asPlan(planContent(save)).menu).toEqual([
      {
        title: "Save as workflow…",
        icon: "workflow",
        command: { command: SAVE_AS_WORKFLOW, arguments: ["conv", "Ship it"] },
      },
    ]);
    expect(
      asPlan(planContent({ ...save, plan: plan({ workflowId: "wf" }) })).menu?.[0]?.disabledReason,
    ).toBe("Already saved as a workflow. Open the workflow to edit it.");
    expect(asPlan(planContent({ ...save, actions: NO_ACTIONS })).menu).toEqual([]);
  });

  it("shows a task in the chat from its row once it has a marker", () => {
    const content = asPlan(
      planContent(
        tasksOf({ tasks: [task("a", "done", { chatMarker: "journal-s1" }), task("b", "waiting")] }),
      ),
    );
    expect(content.tasks.map((entry) => entry.command)).toEqual([
      { command: SHOW_IN_CHAT, arguments: ["conv", "journal-s1"] },
      undefined,
    ]);
  });
});

describe("taskActionOf", () => {
  const offered = tasksOf({ actions: ALL_ACTIONS });

  it.each([
    ["ready", "run"],
    ["stopped", "continue"],
    ["needs_input", "proceed"],
    ["failed", "retry"],
  ] as const)("offers a %s task %s", (state, action) => {
    expect(taskActionOf(offered, task("a", state), false)).toEqual({
      action,
      command: { command: RUN_TASK_ACTION, arguments: ["conv", action, "Task a"] },
    });
  });

  it("offers Stop on a running task only while a Stop applies", () => {
    expect(taskActionOf(offered, task("a", "running"), true)).toEqual({
      action: "stop",
      command: { command: STOP, arguments: ["conv"] },
    });
    expect(taskActionOf(offered, task("a", "running"), false)).toBeUndefined();
  });

  it("takes a waiting task's Continue to its question in the chat", () => {
    expect(
      taskActionOf(offered, task("a", "needs_input", { question: "elicit_1" }), false),
    ).toEqual({
      action: "proceed",
      command: { command: SHOW_IN_CHAT, arguments: ["conv", "elicit_1"] },
    });
  });

  it("offers nothing on done and waiting tasks, or when the composer cannot act", () => {
    expect(taskActionOf(offered, task("a", "done"), true)).toBeUndefined();
    expect(taskActionOf(offered, task("a", "waiting"), true)).toBeUndefined();
    expect(taskActionOf(tasksOf(), task("a", "ready"), true)).toBeUndefined();
  });
});

describe("summaryOf", () => {
  it("counts finished tasks, failed ones included", () => {
    expect(summaryOf([task("a", "done"), task("b", "ready")])).toBe("1 of 2 finished");
    expect(summaryOf([task("a", "done"), task("b", "failed")])).toBe("All 2 tasks finished");
    expect(summaryOf([task("a", "done"), task("b", "done")])).toBe("All 2 tasks done");
  });
});
