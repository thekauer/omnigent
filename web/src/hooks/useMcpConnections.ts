// React-query access to the host-provided MCP-connections capability
// (`OmnigentHostConfig.mcpConnections`, see `lib/host.ts`). The host owns
// listing, per-user sign-in status and the OAuth popup; these hooks surface them
// to the new-session and new-automation screens. Without the capability the
// queries are disabled, so the picker stays inert.

import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { getOmnigentMcpConnections, type McpConnectionStatus } from "@/lib/host";

const MCP_CONNECTIONS_QUERY_KEY = ["mcp-connections"] as const;
const MCP_SERVICES_BROWSE_QUERY_KEY = ["mcp-services-browse"] as const;

type McpServiceStatus = NonNullable<
  NonNullable<ReturnType<typeof getOmnigentMcpConnections>>["status"]
>;

// Keyed under the list's key, so the refresh after a sign-in covers these too.
function mcpServiceStatusQuery(status: McpServiceStatus, name: string) {
  return {
    queryKey: [...MCP_CONNECTIONS_QUERY_KEY, "status", name],
    queryFn: () => status(name),
    // A switch-on from browse reads the status just before the row mounts; don't
    // read it again right away.
    staleTime: 30_000,
  };
}

function combineStatuses(results: UseQueryResult<McpConnectionStatus | null>[]) {
  return {
    statuses: results.map((result) => result.data),
    pending: results.some((result) => result.isPending),
  };
}

export interface McpConnections {
  /** The host's list plus the usable services among `names`; undefined until listed. */
  data: McpConnectionStatus[] | undefined;
  /** The names the host's own list returned. */
  listedNames: ReadonlySet<string>;
  /** True while the status of one of `names` the list left out is still loading. */
  statusesPending: boolean;
}

/**
 * The host's list plus the status of `names` it doesn't list (picked from
 * `browse`, or restored from a previous session), each read on its own so a pick
 * doesn't refetch the rest. A name the user can't use is left out.
 */
export function useMcpConnections(names: Iterable<string> = []): McpConnections {
  const capability = getOmnigentMcpConnections();
  const listed = useQuery({
    queryKey: MCP_CONNECTIONS_QUERY_KEY,
    queryFn: async ({ signal }): Promise<McpConnectionStatus[]> => {
      // `enabled` already guards this, but the closure can outlive a config
      // change, so narrow defensively.
      if (!capability) return [];
      return capability.list({ signal });
    },
    enabled: capability != null,
  });
  const listedNames = useMemo(
    () => new Set((listed.data ?? []).map((connection) => connection.name)),
    [listed.data],
  );
  const status = capability?.status;
  // Only once listed, so a name the list covers is never read on its own.
  const extra =
    status && listed.data
      ? [...new Set(names)].filter((name) => !listedNames.has(name)).sort()
      : [];
  const picked = useQueries({
    queries: status ? extra.map((name) => mcpServiceStatusQuery(status, name)) : [],
    combine: combineStatuses,
  });
  const data = useMemo(() => {
    if (!listed.data) return undefined;
    const added = picked.statuses.filter(
      (connection): connection is McpConnectionStatus =>
        connection != null && !listedNames.has(connection.name),
    );
    return [...listed.data, ...added];
  }, [listed.data, listedNames, picked.statuses]);
  return { data, listedNames, statusesPending: picked.pending };
}

/** Reads one service's status now, for a handler; shares the cache with `useMcpConnections`. */
export function useFetchMcpServiceStatus(): (name: string) => Promise<McpConnectionStatus | null> {
  const status = getOmnigentMcpConnections()?.status;
  const queryClient = useQueryClient();
  return (name) =>
    status ? queryClient.fetchQuery(mcpServiceStatusQuery(status, name)) : Promise.resolve(null);
}

export function useBrowseMcpServices(enabled: boolean) {
  const browse = getOmnigentMcpConnections()?.browse;
  return useInfiniteQuery({
    queryKey: MCP_SERVICES_BROWSE_QUERY_KEY,
    queryFn: ({ pageParam, signal }) =>
      browse
        ? browse({ pageToken: pageParam, signal })
        : Promise.resolve({ services: [], nextPageToken: undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken,
    enabled: enabled && browse != null,
  });
}

export function useAuthorizeMcpConnection() {
  const capability = getOmnigentMcpConnections();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connectionName: string): Promise<void> => {
      if (!capability) throw new Error("MCP connections are not available here.");
      await capability.authorize(connectionName);
    },
    // Re-read status after a grant so the row flips to "Connected".
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MCP_CONNECTIONS_QUERY_KEY }),
  });
}
