// What the Pull Requests tab shows for a session's pull requests, as plain pull
// request view content: the bar and its buttons, the link form, the list or the
// pull request shown, the words of each row and state, and the command each
// control runs. Pure, so it is tested without the host.
import type * as Omnigent from "omnigent";

export const LINK = "omnigent.pullRequests.link";
export const UNLINK = "omnigent.pullRequests.unlink";
export const REFRESH = "omnigent.pullRequests.refresh";

/** The view's own commands, each taking the session first. */
export const VIEW_COMMANDS = {
  select: "omnigent.pull-requests.select",
  showList: "omnigent.pull-requests.showList",
  selectSection: "omnigent.pull-requests.selectSection",
  toggleLink: "omnigent.pull-requests.toggleLink",
  openLink: "omnigent.pull-requests.openLink",
  cancelLink: "omnigent.pull-requests.cancelLink",
  submitLink: "omnigent.pull-requests.submitLink",
  unlink: "omnigent.pull-requests.unlink",
  refresh: "omnigent.pull-requests.refresh",
  /** Public: shows a pull request's section in the tab (the composer's links use it). */
  reveal: "omnigent.pull-requests.reveal",
} as const;

export type Section = "summary" | "comments" | "changes";

/** Each chat session's place in the tab and its pending actions, kept for the page. */
export interface SessionViewState {
  selected: string | undefined;
  showingDetails: boolean;
  section: Section;
  linking: boolean;
  linkPending: boolean;
  linkError: string | undefined;
  unlinkPending: boolean;
  unlinkError: string | undefined;
  refreshing: boolean;
  /** The review comment whose pull request was last opened on its changes. */
  reviewTarget: string | undefined;
  /**
   * A pull request just linked and selected, which the list may not hold yet:
   * the selection keeps it for the next two data changes, until it is listed.
   */
  linked: { url: string; changes: number } | undefined;
}

export const INITIAL_VIEW_STATE: SessionViewState = Object.freeze({
  selected: undefined,
  showingDetails: false,
  section: "summary",
  linking: false,
  linkPending: false,
  linkError: undefined,
  unlinkPending: false,
  unlinkError: undefined,
  refreshing: false,
  reviewTarget: undefined,
  linked: undefined,
});

const command = (id: string, ...args: unknown[]): Omnigent.Command => ({
  command: id,
  arguments: args,
});

/**
 * The view state after the session's data changed: the selection follows the
 * linked list, the host's choice fills an empty one, a lone pull request opens,
 * and a new review comment opens its pull request on Changes.
 */
export function followData(
  state: SessionViewState,
  data: Omnigent.SessionPullRequests,
): SessionViewState {
  let next = state;
  const prs = data.pullRequests;
  const linked = next.linked;
  if (linked) {
    const listed = prs.some((pr) => pr.url === linked.url);
    next = {
      ...next,
      linked:
        listed || linked.changes >= 2 ? undefined : { ...linked, changes: linked.changes + 1 },
    };
  }
  const keep = next.linked !== undefined && next.selected === next.linked.url;
  if (
    !keep &&
    data.listedByServer &&
    next.selected &&
    !prs.some((pr) => pr.url === next.selected)
  ) {
    next = { ...next, selected: data.selectedUrl, section: "summary" };
  } else if (!next.selected && data.selectedUrl) {
    next = { ...next, selected: data.selectedUrl, section: "summary" };
  }
  if (prs.length === 1 && !next.showingDetails) next = { ...next, showingDetails: true };
  const target = data.reviewTarget;
  if (target && target.id !== next.reviewTarget) {
    next = {
      ...next,
      reviewTarget: target.id,
      selected: target.pullRequestUrl,
      showingDetails: true,
      section: "changes",
    };
  }
  return next;
}

/** "acme/app #12", with the host when it is not the provider's default, and "(from branch)". */
export function pullRequestIdentity(pr: Omnigent.SessionPullRequest): string {
  const host = pr.host === pr.defaultHost ? "" : `${pr.host}/`;
  const inferred = pr.relationship === "inferred" ? " (from branch)" : "";
  return `${host}${pr.repository} ${pr.numberPrefix}${pr.number}${inferred}`;
}

function sandboxLabel(data: Omnigent.SessionPullRequests): string {
  if (data.sandbox === "starting") return "Sandbox starting";
  if (data.sandbox === "asleep") return "Sandbox asleep";
  return "Host offline";
}

/** What a row's trailing area says, from its own read. */
export function rowStatus(
  pr: Omnigent.SessionPullRequest,
  data: Omnigent.SessionPullRequests,
): Omnigent.PullRequestViewRow["status"] {
  const live = pr.live;
  const details = live.details;
  if (live.offline) {
    return { kind: "offline", label: sandboxLabel(data), hint: live.offlineHint ?? "" };
  }
  const checks = details?.checks;
  const checksUnavailable = !!checks?.partial || details?.checksSupported === false;
  if (rowMergeReady(pr, data) && details) {
    return checksUnavailable || !!checks?.failing || !!checks?.pending
      ? { kind: "checks", incomplete: checksUnavailable, draft: false }
      : { kind: "none" };
  }
  if (live.error !== undefined) {
    return { kind: "text", text: "Status unavailable", tooltip: live.error };
  }
  if (!details) return { kind: "text", text: live.loading ? "Loading…" : "Status unavailable" };
  if (details.state !== "OPEN") return { kind: "state", state: details.state };
  return {
    kind: "checks",
    incomplete: checksUnavailable,
    draft: details.isDraft,
    noChecks:
      !checksUnavailable && checks?.total === 0 && !details.isDraft
        ? (details.mergeable.hint ?? "")
        : undefined,
  };
}

/** Whether the row offers its merge button: an open, ready pull request the viewer may merge. */
function rowMergeReady(
  pr: Omnigent.SessionPullRequest,
  data: Omnigent.SessionPullRequests,
): boolean {
  const details = pr.live.details;
  return (
    data.canEdit &&
    pr.live.error === undefined &&
    pr.live.canMerge &&
    details?.state === "OPEN" &&
    !details.isDraft &&
    details.mergeable.ready
  );
}

function httpsHref(url: string): string | undefined {
  if (!/^https:\/\//.test(url)) return undefined;
  try {
    return new URL(url).href;
  } catch {
    return undefined;
  }
}

/** A listed pull request's row; a branch's own one cannot be unlinked. */
export function pullRequestRow(
  pr: Omnigent.SessionPullRequest,
  data: Omnigent.SessionPullRequests,
  state: SessionViewState,
  options: { unlinkable: boolean },
): Omnigent.PullRequestViewRow {
  const sessionId = data.sessionId;
  const title = (pr.live.details?.title ?? pr.title)?.trim() || undefined;
  const live = pr.live;
  const href = httpsHref(pr.url);
  return {
    pullRequest: pr,
    identity: pullRequestIdentity(pr),
    title,
    command: command(VIEW_COMMANDS.select, sessionId, pr.url),
    status: rowStatus(pr, data),
    merge: live.cached
      ? {
          trigger: rowMergeReady(pr, data),
          unavailable: live.offline || live.error !== undefined || !data.canEdit || !live.canMerge,
        }
      : undefined,
    unlink:
      options.unlinkable && data.canEdit
        ? {
            command: command(VIEW_COMMANDS.unlink, sessionId, pr.url),
            disabled: state.unlinkPending,
          }
        : undefined,
    openUrl: href ? { url: href, label: `Open in ${pr.providerLabel}` } : undefined,
  };
}

function linkNeedsHostMessage(data: Omnigent.SessionPullRequests): string {
  if (data.sandbox === "starting") {
    return "Starting the session’s sandbox. You can link a PR once it’s back online.";
  }
  if (data.sandbox === "asleep")
    return "To link a PR, send a message to start the session’s sandbox.";
  return "To link a PR, please reconnect the session’s host.";
}

/** The view's content for the session's pull requests and its place in the tab. */
export function pullRequestsContent(
  data: Omnigent.SessionPullRequests | undefined,
  state: SessionViewState,
): Omnigent.PullRequestViewContent {
  if (!data) return { kind: "loading" };
  const sessionId = data.sessionId;
  const prs = data.pullRequests;
  const tracking = data.trackingAvailable;
  const linkInEmptyState = prs.length === 0 && data.listStatus === "no-pr";
  const showTrackingControls = tracking && !linkInEmptyState;
  const selectedPr = prs.find((pr) => pr.url === (state.selected ?? data.selectedUrl));
  const refresh = {
    title: "Refresh",
    icon: "refresh-cw",
    command: command(VIEW_COMMANDS.refresh, sessionId),
    disabled: state.refreshing,
    busy: state.refreshing,
  };
  const linkAction = {
    title: data.linkNeedsHost ? "Link a PR (needs the host online)" : "Link a PR",
    icon: "plus",
    command: command(VIEW_COMMANDS.toggleLink, sessionId),
    disabled: data.linkNeedsHost,
  };
  const actionsFor = (showingDetails: boolean): Omnigent.PullRequestViewAction[] => [
    refresh,
    ...(showTrackingControls ? [linkAction] : []),
    ...(showTrackingControls && selectedPr && showingDetails
      ? [
          {
            title: "Unlink PR",
            icon: "trash-2",
            command: command(VIEW_COMMANDS.unlink, sessionId, selectedPr.url),
            disabled: state.unlinkPending,
          },
        ]
      : []),
  ];
  const refreshCommand = {
    busy: state.refreshing,
    command: command(VIEW_COMMANDS.refresh, sessionId),
  };
  const emptyState = (): Extract<
    Omnigent.PullRequestViewBody,
    { kind: "details" }
  >["emptyState"] => {
    if (tracking && linkInEmptyState) {
      return data.linkNeedsHost
        ? { kind: "message", text: linkNeedsHostMessage(data) }
        : { kind: "link", command: command(VIEW_COMMANDS.openLink, sessionId) };
    }
    if (tracking && state.selected && data.status !== "loading" && !data.hasDetails) {
      const label = selectedPr?.providerLabel ?? data.listProviderLabel;
      return { kind: "open", url: state.selected, label: `Open the PR on ${label}` };
    }
    return undefined;
  };
  const details = (): Omnigent.PullRequestViewBody => ({
    kind: "details",
    url: state.selected,
    branchHidden: data.listedByServer && prs.length === 0,
    section: state.section,
    selectSection: command(VIEW_COMMANDS.selectSection, sessionId),
    stored: data.linkNeedsHost ? selectedPr : undefined,
    notSynced: data.notSynced && !selectedPr,
    refresh: showTrackingControls ? undefined : refreshCommand,
    emptyState: emptyState(),
  });
  const rows = (listed: readonly Omnigent.SessionPullRequest[], branch: boolean) =>
    listed.map((pr) => pullRequestRow(pr, data, state, { unlinkable: tracking && !branch }));

  // The rail: a list of several, or the one selected.
  const showsList = prs.length > 1 && !state.showingDetails;
  const bar: Omnigent.PullRequestViewBar | undefined = showTrackingControls
    ? { kind: "toolbar", showTitle: !state.showingDetails || prs.length <= 1 }
    : data.status !== "ready"
      ? { kind: "refresh", ...refreshCommand }
      : undefined;
  // A page that opens each pull request on its own: always the list, the branch's too.
  const branch = prs.length === 0 ? data.branchPullRequest : undefined;
  const pageListed = branch ? [branch] : prs;
  const pageShowsList = pageListed.length > 0;
  const pageBar: Omnigent.PullRequestViewBar | undefined = showTrackingControls
    ? { kind: "toolbar", showTitle: true }
    : data.status !== "ready" || pageShowsList
      ? { kind: "refresh", ...refreshCommand }
      : undefined;
  const warnings = data.warnings.join(" ");
  return {
    kind: "pullRequests",
    sessionId,
    selectedUrl: state.selected,
    actions: actionsFor(state.showingDetails),
    back:
      state.showingDetails && prs.length > 1
        ? {
            title: `All pull requests (${prs.length})`,
            command: command(VIEW_COMMANDS.showList, sessionId),
          }
        : undefined,
    bar,
    linkForm: tracking
      ? {
          open: state.linking,
          placeholder: data.linkPlaceholder,
          disabled: data.linkNeedsHost,
          pending: state.linkPending,
          error: state.linkError,
          submit: command(VIEW_COMMANDS.submitLink, sessionId),
          cancel: command(VIEW_COMMANDS.cancelLink, sessionId),
        }
      : undefined,
    alert: state.unlinkError === undefined ? undefined : `Couldn’t unlink: ${state.unlinkError}`,
    note: warnings ? warnings : undefined,
    body: showsList ? { kind: "list", rows: rows(prs, false) } : details(),
    page: {
      actions: actionsFor(false),
      bar: pageBar,
      body: pageShowsList ? { kind: "list", rows: rows(pageListed, !!branch) } : details(),
    },
  };
}
