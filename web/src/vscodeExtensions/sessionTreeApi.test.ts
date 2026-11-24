// `omnigent.sessions`'s session tree: the active tree's root, sub-agent lists and
// session details as plain data, live through the query cache the app shares.
import { QueryClient } from "@tanstack/react-query";
import type * as omnigent from "omnigent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { childSessionsQueryKey } from "@/hooks/useChildSessions";
import { authenticatedFetch } from "@/lib/identity";
import {
  DEFAULT_WORKSPACE_FILE_SETTINGS,
  type WorkspaceBridgeState,
  WorkspaceBridge,
} from "@/shell/workspaceBridge";
import { childInfo, rootSession } from "@/test/agentSessionFixtures";
import { createExtensionApi } from "./api";
import { MAX_OBSERVED, SessionTreeService } from "./sessionTreeService";
import { hostServices } from "./testServices";

vi.mock("@/lib/identity", () => ({ authenticatedFetch: vi.fn() }));

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

function setup(state: Partial<WorkspaceBridgeState> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const bridge = new WorkspaceBridge();
  const source = bridge.createSource();
  const publish = (patch: Partial<WorkspaceBridgeState>) => {
    current = { ...current, ...patch };
    source.update(current);
  };
  let current: WorkspaceBridgeState = {
    sessionId: "conv_root",
    changedFiles: [],
    availability: "available",
    servedFromHost: false,
    settings: DEFAULT_WORKSPACE_FILE_SETTINGS,
    rootSessionId: "conv_root",
    ...state,
  };
  source.update(current);
  source.setActions({
    openFile: () => {},
    refreshChangedFiles: () => Promise.resolve(),
    updateSettings: () => {},
    queryClient: client,
  });
  source.setActive(true);
  const sessionTree = new SessionTreeService(bridge);
  const api = createExtensionApi("pub.agents", hostServices({ sessionTree }), vi.fn()).api;
  return { client, bridge, source, publish, sessionTree, api };
}

afterEach(() => vi.mocked(authenticatedFetch).mockReset());

describe("sessions API: the session tree", () => {
  it("follows the root of the workspace on screen and says when it changes", async () => {
    const { api, publish } = setup();
    expect(api.sessions.activeSessionTreeRoot).toBe("conv_root");
    const roots: (string | undefined)[] = [];
    api.sessions.onDidChangeActiveSessionTree((root) => roots.push(root));
    publish({ sessionId: "conv_child", rootSessionId: "conv_root" });
    publish({ sessionId: "conv_other", rootSessionId: "conv_other" });
    publish({ rootSessionId: null });
    publish({ rootSessionId: "temp:1234" });
    expect(roots).toEqual(["conv_other", undefined]);
    expect(api.sessions.activeSessionTreeRoot).toBeUndefined();
  });

  it("hands out a session's sub-agents as frozen plain data, named and classified", async () => {
    const { api, client } = setup();
    client.setQueryData(childSessionsQueryKey("conv_root"), [
      childInfo({
        id: "conv_a",
        title: "researcher:auth",
        tool: "researcher",
        session_name: "auth",
        busy: true,
        last_message_preview: "Reading",
        routed_model: "databricks-claude-sonnet-5",
      }),
      childInfo({
        id: "conv_b",
        tool: "Explore",
        labels: { "omnigent.wrapper": "claude-code-native-ui-subagent" },
        last_task_error: { code: "runner_disconnected", message: "gone\nmore" },
      }),
    ]);
    const list = api.sessions.getChildSessions("conv_root");
    expect(list.loading).toBe(false);
    expect(list.error).toBeUndefined();
    expect(list.sessions).toEqual([
      {
        id: "conv_a",
        label: "auth",
        title: "researcher:auth",
        tool: "researcher",
        agent: undefined,
        status: { state: "working", label: "Working" },
        busy: true,
        preview: "Reading",
        routedModel: { id: "databricks-claude-sonnet-5", label: "sonnet" },
        cost: undefined,
      },
      {
        id: "conv_b",
        label: "Explore",
        title: null,
        tool: "Explore",
        agent: { agent: "claude-native-ui", harness: "claude-native" },
        status: { state: "disconnected", label: "Disconnected", detail: "gone" },
        busy: false,
        preview: undefined,
        routedModel: undefined,
        cost: undefined,
      },
    ]);
    expect(Object.isFrozen(list.sessions[0])).toBe(true);
    // The same snapshot until something changes.
    expect(api.sessions.getChildSessions("conv_root")).toBe(list);
  });

  it("loads a list on first ask, reports loading and failure, and fires when it lands", async () => {
    vi.mocked(authenticatedFetch).mockImplementation(async (input) =>
      String(input).includes("conv_bad")
        ? new Response("{}", { status: 500, statusText: "Internal" })
        : new Response(
            JSON.stringify({ object: "list", data: [childInfo({ id: "x" })], has_more: false }),
          ),
    );
    const { api } = setup();
    const changed: string[][] = [];
    api.sessions.onDidChangeChildSessions((event) => changed.push([...event.sessionIds]));
    expect(api.sessions.getChildSessions("conv_root")).toMatchObject({
      loading: true,
      sessions: [],
    });
    expect(api.sessions.getChildSessions("conv_bad").loading).toBe(true);
    await vi.waitFor(() =>
      expect(api.sessions.getChildSessions("conv_root").sessions).toHaveLength(1),
    );
    await vi.waitFor(() =>
      expect(api.sessions.getChildSessions("conv_bad")).toMatchObject({
        loading: false,
        error: "500 Internal",
      }),
    );
    expect(changed.flat()).toEqual(expect.arrayContaining(["conv_root", "conv_bad"]));
    // Never for client-only ids.
    expect(api.sessions.getChildSessions("temp:1").loading).toBe(false);
  });

  it("gives the root's details: label, agent icon, kind, preview and status", () => {
    const { api, client } = setup();
    client.setQueryData(
      ["session", "conv_root"],
      rootSession({
        agentName: "claude-native-ui",
        labels: { "omnigent.wrapper": "claude-code-native-ui" },
        status: "running",
        items: [
          {
            id: "i",
            type: "message",
            data: { content: [{ type: "output_text", text: "Hi there" }] },
          },
        ] as never,
      }),
    );
    expect(api.sessions.getSession("conv_root")).toEqual({
      id: "conv_root",
      label: "Claude Code",
      agent: { agent: "claude-native-ui", harness: "claude-native" },
      kind: "claude-native",
      preview: "Hi there",
      status: { state: "working", label: "Working" },
      cost: undefined,
    });
    expect(api.sessions.getSession("conv_unknown")).toBeUndefined();
  });

  it("adds the active tree's costs while the server reports them, and fires when they move", async () => {
    vi.mocked(authenticatedFetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "conv_root", cost_usd: 1.5 },
              { id: "conv_a", cost_usd: null, estimated_cost_usd: 0.25 },
            ],
            has_more: false,
          }),
        ),
    );
    const { api, client, publish } = setup();
    client.setQueryData(childSessionsQueryKey("conv_root"), [childInfo({ id: "conv_a" })]);
    client.setQueryData(["session", "conv_root"], rootSession());
    expect(api.sessions.getChildSessions("conv_root").sessions[0].cost).toBeUndefined();
    const changed = vi.fn();
    api.sessions.onDidChangeChildSessions(changed);
    publish({ agentCostsEnabled: true });
    await vi.waitFor(() =>
      expect(api.sessions.getChildSessions("conv_root").sessions[0].cost).toEqual({
        usd: 0.25,
        estimated: true,
      }),
    );
    expect(api.sessions.getSession("conv_root")?.cost).toEqual({ usd: 1.5, estimated: false });
    expect(changed).toHaveBeenCalled();
    const url = String(vi.mocked(authenticatedFetch).mock.calls.at(-1)?.[0]);
    expect(url).toContain("/v1/sessions/conv_root/agent_costs");
  });

  it("observes the same cache entries the app's hooks use, and stops when disposed", async () => {
    const { api, client, sessionTree } = setup();
    client.setQueryData(childSessionsQueryKey("conv_root"), []);
    api.sessions.getChildSessions("conv_root");
    const query = client.getQueryCache().find({ queryKey: childSessionsQueryKey("conv_root") })!;
    expect(query.getObserversCount()).toBe(1);
    const events: omnigent.ChildSessionsChangeEvent[] = [];
    api.sessions.onDidChangeChildSessions((event) => events.push(event));
    client.setQueryData(childSessionsQueryKey("conv_root"), [childInfo({ id: "new" })]);
    await flush();
    expect(events).toEqual([{ sessionIds: ["conv_root"] }]);
    sessionTree.dispose();
    expect(query.getObserversCount()).toBe(0);
  });

  const observers = (client: QueryClient, id: string) =>
    client
      .getQueryCache()
      .find({ queryKey: childSessionsQueryKey(id) })
      ?.getObserversCount() ?? 0;
  const listResponse = (ids: string[]) =>
    new Response(
      JSON.stringify({ object: "list", data: ids.map((id) => childInfo({ id })), has_more: false }),
    );

  it("keeps following a root whose tree has more lists than the cap (261 lists)", async () => {
    const { api, client } = setup();
    const kids = Array.from({ length: 260 }, (_, i) => `conv_k${i}`);
    client.setQueryData(
      childSessionsQueryKey("conv_root"),
      kids.map((id) => childInfo({ id })),
    );
    for (const id of kids) client.setQueryData(childSessionsQueryKey(id), []);
    // What the Agents view does: the root's list, then every node's list.
    api.sessions.getChildSessions("conv_root");
    for (const id of kids) api.sessions.getChildSessions(id);
    expect(observers(client, "conv_root")).toBe(1);
    expect(observers(client, kids[0])).toBe(1);
    const changed: string[] = [];
    api.sessions.onDidChangeChildSessions((event) => changed.push(...event.sessionIds));
    vi.mocked(authenticatedFetch).mockImplementation(async (input) =>
      String(input).includes("/conv_root/")
        ? listResponse([...kids, "conv_new"])
        : listResponse([]),
    );
    await client.invalidateQueries({ queryKey: childSessionsQueryKey("conv_root") });
    await vi.waitFor(() =>
      expect(api.sessions.getChildSessions("conv_root").sessions).toHaveLength(261),
    );
    expect(changed).toContain("conv_root");
  });

  it("caps lists outside the active tree and refetches a released one that went stale", async () => {
    const { api, client } = setup();
    client.setQueryData(childSessionsQueryKey("conv_root"), []);
    api.sessions.getChildSessions("conv_root");
    const outside = Array.from({ length: MAX_OBSERVED + 20 }, (_, i) => `conv_o${i}`);
    for (const id of outside) {
      client.setQueryData(childSessionsQueryKey(id), []);
      api.sessions.getChildSessions(id);
    }
    expect(observers(client, "conv_root")).toBe(1);
    expect(observers(client, outside[0])).toBe(0);
    expect(observers(client, outside.at(-1)!)).toBe(1);
    // Invalidated while released: asking again catches up.
    vi.mocked(authenticatedFetch).mockImplementation(async () => listResponse(["conv_late"]));
    await client.invalidateQueries({ queryKey: childSessionsQueryKey(outside[0]) });
    expect(authenticatedFetch).not.toHaveBeenCalled();
    api.sessions.getChildSessions(outside[0]);
    await vi.waitFor(() =>
      expect(api.sessions.getChildSessions(outside[0]).sessions.map((s) => s.id)).toEqual([
        "conv_late",
      ]),
    );
  });

  it("releases the old tree's observers when the root changes", () => {
    const { api, client, publish } = setup();
    client.setQueryData(childSessionsQueryKey("conv_root"), [childInfo({ id: "conv_a" })]);
    client.setQueryData(childSessionsQueryKey("conv_a"), []);
    client.setQueryData(childSessionsQueryKey("conv_other"), [childInfo({ id: "conv_b" })]);
    client.setQueryData(childSessionsQueryKey("conv_b"), []);
    client.setQueryData(["session", "conv_root"], rootSession());
    api.sessions.getChildSessions("conv_root");
    api.sessions.getChildSessions("conv_a");
    api.sessions.getChildSessions("conv_b");
    api.sessions.getSession("conv_root");
    const rootQuery = client.getQueryCache().find({ queryKey: ["session", "conv_root"] })!;
    expect(rootQuery.getObserversCount()).toBe(1);
    publish({ sessionId: "conv_other", rootSessionId: "conv_other" });
    expect(observers(client, "conv_root")).toBe(0);
    expect(observers(client, "conv_a")).toBe(0);
    expect(rootQuery.getObserversCount()).toBe(0);
    // A list the new tree shows stays observed.
    expect(observers(client, "conv_b")).toBe(1);
  });
});
