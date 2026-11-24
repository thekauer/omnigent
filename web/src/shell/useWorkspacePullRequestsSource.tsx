// Publishes a workspace surface's pull requests to the workspace bridge, as plain
// data for the extension API (`pullRequests.activeSessionPullRequests`), with the
// actions the `omnigent.pullRequests.*` commands take. They are read and polled
// only while a view watches them (the Pull Requests tab on screen), at the pace
// the classic tab used: the pull request in focus, and each listed one while
// the list shows.

import type * as omnigent from "omnigent";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useCanEdit } from "@/hooks/usePermissions";
import {
  normalizePullRequestInfo,
  type PullRequest,
  type PullRequestAssociation,
  type PullRequestInfo,
  postPullRequestComment,
  useMergePullRequest,
  usePullRequestInfo,
  usePullRequestReadPriority,
  useUpdatePullRequestLabels,
  useUpdatePullRequestReviewers,
  useUpdateSessionPr,
} from "@/hooks/usePullRequests";
import {
  sessionPullRequestsKey,
  type StoredPullRequests,
  storedListToShow,
  storesSessionPullRequests,
  useSessionPullRequests,
  useUnlinkSessionPr,
} from "@/hooks/useSessionPullRequests";
import { useSandboxStarting } from "@/hooks/useSessionReconnect";
import { RunnerOfflineError, useWorkspaceAsleep } from "@/hooks/useWorkspaceChangedFiles";
import { useServerInfo } from "@/lib/CapabilitiesContext";
import { type GitProviderDisplay, gitProviderCopy } from "@/lib/gitProviders";
import { useLocalReviewNavigation } from "@/lib/localReviewContext";
import { mergeButtonState } from "./PullRequestMerge";
import {
  derivePullRequestPanelState,
  refreshSessionPullRequests,
  storedPullRequestHint,
  useHostOffline,
} from "./PullRequestPanelDetails";
import {
  type WorkspaceBridge,
  type WorkspacePullRequestsWatch,
  type WorkspaceSource,
  workspaceBridge,
} from "./workspaceBridge";

type Associations = Pick<
  PullRequestInfo,
  "prs" | "tracking_available" | "selected_pr_url" | "provider" | "provider_display"
>;

type InfoQuery = ReturnType<typeof usePullRequestInfo>;

/** What a listed pull request's own read says, as its row draws it. */
export interface PullRequestRowRead {
  isLoading: boolean;
  error: unknown;
  data: PullRequestInfo | undefined;
}

export interface WorkspacePullRequestsSourceOptions {
  source: WorkspaceSource | null;
  bridge?: WorkspaceBridge;
  sessionId: string | undefined;
  /** Whether this surface is on screen. */
  active: boolean;
}

function displayOf(
  display: GitProviderDisplay | null | undefined,
): omnigent.GitProviderDisplay | undefined {
  return display
    ? {
        id: display.id,
        displayName: display.display_name,
        requestName: display.request_name,
        numberPrefix: display.number_prefix,
      }
    : undefined;
}

/** A pull request's details as plain data. */
export function pullRequestDetailsOf(pr: PullRequest): omnigent.PullRequestDetails {
  const merge = mergeButtonState(pr);
  return {
    url: pr.url,
    number: pr.number,
    title: pr.title,
    state: pr.state,
    isDraft: pr.is_draft,
    author: pr.author,
    baseRef: pr.base_ref,
    headRef: pr.head_ref,
    headSha: pr.head_sha,
    checks: {
      passing: pr.checks.passing,
      failing: pr.checks.failing,
      pending: pr.checks.pending,
      cancelled: pr.checks.cancelled ?? 0,
      skipped: pr.checks.skipped ?? 0,
      total: pr.checks.total,
      runs: pr.checks.runs.map((run) => ({ name: run.name, bucket: run.bucket, url: run.url })),
      partial: pr.checks.partial === true,
    },
    checksSupported: pr.checks_supported !== false,
    reviewers: pr.reviewers?.map(({ login, kind, state }) => ({ login, kind, state })),
    labels: pr.labels?.map(({ name, color }) => ({ name, color })),
    mergeStateStatus: pr.merge_state_status,
    commentCount: pr.comments?.length ?? 0,
    mergeable: { ready: merge.kind === "ready", hint: "hint" in merge ? merge.hint : undefined },
  };
}

/** One listed pull request as plain data, with its own read when the list shows. */
export function sessionPullRequestOf(
  association: PullRequestAssociation,
  context: {
    hostOffline: boolean;
    sandboxAsleep: boolean;
    sandboxStarting: boolean;
    row: PullRequestRowRead | undefined;
  },
): omnigent.SessionPullRequest {
  const copy = gitProviderCopy(association.provider, undefined, association.provider_display);
  const row = context.row;
  const data = row?.data ? normalizePullRequestInfo(row.data) : undefined;
  const offline = context.hostOffline || row?.error instanceof RunnerOfflineError;
  const cachedPr = data?.pr?.url === association.url ? data.pr : undefined;
  const pr = !offline ? cachedPr : undefined;
  return {
    url: association.url,
    host: association.host,
    repository: association.repository,
    number: association.number,
    title: association.title ?? null,
    relationship: association.relationship,
    provider: association.provider,
    providerDisplay: displayOf(association.provider_display),
    providerLabel: copy.label,
    numberPrefix: copy.prNumberPrefix,
    defaultHost: copy.defaultHost,
    state: association.state ?? null,
    isDraft: association.is_draft === true,
    stateCheckedAt: association.state_checked_at ?? null,
    live: {
      loading: row?.isLoading ?? false,
      error: row?.error ? String(row.error) : undefined,
      offline,
      offlineHint: offline
        ? storedPullRequestHint(association, context.sandboxAsleep, context.sandboxStarting)
        : undefined,
      details: pr ? pullRequestDetailsOf(pr) : undefined,
      cached: cachedPr !== undefined,
      canMerge: data?.capabilities.merging === true,
    },
  };
}

/** A stored pull request back in the host's shape, for the details it draws offline. */
export function associationOf(pullRequest: omnigent.SessionPullRequest): PullRequestAssociation {
  const display = pullRequest.providerDisplay;
  return {
    url: pullRequest.url,
    host: pullRequest.host,
    repository: pullRequest.repository,
    number: pullRequest.number,
    title: pullRequest.title,
    relationship: pullRequest.relationship,
    ...(pullRequest.provider === undefined ? {} : { provider: pullRequest.provider }),
    ...(display
      ? {
          provider_display: {
            id: display.id,
            display_name: display.displayName,
            request_name: display.requestName,
            number_prefix: display.numberPrefix,
          },
        }
      : {}),
    state: pullRequest.state,
    is_draft: pullRequest.isDraft,
    state_checked_at: pullRequest.stateCheckedAt,
  };
}

/** Reads one listed pull request at the list's pace, reporting what it read. */
function PullRequestRowObserver({
  sessionId,
  url,
  poll,
  onRead,
}: {
  sessionId: string;
  url: string;
  poll: boolean;
  onRead: (url: string, read: PullRequestRowRead) => void;
}): null {
  const info = usePullRequestInfo(sessionId, { poll: poll ? "list" : false, prUrl: url });
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const { isLoading, error, data } = info;
  useEffect(() => {
    onReadRef.current(url, { isLoading, error, data });
  }, [url, isLoading, error, data]);
  return null;
}

function promiseOf<TData, TVariables>(
  mutation: {
    mutate: (
      variables: TVariables,
      options?: { onSuccess?: (data: TData) => void; onError?: (error: Error) => void },
    ) => void;
  },
  variables: TVariables,
): Promise<TData> {
  return new Promise((resolve, reject) => {
    mutation.mutate(variables, { onSuccess: resolve, onError: reject });
  });
}

/**
 * Publishes the session's pull requests and their actions on `source` while a
 * view watches them; otherwise the last read stays published and nothing is read.
 */
export function WorkspacePullRequestsPublisher({
  source,
  bridge = workspaceBridge,
  sessionId,
  active,
}: WorkspacePullRequestsSourceOptions) {
  const watch = useSyncExternalStore(bridge.subscribePullRequestsWatch, bridge.pullRequestsWatch);
  const live = active && watch.watchers > 0 && sessionId !== undefined;
  // A surface that goes away takes its pull requests with it.
  useEffect(() => () => source?.updatePullRequests(undefined), [source]);
  return live && source ? (
    <LivePullRequestsPublisher source={source} sessionId={sessionId} watch={watch} />
  ) : null;
}

/** Reads, polls and publishes the session's pull requests, with their actions. */
function LivePullRequestsPublisher({
  source,
  sessionId,
  watch,
}: {
  source: WorkspaceSource;
  sessionId: string;
  watch: WorkspacePullRequestsWatch;
}) {
  // Polled while a view has them on screen; a hidden drawn view only reads them.
  const polling = watch.polling;
  const focus = watch.focus?.sessionId === sessionId ? watch.focus : undefined;
  const selected = focus?.url;
  const showingDetails = focus?.details ?? false;
  const queryClient = useQueryClient();
  const info: InfoQuery = usePullRequestInfo(sessionId, {
    poll: polling ? (selected && !showingDetails ? "list" : true) : false,
    prUrl: selected,
  });
  usePullRequestReadPriority(sessionId, polling && showingDetails ? selected : undefined);
  // Re-enabling the poll only restarts its timer; refresh stale info as the tab shows again.
  const wasPolling = useRef(polling);
  useEffect(() => {
    if (polling && !wasPolling.current) {
      void queryClient.refetchQueries({ queryKey: ["github-info", sessionId], stale: true });
    }
    wasPolling.current = polling;
  }, [polling, sessionId, queryClient]);
  const storesPrs = storesSessionPullRequests(useServerInfo());
  const stored = useSessionPullRequests(sessionId, info.data);
  const hostOffline = useHostOffline(sessionId, info);
  const sandboxAsleep = useWorkspaceAsleep(sessionId);
  const sandboxStarting = useSandboxStarting(sessionId);
  const canEdit = useCanEdit(sessionId);
  const reviewTarget = useLocalReviewNavigation(sessionId);
  const [knownAssociations, setKnownAssociations] = useState<{
    sessionId: string;
    data: Associations;
  }>();
  useEffect(() => {
    if (info.data) {
      const { prs, tracking_available, selected_pr_url, provider, provider_display } = info.data;
      setKnownAssociations({
        sessionId,
        data: { prs, tracking_available, selected_pr_url, provider, provider_display },
      });
    }
  }, [sessionId, info.data]);
  // Switching the read of the pull request in focus must not drop the session's list.
  const liveAssociations =
    info.data ??
    (knownAssociations && knownAssociations.sessionId === sessionId
      ? knownAssociations.data
      : undefined);
  // A host that doesn't track PRs shows only its branch PR.
  const linked =
    storesPrs && (!liveAssociations || liveAssociations.tracking_available === true)
      ? storedListToShow(stored.data, liveAssociations !== undefined)
      : undefined;
  const associations: Associations | undefined =
    linked === undefined
      ? liveAssociations
      : {
          prs: linked,
          tracking_available: liveAssociations?.tracking_available ?? true,
          selected_pr_url: linked.some((pr) => pr.url === liveAssociations?.selected_pr_url)
            ? liveAssociations?.selected_pr_url
            : linked[0]?.url,
          provider: liveAssociations?.provider ?? linked[0]?.provider,
          provider_display: liveAssociations?.provider_display ?? linked[0]?.provider_display,
        };
  const notSynced = storesPrs && hostOffline && stored.data?.synced === false;
  const status = derivePullRequestPanelState(info).kind;
  const branchHidden = linked?.length === 0 && info.data !== undefined;
  const detailsInfo = branchHidden
    ? { ...info, data: { ...info.data!, pr: null, selected_pr_url: undefined } }
    : info;
  const listStatus = derivePullRequestPanelState(detailsInfo).kind;
  const copy = gitProviderCopy(
    associations && status !== "not-a-git-repo" ? associations.provider : null,
    undefined,
    associations?.provider_display,
  );
  const listCopy = gitProviderCopy(
    associations?.provider,
    undefined,
    associations?.provider_display,
  );
  const prs = useMemo(
    () =>
      (associations?.prs ?? []).map((pr) => ({
        ...pr,
        provider: pr.provider ?? associations?.provider ?? undefined,
        provider_display: pr.provider_display ?? associations?.provider_display ?? undefined,
      })),
    [associations?.prs, associations?.provider, associations?.provider_display],
  );
  const branchPr = prs.length === 0 ? detailsInfo.data?.pr : undefined;
  const branchAssociation: PullRequestAssociation | undefined =
    branchPr && detailsInfo.data
      ? {
          url: branchPr.url,
          host: (() => {
            try {
              return new URL(branchPr.url).host;
            } catch {
              return "";
            }
          })(),
          repository: detailsInfo.data.repo?.name_with_owner ?? "",
          number: branchPr.number,
          title: branchPr.title,
          relationship: "inferred",
          state: branchPr.state,
          is_draft: branchPr.is_draft,
        }
      : undefined;
  // Each listed pull request reads itself while the list shows, as its row did.
  const observeRows = !showingDetails;
  const observed = observeRows
    ? [...prs.map((pr) => pr.url), ...(branchAssociation ? [branchAssociation.url] : [])]
    : [];
  const [rowReads, setRowReads] = useState<ReadonlyMap<string, PullRequestRowRead>>(new Map());
  const onRowRead = useMemo(
    () => (url: string, read: PullRequestRowRead) =>
      setRowReads((current) => {
        const previous = current.get(url);
        if (
          previous &&
          previous.isLoading === read.isLoading &&
          previous.error === read.error &&
          previous.data === read.data
        ) {
          return current;
        }
        const next = new Map(current);
        next.set(url, read);
        return next;
      }),
    [],
  );

  const snapshot = ((): omnigent.SessionPullRequests => {
    const rowContext = (url: string) => ({
      hostOffline,
      sandboxAsleep,
      sandboxStarting,
      row: observeRows ? rowReads.get(url) : undefined,
    });
    const warnings = [...(info.data?.warnings ?? []), ...(info.data?.discovery_warnings ?? [])];
    const anchorUrl = reviewTarget?.anchor_metadata?.pr_url;
    return {
      sessionId,
      status,
      listStatus,
      provider: associations?.provider,
      providerDisplay: displayOf(associations?.provider_display),
      providerLabel: copy.label,
      linkPlaceholder: copy.prUrlPlaceholder,
      listProviderLabel: listCopy.label,
      trackingAvailable: associations?.tracking_available === true,
      hostOffline,
      linkNeedsHost: storesPrs && hostOffline,
      sandbox: sandboxAsleep ? (sandboxStarting ? "starting" : "asleep") : "awake",
      notSynced,
      canEdit,
      pullRequests: prs.map((pr) => sessionPullRequestOf(pr, rowContext(pr.url))),
      branchPullRequest: branchAssociation
        ? sessionPullRequestOf(branchAssociation, rowContext(branchAssociation.url))
        : undefined,
      selectedUrl: associations?.selected_pr_url,
      listedByServer: linked !== undefined,
      hasDetails: !!info.data?.pr,
      warnings,
      reviewTarget:
        reviewTarget && anchorUrl ? { id: reviewTarget.id, pullRequestUrl: anchorUrl } : undefined,
    };
  })();
  const snapshotKey = JSON.stringify(snapshot ?? null);
  // A new object only when something changed, so the bridge publishes only then.
  const published = useMemo(() => snapshot, [snapshotKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useUpdateSessionPr(sessionId);
  const unlink = useUnlinkSessionPr(sessionId);
  const merge = useMergePullRequest(sessionId);
  const labels = useUpdatePullRequestLabels(sessionId);
  const reviewers = useUpdatePullRequestReviewers(sessionId);
  const latest = useRef({
    sessionId,
    storesPrs,
    update,
    unlink,
    merge,
    labels,
    reviewers,
    queryClient,
  });
  latest.current = { sessionId, storesPrs, update, unlink, merge, labels, reviewers, queryClient };
  useEffect(() => {
    const sessionOf = () => {
      const id = latest.current.sessionId;
      if (id === undefined) throw new Error("no session is open");
      return id;
    };
    source.setPullRequestsActions({
      link: async (url) => {
        const id = sessionOf();
        const { update: link, storesPrs: stores, queryClient: client } = latest.current;
        const data = await promiseOf<PullRequestInfo, { url: string; action: "attach" }>(link, {
          url,
          action: "attach",
        });
        if (stores && data.prs) {
          const key = sessionPullRequestsKey(id);
          await client.cancelQueries({ queryKey: key });
          client.setQueryData<StoredPullRequests>(key, (previous) => ({
            prs: data.prs!.map((pr) => ({
              ...previous?.prs.find((storedPr) => storedPr.url === pr.url),
              ...pr,
            })),
            synced: previous?.synced ?? false,
          }));
        }
        return { selectedUrl: data.selected_pr_url };
      },
      unlink: async (url) => {
        sessionOf();
        const { prs: remaining } = await promiseOf<{ prs: PullRequestAssociation[] }, string>(
          latest.current.unlink,
          url,
        );
        return { remaining: remaining.map((pr) => pr.url) };
      },
      refresh: async () => {
        await refreshSessionPullRequests(latest.current.queryClient, sessionOf());
      },
      merge: async (url, request) => {
        sessionOf();
        await promiseOf(latest.current.merge, {
          prUrl: url,
          mergeMethod: request.method,
          expectedHead: request.expectedHead,
          ...(request.account === undefined ? {} : { account: request.account }),
        });
      },
      updateLabels: async (url, change) => {
        sessionOf();
        await promiseOf(latest.current.labels, {
          prUrl: url,
          add: change.add.map((name) => ({ name, color: null, description: null })),
          remove: change.remove.map((name) => ({ name, color: null, description: null })),
        });
      },
      updateReviewers: async (url, change) => {
        sessionOf();
        await promiseOf(latest.current.reviewers, { prUrl: url, ...change });
      },
      postComment: async (url, body) => {
        const id = sessionOf();
        await postPullRequestComment(id, url, body);
        await latest.current.queryClient.invalidateQueries({ queryKey: ["github-info", id] });
      },
    });
    return () => source.setPullRequestsActions(null);
  }, [source]);
  // Publishing waits for the commit, as the workspace state does.
  useEffect(() => {
    source.updatePullRequests(published);
  }, [source, published]);

  return observed.map((url) => (
    <PullRequestRowObserver
      key={url}
      sessionId={sessionId}
      url={url}
      poll={polling}
      onRead={onRowRead}
    />
  ));
}
