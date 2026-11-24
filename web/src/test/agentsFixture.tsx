// Test fixture for the built-in Agents view: the built-ins in the real host over a query
// cache, with the server's child-session, session and agent-cost routes served
// from an id-keyed tree, as the classic panel's tests mocked the hooks.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ChildSessionInfo } from "@/hooks/useChildSessions";
import type { AgentCosts } from "@/hooks/useAgentCosts";
import { useLocation } from "@/lib/routing";
import type { Session } from "@/lib/types";
import { ExtensionRailView } from "@/shell/extensionViews/ExtensionRailView";
import { RailViewRegistry } from "@/shell/railViews";
import { WorkspaceBridge } from "@/shell/workspaceBridge";
import { type BuiltInHarness, startBuiltIns } from "@/test/builtInExtensions";
import { VIEW_ID } from "@/builtinExtensions/omnigent.agents/extension";

export interface AgentsFixture {
  harness: BuiltInHarness;
  client: QueryClient;
  /** The child-session lists the server answers, by parent id. */
  tree: Record<string, ChildSessionInfo[]>;
  /** The parent ids whose child lists were fetched, in order. */
  fetched: string[];
}

import { rootSession } from "./agentSessionFixtures";

export { childInfo, rootSession } from "./agentSessionFixtures";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Starts the built-ins for `rootSessionId` with `tree` as the server's child lists.
 * `fetchMock` is the mocked `authenticatedFetch`; `session` seeds the root's snapshot.
 */
export async function startAgents(options: {
  fetchMock: ReturnType<typeof vi.fn>;
  tree?: Record<string, ChildSessionInfo[]>;
  rootSessionId?: string;
  conversationId?: string;
  session?: Session;
  costs?: AgentCosts;
  /** Child-list ids answered with this failure instead. */
  failing?: Record<string, number>;
  /** Child-list ids that never answer. */
  pending?: string[];
}): Promise<AgentsFixture> {
  const tree = options.tree ?? {};
  const fetched: string[] = [];
  const rootSessionId = options.rootSessionId ?? "conv_root";
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    ["session", rootSessionId],
    options.session ?? rootSession({ id: rootSessionId }),
  );
  options.fetchMock.mockImplementation(async (input: unknown) => {
    const url = new URL(String(input), "http://test");
    const children = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/child_sessions$/);
    if (children) {
      const id = decodeURIComponent(children[1]);
      fetched.push(id);
      if (options.pending?.includes(id)) return new Promise(() => {});
      const failure = options.failing?.[id];
      if (failure) return json({ detail: "failed" }, failure);
      return json({ object: "list", data: tree[id] ?? [], has_more: false });
    }
    if (/\/agent_costs$/.test(url.pathname)) {
      const rows = [...(options.costs ?? new Map())].map(([id, cost]) =>
        cost.estimated
          ? { id, cost_usd: null, estimated_cost_usd: cost.costUsd }
          : { id, cost_usd: cost.costUsd },
      );
      return options.costs ? json({ data: rows, has_more: false }) : json({}, 404);
    }
    return json({}, 404);
  });
  const harness = await startBuiltIns({
    registry: new RailViewRegistry(),
    bridge: new WorkspaceBridge(),
    sessionId: options.conversationId ?? rootSessionId,
    queryClient: client,
    rootSessionId,
    agentCostsEnabled: options.costs !== undefined,
  });
  return { harness, client, tree, fetched };
}

export function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

/** The Agents tab's page for `conversationId`, at `initialEntries` in a router. */
export function renderAgents(
  fixture: AgentsFixture,
  {
    conversationId = fixture.harness.state().sessionId ?? "conv_root",
    initialEntries,
    extra,
  }: { conversationId?: string; initialEntries?: string[]; extra?: ReactNode } = {},
) {
  return render(
    <QueryClientProvider client={fixture.client}>
      <MemoryRouter initialEntries={initialEntries ?? [`/c/${conversationId}`]}>
        <TooltipProvider>
          <ExtensionRailView
            viewId={VIEW_ID}
            settled
            conversationId={conversationId}
            registry={fixture.harness.registry}
          />
        </TooltipProvider>
        {extra}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
