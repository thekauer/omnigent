// Registers a workspace surface (the shell's session or a grid cell) with the
// workspace bridge, so extension views read what that surface would show: its
// changed files, why they cannot load, and its file settings.

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSessionHostOnline, useSessionRunnerOnline } from "@/hooks/RunnerHealthProvider";
import { useSandboxStarting } from "@/hooks/useSessionReconnect";
import {
  fetchWorkspaceAllFiles,
  fetchWorkspaceFileSearch,
  RunnerOfflineError,
  useWorkspaceAsleep,
  useWorkspaceChangedFiles,
  useWorkspaceEnvironment,
  type WorkspaceFile,
} from "@/hooks/useWorkspaceChangedFiles";
import { useServerInfo } from "@/lib/CapabilitiesContext";
import { isFeatureEnabled } from "@/lib/capabilities";
import type { ChangedSort } from "@/lib/changedSort";
import { useChatStore } from "@/store/chatStore";
import { fileListStatus } from "./fileListStatus";
import {
  type WorkspaceAvailability,
  type WorkspaceBridge,
  type WorkspaceBridgeState,
  type WorkspaceFilePosition,
  type WorkspaceFileSettings,
  type WorkspaceSource,
  WorkspaceUnavailableError,
  workspaceBridge,
} from "./workspaceBridge";

const NO_FILES: readonly never[] = Object.freeze([]);
/** The listing caches a refresh or the server's invalidation marks stale. */
const LISTING_KEYS = ["workspace-all-files", "workspace-dir"];
// As the classic Files tree: the root and the browsed folder warm for 30 seconds.
const LISTING_STALE_MS = 30_000;

/** A folder of `sessionId`'s workspace, through the query cache the Files views shared. */
export function readWorkspaceDirectory(
  queryClient: QueryClient,
  sessionId: string,
  location: string,
): Promise<readonly WorkspaceFile[]> {
  return queryClient
    .fetchQuery({
      queryKey: ["workspace-all-files", sessionId, location],
      queryFn: () => fetchWorkspaceAllFiles(sessionId, location),
      staleTime: LISTING_STALE_MS,
    })
    .then((result) => {
      if (!result.available) throw new WorkspaceUnavailableError();
      return result.data;
    });
}

export interface WorkspaceBridgeSourceOptions {
  sessionId: string | undefined;
  /** Whether the session's workspace may be read (its Files tabs are shown). */
  enabled: boolean;
  /** Whether this surface is on screen; the latest activated one is in front. */
  active: boolean;
  openFile: (path: string, position?: WorkspaceFilePosition) => void;
  /** The top-level session of the session's tree, for the Agents view; null until known. */
  rootSessionId?: string | null;
  /** Shows a session; `asSubagent` opens a sub-agent beside the chat when the setting asks for it. */
  openSession?: (sessionId: string, options: { asSubagent: boolean }) => void;
  sortOrder: ChangedSort;
  onSortOrderChange: (sort: ChangedSort) => void;
  showHidden: boolean;
  onShowHiddenChange: (showHidden: boolean) => void;
  bridge?: WorkspaceBridge;
}

export function useWorkspaceBridgeSource({
  sessionId,
  enabled,
  active,
  openFile,
  sortOrder,
  onSortOrderChange,
  showHidden,
  onShowHiddenChange,
  rootSessionId = null,
  openSession,
  bridge = workspaceBridge,
}: WorkspaceBridgeSourceOptions): WorkspaceSource | null {
  const queryClient = useQueryClient();
  const agentCostsEnabled = isFeatureEnabled(useServerInfo(), "session_overview");
  const changedQuery = useWorkspaceChangedFiles(sessionId, { enabled });
  const environmentQuery = useWorkspaceEnvironment(sessionId, { enabled });
  // The runner went offline after it was up (the session failed): a message reconnects it.
  const runnerWentOffline = useChatStore(
    (state) => state.conversationId === sessionId && state.sessionStatus === "failed",
  );
  const sandboxAsleep = useWorkspaceAsleep(sessionId);
  const sandboxWaking = useSandboxStarting(sessionId);
  const runnerOnline = useSessionRunnerOnline(sessionId);
  const hostOnline = useSessionHostOnline(sessionId);
  const status = fileListStatus(changedQuery, environmentQuery);
  const loaded = changedQuery.data?.data;
  const offline = status.isError && status.error instanceof RunnerOfflineError;

  let availability: WorkspaceAvailability = "available";
  let changedFiles: WorkspaceBridgeState["changedFiles"];
  let error: string | undefined;
  if (!enabled || sessionId === undefined) {
    changedFiles = NO_FILES;
  } else if (sandboxAsleep && loaded === undefined) {
    availability = sandboxWaking ? "sandboxStarting" : "sandboxOffline";
  } else if (status.isLoading) {
    changedFiles = undefined;
  } else if (offline) {
    // A session that has not started yet also answers offline: that is no changes yet.
    if (runnerWentOffline) availability = "agentAsleep";
    else changedFiles = NO_FILES;
  } else if (status.isError) {
    error = status.error?.message ?? "unknown error";
  } else {
    changedFiles = loaded ?? NO_FILES;
  }
  const servedFromHost = runnerOnline === false && hostOnline === true;
  const rootPath =
    !enabled || sessionId === undefined
      ? null
      : environmentQuery.data === undefined
        ? undefined
        : environmentQuery.data.available
          ? environmentQuery.data.root
          : null;
  // Listings are read on demand through the cache; say when it marked them stale.
  const [filesRevision, setFilesRevision] = useState(0);
  useEffect(() => {
    if (!sessionId) return;
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "invalidate") return;
      const [kind, id] = event.query.queryKey as unknown[];
      if (id === sessionId && LISTING_KEYS.includes(kind as string)) {
        setFilesRevision((value) => value + 1);
      }
    });
  }, [queryClient, sessionId]);

  const settings = useMemo<WorkspaceFileSettings>(
    () => ({ sortOrder, showHidden }),
    [sortOrder, showHidden],
  );
  const latest = useRef({
    openFile,
    onSortOrderChange,
    onShowHiddenChange,
    sessionId,
    openSession,
  });
  latest.current = { openFile, onSortOrderChange, onShowHiddenChange, sessionId, openSession };
  const sourceRef = useRef<WorkspaceSource | null>(null);
  // Also as state, so a surface's tasks publisher can share the source.
  const [registered, setRegistered] = useState<WorkspaceSource | null>(null);
  useEffect(() => {
    const source = bridge.createSource();
    source.setActions({
      openFile: (path, position) =>
        position ? latest.current.openFile(path, position) : latest.current.openFile(path),
      openSession: (id, options) => {
        const open = latest.current.openSession;
        if (!open) throw new Error("this workspace cannot open sessions");
        open(id, options);
      },
      queryClient,
      refreshChangedFiles: () => {
        const id = latest.current.sessionId;
        return id
          ? queryClient.invalidateQueries({ queryKey: ["workspace-changed-files", id] })
          : Promise.resolve();
      },
      readDirectory: (location) => {
        const id = latest.current.sessionId;
        if (!id) return Promise.reject(new Error("no workspace is open"));
        return readWorkspaceDirectory(queryClient, id, location);
      },
      findFiles: (query, signal) => {
        const id = latest.current.sessionId;
        if (!id) return Promise.reject(new Error("no workspace is open"));
        return fetchWorkspaceFileSearch(
          id,
          query.pattern.trim(),
          query.include.trim(),
          query.exclude.trim(),
          query.location,
          signal,
        );
      },
      refreshFiles: async () => {
        const id = latest.current.sessionId;
        if (!id) return;
        // The listings reload when the Files view reads them again (on the revision bump).
        await Promise.all([
          ...LISTING_KEYS.map((kind) =>
            queryClient.invalidateQueries({ queryKey: [kind, id], refetchType: "none" }),
          ),
          queryClient.invalidateQueries({ queryKey: ["workspace-changed-files", id] }),
        ]);
      },
      updateSettings: (patch) => {
        if (patch.sortOrder !== undefined) latest.current.onSortOrderChange(patch.sortOrder);
        if (patch.showHidden !== undefined) latest.current.onShowHiddenChange(patch.showHidden);
      },
    });
    sourceRef.current = source;
    setRegistered(source);
    return () => {
      source.dispose();
      if (sourceRef.current === source) sourceRef.current = null;
      setRegistered((current) => (current === source ? null : current));
    };
  }, [bridge, queryClient]);
  // Publishing waits for the commit, so a surface never reports a render it threw away.
  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    source.update({
      sessionId: sessionId ?? null,
      changedFiles,
      ...(error === undefined ? {} : { error }),
      availability,
      servedFromHost,
      settings,
      rootSessionId,
      agentCostsEnabled,
      rootPath,
      filesRevision,
    });
    source.setActive(active);
  });
  return registered;
}
