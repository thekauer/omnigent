import { describe, expect, it } from "vitest";
import { agentCostLabel } from "@/hooks/useAgentCosts";
import { formatSessionCostUsd } from "@/lib/formatCost";
import {
  agentsBadge,
  childItem,
  costLabel,
  formatCostUsd,
  iconForAgentType,
  listMessage,
  rootItem,
} from "./agentsModel";

const states = { None: 0, Collapsed: 1, Expanded: 2 } as never;
const session = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "c1",
    label: "auth",
    title: "researcher:auth",
    tool: "researcher",
    agent: undefined,
    status: { state: "working", label: "Working" },
    busy: false,
    preview: undefined,
    routedModel: undefined,
    cost: undefined,
    ...overrides,
  }) as never;

describe("Agents model", () => {
  // Substring precedence matters: review before code, test before code.
  it.each([
    ["Explore", "search"],
    ["deep-researcher", "book-open"],
    ["planner", "compass"],
    ["architect", "compass"],
    ["code-reviewer", "scan-search"],
    ["pr-test-analyzer", "flask-conical"],
    ["frontend_engineer", "code"],
    ["documentation", "file-text"],
    ["technical-writer", "file-text"],
    ["general-purpose", "bot"],
    [null, "bot"],
  ] as const)("maps agent type %s to its category icon %s", (tool, icon) => {
    expect(iconForAgentType(tool)).toBe(icon);
  });

  it("formats costs exactly as core's session total and agent cost labels", () => {
    for (const usd of [0, 0.004, 0.009, 0.01, 0.4, 1.234, 12, 1234.5]) {
      expect(formatCostUsd(usd)).toBe(formatSessionCostUsd(usd));
      for (const estimated of [false, true]) {
        expect(costLabel({ usd, estimated })).toBe(agentCostLabel({ costUsd: usd, estimated }));
      }
    }
  });

  it("formats costs as the session total does, marking estimates", () => {
    expect(formatCostUsd(0.004)).toBe("<$0.01");
    expect(formatCostUsd(0)).toBe("$0.00");
    expect(formatCostUsd(1.5)).toBe("$1.50");
    expect(costLabel({ usd: 0.25, estimated: true })).toBe("~$0.25");
    expect(costLabel({ usd: null, estimated: false })).toBeUndefined();
    expect(costLabel(undefined)).toBeUndefined();
  });

  it("draws the root as a session row named by its agent, 'main' while it loads", () => {
    expect(rootItem("conv_root", undefined, false, states)).toEqual({
      id: "session:conv_root",
      label: "main",
      resourceUri: { scheme: "session", path: "conv_root" },
      iconPath: { agent: "" },
      contextValue: "agent",
      collapsibleState: 0,
    });
    expect(
      rootItem(
        "conv_root",
        {
          id: "conv_root",
          label: "Claude Code",
          agent: { agent: "claude-native-ui", harness: "claude-native" },
          kind: "claude-native",
          preview: "Hi",
          status: { state: "idle", label: "Idle" },
          cost: { usd: 1.5, estimated: false },
        },
        true,
        states,
      ),
    ).toMatchObject({
      label: "Claude Code",
      description: "Hi",
      contextValue: "claude-native",
      decoration: { parts: [{ text: "$1.50" }] },
      collapsibleState: 2,
    });
  });

  it("draws a sub-agent with its role icon or harness, routed model, cost and opener", () => {
    expect(childItem(session(), false, states)).toEqual({
      id: "session:c1",
      label: "auth",
      resourceUri: { scheme: "session", path: "c1" },
      iconPath: "book-open",
      status: { state: "working", label: "Working" },
      command: { command: "omnigent.openSubagent", title: "Open", arguments: ["c1"] },
      collapsibleState: 0,
    });
    expect(
      childItem(
        session({
          agent: { agent: "codex-native-ui", harness: "codex-native" },
          routedModel: { id: "databricks-claude-sonnet-5", label: "sonnet" },
          cost: { usd: 0.4, estimated: false },
          preview: "Reading",
        }),
        true,
        states,
      ),
    ).toMatchObject({
      iconPath: { agent: "codex-native-ui", harness: "codex-native" },
      description: "Reading",
      decoration: {
        parts: [
          { text: "sonnet", tooltip: "Smart routing picked databricks-claude-sonnet-5" },
          { text: "$0.40" },
        ],
      },
      collapsibleState: 2,
    });
  });

  it("badges every agent, the main one included, and working/total in the success tone", () => {
    expect(agentsBadge([])).toEqual({ value: 1, tooltip: "1", tone: "muted" });
    expect(agentsBadge([session({ busy: true }), session({ id: "c2" })])).toEqual({
      value: 3,
      tooltip: "1/3",
      label: "1/3",
      tone: "success",
    });
  });

  it("shows Loading or the failure only while there is no list to show", () => {
    expect(listMessage({ sessions: [], loading: true, error: undefined })).toBe("Loading…");
    expect(listMessage({ sessions: [], loading: false, error: "500" })).toBe(
      "Failed to load agents.",
    );
    expect(listMessage({ sessions: [session()], loading: true, error: "500" })).toBeUndefined();
    expect(listMessage({ sessions: [], loading: false, error: undefined })).toBeUndefined();
  });
});
