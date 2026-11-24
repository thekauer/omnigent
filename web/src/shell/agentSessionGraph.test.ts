// The status a session row carries, its dot colors, and the graph layout: pure
// parts of the Agents tab. Ported from the classic SubagentsGraphView suite.
import { describe, expect, it } from "vitest";
import type { ChildSessionInfo } from "@/hooks/useChildSessions";
import type { RailTreeNode } from "./railViews";
import { toChildSession } from "./agentSessions";
import {
  computeSubtreeWidths,
  layoutTree,
  type TreeNode,
  treeFromRows,
} from "./subagentGraphLayout";
import { activityDotClassName, childStatus, sessionStatus } from "./subagentStatus";

function childInfo(overrides: Partial<ChildSessionInfo> & { id: string }): ChildSessionInfo {
  return {
    title: null,
    task_summary: null,
    tool: null,
    session_name: null,
    current_task_status: null,
    busy: false,
    last_message_preview: null,
    pending_elicitations_count: 0,
    ...overrides,
  };
}

const statusOf = (child: ChildSessionInfo) => toChildSession(child, undefined).status;

function leaf(id: string, overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id,
    label: id,
    activity: "idle",
    statusLabel: "Idle",
    preview: null,
    children: [],
    ...overrides,
  };
}

/** A loaded session row, as the host draws the Agents view's items. */
function row(id: string, overrides: Partial<RailTreeNode> = {}): RailTreeNode {
  return {
    handle: `id:session:${id}`,
    label: id,
    description: undefined,
    tooltip: undefined,
    resourcePath: undefined,
    icon: undefined,
    decoration: undefined,
    status: undefined,
    collapsible: "none",
    hasCommand: true,
    contextValue: undefined,
    size: undefined,
    highlights: undefined,
    line: undefined,
    accessibleLabel: undefined,
    sessionId: id,
    agentIcon: undefined,
    agentStatus: undefined,
    ...overrides,
  };
}

describe("a child session's status, as the API hands it out", () => {
  it("returns awaiting when pending_elicitations_count > 0, even if busy", () => {
    const result = statusOf(childInfo({ id: "x", busy: true, pending_elicitations_count: 2 }));
    expect(result).toMatchObject({ state: "awaiting", label: "Needs response" });
  });

  it("returns launching for launching status", () => {
    const result = statusOf(childInfo({ id: "x", current_task_status: "launching" }));
    expect(result).toMatchObject({ state: "launching", label: "Launching" });
  });

  it("returns working when busy", () => {
    const result = statusOf(childInfo({ id: "x", busy: true }));
    expect(result).toMatchObject({ state: "working", label: "Working" });
  });

  it("returns failed when last_task_error is set", () => {
    const result = statusOf(
      childInfo({ id: "x", last_task_error: { code: "err", message: "boom" } }),
    );
    expect(result).toMatchObject({ state: "failed", label: "Failed" });
  });

  it("returns failed for failed task status", () => {
    const result = statusOf(childInfo({ id: "x", current_task_status: "failed" }));
    expect(result).toMatchObject({ state: "failed", label: "Failed" });
  });

  it("returns done for completed task status", () => {
    const result = statusOf(childInfo({ id: "x", current_task_status: "completed" }));
    expect(result).toMatchObject({ state: "done", label: "Done" });
  });

  it("returns the raw status as label for unknown statuses", () => {
    const result = statusOf(childInfo({ id: "x", current_task_status: "cancelled" }));
    expect(result).toMatchObject({ state: "other", label: "cancelled" });
  });

  it("returns idle when no status signals are set", () => {
    const result = statusOf(childInfo({ id: "x" }));
    expect(result).toMatchObject({ state: "idle", label: "Idle" });
  });

  it("prioritizes awaiting over launching", () => {
    const result = statusOf(
      childInfo({ id: "x", current_task_status: "launching", pending_elicitations_count: 1 }),
    );
    expect(result.state).toBe("awaiting");
  });

  it("returns disconnected (not failed) for a runner-disconnect error code", () => {
    const result = statusOf(
      childInfo({
        id: "x",
        last_task_error: { code: "runner_disconnected", message: "tunnel dropped" },
      }),
    );
    expect(result.state).toBe("disconnected");
  });

  it("returns disconnected for runner_failed_to_start", () => {
    const result = statusOf(
      childInfo({
        id: "x",
        last_task_error: { code: "runner_failed_to_start", message: "exited" },
      }),
    );
    expect(result.state).toBe("disconnected");
  });
});

describe("activityDotClassName (shared list/graph palette)", () => {
  // The graph view previously kept its own map that painted these grey; the
  // shared helper is the single source of truth, so both views render blue.
  it.each(["launching", "idle", "done"] as const)(
    "renders %s as a blue session-active dot, not grey",
    (activity) => {
      const cls = activityDotClassName(activity);
      expect(cls).toContain("bg-session-active");
      expect(cls).not.toContain("muted-foreground");
    },
  );

  it("renders disconnected as a grey muted-foreground dot, not destructive red", () => {
    const cls = activityDotClassName("disconnected");
    expect(cls).toContain("bg-muted-foreground");
    expect(cls).not.toContain("destructive");
  });

  it("renders failed as a destructive dot", () => {
    expect(activityDotClassName("failed")).toContain("bg-destructive");
  });

  // The list and the graph both draw the status the API hands out, which is
  // ``childStatus``'s; both color the dot from the same ``activityDotClassName``.
  it("classifies list and graph identically for each status", () => {
    const cases: { child: ChildSessionInfo; expected: string }[] = [
      {
        child: childInfo({ id: "launching", current_task_status: "launching" }),
        expected: "bg-session-active/70",
      },
      { child: childInfo({ id: "idle" }), expected: "bg-session-active/55" },
      {
        child: childInfo({ id: "done", current_task_status: "completed" }),
        expected: "bg-session-active/55",
      },
      {
        child: childInfo({ id: "other", current_task_status: "cancelled" }),
        expected: "bg-muted-foreground/55",
      },
      {
        child: childInfo({ id: "failed", current_task_status: "failed" }),
        expected: "bg-destructive",
      },
      {
        child: childInfo({
          id: "disconnected",
          last_task_error: { code: "runner_disconnected", message: "gone" },
        }),
        expected: "bg-muted-foreground",
      },
    ];
    for (const { child, expected } of cases) {
      const list = childStatus(child).activity;
      const graph = statusOf(child).state;
      expect(graph).toBe(list);
      // Neither classification lands on working/awaiting for these cases.
      expect(activityDotClassName(graph as Exclude<typeof graph, "working" | "awaiting">)).toBe(
        expected,
      );
    }
  });
});

describe("sessionStatus", () => {
  it("maps launching status to launching", () => {
    expect(sessionStatus("launching").activity).toBe("launching");
  });

  it("maps running to working and idle to idle", () => {
    expect(sessionStatus("running").activity).toBe("working");
    expect(sessionStatus("idle").activity).toBe("idle");
  });

  it("maps a runner-disconnect failure to disconnected, not failed", () => {
    const result = sessionStatus("failed", {
      code: "runner_disconnected",
      message: "tunnel dropped",
    });
    expect(result.activity).toBe("disconnected");
    expect(activityDotClassName("disconnected")).toContain("bg-muted-foreground");
  });

  it("maps a genuine failure to failed", () => {
    expect(sessionStatus("failed", { code: "boom", message: "oops" }).activity).toBe("failed");
  });
});

describe("computeSubtreeWidths", () => {
  it("assigns NODE_WIDTH to a leaf", () => {
    const widths = computeSubtreeWidths(leaf("a"));
    expect(widths.get("a")).toBe(180);
  });

  it("computes width as sum of children + gaps for a parent", () => {
    const root: TreeNode = {
      ...leaf("root"),
      children: [leaf("c1"), leaf("c2"), leaf("c3")],
    };
    const widths = computeSubtreeWidths(root);
    // 3 * 180 + 2 * 40 = 620
    expect(widths.get("root")).toBe(620);
    expect(widths.get("c1")).toBe(180);
  });

  it("uses the larger of NODE_WIDTH and total children width", () => {
    const root: TreeNode = { ...leaf("root"), children: [leaf("c1")] };
    const widths = computeSubtreeWidths(root);
    expect(widths.get("root")).toBe(180);
  });

  it("handles nested trees", () => {
    const root: TreeNode = {
      ...leaf("root"),
      children: [{ ...leaf("a"), children: [leaf("a1"), leaf("a2")] }, leaf("b")],
    };
    const widths = computeSubtreeWidths(root);
    // a subtree: 2 * 180 + 40 = 400
    expect(widths.get("a")).toBe(400);
    // root: 400 + 180 + 40 = 620
    expect(widths.get("root")).toBe(620);
  });
});

describe("layoutTree", () => {
  it("places a single root node at the origin", () => {
    const { nodes, edges } = layoutTree(leaf("root"), "root");
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
    expect(nodes[0].id).toBe("root");
    expect(nodes[0].data.isActive).toBe(true);
  });

  it("creates edges from parent to each child", () => {
    const root: TreeNode = {
      ...leaf("root"),
      children: [leaf("c1"), leaf("c2")],
    };
    const { nodes, edges } = layoutTree(root, "none");
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({ source: "root", target: "c1" });
    expect(edges[1]).toMatchObject({ source: "root", target: "c2" });
  });

  it("marks active node correctly", () => {
    const root: TreeNode = {
      ...leaf("root"),
      children: [leaf("c1"), leaf("c2")],
    };
    const { nodes } = layoutTree(root, "c2");
    expect(nodes.find((n) => n.id === "root")!.data.isActive).toBe(false);
    expect(nodes.find((n) => n.id === "c1")!.data.isActive).toBe(false);
    expect(nodes.find((n) => n.id === "c2")!.data.isActive).toBe(true);
  });

  it("positions children below the parent", () => {
    const root: TreeNode = { ...leaf("root"), children: [leaf("c1")] };
    const { nodes } = layoutTree(root, "none");
    const rootNode = nodes.find((n) => n.id === "root")!;
    const childNode = nodes.find((n) => n.id === "c1")!;
    expect(childNode.position.y).toBeGreaterThan(rootNode.position.y);
  });

  it("spaces siblings horizontally", () => {
    const root: TreeNode = {
      ...leaf("root"),
      children: [leaf("c1"), leaf("c2"), leaf("c3")],
    };
    const { nodes } = layoutTree(root, "none");
    const xs = ["c1", "c2", "c3"].map((id) => nodes.find((n) => n.id === id)!.position.x);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
  });

  it("centers parent above its children", () => {
    const root: TreeNode = {
      ...leaf("root"),
      children: [leaf("c1"), leaf("c2")],
    };
    const { nodes } = layoutTree(root, "none");
    const rootX = nodes.find((n) => n.id === "root")!.position.x;
    const c1X = nodes.find((n) => n.id === "c1")!.position.x;
    const c2X = nodes.find((n) => n.id === "c2")!.position.x;
    const rootCenter = rootX + 180 / 2;
    const childrenCenter = (c1X + c2X) / 2 + 180 / 2;
    expect(Math.abs(rootCenter - childrenCenter)).toBeLessThan(1);
  });

  it("animates edges to working children", () => {
    const root: TreeNode = {
      ...leaf("root"),
      children: [leaf("c_work", { activity: "working" }), leaf("c_idle")],
    };
    const { edges } = layoutTree(root, "none");
    const workEdge = edges.find((e) => e.target === "c_work")!;
    const idleEdge = edges.find((e) => e.target === "c_idle")!;
    expect(workEdge.animated).toBe(true);
    expect(idleEdge.animated).toBe(false);
  });

  it("uses higher opacity on edges to working children", () => {
    const root: TreeNode = {
      ...leaf("root"),
      children: [leaf("c_work", { activity: "working" }), leaf("c_idle")],
    };
    const { edges } = layoutTree(root, "none");
    const workEdge = edges.find((e) => e.target === "c_work")!;
    const idleEdge = edges.find((e) => e.target === "c_idle")!;
    expect(workEdge.style.opacity).toBeGreaterThan(idleEdge.style.opacity as number);
  });

  it("lays out a 3-level tree without overlapping nodes", () => {
    const root: TreeNode = {
      ...leaf("root"),
      children: [
        { ...leaf("a"), children: [leaf("a1"), leaf("a2")] },
        { ...leaf("b"), children: [leaf("b1"), leaf("b2"), leaf("b3")] },
      ],
    };
    const { nodes } = layoutTree(root, "none");
    const byY = new Map<number, typeof nodes>();
    for (const n of nodes) {
      const y = n.position.y;
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push(n);
    }
    for (const [, levelNodes] of byY) {
      const sorted = levelNodes.sort((a, b) => a.position.x - b.position.x);
      for (let i = 1; i < sorted.length; i++) {
        const prevRight = sorted[i - 1].position.x + 180;
        const currLeft = sorted[i].position.x;
        expect(currLeft).toBeGreaterThanOrEqual(prevRight);
      }
    }
  });

  it("handles a wide flat tree (many siblings)", () => {
    const root: TreeNode = {
      ...leaf("root"),
      children: Array.from({ length: 10 }, (_, i) => leaf(`c${i}`)),
    };
    const { nodes, edges } = layoutTree(root, "none");
    expect(nodes).toHaveLength(11);
    expect(edges).toHaveLength(10);
    // All children at the same y level
    const childYs = nodes.filter((n) => n.id !== "root").map((n) => n.position.y);
    expect(new Set(childYs).size).toBe(1);
  });
});

describe("treeFromRows", () => {
  it("creates a leaf root when no rows are below it", () => {
    const rows = new Map([["", [row("root", { label: "main" })]]]);
    expect(treeFromRows(rows, 3)).toMatchObject({
      id: "root",
      label: "main",
      activity: "idle",
      statusLabel: "Idle",
      preview: null,
      children: [],
    });
    expect(treeFromRows(new Map(), 3)).toBeNull();
  });

  it("builds the nested tree from the loaded rows, each status from its row", () => {
    const working = { state: "working" as const, label: "Working", detail: undefined };
    const done = { state: "done" as const, label: "Done", detail: undefined };
    const rows = new Map<string, readonly RailTreeNode[]>([
      ["", [row("root", { label: "main", collapsible: "expanded", hasCommand: false })]],
      [
        "id:session:root",
        [
          row("c1", { label: "auth", agentStatus: working, collapsible: "expanded" }),
          row("c2", { label: "docs", agentStatus: done }),
        ],
      ],
      ["id:session:c1", [row("c1a", { label: "search" })]],
    ]);
    const tree = treeFromRows(rows, 3)!;
    expect(tree.children.map((node) => [node.id, node.label, node.activity])).toEqual([
      ["c1", "auth", "working"],
      ["c2", "docs", "done"],
    ]);
    expect(tree.children[0].children.map((node) => node.id)).toEqual(["c1a"]);
    expect(tree.children[1].children).toHaveLength(0);
  });

  it("stops at the depth it is given", () => {
    const rows = new Map<string, readonly RailTreeNode[]>([
      ["", [row("root")]],
      ["id:session:root", [row("c1")]],
      ["id:session:c1", [row("c2")]],
      ["id:session:c2", [row("c3")]],
      ["id:session:c3", [row("c4")]],
    ]);
    const tree = treeFromRows(rows, 3)!;
    expect(tree.children[0].children[0].children[0].id).toBe("c3");
    expect(tree.children[0].children[0].children[0].children).toHaveLength(0);
  });

  it("passes each child's preview through, but keeps the root's card to its name", () => {
    const rows = new Map<string, readonly RailTreeNode[]>([
      ["", [row("root", { description: "root preview" })]],
      ["id:session:root", [row("c1", { description: "Searching for auth..." })]],
    ]);
    const tree = treeFromRows(rows, 3)!;
    expect(tree.preview).toBeNull();
    expect(tree.children[0].preview).toBe("Searching for auth...");
  });
});

describe("a child session's label, shared by the list and the graph", () => {
  it("uses the task, then session_name, then title, then tool, then id", () => {
    expect(
      [
        childInfo({ id: "c0", task_summary: "Investigate", session_name: "named" }),
        childInfo({ id: "c1", session_name: "named" }),
        childInfo({ id: "c2", title: "titled" }),
        childInfo({ id: "c3", tool: "tooled" }),
        childInfo({ id: "c4" }),
      ].map((child) => toChildSession(child, undefined).label),
    ).toEqual(["Investigate", "named", "titled", "tooled", "c4"]);
  });

  it("prefers the server-resolved tool label over session_name for native sub-agent children", () => {
    expect(
      [
        childInfo({
          id: "c1",
          title: "rpw-published:debug-lead:a09d1dd1d8dbc0151",
          session_name: "a09d1dd1d8dbc0151",
          tool: "Investigate flaky auth test",
          labels: { "omnigent.wrapper": "claude-code-native-ui-subagent" },
        }),
        childInfo({
          id: "c2",
          title: "general-purpose:b7c2e9f4a1d3c5e60",
          session_name: "b7c2e9f4a1d3c5e60",
          labels: { "omnigent.wrapper": "claude-code-native-ui-subagent" },
        }),
        childInfo({
          id: "c3",
          title: "worker:thread-4",
          session_name: "thread-4",
          tool: "Summarize release notes",
          labels: { "omnigent.wrapper": "codex-native-ui-subagent" },
        }),
        childInfo({
          id: "c4",
          title: "ui:claude:my-agent",
          session_name: "my-agent",
          tool: "should-not-win",
          labels: { "omnigent.wrapper": "claude-code-native-ui-subagent" },
        }),
      ].map((child) => toChildSession(child, undefined).label),
    ).toEqual([
      "Investigate flaky auth test",
      "general-purpose:b7c2e9f4a1d3c5e60",
      "Summarize release notes",
      "my-agent",
    ]);
  });

  it("passes through the latest message preview", () => {
    expect(
      toChildSession(
        childInfo({ id: "c1", last_message_preview: "Searching for auth..." }),
        undefined,
      ).preview,
    ).toBe("Searching for auth...");
  });
});
