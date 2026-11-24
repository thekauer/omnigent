// A plan view in more than one pane: each grid cell draws its own session's plan.
import type * as omnigent from "omnigent";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RailView } from "../railViews";
import { planForSession, ViewPlan } from "./ViewPlan";

vi.mock("@/components/workflows/WorkflowRunRow", () => ({ SessionDescendantRuns: () => null }));

afterEach(cleanup);

const task = (id: string, name: string) => ({
  task: {
    id,
    name,
    goal: null,
    dependsOn: [],
    state: "waiting" as const,
    status: null,
    startedAt: null,
    native: false,
    activeForm: null,
    history: [],
    chatMarker: undefined,
    question: undefined,
    blockedBy: [],
  },
});

const planFor = (sessionId: string, name: string): omnigent.PlanViewContent => ({
  kind: "plan",
  sessionId,
  summary: `${name} summary`,
  counts: [],
  menu: [],
  graph: false,
  tasks: [task(`${sessionId}-1`, name)],
  dependencies: false,
});

function viewWith(published: omnigent.PlanViewContent, snapshots: omnigent.PlanViewContent[]) {
  return {
    id: "pub.tasks.view",
    host: { runCommand: vi.fn() },
    plan: published,
    planBySession: new Map(
      snapshots.map((content) => [content.kind === "loading" ? "" : content.sessionId!, content]),
    ),
  } as unknown as RailView;
}

describe("plan views in grid cells", () => {
  it("draw each pane's own session, the front one live and the others from their snapshot", () => {
    const a = planFor("a", "Task of A");
    const b = planFor("b", "Task of B");
    const view = viewWith(a, [b, a]);
    render(
      <MemoryRouter>
        <section data-testid="cell-a">
          <ViewPlan view={view} content={view.plan!} conversationId="a" visible />
        </section>
        <section data-testid="cell-b">
          <ViewPlan view={view} content={view.plan!} conversationId="b" visible />
        </section>
        <section data-testid="cell-c">
          <ViewPlan view={view} content={view.plan!} conversationId="c" visible />
        </section>
      </MemoryRouter>,
    );
    expect(within(screen.getByTestId("cell-a")).getByText("Task of A")).toBeTruthy();
    expect(within(screen.getByTestId("cell-b")).getByText("Task of B")).toBeTruthy();
    expect(within(screen.getByTestId("cell-b")).queryByText("Task of A")).toBeNull();
    // A session never published waits, as before.
    expect(within(screen.getByTestId("cell-c")).getByRole("status")).toBeTruthy();
    expect(within(screen.getByTestId("cell-c")).queryByText(/Task of/)).toBeNull();
  });

  it("picks the published content first, then the pane's own snapshot", () => {
    const a = planFor("a", "A");
    const b = planFor("b", "B");
    const loading: omnigent.PlanViewContent = { kind: "loading", label: "Loading" };
    const empty: omnigent.PlanViewContent = { kind: "empty", title: "None", message: "" };
    const view = viewWith(a, [b]);
    expect(planForSession(view, a, "a")).toBe(a);
    expect(planForSession(view, a, "b")).toBe(b);
    // Loading is the session on screen's, so no pane draws an older snapshot over it.
    expect(planForSession(view, loading, "b")).toBe(loading);
    expect(planForSession(view, a, "c")).toBe(a);
    expect(planForSession(view, a, undefined)).toBe(a);
    // Content without a session is for whichever session is on screen.
    expect(planForSession(view, empty, "b")).toBe(empty);
  });
});
