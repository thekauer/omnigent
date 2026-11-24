// The API pieces the Tasks view relies on: the tasks of the workspace on screen as
// plain data with change events, watching them, the task commands, and plan views.
import type * as omnigent from "omnigent";
import { describe, expect, it, vi } from "vitest";
import { RailViewRegistry } from "@/shell/railViews";
import {
  DEFAULT_WORKSPACE_FILE_SETTINGS,
  type WorkspaceBridgeState,
  WorkspaceBridge,
  type WorkspaceTasksActions,
} from "@/shell/workspaceBridge";
import { createExtensionApi } from "./api";
import { registerBuiltInCommands } from "./builtinCommands";
import { CommandRegistry } from "./commands";
import { ContextKeyService } from "./contextKeys";
import { parseContributions } from "./contributions";
import {
  MAX_GOAL,
  MAX_NAME,
  MAX_TASKS,
  planContentOf,
  TRUNCATED_MARKER,
  truncateMarkdown,
} from "./planContent";
import { TasksService } from "./tasksService";
import { hostServices, testViewsService } from "./testServices";

const microtasks = async () => {
  let turns = Promise.resolve();
  for (let turn = 0; turn < 5; turn += 1) turns = turns.then(() => undefined);
  await turns;
};

function tasksOf(sessionId: string, extra: Partial<omnigent.SessionTasks> = {}) {
  return {
    sessionId,
    loading: false,
    error: undefined,
    plan: undefined,
    tasks: [],
    paused: undefined,
    working: false,
    stopping: false,
    actions: {
      startWorkflow: false,
      saveWorkflow: false,
      continuePlan: false,
      stopWork: false,
      taskAction: false,
    },
    workflowsLinked: false,
    ...extra,
  } satisfies omnigent.SessionTasks;
}

const TASK: omnigent.SessionTask = {
  id: "build",
  name: "Build it",
  goal: "Run **make**",
  dependsOn: ["plan"],
  state: "running",
  status: { id: "s1", status: "started", text: "Compiling", createdAt: 10, restart: false },
  startedAt: 10,
  native: false,
  activeForm: null,
  history: [{ id: "s1", status: "started", text: "Compiling", createdAt: 10, restart: false }],
  chatMarker: "journal-s1",
  question: undefined,
  blockedBy: [],
};

function source(bridge: WorkspaceBridge, sessionId: string) {
  const entry = bridge.createSource();
  const state: WorkspaceBridgeState = {
    sessionId,
    changedFiles: [],
    availability: "available",
    servedFromHost: false,
    settings: DEFAULT_WORKSPACE_FILE_SETTINGS,
  };
  entry.update(state);
  const actions: { [Key in keyof WorkspaceTasksActions]: ReturnType<typeof vi.fn> } = {
    showInChat: vi.fn(),
    startWorkflow: vi.fn(),
    saveWorkflow: vi.fn(),
    continuePlan: vi.fn(),
    stopWork: vi.fn(),
    taskAction: vi.fn(),
    reload: vi.fn(),
    openWorkflow: vi.fn(),
  };
  entry.setTasksActions(actions as unknown as WorkspaceTasksActions);
  return { entry, actions };
}

function setup() {
  const bridge = new WorkspaceBridge();
  const tasks = new TasksService(bridge);
  const api = createExtensionApi("pub.tasks", hostServices({ tasks }), vi.fn());
  return { bridge, tasks, api: api.api, deactivate: api.dispose };
}

describe("sessions API: tasks", () => {
  it("hands out the tasks of the workspace on screen as frozen copies", () => {
    const { bridge, api } = setup();
    expect(api.sessions.activeSessionTasks).toBeUndefined();
    const { entry } = source(bridge, "conv");
    const published = tasksOf("conv", { tasks: [TASK] });
    entry.updateTasks(published);
    entry.setActive(true);
    const tasks = api.sessions.activeSessionTasks!;
    expect(tasks).toEqual(published);
    expect(tasks).not.toBe(published);
    expect(Object.isFrozen(tasks)).toBe(true);
    expect(Object.isFrozen(tasks.tasks[0].history[0])).toBe(true);
    // The same snapshot until something changes.
    expect(api.sessions.activeSessionTasks).toBe(tasks);
  });

  it("says when they change, once per burst, and follows the surface in front", async () => {
    const { bridge, api } = setup();
    const seen: (string | undefined)[] = [];
    api.sessions.onDidChangeActiveSessionTasks((tasks) =>
      seen.push(tasks ? `${tasks.sessionId}:${tasks.tasks.length}` : undefined),
    );
    const first = source(bridge, "conv");
    first.entry.setActive(true);
    first.entry.updateTasks(tasksOf("conv"));
    first.entry.updateTasks(tasksOf("conv", { tasks: [TASK] }));
    await microtasks();
    expect(seen).toEqual(["conv:1"]);
    // A grid cell activated later is in front; its tasks are the ones on screen.
    const cell = source(bridge, "cell");
    cell.entry.updateTasks(tasksOf("cell"));
    cell.entry.setActive(true);
    await microtasks();
    expect(seen.at(-1)).toBe("cell:0");
    cell.entry.dispose();
    await microtasks();
    expect(seen.at(-1)).toBe("conv:1");
    first.entry.dispose();
    await microtasks();
    expect(seen.at(-1)).toBeUndefined();
  });

  it("keeps the tasks loading while watched, until every watch or the extension is gone", () => {
    const { bridge, api, deactivate } = setup();
    const changes = vi.fn();
    bridge.subscribeTasksWatch(changes);
    expect(bridge.tasksWatched()).toBe(false);
    const first = api.sessions.watchActiveSessionTasks();
    const second = api.sessions.watchActiveSessionTasks();
    expect(bridge.tasksWatched()).toBe(true);
    first.dispose();
    first.dispose();
    expect(bridge.tasksWatched()).toBe(true);
    second.dispose();
    expect(bridge.tasksWatched()).toBe(false);
    api.sessions.watchActiveSessionTasks();
    expect(bridge.tasksWatched()).toBe(true);
    deactivate();
    expect(bridge.tasksWatched()).toBe(false);
    expect(changes).toHaveBeenCalledTimes(4);
    // A deactivated extension's watch is inert.
    api.sessions.watchActiveSessionTasks();
    expect(bridge.tasksWatched()).toBe(false);
  });
});

describe("task commands", () => {
  function commandsSetup() {
    const bridge = new WorkspaceBridge();
    const commands = new CommandRegistry();
    registerBuiltInCommands(commands, { contextKeys: new ContextKeyService(), workspace: bridge });
    const { entry, actions } = source(bridge, "conv");
    entry.setActive(true);
    const run = (command: string, ...args: unknown[]) => commands.execute(command, args, () => {});
    return { run, actions };
  }

  it("route each action to the workspace on screen", async () => {
    const { run, actions } = commandsSetup();
    await run("omnigent.showInChat", "conv", "journal-s1");
    expect(actions.showInChat).toHaveBeenCalledWith("journal-s1");
    await run("omnigent.tasks.runTaskAction", "conv", "retry", "Build it");
    expect(actions.taskAction).toHaveBeenCalledWith("retry", "Build it");
    await run("omnigent.tasks.stop", "conv");
    expect(actions.stopWork).toHaveBeenCalledOnce();
    await run("omnigent.tasks.continuePlan", "conv", null);
    expect(actions.continuePlan).toHaveBeenCalledWith(null);
    await run("omnigent.tasks.saveAsWorkflow", "conv", "Ship it");
    expect(actions.saveWorkflow).toHaveBeenCalledWith("Ship it");
    await run("omnigent.tasks.startWorkflow", "conv", { description: "", workflowId: "wf" });
    await run("omnigent.tasks.startWorkflow", "conv", { description: "Bump deps" });
    await run("omnigent.tasks.startWorkflow", "conv");
    expect(actions.startWorkflow.mock.calls).toEqual([
      [{ description: "", workflowId: "wf" }],
      [{ description: "Bump deps" }],
      [{}],
    ]);
    await run("omnigent.tasks.reload", "conv");
    expect(actions.reload).toHaveBeenCalledOnce();
    await run("omnigent.openWorkflow", "wf");
    expect(actions.openWorkflow).toHaveBeenCalledWith("wf");
  });

  it("refuse another session's tasks and malformed arguments", async () => {
    const { run, actions } = commandsSetup();
    await expect(run("omnigent.tasks.stop", "other")).rejects.toThrow(
      /not the workspace on screen/,
    );
    await expect(run("omnigent.showInChat", "conv", "")).rejects.toThrow(/marker id/);
    await expect(run("omnigent.tasks.runTaskAction", "conv", "delete", "x")).rejects.toThrow(
      /run, continue, proceed, retry/,
    );
    await expect(run("omnigent.tasks.runTaskAction", "conv", "run", 3)).rejects.toThrow(
      /task name/,
    );
    await expect(run("omnigent.tasks.stop")).rejects.toThrow(/session id/);
    await expect(run("omnigent.openWorkflow", "")).rejects.toThrow(/workflow id/);
    expect(Object.values(actions).every((action) => action.mock.calls.length === 0)).toBe(true);
  });

  it("reject without a workspace that offers tasks", async () => {
    const commands = new CommandRegistry();
    const bridge = new WorkspaceBridge();
    registerBuiltInCommands(commands, { contextKeys: new ContextKeyService(), workspace: bridge });
    await expect(commands.execute("omnigent.tasks.stop", ["conv"], () => {})).rejects.toThrow(
      /no workspace is open/,
    );
    const entry = bridge.createSource();
    entry.update({
      sessionId: "conv",
      changedFiles: [],
      availability: "available",
      servedFromHost: false,
      settings: DEFAULT_WORKSPACE_FILE_SETTINGS,
    });
    entry.setActive(true);
    await expect(commands.execute("omnigent.tasks.stop", ["conv"], () => {})).rejects.toThrow(
      /has no tasks/,
    );
  });
});

describe("plan views", () => {
  const PLAN_VIEW = { views: { "omnigent.rightPanel": [{ id: "pub.tasks.view", name: "Plan" }] } };

  function viewsSetup() {
    const registry = new RailViewRegistry();
    const commands = new CommandRegistry();
    const views = testViewsService(commands, { registry });
    const { contributions, warnings } = parseContributions("pub.tasks", PLAN_VIEW);
    expect(warnings).toEqual([]);
    views.addExtension("pub.tasks", contributions);
    views.extensionSettled("pub.tasks");
    const logError = vi.fn();
    const api = createExtensionApi("pub.tasks", hostServices({ commands, views }), logError);
    return { registry, commands, api: api.api, deactivate: api.dispose, logError };
  }

  it("keep each session's last content, so a pane not in front draws its own", () => {
    const { registry, api } = viewsSetup();
    const view = api.window.createPlanView("pub.tasks.view");
    const planFor = (sessionId: string) => ({
      kind: "plan" as const,
      sessionId,
      summary: sessionId,
      tasks: [],
      dependencies: false,
    });
    view.content = planFor("a");
    view.content = planFor("b");
    view.content = { kind: "loading", label: "Loading" };
    const drawn = registry.get("pub.tasks.view")!;
    expect(drawn.plan).toEqual({ kind: "loading", label: "Loading" });
    expect([...drawn.planBySession.keys()]).toEqual(["a", "b"]);
    expect(drawn.planBySession.get("a")).toMatchObject({ summary: "a" });
    // A session published again moves to the end, and only the latest 32 are kept.
    view.content = planFor("a");
    expect([...registry.get("pub.tasks.view")!.planBySession.keys()]).toEqual(["b", "a"]);
    for (let index = 0; index < 40; index++) view.content = planFor(`s${index}`);
    const kept = [...registry.get("pub.tasks.view")!.planBySession.keys()];
    expect(kept).toHaveLength(32);
    expect(kept.at(-1)).toBe("s39");
    view.dispose();
    expect(registry.get("pub.tasks.view")!.planBySession.size).toBe(0);
  });

  it("show content that throws while read as loading, and log it against the extension", () => {
    const { registry, api, logError } = viewsSetup();
    const view = api.window.createPlanView("pub.tasks.view");
    expect(() => {
      view.content = new Proxy({} as omnigent.PlanViewContent, {
        get() {
          throw new Error("trap");
        },
      });
    }).not.toThrow();
    expect(registry.get("pub.tasks.view")?.plan).toEqual({ kind: "loading", label: "Loading" });
    expect(logError).toHaveBeenCalledWith(
      expect.stringMatching(/plan view content/),
      expect.any(Error),
    );
  });

  it("give the host checked plain content, and only for the extension's own views", () => {
    const { registry, api } = viewsSetup();
    expect(() => api.window.createPlanView("pub.other.view")).toThrow(/no view/);
    const view = api.window.createPlanView("pub.tasks.view");
    expect(registry.get("pub.tasks.view")?.plan).toEqual({ kind: "loading", label: "Loading" });
    view.content = {
      kind: "plan",
      sessionId: "conv",
      summary: "0 of 1 finished",
      tasks: [
        {
          task: TASK,
          action: {
            action: "stop",
            command: { command: "omnigent.tasks.stop", arguments: ["conv"] },
          },
          command: { command: "omnigent.showInChat", arguments: ["conv", "journal-s1"] },
        },
      ],
      dependencies: true,
      graph: true,
    };
    const drawn = registry.get("pub.tasks.view")!.plan!;
    expect(drawn.kind).toBe("plan");
    expect(Object.isFrozen(drawn)).toBe(true);
    if (drawn.kind !== "plan") return;
    expect(drawn.tasks[0].task).toEqual(TASK);
    expect(drawn.tasks[0].action?.command).toEqual({
      command: "omnigent.tasks.stop",
      arguments: ["conv"],
    });
    expect(() => api.window.createPlanView("pub.tasks.view")).toThrow(/already has/);
    expect(() =>
      api.window.createTreeView("pub.tasks.view", {
        treeDataProvider: { getChildren: () => [], getTreeItem: () => ({}) },
      }),
    ).toThrow(/already has/);
    view.dispose();
    expect(registry.get("pub.tasks.view")?.plan).toBeUndefined();
    // Once disposed, the view takes no more content.
    view.content = { kind: "empty", title: "x", message: "" };
    expect(registry.get("pub.tasks.view")?.plan).toBeUndefined();
  });

  it("say when they come on screen and go", () => {
    const { registry, api } = viewsSetup();
    const view = api.window.createPlanView("pub.tasks.view");
    const seen: boolean[] = [];
    view.onDidChangeVisibility(({ visible }) => seen.push(visible));
    expect(view.visible).toBe(false);
    const host = registry.get("pub.tasks.view")!.host!;
    const first = host.reportVisible();
    const second = host.reportVisible();
    expect(view.visible).toBe(true);
    first();
    second();
    expect(seen).toEqual([true, false]);
    expect(view.visible).toBe(false);
  });

  it("run the commands their content names, with its arguments", async () => {
    const { registry, commands, api } = viewsSetup();
    api.window.createPlanView("pub.tasks.view");
    const ran = vi.fn();
    commands.register("pub.tasks", "pub.tasks.do", ran);
    registry.get("pub.tasks.view")!.host!.runCommand("pub.tasks.do", ["conv", { a: 1 }]);
    await microtasks();
    expect(ran).toHaveBeenCalledWith("conv", { a: 1 });
  });

  it("are left for good when the extension deactivates", () => {
    const { registry, api, deactivate } = viewsSetup();
    api.window.createPlanView("pub.tasks.view").content = {
      kind: "empty",
      title: "Nothing",
      message: "",
    };
    deactivate();
    expect(registry.get("pub.tasks.view")?.plan).toBeUndefined();
  });
});

describe("planContentOf", () => {
  it("drops what it cannot draw", () => {
    expect(planContentOf(null)).toEqual({ kind: "loading", label: "Loading" });
    expect(planContentOf({ kind: "webview", html: "<script>" })).toEqual({
      kind: "loading",
      label: "Loading",
    });
    expect(planContentOf({ kind: "plan", summary: "no session" })).toEqual({
      kind: "loading",
      label: "Loading",
    });
    const content = planContentOf({
      kind: "plan",
      sessionId: "conv",
      summary: "1 of 2 finished",
      counts: [
        { state: "running", count: 1 },
        { state: "bogus", count: 1 },
      ],
      runControl: { kind: "stop", command: { command: "bad id!" } },
      menu: [
        {
          title: "Save",
          icon: "not-an-icon",
          command: { command: "omnigent.tasks.saveAsWorkflow" },
        },
        { title: "", command: { command: "x" } },
      ],
      tasks: [
        { task: { ...TASK, state: "exploded" } },
        {
          task: {
            ...TASK,
            id: "ok",
            history: [{ status: "bogus", createdAt: 1 }, TASK.history[0]],
          },
          action: { action: "delete", command: { command: "x" } },
          command: { command: "omnigent.showInChat", arguments: [() => 1] },
        },
      ],
    });
    expect(content).toMatchObject({
      kind: "plan",
      counts: [{ state: "running", count: 1 }],
      menu: [
        { title: "Save", command: { command: "omnigent.tasks.saveAsWorkflow", arguments: [] } },
      ],
      graph: false,
      dependencies: false,
    });
    if (content.kind !== "plan") return;
    expect(content.runControl).toBeUndefined();
    expect(content.menu?.[0]).not.toHaveProperty("icon");
    expect(content.tasks.map((entry) => entry.task.id)).toEqual(["ok"]);
    expect(content.tasks[0].task.history).toEqual([TASK.history[0]]);
    expect(content.tasks[0]).not.toHaveProperty("action");
    // A function is not JSON: it becomes null, as a command argument would.
    expect(content.tasks[0].command).toEqual({ command: "omnigent.showInChat", arguments: [null] });
  });
});

describe("plan content caps", () => {
  const plan = (tasks: unknown[], extra: Record<string, unknown> = {}) =>
    planContentOf({ kind: "plan", sessionId: "conv", summary: "", tasks, ...extra });
  const drawnTasks = (content: ReturnType<typeof planContentOf>) =>
    content.kind === "plan" ? content.tasks : [];

  it("keeps a 15k goal whole, mermaid blocks and all", () => {
    const mermaid = "```mermaid\ngraph TD\n  A --> B\n```";
    const goal = `${"Intro paragraph. ".repeat(900)}\n\n${mermaid}\n\nMore.\n\n${mermaid}`;
    expect(goal.length).toBeGreaterThan(15_000);
    expect(drawnTasks(plan([{ task: { ...TASK, goal } }]))[0].task.goal).toBe(goal);
  });

  it("cuts a long goal at a block boundary, never inside a fence, with a marker", () => {
    const block = "```mermaid\ngraph TD\n" + "  A --> B\n".repeat(2000) + "```";
    const goal = `${"word ".repeat(30_000)}\n\n${block}\n\n${"tail ".repeat(30_000)}\n\n${block}`;
    expect(goal.length).toBeGreaterThan(MAX_GOAL);
    const cut = drawnTasks(plan([{ task: { ...TASK, goal } }]))[0].task.goal!;
    expect(cut.length).toBeLessThanOrEqual(MAX_GOAL);
    expect(cut.endsWith(`\n\n${TRUNCATED_MARKER}`)).toBe(true);
    const body = cut.slice(0, -TRUNCATED_MARKER.length);
    // Every fence it keeps is closed.
    expect((body.match(/^```/gm) ?? []).length % 2).toBe(0);
    expect(body).toContain(block);
  });

  it("closes no fence open at the cut and falls back to line and word cuts", () => {
    const open = "intro\n\n```mermaid\n" + "  A --> B\n".repeat(100);
    expect(truncateMarkdown(open, 200)).toBe(`intro\n\n${TRUNCATED_MARKER}`);
    expect(truncateMarkdown("line one\nline two\nline three", 24)).toBe(
      `line one\n\n${TRUNCATED_MARKER}`,
    );
    expect(truncateMarkdown("alpha beta gamma delta epsilon", 27)).toBe(
      `alpha beta\n\n${TRUNCATED_MARKER}`,
    );
    expect(truncateMarkdown("short", 100)).toBe("short");
  });

  it("caps task names and tasks", () => {
    const name = "name ".repeat(1000);
    const kept = drawnTasks(plan([{ task: { ...TASK, name } }]))[0].task.name;
    expect(kept.length).toBeLessThanOrEqual(MAX_NAME);
    expect(kept.endsWith(`… ${TRUNCATED_MARKER}`)).toBe(true);
    const many = Array.from({ length: MAX_TASKS + 10 }, (_, index) => ({
      task: { ...TASK, id: `t${index}` },
    }));
    expect(drawnTasks(plan(many))).toHaveLength(MAX_TASKS);
  });

  it("keeps one count per known state", () => {
    const content = plan([], {
      counts: [
        { state: "running", count: 1 },
        { state: "running", count: 9 },
        { state: "done", count: 2 },
        ...Array.from({ length: 10_000 }, () => ({ state: "done", count: 3 })),
      ],
    });
    expect(content.kind === "plan" && content.counts).toEqual([
      { state: "running", count: 1 },
      { state: "done", count: 2 },
    ]);
  });

  it("is a loading state, logged, when reading the content throws", () => {
    const onError = vi.fn();
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
      },
    );
    expect(planContentOf(hostile, onError)).toEqual({ kind: "loading", label: "Loading" });
    const getter = {
      kind: "plan",
      sessionId: "conv",
      get tasks(): never {
        throw new Error("getter");
      },
    };
    expect(planContentOf(getter, onError)).toEqual({ kind: "loading", label: "Loading" });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(() =>
      planContentOf(hostile, () => {
        throw new Error("reporter");
      }),
    ).not.toThrow();
  });
});
