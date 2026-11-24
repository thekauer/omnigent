// Registers a workspace surface (the shell's session or a grid cell) with the
// workspace bridge, so extension views read what that surface would show: its
// changed files, why they cannot load, and its file settings.

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSessionHostOnline, useSessionRunnerOnline } from "@/hooks/RunnerHealthProvider";
import { useSandboxStarting } from "@/hooks/useSessionReconnect";
import {
  RunnerOfflineError,
  useWorkspaceAsleep,
  useWorkspaceChangedFiles,
  useWorkspaceEnvironment,
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
  workspaceBridge,
} from "./workspaceBridge";

const NO_FILES: readonly never[] = Object.freeze([]);

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
    });
    source.setActive(active);
  });
  return registered;
}
