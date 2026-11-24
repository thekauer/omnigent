// Host-side source of the session tree in `omnigent.sessions`: a session's
// sub-agents and details, read through the same query cache entries (and fetch
// options) the app's own hooks use, so lists stay live through the SSE
// invalidations and are shared with the rest of the UI. Plain frozen data out.
import { QueryObserver, type QueryClient, type QueryObserverResult } from "@tanstack/react-query";
import type * as omnigent from "omnigent";
import { type AgentCosts, fetchAgentCosts } from "@/hooks/useAgentCosts";
import {
  type ChildSessionInfo,
  childSessionsQueryKey,
  fetchChildSessions,
} from "@/hooks/useChildSessions";
import { sessionQueryOptions } from "@/hooks/useSession";
import type { Session } from "@/lib/types";
import { isTempConvId } from "@/lib/tempConversationId";
import { toChildSession, toSessionDetails } from "@/shell/agentSessions";
import type { WorkspaceBridge } from "@/shell/workspaceBridge";
import { EventEmitter } from "./base";

/**
 * Observed sessions per kind outside the active tree; the least recently asked
 * for is released first. The active tree (its root and every session reachable
 * through its cached child lists) is never released while it is active, so a
 * tree with more lists than this still follows its invalidations.
 */
export const MAX_OBSERVED = 100;
const AGENT_COSTS_POLL_MS = 15_000;
const EMPTY_LIST: omnigent.ChildSessionList = Object.freeze({
  sessions: Object.freeze([]),
  loading: false,
  error: undefined,
});

interface Observed<T> {
  readonly observer: QueryObserver<T, Error>;
  unsubscribe: () => void;
  /** The converted result, for the data and costs it was made from. */
  memo: { data: unknown; costs: unknown; status: string; value: unknown } | undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SessionTreeService {
  private readonly bridge: WorkspaceBridge;
  private readonly treeEmitter = new EventEmitter<string | undefined>();
  private readonly changeEmitter = new EventEmitter<omnigent.ChildSessionsChangeEvent>();
  private readonly children = new Map<string, Observed<ChildSessionInfo[]>>();
  private readonly sessions = new Map<string, Observed<Session>>();
  private costs: { root: string; observed: Observed<AgentCosts | null> } | undefined;
  private client: QueryClient | undefined;
  private root: string | undefined;
  private costsEnabled = false;
  private readonly pending = new Set<string>();
  private flushScheduled = false;
  private disposed = false;
  private readonly unsubscribeBridge: () => void;

  readonly onDidChangeActiveSessionTree = this.treeEmitter.event;
  readonly onDidChangeChildSessions = this.changeEmitter.event;

  constructor(bridge: WorkspaceBridge) {
    this.bridge = bridge;
    this.unsubscribeBridge = bridge.subscribe(() => this.sync());
    this.sync();
  }

  get activeSessionTreeRoot(): string | undefined {
    return this.root;
  }

  /** Follows the workspace on screen: its query cache, tree root and cost setting. */
  private sync(): void {
    if (this.disposed) return;
    const state = this.bridge.getState();
    const client = this.bridge.queryClient();
    if (client !== this.client) {
      this.releaseAll();
      this.client = client;
    }
    const root =
      state.sessionId === null || !state.rootSessionId || isTempConvId(state.rootSessionId)
        ? undefined
        : state.rootSessionId;
    const costsEnabled = state.agentCostsEnabled === true;
    const rootChanged = root !== this.root;
    if (rootChanged || costsEnabled !== this.costsEnabled) {
      this.root = root;
      this.costsEnabled = costsEnabled;
      this.syncCosts();
    }
    if (rootChanged) {
      this.releaseOutsideTree();
      this.treeEmitter.fire(root);
    }
  }

  /**
   * The active root and every session reachable from it through cached child
   * lists: the sessions the active tree shows, which are never evicted.
   */
  private activeTree(): Set<string> {
    const tree = new Set<string>();
    const client = this.client;
    if (this.root === undefined) return tree;
    const queue = [this.root];
    tree.add(this.root);
    while (queue.length > 0) {
      const id = queue.shift()!;
      const list = client?.getQueryData<ChildSessionInfo[]>(childSessionsQueryKey(id));
      for (const child of list ?? []) {
        if (typeof child?.id !== "string" || tree.has(child.id)) continue;
        tree.add(child.id);
        queue.push(child.id);
      }
    }
    return tree;
  }

  /** After a switch, drops what the old tree observed and the new one does not show. */
  private releaseOutsideTree(): void {
    const tree = this.activeTree();
    for (const map of [this.children, this.sessions] as Map<string, Observed<unknown>>[]) {
      for (const [id, entry] of map) {
        if (tree.has(id)) continue;
        entry.unsubscribe();
        map.delete(id);
      }
    }
  }

  /** Keeps at most MAX_OBSERVED entries outside the active tree, oldest out first. */
  private evict<T>(map: Map<string, Observed<T>>): void {
    if (map.size <= MAX_OBSERVED) return;
    const tree = this.activeTree();
    let outside = 0;
    for (const id of map.keys()) if (!tree.has(id)) outside += 1;
    for (const [id, entry] of map) {
      if (outside <= MAX_OBSERVED) break;
      if (tree.has(id)) continue;
      entry.unsubscribe();
      map.delete(id);
      outside -= 1;
    }
  }

  private releaseAll(): void {
    for (const entry of this.children.values()) entry.unsubscribe();
    for (const entry of this.sessions.values()) entry.unsubscribe();
    this.children.clear();
    this.sessions.clear();
    this.costs?.observed.unsubscribe();
    this.costs = undefined;
  }

  private changed(sessionIds: Iterable<string>): void {
    for (const id of sessionIds) this.pending.add(id);
    if (this.flushScheduled || this.disposed) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      if (this.disposed || this.pending.size === 0) return;
      const ids = Object.freeze([...this.pending]);
      this.pending.clear();
      this.changeEmitter.fire(Object.freeze({ sessionIds: ids }));
    });
  }

  private observe<T>(
    map: Map<string, Observed<T>>,
    id: string,
    create: (client: QueryClient) => QueryObserver<T, Error>,
    onChange: () => void,
  ): Observed<T> | undefined {
    const existing = map.get(id);
    if (existing) {
      // Most recently asked for last.
      map.delete(id);
      map.set(id, existing);
      return existing;
    }
    const client = this.client;
    if (!client) return undefined;
    const observer = create(client);
    const entry: Observed<T> = { observer, unsubscribe: () => {}, memo: undefined };
    map.set(id, entry);
    // Subscribing can notify at once (the fetch starts), so the entry exists first.
    entry.unsubscribe = observer.subscribe(() => {
      entry.memo = undefined;
      onChange();
    });
    this.evict(map);
    return entry;
  }

  private costsFor(): AgentCosts | null | undefined {
    return this.costs?.observed.observer.getCurrentResult().data;
  }

  private rootWorking(): boolean {
    if (this.root === undefined) return false;
    const data = this.children.get(this.root)?.observer.getCurrentResult().data;
    return data?.some((child) => child.busy) ?? false;
  }

  private costOptions(root: string) {
    return {
      queryKey: ["agent_costs", root] as const,
      queryFn: () => fetchAgentCosts(root),
      retry: false,
      staleTime: (query: { state: { data: unknown } }) =>
        query.state.data === null ? Infinity : 0,
      refetchInterval: (query: { state: { data: unknown } }) =>
        this.rootWorking() && query.state.data !== null ? AGENT_COSTS_POLL_MS : false,
    };
  }

  /** One cost breakdown, for the active tree's root, while the server has the feature. */
  private syncCosts(): void {
    const root = this.costsEnabled ? this.root : undefined;
    if (this.costs?.root === root) return;
    this.costs?.observed.unsubscribe();
    this.costs = undefined;
    const client = this.client;
    if (root === undefined || !client) {
      this.changed([...this.children.keys(), ...this.sessions.keys()]);
      return;
    }
    const observer = new QueryObserver<AgentCosts | null, Error>(client, this.costOptions(root));
    const observed: Observed<AgentCosts | null> = {
      observer,
      unsubscribe: () => {},
      memo: undefined,
    };
    this.costs = { root, observed };
    observed.unsubscribe = observer.subscribe(() => {
      for (const entry of this.children.values()) entry.memo = undefined;
      for (const entry of this.sessions.values()) entry.memo = undefined;
      this.changed([...this.children.keys(), ...this.sessions.keys()]);
    });
  }

  getChildSessions(sessionId: string): omnigent.ChildSessionList {
    if (this.disposed || typeof sessionId !== "string" || sessionId === "") return EMPTY_LIST;
    if (isTempConvId(sessionId)) return EMPTY_LIST;
    const entry = this.observe(
      this.children,
      sessionId,
      (client) =>
        new QueryObserver<ChildSessionInfo[], Error>(client, {
          queryKey: childSessionsQueryKey(sessionId),
          queryFn: () => fetchChildSessions(sessionId),
          staleTime: 60_000,
          retry: false,
          // Unlike the app's hook (mounted once per row), a list asked for again
          // after it was released must catch up on what it missed meanwhile: an
          // invalidated or stale entry refetches, a fresh one is reused.
          refetchOnMount: true,
        }),
      () => {
        // Whether a direct child of the root works decides how often costs poll.
        if (sessionId === this.root && this.costs) {
          this.costs.observed.observer.setOptions(this.costOptions(this.costs.root));
        }
        this.changed([sessionId]);
      },
    );
    if (!entry) return Object.freeze({ ...EMPTY_LIST, loading: true });
    const result: QueryObserverResult<ChildSessionInfo[], Error> =
      entry.observer.getCurrentResult();
    const costs = this.costsFor();
    const memo = entry.memo;
    if (
      memo &&
      memo.data === result.data &&
      memo.costs === costs &&
      memo.status === result.status
    ) {
      return memo.value as omnigent.ChildSessionList;
    }
    const value: omnigent.ChildSessionList = Object.freeze({
      sessions: Object.freeze((result.data ?? []).map((child) => toChildSession(child, costs))),
      loading: result.isLoading,
      error: result.error ? errorText(result.error) : undefined,
    });
    entry.memo = { data: result.data, costs, status: result.status, value };
    return value;
  }

  getSession(sessionId: string): omnigent.SessionDetails | undefined {
    if (this.disposed || typeof sessionId !== "string" || sessionId === "") return undefined;
    if (isTempConvId(sessionId)) return undefined;
    const entry = this.observe(
      this.sessions,
      sessionId,
      (client) => new QueryObserver<Session, Error>(client, sessionQueryOptions(sessionId)),
      () => this.changed([sessionId]),
    );
    const data = entry?.observer.getCurrentResult().data;
    if (!entry || !data) return undefined;
    const costs = this.costsFor();
    const memo = entry.memo;
    if (memo && memo.data === data && memo.costs === costs) {
      return memo.value as omnigent.SessionDetails;
    }
    const value = toSessionDetails(data, costs);
    entry.memo = { data, costs, status: "success", value };
    return value;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeBridge();
    this.releaseAll();
    this.treeEmitter.dispose();
    this.changeEmitter.dispose();
  }
}
