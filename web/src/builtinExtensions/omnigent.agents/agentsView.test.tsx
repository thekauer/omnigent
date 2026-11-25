// The Agents tab as users see it: the built-in extension in the real host, its
// session rows drawn by the host, its data from the same queries the app uses.
// Ported from the classic SubagentsPanel tests.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { childSessionsQueryKey } from "@/hooks/useChildSessions";
import { authenticatedFetch } from "@/lib/identity";
import { clearExpandStates } from "@/shell/extensionViews/treeRows";
import {
  type AgentsFixture,
  childInfo,
  CurrentPath,
  renderAgents,
  rootSession,
  startAgents,
} from "@/test/agentsFixture";
import { VIEW_ID } from "./extension";

vi.mock("@/lib/identity", () => ({ authenticatedFetch: vi.fn() }));
// Brand logos as plain marked SVGs, so the assertions read which icon a row chose.
vi.mock("@/components/icons/ClaudeIcon", () => ({
  ClaudeIcon: (props: Record<string, unknown>) => <svg {...props} data-icon="claude" />,
}));
vi.mock("@/components/icons/CodexIcon", () => ({
  CodexIcon: (props: Record<string, unknown>) => <svg {...props} data-icon="codex" />,
}));
vi.mock("@/components/icons/OpenCodeIcon", () => ({
  OpenCodeIcon: (props: Record<string, unknown>) => <svg {...props} data-icon="opencode" />,
}));
vi.mock("@/components/icons/KiroIcon", () => ({
  KiroIcon: (props: Record<string, unknown>) => <svg {...props} data-icon="kiro" />,
}));
vi.mock("@/components/icons/PiIcon", () => ({
  PiIcon: (props: Record<string, unknown>) => <svg {...props} data-icon="pi" />,
}));

const fetchMock = vi.mocked(authenticatedFetch);
let fixture: AgentsFixture | undefined;

async function setup(options: Omit<Parameters<typeof startAgents>[0], "fetchMock"> = {}) {
  fixture = await startAgents({ fetchMock, ...options });
  return fixture;
}

/** Renders the tab and waits for its main row. */
async function renderPanel(
  options: Omit<Parameters<typeof startAgents>[0], "fetchMock"> = {},
  render: Parameters<typeof renderAgents>[1] = {},
) {
  const started = await setup(options);
  const view = renderAgents(started, render);
  await screen.findByTestId("subagent-main-row");
  return view;
}

/** A rendered child row by session id, once it shows. */
async function childRow(id: string): Promise<HTMLElement> {
  await waitFor(() =>
    expect(document.querySelector(`[data-child-session-id="${id}"]`)).not.toBeNull(),
  );
  return document.querySelector<HTMLElement>(`[data-child-session-id="${id}"]`)!;
}

const noRow = (id: string) => document.querySelector(`[data-child-session-id="${id}"]`);
const classes = (element: Element) => element.className.split(/\s+/);
/** The container a row's guides and toggle sit in. */
const rowFrame = (row: HTMLElement) => row.parentElement!;
const toggleFor = async (id: string) =>
  within(rowFrame(await childRow(id))).getByTestId("subagent-collapse-toggle");

beforeEach(() => fetchMock.mockReset());
afterEach(async () => {
  cleanup();
  clearExpandStates();
  localStorage.clear();
  await fixture?.harness.dispose();
  fixture = undefined;
});

describe("Agents tab", () => {
  it("shows each agent's cost, marking estimates, and omits unknown costs", async () => {
    await renderPanel({
      tree: {
        conv_root: [childInfo({ id: "conv_a" }), childInfo({ id: "conv_b" })],
        conv_a: [childInfo({ id: "conv_c" })],
      },
      costs: new Map([
        ["conv_root", { costUsd: 1.5, estimated: false }],
        ["conv_a", { costUsd: 0.4, estimated: false }],
        ["conv_b", { costUsd: null, estimated: false }],
        ["conv_c", { costUsd: 0.25, estimated: true }],
      ]),
    });
    await waitFor(() => expect(screen.getByTestId("subagent-main-row")).toHaveTextContent("$1.50"));
    expect(await childRow("conv_a")).toHaveTextContent("$0.40");
    expect(await childRow("conv_b")).not.toHaveTextContent("$");
    expect(await childRow("conv_c")).toHaveTextContent("~$0.25");
  });

  it("always renders a 'main' row linking to the root session", async () => {
    await renderPanel();
    const heading = screen.getByRole("heading", { name: "Agents" });
    expect(heading).toHaveClass("pl-1", "font-medium", "text-ui");
    expect(heading.parentElement).toHaveClass("h-(--ui-view-title-height)");
    const main = screen.getByTestId("subagent-main-row");
    expect(main).toHaveAttribute("href", "/c/conv_root");
    expect(main).toHaveAttribute("data-root-session-id", "conv_root");
    expect(main).toHaveTextContent(/main/i);
    expect(within(main).getByTestId("subagent-main-harness-icon")).toHaveClass(
      "size-8",
      "rounded-xl",
      "border",
    );
    expect(screen.queryByTestId("subagent-row")).toBeNull();
  });

  it("labels the main row with the root agent's name when available", async () => {
    await renderPanel({ session: rootSession({ agentName: "deep-researcher" }) });
    const main = screen.getByTestId("subagent-main-row");
    await waitFor(() => expect(main).toHaveTextContent("deep-researcher"));
    expect(main).not.toHaveTextContent(/\bmain\b/);
  });

  it("labels native-wrapper main rows with the product name, not the YAML agent name", async () => {
    await renderPanel({
      session: rootSession({
        agentName: "claude-native-ui",
        labels: { "omnigent.wrapper": "claude-code-native-ui" },
      }),
    });
    const main = screen.getByTestId("subagent-main-row");
    await waitFor(() => expect(main).toHaveTextContent("Claude Code"));
    expect(main).not.toHaveTextContent("claude-native-ui");
    expect(main.querySelector('[data-harness-icon="claude"]')).toHaveClass("size-5");
  });

  it("labels Pi native-wrapper main rows with the product name", async () => {
    await renderPanel({
      session: rootSession({
        agentName: "pi-native-ui",
        labels: { "omnigent.wrapper": "pi-native-ui" },
      }),
    });
    const main = screen.getByTestId("subagent-main-row");
    await waitFor(() => expect(main).toHaveTextContent("Pi"));
    expect(main).not.toHaveTextContent("pi-native-ui");
  });

  it("shows the root's latest message as the main-row preview", async () => {
    await renderPanel({
      session: rootSession({
        items: [
          {
            id: "i1",
            type: "message",
            response_id: "r1",
            status: "completed",
            data: {
              role: "assistant",
              content: [{ type: "output_text", text: "Hello! How can I help you today?" }],
            },
          },
          // A trailing tool call after the message: the preview skips it.
          {
            id: "i2",
            type: "function_call",
            response_id: "r1",
            status: "completed",
            data: { name: "sys_os_read", arguments: "{}", call_id: "c1" },
          },
        ] as never,
      }),
    });
    expect(await screen.findByTestId("subagent-main-preview")).toHaveTextContent(
      "Hello! How can I help you today?",
    );
  });

  it("omits the main-row preview when the root has no message yet", async () => {
    await renderPanel();
    expect(screen.queryByTestId("subagent-main-preview")).toBeNull();
  });

  it.each([
    [{ "omnigent.wrapper": "claude-code-native-ui" }, null, "claude-native"],
    [{ "omnigent.wrapper": "codex-native-ui" }, null, "codex-native"],
    [{ "omnigent.wrapper": "opencode-native-ui" }, null, "opencode-native"],
    [{ "omnigent.wrapper": "pi-native-ui" }, null, "pi-native"],
    [{}, "nessie", "nessie"],
    [{}, null, "agent"],
    [{ "omnigent.wrapper": "some-other-wrapper" }, null, "agent"],
  ] as const)(
    "names what runs the main row's session from its wrapper label / agent name (%j, %s)",
    async (labels, agentName, expectedKind) => {
      await renderPanel({ session: rootSession({ labels: { ...labels }, agentName }) });
      await waitFor(() =>
        expect(screen.getByTestId("subagent-main-row")).toHaveAttribute(
          "data-context-value",
          expectedKind,
        ),
      );
    },
  );

  it("renders a loading state when the initial fetch is in flight", async () => {
    const started = await setup({ pending: ["conv_root"] });
    renderAgents(started);
    await waitFor(() => expect(started.harness.registry.get(VIEW_ID)?.message).toBe("Loading…"));
    await waitFor(() => expect(screen.getByText("Loading…")).toBeInTheDocument());
    expect(screen.queryByTestId("subagent-main-row")).toBeNull();
  });

  it("renders an error state when the fetch fails with no cached data", async () => {
    const started = await setup({ failing: { conv_root: 500 } });
    renderAgents(started);
    expect(await screen.findByText(/Failed to load agents/i)).toBeInTheDocument();
  });

  it("renders one row per child session below 'main' and links to each", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "conv_child_a",
            title: "researcher:auth",
            tool: "researcher",
            session_name: "auth",
            current_task_status: "completed",
          }),
          childInfo({
            id: "conv_child_b",
            title: "frontend_engineer:rail",
            tool: "frontend_engineer",
            session_name: "rail",
            current_task_status: "in_progress",
            busy: true,
            last_message_preview: "Inspecting the rail layout",
          }),
        ],
      },
    });
    await childRow("conv_child_b");
    const rows = screen.getAllByTestId("subagent-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("href", "/c/conv_child_a");
    expect(rows[1]).toHaveAttribute("href", "/c/conv_child_b");
  });

  it("opens a clicked child as a sub-agent through the workspace, leaving the link alone", async () => {
    const started = await setup({
      tree: { conv_root: [childInfo({ id: "conv_child_a", title: "researcher:auth" })] },
    });
    renderAgents(started, { extra: <CurrentPath /> });
    fireEvent.click(await childRow("conv_child_a"));
    // The workspace decides: a tab beside the chat with the setting on, else navigation.
    await waitFor(() =>
      expect(started.harness.openSession).toHaveBeenCalledWith("conv_child_a", {
        asSubagent: true,
      }),
    );
    expect(screen.getByTestId("current-path")).toHaveTextContent("/c/conv_root");
  });

  it("follows the link itself on a modified click, so it can open in a new tab", async () => {
    const started = await setup({
      tree: { conv_root: [childInfo({ id: "conv_child_a" })] },
    });
    renderAgents(started, { extra: <CurrentPath /> });
    fireEvent.click(await childRow("conv_child_a"), { metaKey: true });
    expect(started.harness.openSession).not.toHaveBeenCalled();
  });

  it("uses spawned task titles as the primary child-row labels", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "conv_child",
            title: "codex:auth-refactor",
            tool: "codex",
            session_name: "auth-refactor",
          }),
          childInfo({ id: "conv_title_only", title: "codex:fix-sse-error", tool: "codex" }),
        ],
      },
    });
    const row = await childRow("conv_child");
    expect(within(row).getByText("auth-refactor")).toBeInTheDocument();
    expect(within(row).queryByText("codex")).toBeNull();
    const titleOnly = await childRow("conv_title_only");
    expect(within(titleOnly).getByText("fix-sse-error")).toBeInTheDocument();
    expect(within(titleOnly).queryByText("codex")).toBeNull();
  });

  it("keeps native Codex collaborator rows labeled by nickname instead of thread id", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "conv_child",
            title: "codex-native-ui-subagent:thread_child_alpha",
            tool: "auth-auditor",
            session_name: "thread_child_alpha",
            labels: { "omnigent.wrapper": "codex-native-ui-subagent" },
          }),
        ],
      },
    });
    const row = await childRow("conv_child");
    expect(within(row).getByText("auth-auditor")).toBeInTheDocument();
    expect(within(row).queryByText("thread_child_alpha")).toBeNull();
  });

  it("labels native Antigravity sub-agent rows by role instead of cascade id", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "conv_child",
            title: "App Router Reviewer:1eca7625-9d2f-4c6b-8a31-7f5e2c0d4b8a",
            tool: "App Router Reviewer",
            session_name: "1eca7625-9d2f-4c6b-8a31-7f5e2c0d4b8a",
            labels: { "omnigent.wrapper": "antigravity-native-ui-subagent" },
          }),
        ],
      },
    });
    const row = await childRow("conv_child");
    expect(within(row).getByText("App Router Reviewer")).toBeInTheDocument();
    expect(within(row).queryByText("1eca7625-9d2f-4c6b-8a31-7f5e2c0d4b8a")).toBeNull();
  });

  it("uses native logos for Claude Code, Codex, OpenCode, and Kiro child rows", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "conv_codex",
            tool: "codex",
            labels: { "omnigent.wrapper": "codex-native-ui" },
          }),
          childInfo({
            id: "conv_opencode",
            tool: "opencode",
            labels: { "omnigent.wrapper": "opencode-native-ui" },
          }),
          childInfo({
            id: "conv_claude",
            tool: "claude_code",
            labels: { "omnigent.wrapper": "claude-code-native-ui" },
          }),
          childInfo({
            id: "conv_kiro",
            tool: "kiro",
            labels: { "omnigent.wrapper": "kiro-native-ui" },
          }),
        ],
      },
    });
    await childRow("conv_kiro");
    for (const [id, icon] of [
      ["conv_codex", "codex"],
      ["conv_opencode", "opencode"],
      ["conv_claude", "claude"],
      ["conv_kiro", "kiro"],
    ]) {
      const row = document.querySelector<HTMLElement>(`[data-child-session-id="${id}"]`)!;
      expect(row.querySelector(`[data-harness-icon="${icon}"]`)).not.toBeNull();
      expect(row.querySelector(".lucide-code-2, .lucide-code-xml")).toBeNull();
    }
  });

  it("gives native sub-agent children their harness logo, keeping the nickname as the label", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "conv_claude_explore",
            title: "Explore:find-the-bug",
            tool: "Explore",
            labels: { "omnigent.wrapper": "claude-code-native-ui-subagent" },
          }),
          childInfo({
            id: "conv_codex_researcher",
            title: "codex-native-ui-subagent:thread-1",
            tool: "Archimedes",
            labels: {
              "omnigent.wrapper": "codex-native-ui-subagent",
              "omnigent.codex_native.agent_role": "researcher",
            },
          }),
        ],
      },
    });
    const claudeRow = await childRow("conv_claude_explore");
    expect(claudeRow.querySelector('[data-harness-icon="claude"]')).not.toBeNull();
    expect(claudeRow.querySelector(".lucide-search")).toBeNull();
    const codexRow = await childRow("conv_codex_researcher");
    expect(codexRow).toHaveTextContent("Archimedes");
    expect(codexRow.querySelector('[data-harness-icon="codex"]')).not.toBeNull();
    expect(codexRow.querySelector(".lucide-bot")).toBeNull();
    expect(codexRow.querySelector(".lucide-book-open")).toBeNull();
  });

  it("does not infer native logos from child title or tool names alone", async () => {
    await renderPanel({
      tree: {
        conv_root: [childInfo({ id: "conv_custom", title: "codex:custom-review", tool: "codex" })],
      },
    });
    const row = await childRow("conv_custom");
    expect(row.querySelector('[data-harness-icon="codex"]')).toBeNull();
    expect(row.querySelector('[data-testid="subagent-agent-avatar"] svg')).not.toBeNull();
  });

  it("uses the pi glyph for pi child rows, matched by exact tool name", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "conv_pi",
            title: "pi:review-auth",
            tool: "pi",
            session_name: "review-auth",
          }),
          childInfo({
            id: "conv_pipeline",
            title: "pipeline:build",
            tool: "pipeline",
            session_name: "build",
          }),
        ],
      },
    });
    expect((await childRow("conv_pi")).querySelector('[data-harness-icon="pi"]')).not.toBeNull();
    const pipeline = await childRow("conv_pipeline");
    expect(pipeline.querySelector('[data-harness-icon="pi"]')).toBeNull();
    expect(pipeline.querySelector(".lucide-bot")).not.toBeNull();
  });

  it("native wrapper labels outrank the pi tool-name match", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "conv_native_pi",
            title: "pi:port-fix",
            tool: "pi",
            labels: { "omnigent.wrapper": "claude-code-native-ui" },
          }),
        ],
      },
    });
    const row = await childRow("conv_native_pi");
    expect(row.querySelector('[data-harness-icon="claude"]')).not.toBeNull();
    expect(row.querySelector('[data-harness-icon="pi"]')).toBeNull();
  });

  it("reads child sessions without polling (push-driven via the watch-set)", async () => {
    const started = await setup();
    renderAgents(started);
    await screen.findByTestId("subagent-main-row");
    const query = started.client
      .getQueryCache()
      .find({ queryKey: childSessionsQueryKey("conv_root") });
    expect(query?.observers.length).toBeGreaterThan(0);
    for (const observer of query?.observers ?? []) {
      expect(observer.options.refetchInterval ?? false).toBe(false);
    }
  });

  it("highlights the main row when on the root session", async () => {
    await renderPanel({}, { conversationId: "conv_root" });
    expect(classes(screen.getByTestId("subagent-main-row"))).toContain("bg-accent");
  });

  it("highlights the matching child row when viewing a sibling", async () => {
    await renderPanel(
      {
        conversationId: "conv_child_a",
        tree: {
          conv_root: [
            childInfo({ id: "conv_child_a", busy: true, current_task_status: "in_progress" }),
            childInfo({ id: "conv_child_b", current_task_status: "completed" }),
          ],
        },
      },
      { conversationId: "conv_child_a" },
    );
    expect(classes(screen.getByTestId("subagent-main-row"))).not.toContain("bg-accent");
    expect(classes(await childRow("conv_child_a"))).toContain("bg-accent");
    expect(classes(await childRow("conv_child_b"))).not.toContain("bg-accent");
  });

  it("renders a destructive status avatar for a failed child", async () => {
    await renderPanel({
      tree: { conv_root: [childInfo({ id: "conv_child", current_task_status: "failed" })] },
    });
    const row = await childRow("conv_child");
    const avatar = within(row).getByTestId("subagent-status-avatar");
    expect(row).not.toHaveTextContent(/Failed/);
    expect(avatar).toHaveAttribute("aria-label", "Failed");
    expect(avatar).toHaveAttribute("data-activity", "failed");
    expect(avatar).toHaveClass("bg-destructive/10", "text-destructive");
    expect(avatar.querySelector(".lucide-circle-alert")).not.toBeNull();
  });

  it("renders a child with last_task_error as failed and exposes the error detail", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "conv_child",
            last_task_error: {
              code: "required_terminal_exited",
              message:
                "\nRequired terminal exited unexpectedly; the session runtime is no longer available.\ncommand: worker-cli",
            },
          }),
        ],
      },
    });
    const row = await childRow("conv_child");
    expect(row).not.toHaveTextContent(/Failed/);
    expect(within(row).getByTestId("subagent-status-avatar")).toHaveAttribute(
      "aria-label",
      "Failed: Required terminal exited unexpectedly; the session runtime is no longer available.",
    );
  });

  it.each([
    ["runner_disconnected", "Runner disconnected unexpectedly."],
    ["runner_failed_to_start", "runner exited before the first turn"],
  ])(
    "renders a neutral disconnected avatar for the runner-disconnect code %s",
    async (code, message) => {
      await renderPanel({
        tree: {
          conv_root: [
            childInfo({
              id: "conv_child",
              current_task_status: "failed",
              last_task_error: { code, message },
            }),
          ],
        },
      });
      const row = await childRow("conv_child");
      const avatar = within(row).getByTestId("subagent-status-avatar");
      expect(row).not.toHaveTextContent(/Disconnected/);
      expect(row).not.toHaveTextContent(/Failed/);
      expect(avatar).toHaveClass("bg-muted", "text-muted-foreground");
      expect(avatar).not.toHaveClass("text-warning", "text-destructive");
      expect(avatar.querySelector(".lucide-unplug")).not.toBeNull();
      expect(avatar).toHaveAttribute("aria-label", `Disconnected: ${message}`);
    },
  );

  it("keeps rendering red 'Failed' for a genuine task failure (non-disconnect code)", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "conv_child",
            current_task_status: "failed",
            last_task_error: { code: "tool_error", message: "Tool raised ValueError" },
          }),
        ],
      },
    });
    const row = await childRow("conv_child");
    const avatar = within(row).getByTestId("subagent-status-avatar");
    expect(row).not.toHaveTextContent(/Failed|Disconnected/);
    expect(avatar).toHaveClass("bg-destructive/10", "text-destructive");
    expect(avatar.querySelector(".lucide-circle-alert")).not.toBeNull();
  });

  it.each([
    ["failed", { code: "runner_disconnected", message: "Runner disconnected unexpectedly." }],
    ["failed", { code: "runner_failed_to_start", message: "runner exited before the first turn" }],
    ["failed", { code: "turn_error", message: "turn setup failed" }],
    ["running", null],
  ] as const)(
    "adds no status avatar to the main harness (%s, %j)",
    async (status, lastTaskError) => {
      await renderPanel({ session: rootSession({ status, lastTaskError } as never) });
      const main = screen.getByTestId("subagent-main-row");
      expect(main).not.toHaveTextContent(/Disconnected|Failed|Working/i);
      expect(main.querySelector('[data-testid="running-dot"]')).toBeNull();
      expect(within(main).queryByTestId("subagent-status-avatar")).toBeNull();
    },
  );

  it("renders the last_message_preview underneath the title when present", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "conv_child",
            busy: true,
            last_message_preview: "Searching the codebase for references to the old API…",
          }),
        ],
      },
    });
    expect(
      await screen.findByText("Searching the codebase for references to the old API…"),
    ).toBeInTheDocument();
  });

  it("renders tokenized state avatars with distinct icons", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "c_work",
            tool: "researcher",
            busy: true,
            current_task_status: "in_progress",
          }),
          childInfo({ id: "c_launch", tool: "researcher", current_task_status: "launching" }),
          childInfo({ id: "c_done", tool: "researcher", current_task_status: "completed" }),
          childInfo({ id: "c_idle", tool: "researcher" }),
          childInfo({ id: "c_other", tool: "researcher", current_task_status: "cancelled" }),
          childInfo({ id: "c_fail", tool: "researcher", current_task_status: "failed" }),
        ],
      },
    });
    const avatarOf = async (id: string) =>
      within(await childRow(id)).getByTestId("subagent-status-avatar");
    expect(await avatarOf("c_work")).toHaveClass("bg-muted", "text-muted-foreground");
    expect((await avatarOf("c_work")).querySelector('[data-testid="running-dot"]')).not.toBeNull();
    expect(
      (await avatarOf("c_launch")).querySelector('[data-testid="running-dot"]'),
    ).not.toBeNull();
    expect(await avatarOf("c_done")).toHaveClass("bg-success/10", "text-success");
    expect((await avatarOf("c_done")).querySelector(".lucide-check")).not.toBeNull();
    expect(await avatarOf("c_idle")).toHaveClass("bg-muted", "text-muted-foreground");
    expect((await avatarOf("c_idle")).querySelector(".lucide-pause")).not.toBeNull();
    expect((await avatarOf("c_other")).querySelector(".lucide-ellipsis")).not.toBeNull();
    expect(await avatarOf("c_fail")).toHaveClass("bg-destructive/10", "text-destructive");
    expect((await avatarOf("c_fail")).querySelector(".lucide-circle-alert")).not.toBeNull();
    expect(document.querySelector(".bg-amber-500, .bg-emerald-500, .bg-red-500")).toBeNull();
  });

  it("surfaces an awaiting-input status avatar for a child parked on an elicitation", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "c_await",
            tool: "researcher",
            busy: true,
            pending_elicitations_count: 1,
          }),
        ],
      },
    });
    const row = await childRow("c_await");
    const avatar = within(row).getByTestId("subagent-status-avatar");
    expect(row).not.toHaveTextContent(/Needs response/);
    expect(avatar).toHaveAttribute("aria-label", "Needs response");
    expect(avatar).toHaveClass("bg-warning/15", "text-warning");
    expect(avatar.querySelector(".lucide-circle-question-mark")).not.toBeNull();
    expect(row.querySelector('[data-testid="running-dot"]')).toBeNull();
  });

  it("keeps state names out of row copy while preserving accessible labels", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({ id: "c_launch", tool: "researcher", current_task_status: "launching" }),
          childInfo({ id: "c_work", tool: "researcher", busy: true }),
          childInfo({ id: "c_done", tool: "researcher", current_task_status: "completed" }),
          childInfo({ id: "c_idle", tool: "researcher" }),
          childInfo({ id: "c_cancel", tool: "researcher", current_task_status: "cancelled" }),
        ],
      },
    });
    await childRow("c_cancel");
    for (const [id, word, label] of [
      ["c_launch", /Launching/, "Launching"],
      ["c_work", /Working/, "Working"],
      ["c_done", /Done/, "Done"],
      ["c_idle", /Idle/, "Idle"],
      ["c_cancel", /cancelled/, "cancelled"],
    ] as const) {
      const row = document.querySelector<HTMLElement>(`[data-child-session-id="${id}"]`)!;
      expect(row).not.toHaveTextContent(word);
      expect(within(row).getByTestId("subagent-status-avatar")).toHaveAttribute(
        "aria-label",
        label,
      );
    }
  });

  it("renders the status avatar before the title-line agent avatar", async () => {
    await renderPanel({ tree: { conv_root: [childInfo({ id: "c_agent", tool: "researcher" })] } });
    const row = await childRow("c_agent");
    const statusAvatar = within(row).getByTestId("subagent-status-avatar");
    const agentAvatar = within(row).getByTestId("subagent-agent-avatar");
    expect(statusAvatar.nextElementSibling).toContainElement(agentAvatar);
    expect(agentAvatar.parentElement).toHaveTextContent("researcher");
  });

  it("de-emphasizes settled (done/idle) rows, but never the working or active row", async () => {
    await renderPanel(
      {
        conversationId: "c_done",
        tree: {
          conv_root: [
            childInfo({ id: "c_work", tool: "researcher", busy: true }),
            childInfo({ id: "c_done", tool: "researcher", current_task_status: "completed" }),
            childInfo({ id: "c_idle", tool: "researcher" }),
          ],
        },
      },
      { conversationId: "c_done" },
    );
    expect(classes(await childRow("c_work"))).not.toContain("opacity-60");
    expect(classes(await childRow("c_idle"))).toContain("opacity-60");
    expect(classes(await childRow("c_done"))).not.toContain("opacity-60");
  });

  it("renders a distinct, role-specific icon per agent type", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({ id: "c_explore", tool: "Explore", busy: true }),
          childInfo({ id: "c_code", tool: "frontend_engineer", busy: true }),
        ],
      },
    });
    const icon = async (id: string) =>
      (await childRow(id)).querySelector('[data-testid="subagent-agent-avatar"] svg');
    const explore = await icon("c_explore");
    const code = await icon("c_code");
    expect(explore).not.toBeNull();
    expect(code).not.toBeNull();
    expect(explore?.getAttribute("class")).not.toEqual(code?.getAttribute("class"));
  });

  it("strips session-scoped search params from rail navigation hrefs", async () => {
    await renderPanel(
      {
        tree: {
          conv_root: [childInfo({ id: "conv_child_a", tool: "researcher", session_name: "auth" })],
        },
      },
      {
        conversationId: "conv_root",
        initialEntries: [
          "/c/conv_root?file=existing.txt&diff=1&comment=c1&view=changed&message=msg_1",
        ],
      },
    );
    const main = screen.getByTestId("subagent-main-row");
    expect(main).toHaveAttribute("href", "/c/conv_root");
    expect(main.getAttribute("href")).not.toContain("?");
    const child = await childRow("conv_child_a");
    expect(child).toHaveAttribute("href", "/c/conv_child_a");
    expect(child.getAttribute("href")).not.toContain("?");
  });

  it("preserves global search params (?debug=1) across rail navigation", async () => {
    await renderPanel(
      { tree: { conv_root: [childInfo({ id: "conv_child_a", tool: "researcher" })] } },
      { conversationId: "conv_root", initialEntries: ["/c/conv_root?file=foo.txt&debug=1"] },
    );
    expect(screen.getByTestId("subagent-main-row").getAttribute("href")).toBe(
      "/c/conv_root?debug=1",
    );
    expect((await childRow("conv_child_a")).getAttribute("href")).toBe("/c/conv_child_a?debug=1");
  });

  it("shows instance names for user-added and normal spawned sub-agents", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "conv_added",
            title: "ui:claude-native-ui:jimmy",
            tool: "claude-native-ui",
            session_name: "jimmy",
          }),
          childInfo({
            id: "conv_llm",
            title: "researcher:auth",
            tool: "researcher",
            session_name: "auth",
          }),
        ],
      },
    });
    const added = await childRow("conv_added");
    expect(added).toHaveTextContent("jimmy");
    expect(added).not.toHaveTextContent("claude-native-ui");
    const spawned = await childRow("conv_llm");
    expect(spawned).toHaveTextContent("auth");
    expect(spawned).not.toHaveTextContent("researcher");
  });

  it("shows the Task description for Claude Code sub-agents, never the hex id", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "conv_described",
            title: "general-purpose:a09d1dd1d8dbc0151",
            tool: "wave-worker-696",
            session_name: "a09d1dd1d8dbc0151",
            labels: {
              "omnigent.wrapper": "claude-code-native-ui-subagent",
              "omnigent.claude_native.description": "wave-worker-696",
            },
          }),
          childInfo({
            id: "conv_namespaced",
            title: "rpw-published:debug-lead:a361e6a6aa05689cb",
            tool: "debug-lead",
            session_name: "a361e6a6aa05689cb",
            labels: { "omnigent.wrapper": "claude-code-native-ui-subagent" },
          }),
        ],
      },
    });
    const described = await childRow("conv_described");
    expect(described).toHaveTextContent("wave-worker-696");
    expect(described).not.toHaveTextContent("a09d1dd1d8dbc0151");
    const namespaced = await childRow("conv_namespaced");
    expect(namespaced).toHaveTextContent("debug-lead");
    expect(namespaced).not.toHaveTextContent("a361e6a6aa05689cb");
  });

  it("renders grandchildren and deeper levels indented under their parents", async () => {
    await renderPanel({
      tree: {
        conv_root: [childInfo({ id: "conv_child", tool: "researcher", session_name: "auth" })],
        conv_child: [childInfo({ id: "conv_grandchild", tool: "Explore", session_name: "files" })],
        conv_grandchild: [childInfo({ id: "conv_ggchild", tool: "Explore", session_name: "deep" })],
      },
    });
    await childRow("conv_ggchild");
    expect(
      screen.getAllByTestId("subagent-row").map((row) => row.getAttribute("data-child-session-id")),
    ).toEqual(["conv_child", "conv_grandchild", "conv_ggchild"]);
    expect(await childRow("conv_child")).toHaveAttribute("data-depth", "1");
    expect(await childRow("conv_grandchild")).toHaveAttribute("data-depth", "2");
    expect(await childRow("conv_ggchild")).toHaveAttribute("data-depth", "3");
    const pad = async (id: string) => parseInt((await childRow(id)).style.paddingLeft, 10);
    expect((await pad("conv_grandchild")) - (await pad("conv_child"))).toBe(64);
    expect((await pad("conv_ggchild")) - (await pad("conv_grandchild"))).toBe(90);
  });

  it("uses the circle-dot connector only for first-level leaf nodes", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({ id: "conv_leaf", tool: "Explore", session_name: "leaf" }),
          childInfo({ id: "conv_parent", tool: "Explore", session_name: "parent" }),
        ],
        conv_parent: [childInfo({ id: "conv_nested", tool: "Explore", session_name: "nested" })],
      },
    });
    expect((await childRow("conv_leaf")).querySelector("[data-subagent-connector]")).toHaveClass(
      "lucide-circle-dot",
    );
    expect((await childRow("conv_nested")).querySelector("[data-subagent-connector]")).toHaveClass(
      "lucide-corner-down-right",
    );
  });

  it("stops the root dotted guide at the last first-level node", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({ id: "conv_first", tool: "Explore", session_name: "first" }),
          childInfo({ id: "conv_last", tool: "Explore", session_name: "last" }),
        ],
      },
    });
    const lower = '[data-root-guide-segment="lower"]';
    expect(rowFrame(await childRow("conv_first")).querySelector(lower)).not.toBeNull();
    expect(rowFrame(await childRow("conv_last")).querySelector(lower)).toBeNull();
  });

  it("collapses and expands a row's nested subagents", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({ id: "conv_child", tool: "researcher", session_name: "auth" }),
          childInfo({ id: "conv_leaf", tool: "Explore", session_name: "leaf" }),
        ],
        conv_child: [childInfo({ id: "conv_grandchild", tool: "Explore", session_name: "files" })],
      },
    });
    await childRow("conv_grandchild");
    expect(screen.getAllByTestId("subagent-collapse-toggle")).toHaveLength(1);
    const toggle = await toggleFor("conv_child");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-label", "Collapse subagents");
    expect(toggle).toHaveClass("size-6");
    fireEvent.click(toggle);
    await waitFor(() => expect(noRow("conv_grandchild")).toBeNull());
    expect(await childRow("conv_leaf")).toBeInTheDocument();
    expect(await toggleFor("conv_child")).toHaveAttribute("aria-expanded", "false");
    expect(await toggleFor("conv_child")).toHaveAttribute("aria-label", "Expand subagents");
    fireEvent.click(await toggleFor("conv_child"));
    expect(await childRow("conv_grandchild")).toBeInTheDocument();
    expect(await toggleFor("conv_child")).toHaveAttribute("aria-expanded", "true");
    expect(await toggleFor("conv_child")).toHaveAttribute("aria-label", "Collapse subagents");
  });

  it("preserves a nested row's collapsed state when its parent hides it", async () => {
    await renderPanel({
      tree: {
        conv_root: [childInfo({ id: "conv_child", tool: "researcher", session_name: "auth" })],
        conv_child: [childInfo({ id: "conv_grandchild", tool: "Explore", session_name: "files" })],
        conv_grandchild: [childInfo({ id: "conv_ggchild", tool: "Explore", session_name: "deep" })],
      },
    });
    await childRow("conv_ggchild");
    fireEvent.click(await toggleFor("conv_grandchild"));
    await waitFor(() => expect(noRow("conv_ggchild")).toBeNull());
    fireEvent.click(await toggleFor("conv_child"));
    await waitFor(() => expect(noRow("conv_grandchild")).toBeNull());
    fireEvent.click(await toggleFor("conv_child"));
    expect(await childRow("conv_grandchild")).toBeInTheDocument();
    expect(noRow("conv_ggchild")).toBeNull();
    expect(await toggleFor("conv_grandchild")).toHaveAttribute("aria-expanded", "false");
  });

  it("stops fetching and rendering below the depth cap", async () => {
    const started = await setup({
      tree: {
        conv_root: [childInfo({ id: "c1", tool: "researcher" })],
        c1: [childInfo({ id: "c2", tool: "researcher" })],
        c2: [childInfo({ id: "c3", tool: "researcher" })],
        // Beyond the cap: never fetched or drawn.
        c3: [childInfo({ id: "c4", tool: "researcher" })],
      },
    });
    renderAgents(started);
    await childRow("c3");
    await act(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 20);
        }),
    );
    expect(
      screen.getAllByTestId("subagent-row").map((row) => row.getAttribute("data-child-session-id")),
    ).toEqual(["c1", "c2", "c3"]);
    expect(started.fetched).toContain("c2");
    expect(started.fetched).not.toContain("c3");
  });

  it("shows the router's model on a routed sub-agent row, and nothing when unrouted", async () => {
    await renderPanel({
      tree: {
        conv_root: [
          childInfo({
            id: "conv_routed",
            tool: "researcher",
            routed_model: "databricks-claude-sonnet-5",
          }),
          childInfo({ id: "conv_plain", tool: "researcher" }),
        ],
      },
    });
    const routed = await childRow("conv_routed");
    expect(
      within(routed).getByTitle("Smart routing picked databricks-claude-sonnet-5").textContent,
    ).toBe("sonnet");
    expect(within(await childRow("conv_plain")).queryByTitle(/Smart routing/)).toBeNull();
  });

  it("highlights the active grandchild row", async () => {
    await renderPanel(
      {
        conversationId: "conv_grandchild",
        tree: {
          conv_root: [childInfo({ id: "conv_child", tool: "researcher" })],
          conv_child: [childInfo({ id: "conv_grandchild", tool: "Explore" })],
        },
      },
      { conversationId: "conv_grandchild" },
    );
    expect(classes(await childRow("conv_grandchild"))).toContain("bg-accent");
    expect(classes(await childRow("conv_child"))).not.toContain("bg-accent");
  });
});

describe("Agents tab badge and live updates", () => {
  it("badges the tab with every agent, and working/total in the success tone", async () => {
    const started = await setup({
      tree: { conv_root: [childInfo({ id: "a" }), childInfo({ id: "b", busy: true })] },
    });
    await waitFor(() =>
      expect(started.harness.registry.get(VIEW_ID)?.badge).toEqual({
        value: 3,
        tooltip: "1/3",
        label: "1/3",
        tone: "success",
      }),
    );
    act(() =>
      started.client.setQueryData(childSessionsQueryKey("conv_root"), [childInfo({ id: "a" })]),
    );
    await waitFor(() =>
      expect(started.harness.registry.get(VIEW_ID)?.badge).toEqual({
        value: 2,
        tooltip: "2",
        tone: "muted",
      }),
    );
  });

  it("counts the main agent alone before any tree is known", async () => {
    const started = await setup({ rootSessionId: undefined });
    await started.harness.publish({ rootSessionId: null });
    expect(started.harness.registry.get(VIEW_ID)?.badge).toEqual({
      value: 1,
      tooltip: "1",
      tone: "muted",
    });
  });

  it("adds a sub-agent spawned while the tab is open", async () => {
    const started = await setup({
      tree: { conv_root: [childInfo({ id: "a", session_name: "first" })] },
    });
    renderAgents(started);
    await childRow("a");
    act(() =>
      started.client.setQueryData(childSessionsQueryKey("conv_root"), [
        childInfo({ id: "a", session_name: "first" }),
        childInfo({ id: "b", session_name: "second" }),
      ]),
    );
    expect(await childRow("b")).toHaveTextContent("second");
  });

  it("follows the session tree of the workspace on screen", async () => {
    const started = await setup({
      tree: {
        conv_root: [childInfo({ id: "a", session_name: "of root" })],
        conv_other: [childInfo({ id: "z", session_name: "of other" })],
      },
    });
    started.client.setQueryData(["session", "conv_other"], rootSession({ id: "conv_other" }));
    const view = renderAgents(started);
    await childRow("a");
    await started.harness.publish({ sessionId: "conv_other", rootSessionId: "conv_other" });
    view.unmount();
    renderAgents(started, { conversationId: "conv_other" });
    expect(await childRow("z")).toHaveTextContent("of other");
    expect(noRow("a")).toBeNull();
  });
});
