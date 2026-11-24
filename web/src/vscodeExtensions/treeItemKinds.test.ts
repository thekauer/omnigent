// Tree item fields of the session and text-match rows, checked into plain data.
import { describe, expect, it } from "vitest";
import { sanitizeTreeItem } from "./treeView";

describe("tree items for session and text-match rows", () => {
  it("reads a session resource, an agent icon and a status", () => {
    const { node } = sanitizeTreeItem(
      {
        label: "auth",
        resourceUri: { scheme: "session", path: "conv_a" },
        iconPath: { agent: "claude-native-ui", harness: "claude-native" },
        status: { state: "awaiting", label: "Needs response", detail: "a prompt" },
        decoration: {
          parts: [{ text: "sonnet", tooltip: "Smart routing picked x" }, { text: "$0.42" }],
        },
      },
      "h",
    );
    expect(node).toMatchObject({
      sessionId: "conv_a",
      resourcePath: undefined,
      agentIcon: { agent: "claude-native-ui", harness: "claude-native" },
      agentStatus: { state: "awaiting", label: "Needs response", detail: "a prompt" },
      icon: undefined,
    });
    expect(node.decoration?.parts).toEqual([
      { text: "sonnet", tooltip: "Smart routing picked x" },
      { text: "$0.42" },
    ]);
  });

  it("drops a status it does not know and an agent icon without a name", () => {
    const { node } = sanitizeTreeItem(
      { label: "x", status: { state: "exploding" } as never, iconPath: { harness: "x" } as never },
      "h",
    );
    expect(node.agentStatus).toBeUndefined();
    expect(node.agentIcon).toBeUndefined();
  });

  it("reads a text match: highlights clipped to the label, the line and its accessible name", () => {
    const { node } = sanitizeTreeItem(
      {
        label: {
          label: "let needle = 1",
          highlights: [[4, 10], [12, 99], [5, 3], [1.5, 2] as never],
        },
        resourceUri: { path: "a.ts" },
        line: 3,
        accessibilityInformation: { label: "Open a.ts at line 3" },
      },
      "h",
    );
    expect(node).toMatchObject({
      label: "let needle = 1",
      resourcePath: "a.ts",
      highlights: [
        [4, 10],
        [12, 14],
      ],
      line: 3,
      accessibleLabel: "Open a.ts at line 3",
    });
    expect(sanitizeTreeItem({ label: "x", line: 0 }, "h").node.line).toBeUndefined();
  });
});
