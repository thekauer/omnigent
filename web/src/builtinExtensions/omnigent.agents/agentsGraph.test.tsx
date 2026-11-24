// The Agents tab's "List view" / "Graph view": the extension switches the host's
// presentation, and the host draws the same tree as a graph of cards. Ported from
// the classic SubagentsGraphView toggle and node-click suites.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType, MouseEvent, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { childSessionsQueryKey } from "@/hooks/useChildSessions";
import { authenticatedFetch } from "@/lib/identity";
import { clearExpandStates } from "@/shell/extensionViews/treeRows";
import {
  type AgentsFixture,
  childInfo,
  CurrentPath,
  renderAgents,
  startAgents,
} from "@/test/agentsFixture";

vi.mock("@/lib/identity", () => ({ authenticatedFetch: vi.fn() }));
// The real canvas exhausts jsdom's memory; this stand-in renders one button per
// node, forwards clicks as React Flow's `onNodeClick` does, and each node's component.
interface StubNode {
  id: string;
  type: string;
  data: { sessionId: string };
}
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    nodes,
    nodeTypes,
    onNodeClick,
  }: {
    nodes: StubNode[];
    nodeTypes: Record<string, ComponentType<{ data: StubNode["data"] }>>;
    onNodeClick: (event: MouseEvent, node: StubNode) => void;
    children?: ReactNode;
  }) => (
    <div data-testid="graph-canvas">
      {nodes.map((node) => {
        const NodeComponent = nodeTypes[node.type];
        return (
          <div key={node.id} data-testid={`graph-node-${node.id}`}>
            <button type="button" onClick={(event) => onNodeClick(event, node)}>
              {node.data.sessionId}
            </button>
            <NodeComponent data={node.data} />
          </div>
        );
      })}
    </div>
  ),
  Background: () => null,
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom" },
  useReactFlow: () => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), fitView: vi.fn() }),
}));
vi.mock("@xyflow/react/dist/style.css", () => ({}));

const fetchMock = vi.mocked(authenticatedFetch);
let fixture: AgentsFixture | undefined;

beforeEach(() => fetchMock.mockReset());
afterEach(async () => {
  cleanup();
  clearExpandStates();
  localStorage.clear();
  await fixture?.harness.dispose();
  fixture = undefined;
});

const listButton = () => screen.getByRole("button", { name: "List view" });
const graphButton = () => screen.getByRole("button", { name: "Graph view" });

describe("Agents tab view-mode toggle", () => {
  it("defaults to the list, with both toggles in the title bar", async () => {
    fixture = await startAgents({ fetchMock });
    renderAgents(fixture);
    expect(await screen.findByTestId("subagent-main-row")).toBeInTheDocument();
    expect(listButton()).toHaveAttribute("aria-pressed", "true");
    expect(graphButton()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("graph-canvas")).toBeNull();
  });

  it("switches to the graph and back, keeping the toggle bar", async () => {
    fixture = await startAgents({
      fetchMock,
      tree: {
        conv_root: [
          childInfo({ id: "c1", tool: "researcher", session_name: "auth", busy: true }),
          childInfo({
            id: "c2",
            tool: "Explore",
            session_name: "files",
            current_task_status: "completed",
          }),
        ],
      },
    });
    renderAgents(fixture);
    await screen.findByTestId("subagent-main-row");
    fireEvent.click(graphButton());
    expect(await screen.findByTestId("graph-node-c2")).toBeInTheDocument();
    expect(screen.getByTestId("graph-node-conv_root")).toBeInTheDocument();
    expect(screen.queryByTestId("subagent-main-row")).toBeNull();
    expect(screen.queryByTestId("subagent-row")).toBeNull();
    expect(graphButton()).toHaveAttribute("aria-pressed", "true");
    expect(listButton()).toBeInTheDocument();
    fireEvent.click(listButton());
    expect(await screen.findByTestId("subagent-main-row")).toBeInTheDocument();
    expect(screen.queryByTestId("graph-canvas")).toBeNull();
  });

  it("draws each card's label, status label and the session on screen", async () => {
    fixture = await startAgents({
      fetchMock,
      conversationId: "c1",
      tree: {
        conv_root: [
          childInfo({ id: "c1", session_name: "auth", busy: true }),
          childInfo({ id: "c2", session_name: "docs", current_task_status: "completed" }),
        ],
        c1: [childInfo({ id: "c1a", session_name: "search", pending_elicitations_count: 1 })],
      },
    });
    renderAgents(fixture, { conversationId: "c1" });
    await screen.findByTestId("subagent-main-row");
    fireEvent.click(graphButton());
    const working = within(await screen.findByTestId("graph-node-c1"));
    expect(working.getByText("auth")).toBeInTheDocument();
    expect(working.getByText("Working")).toBeInTheDocument();
    expect(working.getByTestId("graph-node")).toHaveClass("ring-2");
    // Settled cards leave the status out; one waiting on the user says so.
    expect(within(screen.getByTestId("graph-node-c2")).queryByText("Done")).toBeNull();
    expect(
      within(await screen.findByTestId("graph-node-c1a")).getByText("Needs response"),
    ).toBeInTheDocument();
  });
});

describe("Agents graph node clicks", () => {
  it("opens a sub-agent node through the workspace, as its row does", async () => {
    fixture = await startAgents({
      fetchMock,
      tree: { conv_root: [childInfo({ id: "conv_child" })] },
    });
    renderAgents(fixture, { extra: <CurrentPath /> });
    await screen.findByTestId("subagent-main-row");
    fireEvent.click(graphButton());
    fireEvent.click(await screen.findByRole("button", { name: "conv_child" }));
    await waitFor(() =>
      expect(fixture!.harness.openSession).toHaveBeenCalledWith("conv_child", { asSubagent: true }),
    );
    expect(screen.getByTestId("current-path")).toHaveTextContent("/c/conv_root");
  });

  it("navigates to the root node, dropping session-scoped params", async () => {
    fixture = await startAgents({
      fetchMock,
      tree: { conv_root: [childInfo({ id: "conv_child" })] },
    });
    renderAgents(fixture, {
      conversationId: "conv_root",
      initialEntries: ["/c/conv_child?file=notes.md"],
      extra: <CurrentPath />,
    });
    await screen.findByTestId("subagent-main-row");
    fireEvent.click(graphButton());
    fireEvent.click(await screen.findByRole("button", { name: "conv_root" }));
    expect(screen.getByTestId("current-path").textContent).toBe("/c/conv_root");
    expect(fixture.harness.openSession).not.toHaveBeenCalled();
  });

  it("shows each node's cost, marking estimates, and drops one that becomes unknown", async () => {
    fixture = await startAgents({
      fetchMock,
      tree: { conv_root: [childInfo({ id: "conv_child" })] },
      costs: new Map([
        ["conv_root", { costUsd: 1.5, estimated: false }],
        ["conv_child", { costUsd: 0.25, estimated: true }],
      ]),
    });
    renderAgents(fixture);
    await screen.findByTestId("subagent-main-row");
    fireEvent.click(graphButton());
    const node = (id: string) => screen.getByTestId(`graph-node-${id}`);
    await waitFor(() => expect(node("conv_root")).toHaveTextContent("$1.50"));
    expect(node("conv_child")).toHaveTextContent("~$0.25");
    // A later poll updates the same graph in place.
    act(() =>
      fixture!.client.setQueryData(
        ["agent_costs", "conv_root"],
        new Map([["conv_root", { costUsd: 2, estimated: false }]]),
      ),
    );
    await waitFor(() => expect(node("conv_root")).toHaveTextContent("$2.00"));
    expect(node("conv_child")).not.toHaveTextContent("$");
    expect(fixture.client.getQueryData(childSessionsQueryKey("conv_root"))).toHaveLength(1);
  });
});
