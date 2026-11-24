// The pure logic of the Pull Requests tab: how the selection follows the data, the
// row labels and statuses, and the content for each state, as the classic panel
// decided them.
import type * as Omnigent from "omnigent";
import { describe, expect, it } from "vitest";
import {
  followData,
  INITIAL_VIEW_STATE,
  pullRequestIdentity,
  pullRequestRow,
  pullRequestsContent,
  rowStatus,
  type SessionViewState,
  VIEW_COMMANDS,
} from "./pullRequestsModel";

const ONE = "https://github.com/acme/app/pull/1";
const TWO = "https://github.com/acme/app/pull/2";

function details(extra: Partial<Omnigent.PullRequestDetails> = {}): Omnigent.PullRequestDetails {
  return {
    url: ONE,
    number: 1,
    title: "Live title",
    state: "OPEN",
    isDraft: false,
    author: "octo",
    baseRef: "main",
    headRef: "feature",
    headSha: "abc",
    checks: {
      passing: 1,
      failing: 0,
      pending: 0,
      cancelled: 0,
      skipped: 0,
      total: 1,
      runs: [],
      partial: false,
    },
    checksSupported: true,
    reviewers: [],
    labels: [],
    mergeStateStatus: "CLEAN",
    commentCount: 0,
    mergeable: { ready: true, hint: undefined },
    ...extra,
  };
}

function pr(
  url: string,
  extra: Partial<Omnigent.SessionPullRequest> = {},
  live: Partial<Omnigent.SessionPullRequest["live"]> = {},
): Omnigent.SessionPullRequest {
  return {
    url,
    host: "github.com",
    repository: "acme/app",
    number: Number(url.split("/").pop()),
    title: "Stored title",
    relationship: "attached",
    provider: "github",
    providerDisplay: undefined,
    providerLabel: "GitHub",
    numberPrefix: "#",
    defaultHost: "github.com",
    state: "OPEN",
    isDraft: false,
    stateCheckedAt: null,
    live: {
      loading: false,
      error: undefined,
      offline: false,
      offlineHint: undefined,
      details: undefined,
      cached: false,
      canMerge: true,
      ...live,
    },
    ...extra,
  };
}

function data(extra: Partial<Omnigent.SessionPullRequests> = {}): Omnigent.SessionPullRequests {
  return {
    sessionId: "conv",
    status: "ready",
    listStatus: "ready",
    provider: "github",
    providerDisplay: undefined,
    providerLabel: "GitHub",
    linkPlaceholder: "https://github.com/owner/repo/pull/123",
    listProviderLabel: "GitHub",
    trackingAvailable: true,
    hostOffline: false,
    linkNeedsHost: false,
    sandbox: "awake",
    notSynced: false,
    canEdit: true,
    pullRequests: [pr(ONE), pr(TWO)],
    branchPullRequest: undefined,
    selectedUrl: ONE,
    listedByServer: true,
    hasDetails: true,
    warnings: [],
    reviewTarget: undefined,
    ...extra,
  };
}

const state = (extra: Partial<SessionViewState> = {}): SessionViewState => ({
  ...INITIAL_VIEW_STATE,
  ...extra,
});

describe("followData", () => {
  it("takes the host's choice, drops a pull request no longer listed, and opens a lone one", () => {
    expect(followData(state(), data())).toMatchObject({ selected: ONE, showingDetails: false });
    expect(followData(state({ selected: "gone", section: "changes" }), data())).toMatchObject({
      selected: ONE,
      section: "summary",
    });
    expect(followData(state(), data({ pullRequests: [pr(ONE)] }))).toMatchObject({
      showingDetails: true,
    });
    // Live info alone (no server list) keeps a selection it does not list.
    expect(
      followData(state({ selected: "elsewhere" }), data({ listedByServer: false })).selected,
    ).toBe("elsewhere");
  });

  it("keeps a just-linked pull request selected until the list holds it, for two reads", () => {
    const linked = state({ selected: TWO, linked: { url: TWO, changes: 0 } });
    const stale = data({ pullRequests: [pr(ONE)] });
    const once = followData(linked, stale);
    expect(once).toMatchObject({ selected: TWO, linked: { url: TWO, changes: 1 } });
    const twice = followData(once, stale);
    expect(twice).toMatchObject({ selected: TWO, linked: { changes: 2 } });
    expect(followData(twice, stale)).toMatchObject({ selected: ONE, linked: undefined });
    expect(followData(once, data())).toMatchObject({ selected: TWO, linked: undefined });
  });

  it("opens a review comment's pull request on Changes, once per comment", () => {
    const target = { id: "comment-1", pullRequestUrl: TWO };
    const opened = followData(state({ selected: ONE }), data({ reviewTarget: target }));
    expect(opened).toMatchObject({ selected: TWO, showingDetails: true, section: "changes" });
    const moved = { ...opened, section: "summary" as const };
    expect(followData(moved, data({ reviewTarget: target }))).toBe(moved);
  });
});

describe("rows", () => {
  it("label a pull request with its host when it is not the provider's, and its branch origin", () => {
    expect(pullRequestIdentity(pr(ONE))).toBe("acme/app #1");
    expect(
      pullRequestIdentity(pr(ONE, { host: "ghe.example.com", relationship: "inferred" })),
    ).toBe("ghe.example.com/acme/app #1 (from branch)");
    expect(pullRequestIdentity(pr(ONE, { defaultHost: null, numberPrefix: "!" }))).toBe(
      "github.com/acme/app !1",
    );
  });

  it("say what each read shows, as the classic rows did", () => {
    const session = data();
    const status = (live: Partial<Omnigent.SessionPullRequest["live"]>, extra = {}) =>
      rowStatus(pr(ONE, {}, live), data(extra));
    expect(status({ offline: true, offlineHint: "Reconnect" })).toEqual({
      kind: "offline",
      label: "Host offline",
      hint: "Reconnect",
    });
    expect(status({ offline: true }, { sandbox: "asleep" })).toMatchObject({
      label: "Sandbox asleep",
    });
    expect(status({ offline: true }, { sandbox: "starting" })).toMatchObject({
      label: "Sandbox starting",
    });
    expect(status({ details: details() })).toEqual({ kind: "none" });
    expect(
      status({
        details: details({ checks: { ...details().checks, failing: 1 } }),
      }),
    ).toEqual({ kind: "checks", incomplete: false, draft: false });
    expect(status({ error: "Error: boom" })).toEqual({
      kind: "text",
      text: "Status unavailable",
      tooltip: "Error: boom",
    });
    expect(status({ loading: true })).toEqual({ kind: "text", text: "Loading…" });
    expect(status({})).toEqual({ kind: "text", text: "Status unavailable" });
    expect(status({ details: details({ state: "MERGED" }) })).toEqual({
      kind: "state",
      state: "MERGED",
    });
    expect(
      status({
        canMerge: false,
        details: details({
          isDraft: true,
          checks: { ...details().checks, total: 0, partial: true },
        }),
      }),
    ).toEqual({ kind: "checks", incomplete: true, draft: true, noChecks: undefined });
    expect(
      status({
        canMerge: false,
        details: details({
          checks: { ...details().checks, total: 0 },
          mergeable: { ready: false, hint: "Checking whether it can merge…" },
        }),
      }),
    ).toEqual({
      kind: "checks",
      incomplete: false,
      draft: false,
      noChecks: "Checking whether it can merge…",
    });
    expect(session.pullRequests).toHaveLength(2);
  });

  it("offer merging, unlinking and opening only where the classic rows did", () => {
    const cached = pr(ONE, { title: "  " }, { cached: true, details: details() });
    const row = pullRequestRow(cached, data(), state({ unlinkPending: true }), {
      unlinkable: true,
    });
    expect(row).toMatchObject({
      identity: "acme/app #1",
      title: "Live title",
      command: { command: VIEW_COMMANDS.select, arguments: ["conv", ONE] },
      merge: { trigger: true, unavailable: false },
      unlink: { disabled: true },
      openUrl: { url: ONE, label: "Open in GitHub" },
    });
    const viewer = pullRequestRow(cached, data({ canEdit: false }), state(), { unlinkable: true });
    expect(viewer.merge).toEqual({ trigger: false, unavailable: true });
    expect(viewer.unlink).toBeUndefined();
    expect(
      pullRequestRow(pr("http://example.com/a/b/pull/1"), data(), state(), { unlinkable: false }),
    ).toMatchObject({ merge: undefined, unlink: undefined, openUrl: undefined });
  });
});

describe("pullRequestsContent", () => {
  it("is loading without data", () => {
    expect(pullRequestsContent(undefined, state())).toEqual({ kind: "loading" });
  });

  it("lists several pull requests under the toolbar with Refresh and Link a PR", () => {
    const content = pullRequestsContent(data(), state({ selected: ONE }));
    expect(content).toMatchObject({
      kind: "pullRequests",
      sessionId: "conv",
      selectedUrl: ONE,
      bar: { kind: "toolbar", showTitle: true },
      body: { kind: "list" },
      linkForm: { open: false, disabled: false, pending: false },
    });
    if (content.kind !== "pullRequests") return;
    expect(content.actions.map((action) => action.title)).toEqual(["Refresh", "Link a PR"]);
    expect(content.back).toBeUndefined();
    expect(content.page?.body.kind).toBe("list");
  });

  it("shows the selected one with the way back and Unlink PR", () => {
    const content = pullRequestsContent(
      data(),
      state({ selected: TWO, showingDetails: true, section: "comments", refreshing: true }),
    );
    if (content.kind !== "pullRequests") throw new Error("loading");
    expect(content.bar).toEqual({ kind: "toolbar", showTitle: false });
    expect(content.back).toEqual({
      title: "All pull requests (2)",
      command: { command: VIEW_COMMANDS.showList, arguments: ["conv"] },
    });
    expect(content.actions.map((action) => [action.title, !!action.disabled])).toEqual([
      ["Refresh", true],
      ["Link a PR", false],
      ["Unlink PR", false],
    ]);
    expect(content.body).toMatchObject({
      kind: "details",
      url: TWO,
      section: "comments",
      refresh: undefined,
      stored: undefined,
      notSynced: false,
    });
    // The sidebar page lists them whatever the rail shows.
    expect(content.page?.actions.map((action) => action.title)).toEqual(["Refresh", "Link a PR"]);
  });

  it("offers linking in the empty state, or says what linking needs", () => {
    const empty = data({ pullRequests: [], listStatus: "no-pr", status: "no-pr" });
    const link = pullRequestsContent(empty, state());
    if (link.kind !== "pullRequests") throw new Error("loading");
    expect(link.bar).toEqual({
      kind: "refresh",
      busy: false,
      command: { command: VIEW_COMMANDS.refresh, arguments: ["conv"] },
    });
    expect(link.body).toMatchObject({
      kind: "details",
      branchHidden: true,
      emptyState: { kind: "link", command: { command: VIEW_COMMANDS.openLink } },
      refresh: { busy: false },
    });
    const messages = (["awake", "asleep", "starting"] as const).map((sandbox) => {
      const content = pullRequestsContent({ ...empty, linkNeedsHost: true, sandbox }, state());
      return content.kind === "pullRequests" && content.body.kind === "details"
        ? content.body.emptyState
        : undefined;
    });
    expect(messages).toEqual([
      { kind: "message", text: "To link a PR, please reconnect the session’s host." },
      { kind: "message", text: "To link a PR, send a message to start the session’s sandbox." },
      {
        kind: "message",
        text: "Starting the session’s sandbox. You can link a PR once it’s back online.",
      },
    ]);
  });

  it("points at the provider when the selected pull request has no details", () => {
    const content = pullRequestsContent(
      data({ pullRequests: [pr(ONE)], hasDetails: false }),
      state({ selected: ONE, showingDetails: true }),
    );
    expect(content.kind === "pullRequests" && content.body).toMatchObject({
      emptyState: { kind: "open", url: ONE, label: "Open the PR on GitHub" },
    });
  });

  it("shows the stored copy offline, the link button disabled, and the failure lines", () => {
    const content = pullRequestsContent(
      data({
        pullRequests: [pr(ONE)],
        hostOffline: true,
        linkNeedsHost: true,
        warnings: ["One", "Two"],
      }),
      state({ selected: ONE, showingDetails: true, unlinkError: "Gone", linkError: "Bad" }),
    );
    if (content.kind !== "pullRequests") throw new Error("loading");
    expect(content.actions[1]).toMatchObject({
      title: "Link a PR (needs the host online)",
      disabled: true,
    });
    expect(content.body).toMatchObject({ kind: "details", stored: { url: ONE } });
    expect(content.alert).toBe("Couldn’t unlink: Gone");
    expect(content.linkForm?.error).toBe("Bad");
    expect(content.note).toBe("One Two");
  });

  it("lists the branch's own pull request on the sidebar page, without unlinking", () => {
    const branch = pr(ONE, { relationship: "inferred" });
    const content = pullRequestsContent(
      data({ pullRequests: [], branchPullRequest: branch, trackingAvailable: false }),
      state(),
    );
    if (content.kind !== "pullRequests" || content.page?.body.kind !== "list") {
      throw new Error("no page list");
    }
    expect(content.body.kind).toBe("details");
    expect(content.page.bar?.kind).toBe("refresh");
    expect(content.page.body.rows.map((row) => [row.identity, row.unlink])).toEqual([
      ["acme/app #1 (from branch)", undefined],
    ]);
    expect(content.linkForm).toBeUndefined();
  });
});
