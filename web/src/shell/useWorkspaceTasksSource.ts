// Publishes a workspace surface's session tasks to the workspace bridge, as plain
// data for the extension API (`sessions.activeSessionTasks`), with the actions the
// Tasks commands take. The journal loads only while something watches the tasks
// (the Tasks view on screen), as the classic tab loaded it only while it showed.

import type * as omnigent from "omnigent";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useConversationEntryValue } from "@/hooks/useConversationEntryState";
import { usePlanStopping } from "@/hooks/usePlanStopping";
import { type SavedWorkflow, useSavedWorkflows } from "@/hooks/useSavedWorkflows";
import { type SessionTasksView, useSessionTasks } from "@/hooks/useSessionTasks";
import { pendingWorkflowQuestions } from "@/lib/blocks";
import { useServerInfo } from "@/lib/CapabilitiesContext";
import { isFeatureEnabled } from "@/lib/capabilities";
import { messageDeepLinkParams } from "@/lib/messageDeepLink";
import { useLocation, useNavigate } from "@/lib/routing";
import {
  failedUpstream,
  isPlanComplete,
  isRestart,
  type JournalEntry,
  planGraphRevision,
  planName,
  planWorkflowId,
  statusOf,
  textOf,
} from "@/lib/sessionJournal";
import { readTaskActivity, taskMarkerId, taskMarkerTarget } from "@/lib/taskActivity";
import { useSessionTasksActions } from "@/store/sessionTasksActions";
import { type WorkspaceBridge, type WorkspaceSource, workspaceBridge } from "./workspaceBridge";

const NO_ENTRIES: JournalEntry[] = [];

export interface WorkspaceTasksSourceOptions {
  /** The surface's workspace source, from `useWorkspaceBridgeSource`; null until registered. */
  source: WorkspaceSource | null;
  bridge?: WorkspaceBridge;
  sessionId: string | undefined;
  /** Whether this surface is on screen. */
  active: boolean;
  /** Runs before a task's click scrolls the chat or a workflow starts, e.g. to close a drawer. */
  onLeave?: () => void;
}

/** What the composer offers for the session's tasks. */
function actionsOf(sessionId: string | undefined): omnigent.SessionTaskActions {
  const state = useSessionTasksActions.getState();
  const has = (record: Readonly<Partial<Record<string, unknown>>>) =>
    sessionId !== undefined && record[sessionId] !== undefined;
  return {
    startWorkflow: has(state.startWorkflow),
    saveWorkflow: has(state.saveWorkflow),
    continuePlan: has(state.continuePlan),
    stopWork: has(state.stopWork),
    taskAction: has(state.taskAction),
  };
}

function statusEntry(
  entry: JournalEntry,
  earlier: readonly JournalEntry[],
): omnigent.TaskStatus | null {
  const status = statusOf(entry);
  if (!status) return null;
  return {
    id: entry.id,
    status,
    text: textOf(entry),
    createdAt: entry.created_at,
    restart: isRestart(entry, earlier),
  };
}

/**
 * The plain snapshot of a session's tasks. Pure, so the API's data is the same
 * the classic tab drew.
 */
export function sessionTasksSnapshot(
  sessionId: string,
  tasks: SessionTasksView,
  extra: {
    stopping: boolean;
    actions: omnigent.SessionTaskActions;
    /** Pending workflow questions, as `[step ID, elicitation ID]`. */
    questions: readonly (readonly [string, string])[];
    /** The chat's markers of the agent's own tasks. */
    nativeMarkerIds: ReadonlySet<string>;
    workflowName: (workflowId: string) => string | undefined;
    workflowsLinked: boolean;
  },
): omnigent.SessionTasks {
  const { journal, plan, progress } = tasks;
  const entries = tasks.journalSupported ? journal.entries : NO_ENTRIES;
  const workflowId = planWorkflowId(entries);
  const questions = new Map(extra.questions);
  const blocked = failedUpstream(progress);
  const statuses = entries.filter((entry) => entry.kind === "status" && statusOf(entry) !== null);
  return {
    sessionId,
    loading: tasks.loading,
    error: journal.error ? journal.error.message : undefined,
    plan: plan
      ? {
          name: planName(plan),
          createdAt: plan.created_at,
          workflowId,
          workflowName: workflowId === null ? undefined : extra.workflowName(workflowId),
          complete: isPlanComplete(progress, planGraphRevision(entries)),
        }
      : undefined,
    tasks: progress.map((item): omnigent.SessionTask => {
      const target = taskMarkerTarget(item);
      // An item of the agent's own list has a marker only once the chat shows it.
      const chatMarker =
        target && (!item.native || extra.nativeMarkerIds.has(target)) ? target : undefined;
      const history = item.native
        ? []
        : statuses.flatMap((entry, index) => {
            if (entry.step !== item.step.id) return [];
            const status = statusEntry(entry, statuses.slice(0, index));
            return status ? [status] : [];
          });
      return {
        id: item.step.id,
        name: item.step.name,
        goal: item.step.goal,
        dependsOn: [...item.step.depends_on],
        state: item.state,
        status: item.status
          ? statusEntry(item.status, entries.slice(0, entries.indexOf(item.status)))
          : null,
        startedAt: item.startedAt,
        native: item.native,
        activeForm: item.activeForm,
        history,
        chatMarker,
        question: item.state === "needs_input" ? questions.get(item.step.id) : undefined,
        blockedBy: blocked.get(item.step.id) ?? [],
      };
    }),
    paused: tasks.paused ?? undefined,
    working: tasks.sessionWorking,
    stopping: extra.stopping,
    actions: extra.actions,
    workflowsLinked: extra.workflowsLinked,
  };
}

/** Publishes the session's tasks and their actions on `source`. */
export function useWorkspaceTasksSource({
  source,
  bridge = workspaceBridge,
  sessionId,
  active,
  onLeave,
}: WorkspaceTasksSourceOptions): void {
  const watched = useSyncExternalStore(bridge.subscribeTasksWatch, bridge.tasksWatched);
  const live = active && watched && sessionId !== undefined;
  const liveId = live ? sessionId : undefined;
  const tasks = useSessionTasks(liveId, live);
  const stopping = usePlanStopping(liveId ?? null, tasks.sessionWorking);
  // Re-read on every change to the composer's registrations.
  const actionsKey = useSessionTasksActions((state) =>
    JSON.stringify(
      liveId === undefined
        ? null
        : [
            state.startWorkflow[liveId] !== undefined,
            state.saveWorkflow[liveId] !== undefined,
            state.continuePlan[liveId] !== undefined,
            state.stopWork[liveId] !== undefined,
            state.taskAction[liveId] !== undefined,
          ],
    ),
  );
  const questionsJson = useConversationEntryValue(liveId ?? null, (state) =>
    JSON.stringify(pendingWorkflowQuestions(state.blocks, liveId ?? null)),
  );
  const nativeMarkersJson = useConversationEntryValue(liveId ?? null, (state) =>
    JSON.stringify(
      state.blocks.flatMap((block) => {
        const activity = block.type === "native_tool" ? readTaskActivity(block.data) : null;
        return activity?.kind === "task" && activity.native ? [taskMarkerId(activity)] : [];
      }),
    ),
  );
  const serverInfo = useServerInfo();
  const workflowsLinked = isFeatureEnabled(serverInfo, "workflows");
  const entries = tasks.journalSupported ? tasks.journal.entries : NO_ENTRIES;
  const workflowId = planWorkflowId(entries);
  // The workflow's name for its chip, loaded only for a plan that has one, as the chip did.
  const { workflows: ownWorkflows } = useSavedWorkflows({ enabled: live && workflowId !== null });
  // What Run a workflow listed (it loads them), to start the one picked.
  const { workflows: runnable } = useSavedWorkflows({ enabled: false, includeShared: true });

  const snapshotKey =
    liveId === undefined
      ? JSON.stringify([sessionId ?? null])
      : JSON.stringify([
          liveId,
          tasks.loading,
          tasks.journal.error?.message ?? null,
          entries,
          tasks.progress,
          tasks.paused,
          tasks.sessionWorking,
          stopping,
          actionsKey,
          questionsJson,
          nativeMarkersJson,
          workflowsLinked,
          workflowId === null
            ? null
            : (ownWorkflows.find((workflow) => workflow.id === workflowId)?.name ?? null),
        ]);
  const latestRef = useRef({ tasks, stopping, ownWorkflows, workflowsLinked });
  const lastLiveRef = useRef<omnigent.SessionTasks | undefined>(undefined);
  latestRef.current = { tasks, stopping, ownWorkflows, workflowsLinked };
  const snapshot = useMemo((): omnigent.SessionTasks | undefined => {
    if (sessionId === undefined) return undefined;
    const latest = latestRef.current;
    if (liveId === undefined) {
      // Not watched (the view hidden): the last tasks stay, so showing it again shows them at once.
      const previous = lastLiveRef.current;
      if (previous?.sessionId === sessionId) return previous;
      // Nothing is loaded for this session, so nothing is known yet.
      return {
        sessionId,
        loading: true,
        error: undefined,
        plan: undefined,
        tasks: [],
        paused: undefined,
        working: false,
        stopping: false,
        actions: actionsOf(undefined),
        workflowsLinked: latest.workflowsLinked,
      };
    }
    lastLiveRef.current = sessionTasksSnapshot(liveId, latest.tasks, {
      stopping: latest.stopping,
      actions: actionsOf(liveId),
      questions: JSON.parse(questionsJson) as [string, string][],
      nativeMarkerIds: new Set(JSON.parse(nativeMarkersJson) as string[]),
      workflowName: (id) => latest.ownWorkflows.find((workflow) => workflow.id === id)?.name,
      workflowsLinked: latest.workflowsLinked,
    });
    return lastLiveRef.current;
    // The key covers everything the snapshot reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotKey]);

  const location = useLocation();
  const navigate = useNavigate();
  const latest = useRef({ sessionId, onLeave, location, navigate, tasks, runnable });
  latest.current = { sessionId, onLeave, location, navigate, tasks, runnable };
  useEffect(() => {
    if (!source) return;
    const sessionAction = <Key extends "saveWorkflow" | "continuePlan" | "stopWork" | "taskAction">(
      key: Key,
    ) => {
      const id = latest.current.sessionId;
      const action = id === undefined ? undefined : useSessionTasksActions.getState()[key][id];
      if (!action) throw new Error("the composer does not offer this action now");
      return action as NonNullable<ReturnType<typeof useSessionTasksActions.getState>[Key][string]>;
    };
    source.setTasksActions({
      showInChat: (markerId) => {
        const { sessionId: id, location: at, navigate: go, onLeave: leave } = latest.current;
        if (id === undefined) throw new Error("no session is open");
        leave?.();
        const pathname = `/c/${encodeURIComponent(id)}`;
        const search = messageDeepLinkParams(new URLSearchParams(at.search), markerId);
        go(`${pathname}?${search}`, { replace: at.pathname === pathname });
      },
      startWorkflow: ({ description, workflowId: picked }) => {
        const id = latest.current.sessionId;
        const start =
          id === undefined ? undefined : useSessionTasksActions.getState().startWorkflow[id];
        if (!start) throw new Error("the composer does not offer workflows now");
        let workflow: SavedWorkflow | undefined;
        if (picked !== undefined) {
          workflow = latest.current.runnable.find((candidate) => candidate.id === picked);
          if (!workflow) throw new Error(`unknown workflow ${picked}`);
        }
        latest.current.onLeave?.();
        if (workflow) start(description ?? "", workflow);
        else if (description === undefined) start();
        else start(description);
      },
      saveWorkflow: (name) => sessionAction("saveWorkflow")(name),
      continuePlan: (name) => sessionAction("continuePlan")(name),
      stopWork: () => sessionAction("stopWork")(),
      taskAction: (action, taskName) => sessionAction("taskAction")(action, taskName),
      reload: () => latest.current.tasks.journal.retry(),
      openWorkflow: (id) => latest.current.navigate(`/workflows/${encodeURIComponent(id)}`),
    });
    return () => source.setTasksActions(null);
  }, [source]);
  // Publishing waits for the commit, as the workspace state does.
  useEffect(() => {
    source?.updateTasks(snapshot);
  }, [source, snapshot]);
  // A surface that goes away takes its tasks with it.
  useEffect(() => () => source?.updateTasks(undefined), [source]);
}

/** Renders nothing; publishes a surface's tasks, so their updates re-render only this. */
export function WorkspaceTasksPublisher(props: WorkspaceTasksSourceOptions): null {
  useWorkspaceTasksSource(props);
  return null;
}
