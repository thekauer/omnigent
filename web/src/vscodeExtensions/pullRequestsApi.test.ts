// The API pieces the Pull Requests view relies on: the pull requests of the workspace
// on screen as plain data with change events, watching them (focus, list and passive
// watches), the `omnigent.pullRequests.*` commands, pull request views, and git host
// providers registered by extensions.
import type * as omnigent from "omnigent";
import { describe, expect, it, vi } from "vitest";
import { GitHostProviderRegistry } from "@/lib/gitHostProviders";
import { RailViewRegistry } from "@/shell/railViews";
import {
  DEFAULT_WORKSPACE_FILE_SETTINGS,
  WorkspaceBridge,
  type WorkspacePullRequestsActions,
} from "@/shell/workspaceBridge";
import { createExtensionApi } from "./api";
import { registerBuiltInCommands } from "./builtinCommands";
import { CommandRegistry } from "./commands";
import { ContextKeyService } from "./contextKeys";
import { parseContributions } from "./contributions";
import { pullRequestContentOf } from "./pullRequestContent";
import { PullRequestsService } from "./pullRequestsService";
import { hostServices, testViewsService } from "./testServices";

const microtasks = async () => {
  let turns = Promise.resolve();
  for (let turn = 0; turn < 5; turn += 1) turns = turns.then(() => undefined);
  await turns;
};

const URL_A = "https://github.com/acme/app/pull/1";

const PULL_REQUEST: omnigent.SessionPullRequest = {
  url: URL_A,
  host: "github.com",
  repository: "acme/app",
  number: 1,
  title: "First",
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
    canMerge: false,
  },
};

function pullRequestsOf(
  sessionId: string,
  extra: Partial<omnigent.SessionPullRequests> = {},
): omnigent.SessionPullRequests {
  return {
    sessionId,
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
    pullRequests: [PULL_REQUEST],
    branchPullRequest: undefined,
    selectedUrl: URL_A,
    listedByServer: true,
    hasDetails: true,
    warnings: [],
    reviewTarget: undefined,
    ...extra,
  };
}

function source(bridge: WorkspaceBridge, sessionId: string) {
  const entry = bridge.createSource();
  entry.update({
    sessionId,
    changedFiles: [],
    availability: "available",
    servedFromHost: false,
    settings: DEFAULT_WORKSPACE_FILE_SETTINGS,
  });
  const actions = {
    link: vi.fn(async () => ({ selectedUrl: URL_A })),
    unlink: vi.fn(async () => ({ remaining: [] as string[] })),
    refresh: vi.fn(async () => {}),
    merge: vi.fn(async () => {}),
    updateLabels: vi.fn(async () => {}),
    updateReviewers: vi.fn(async () => {}),
    postComment: vi.fn(async () => {}),
  } satisfies WorkspacePullRequestsActions;
  entry.setPullRequestsActions(actions);
  return { entry, actions };
}

function setup() {
  const bridge = new WorkspaceBridge();
  const pullRequests = new PullRequestsService(bridge);
  const gitHosts = new GitHostProviderRegistry();
  const logError = vi.fn();
  const handle = createExtensionApi("pub.prs", hostServices({ pullRequests, gitHosts }), logError);
  return { bridge, pullRequests, gitHosts, logError, api: handle.api, deactivate: handle.dispose };
}

describe("pullRequests API: data", () => {
  it("hands out the pull requests of the workspace on screen as frozen copies", () => {
    const { bridge, api } = setup();
    expect(api.pullRequests.activeSessionPullRequests).toBeUndefined();
    const { entry } = source(bridge, "conv");
    const published = pullRequestsOf("conv");
    entry.updatePullRequests(published);
    entry.setActive(true);
    const data = api.pullRequests.activeSessionPullRequests!;
    expect(data).toEqual(published);
    expect(data).not.toBe(published);
    expect(Object.isFrozen(data.pullRequests[0].live)).toBe(true);
    expect(api.pullRequests.activeSessionPullRequests).toBe(data);
  });

  it("says when they change, once per burst, and follows the surface in front", async () => {
    const { bridge, api } = setup();
    const seen: (string | undefined)[] = [];
    api.pullRequests.onDidChangeActiveSessionPullRequests((data) =>
      seen.push(data && `${data.sessionId}:${data.pullRequests.length}`),
    );
    const first = source(bridge, "a");
    first.entry.setActive(true);
    first.entry.updatePullRequests(pullRequestsOf("a"));
    first.entry.updatePullRequests(pullRequestsOf("a", { pullRequests: [] }));
    await microtasks();
    expect(seen).toEqual(["a:0"]);
    const second = source(bridge, "b");
    second.entry.updatePullRequests(pullRequestsOf("b"));
    second.entry.setActive(true);
    await microtasks();
    expect(seen).toEqual(["a:0", "b:1"]);
    second.entry.dispose();
    await microtasks();
    expect(seen).toEqual(["a:0", "b:1", "a:0"]);
  });
});

describe("pullRequests API: watching", () => {
  it("counts watches, polls only for active ones, and keeps the latest focus", () => {
    const { bridge, api, deactivate } = setup();
    expect(bridge.pullRequestsWatch()).toEqual({ watchers: 0, polling: false, focus: undefined });
    const passive = bridge.watchPullRequests({ passive: true });
    expect(bridge.pullRequestsWatch()).toMatchObject({ watchers: 1, polling: false });
    const watch = api.pullRequests.watchActiveSessionPullRequests();
    expect(bridge.pullRequestsWatch()).toMatchObject({ watchers: 2, polling: true });
    watch.focus = { sessionId: "conv", url: URL_A, details: true };
    expect(watch.focus).toEqual({ sessionId: "conv", url: URL_A, details: true });
    expect(bridge.pullRequestsWatch().focus).toEqual({
      sessionId: "conv",
      url: URL_A,
      details: true,
    });
    // A page that lists them keeps every listed one read.
    const list = bridge.watchPullRequests({ list: true });
    expect(bridge.pullRequestsWatch().focus).toMatchObject({ details: false });
    list.dispose();
    expect(bridge.pullRequestsWatch().focus).toMatchObject({ details: true });
    // Malformed focus is none.
    watch.focus = {
      sessionId: "",
      url: 3,
      details: "yes",
    } as unknown as omnigent.PullRequestsFocus;
    expect(watch.focus).toBeUndefined();
    watch.focus = { sessionId: "conv", url: URL_A, details: false };
    // Deactivating ends the extension's watch; the passive one reads the last focus.
    deactivate();
    expect(bridge.pullRequestsWatch()).toEqual({
      watchers: 1,
      polling: false,
      focus: { sessionId: "conv", url: URL_A, details: false },
    });
    passive.dispose();
    expect(bridge.pullRequestsWatch()).toEqual({ watchers: 0, polling: false, focus: undefined });
    // Once deactivated, a new watch is inert.
    const late = api.pullRequests.watchActiveSessionPullRequests();
    expect(bridge.pullRequestsWatch().watchers).toBe(0);
    late.dispose();
  });
});

describe("pullRequests commands", () => {
  function commandsSetup() {
    const bridge = new WorkspaceBridge();
    const commands = new CommandRegistry();
    registerBuiltInCommands(commands, { contextKeys: new ContextKeyService(), workspace: bridge });
    const { entry, actions } = source(bridge, "conv");
    entry.setActive(true);
    const run = (id: string, ...args: unknown[]) => commands.execute(id, args, () => {});
    return { bridge, commands, entry, actions, run };
  }

  it("route each action to the workspace on screen, with checked arguments", async () => {
    const { actions, run } = commandsSetup();
    await expect(run("omnigent.pullRequests.link", "conv", `  ${URL_A}  `)).resolves.toEqual({
      selectedUrl: URL_A,
    });
    expect(actions.link).toHaveBeenCalledWith(URL_A);
    await expect(run("omnigent.pullRequests.unlink", "conv", URL_A)).resolves.toEqual({
      remaining: [],
    });
    await run("omnigent.pullRequests.refresh", "conv");
    expect(actions.refresh).toHaveBeenCalled();
    await run("omnigent.pullRequests.merge", "conv", URL_A, {
      method: "squash",
      expectedHead: "abc",
    });
    expect(actions.merge).toHaveBeenCalledWith(URL_A, { method: "squash", expectedHead: "abc" });
    await run("omnigent.pullRequests.merge", "conv", URL_A, {
      method: "merge",
      expectedHead: "abc",
      account: "octo",
    });
    expect(actions.merge).toHaveBeenLastCalledWith(URL_A, {
      method: "merge",
      expectedHead: "abc",
      account: "octo",
    });
    await run("omnigent.pullRequests.updateLabels", "conv", URL_A, { add: ["bug"] });
    expect(actions.updateLabels).toHaveBeenCalledWith(URL_A, { add: ["bug"], remove: [] });
    await run("omnigent.pullRequests.updateReviewers", "conv", URL_A, {
      add: [{ login: "octo", kind: "user" }],
      remove: [{ login: "core", kind: "team" }],
    });
    expect(actions.updateReviewers).toHaveBeenCalledWith(URL_A, {
      add: [{ login: "octo", kind: "user" }],
      remove: [{ login: "core", kind: "team" }],
    });
    await run("omnigent.pullRequests.postComment", "conv", URL_A, "Ship it");
    expect(actions.postComment).toHaveBeenCalledWith(URL_A, "Ship it");
  });

  it("refuse another session, malformed arguments and a workspace without pull requests", async () => {
    const { bridge, actions, run } = commandsSetup();
    await expect(run("omnigent.pullRequests.refresh", "other")).rejects.toThrow(
      /not the workspace on screen/,
    );
    await expect(run("omnigent.pullRequests.link", "conv", "  ")).rejects.toThrow(/link/);
    await expect(run("omnigent.pullRequests.unlink", "conv", "ftp://x")).rejects.toThrow(/link/);
    await expect(
      run("omnigent.pullRequests.merge", "conv", URL_A, { method: "fast", expectedHead: "a" }),
    ).rejects.toThrow(/method/);
    await expect(
      run("omnigent.pullRequests.merge", "conv", URL_A, { method: "merge" }),
    ).rejects.toThrow(/head/);
    await expect(
      run("omnigent.pullRequests.updateLabels", "conv", URL_A, { add: "bug" }),
    ).rejects.toThrow(/list of names/);
    await expect(
      run("omnigent.pullRequests.updateReviewers", "conv", URL_A, { add: [{ login: "x" }] }),
    ).rejects.toThrow(/login and kind/);
    await expect(run("omnigent.pullRequests.postComment", "conv", URL_A, " ")).rejects.toThrow(
      /comment/,
    );
    expect(Object.values(actions).every((action) => action.mock.calls.length === 0)).toBe(true);
    const other = bridge.createSource();
    other.update({
      sessionId: "plain",
      changedFiles: [],
      availability: "available",
      servedFromHost: false,
      settings: DEFAULT_WORKSPACE_FILE_SETTINGS,
    });
    other.setActive(true);
    await expect(run("omnigent.pullRequests.refresh", "plain")).rejects.toThrow(
      /has no pull requests/,
    );
  });
});

describe("pull request views", () => {
  const VIEW = { views: { "omnigent.rightPanel": [{ id: "pub.prs.view", name: "PRs" }] } };

  function viewsSetup() {
    const registry = new RailViewRegistry();
    const commands = new CommandRegistry();
    const views = testViewsService(commands, { registry });
    const { contributions, warnings } = parseContributions("pub.prs", VIEW);
    expect(warnings).toEqual([]);
    views.addExtension("pub.prs", contributions);
    views.extensionSettled("pub.prs");
    const logError = vi.fn();
    const api = createExtensionApi("pub.prs", hostServices({ commands, views }), logError);
    return { registry, commands, api: api.api, deactivate: api.dispose, logError };
  }

  const contentFor = (sessionId: string): omnigent.PullRequestViewContent => ({
    kind: "pullRequests",
    sessionId,
    actions: [],
    body: { kind: "list", rows: [] },
  });

  it("give the host checked plain content, and only for the extension's own views", () => {
    const { registry, api } = viewsSetup();
    expect(() => api.window.createPullRequestView("pub.other.view")).toThrow(/no view/);
    const view = api.window.createPullRequestView("pub.prs.view");
    expect(registry.get("pub.prs.view")?.pullRequests).toEqual({ kind: "loading" });
    expect(() => api.window.createPullRequestView("pub.prs.view")).toThrow(/already has/);
    expect(() => api.window.createPlanView("pub.prs.view")).toThrow(/already has/);
    view.content = {
      kind: "pullRequests",
      sessionId: "conv",
      selectedUrl: URL_A,
      actions: [
        { title: "Refresh", icon: "refresh-cw", command: { command: "pub.prs.refresh" } },
        { title: "Nope", icon: "not-an-icon", command: { command: "pub.prs.x" } },
        { title: "Bad", icon: "plus", command: { command: "bad id!" } },
      ],
      back: { title: "All pull requests (2)", command: { command: "pub.prs.back" } },
      bar: { kind: "toolbar", showTitle: true },
      body: {
        kind: "list",
        rows: [
          {
            pullRequest: PULL_REQUEST,
            identity: "acme/app #1",
            title: "First",
            command: { command: "pub.prs.select", arguments: ["conv", URL_A] },
            status: { kind: "checks", incomplete: true, draft: false },
            merge: { trigger: true, unavailable: false },
            unlink: { command: { command: "pub.prs.unlink" }, disabled: false },
            openUrl: { url: "javascript:alert(1)", label: "Open" },
          },
          { pullRequest: { url: "" }, identity: "x", command: { command: "pub.prs.select" } },
        ],
      },
      page: {
        actions: [],
        bar: { kind: "refresh", busy: true, command: { command: "pub.prs.refresh" } },
        body: { kind: "details", url: URL_A, section: "changes" } as omnigent.PullRequestViewBody,
      },
    } as unknown as omnigent.PullRequestViewContent;
    const drawn = registry.get("pub.prs.view")!.pullRequests!;
    expect(Object.isFrozen(drawn)).toBe(true);
    if (drawn.kind !== "pullRequests") throw new Error("not drawn");
    expect(drawn.selectedUrl).toBe(URL_A);
    expect(drawn.actions.map((action) => action.title)).toEqual(["Refresh"]);
    expect(drawn.back?.title).toBe("All pull requests (2)");
    expect(drawn.body.kind === "list" && drawn.body.rows).toHaveLength(1);
    const row = drawn.body.kind === "list" ? drawn.body.rows[0] : undefined;
    expect(row?.pullRequest).toEqual(PULL_REQUEST);
    expect(row?.status).toEqual({
      kind: "checks",
      incomplete: true,
      noChecks: undefined,
      draft: false,
    });
    // Only https links open.
    expect(row?.openUrl).toBeUndefined();
    expect(drawn.page?.bar).toEqual({
      kind: "refresh",
      busy: true,
      command: { command: "pub.prs.refresh", arguments: [] },
    });
    expect(drawn.page?.body).toMatchObject({ kind: "details", url: URL_A, section: "changes" });
    view.dispose();
    expect(registry.get("pub.prs.view")?.pullRequests).toBeUndefined();
    view.content = contentFor("conv");
    expect(registry.get("pub.prs.view")?.pullRequests).toBeUndefined();
  });

  it("keep each session's last content, so a pane not in front draws its own", () => {
    const { registry, api } = viewsSetup();
    const view = api.window.createPullRequestView("pub.prs.view");
    view.content = contentFor("a");
    view.content = contentFor("b");
    view.content = { kind: "loading" };
    const drawn = registry.get("pub.prs.view")!;
    expect(drawn.pullRequests).toEqual({ kind: "loading" });
    expect([...drawn.pullRequestsBySession.keys()]).toEqual(["a", "b"]);
    for (let index = 0; index < 40; index++) view.content = contentFor(`s${index}`);
    expect(registry.get("pub.prs.view")!.pullRequestsBySession.size).toBe(32);
  });

  it("show unreadable content as loading, logged against the extension", () => {
    const { registry, api, logError } = viewsSetup();
    const view = api.window.createPullRequestView("pub.prs.view");
    view.content = new Proxy({} as omnigent.PullRequestViewContent, {
      get() {
        throw new Error("trap");
      },
    });
    expect(registry.get("pub.prs.view")?.pullRequests).toEqual({ kind: "loading" });
    expect(logError).toHaveBeenCalledWith(
      expect.stringMatching(/pull request view content/),
      expect.any(Error),
    );
  });

  it("say when they come on screen and go, and leave with the extension", () => {
    const { registry, api, deactivate } = viewsSetup();
    const view = api.window.createPullRequestView("pub.prs.view");
    const seen: boolean[] = [];
    view.onDidChangeVisibility(({ visible }) => seen.push(visible));
    const done = registry.get("pub.prs.view")!.host!.reportVisible();
    expect(view.visible).toBe(true);
    done();
    expect(seen).toEqual([true, false]);
    view.content = contentFor("conv");
    deactivate();
    expect(registry.get("pub.prs.view")?.pullRequests).toBeUndefined();
  });

  it("check content without an API, too", () => {
    expect(pullRequestContentOf({ kind: "pullRequests" })).toEqual({ kind: "loading" });
    expect(pullRequestContentOf(undefined)).toEqual({ kind: "loading" });
    const content = pullRequestContentOf({
      kind: "pullRequests",
      sessionId: "conv",
      body: { kind: "details", emptyState: { kind: "link", command: { command: "pub.link" } } },
      linkForm: {
        open: true,
        submit: { command: "pub.submit" },
        cancel: { command: "pub.cancel" },
      },
    });
    expect(content).toMatchObject({
      actions: [],
      linkForm: { open: true, placeholder: "", disabled: false, pending: false },
      body: {
        kind: "details",
        section: "summary",
        branchHidden: false,
        notSynced: false,
        emptyState: { kind: "link", command: { command: "pub.link", arguments: [] } },
      },
    });
  });

  it("open only https links from an empty state", () => {
    const emptyStateFor = (url: string) => {
      const content = pullRequestContentOf({
        kind: "pullRequests",
        sessionId: "conv",
        body: { kind: "details", emptyState: { kind: "open", url, label: "Open" } },
      });
      return content.kind === "pullRequests" && content.body.kind === "details"
        ? content.body.emptyState
        : null;
    };
    expect(emptyStateFor("https://github.com/acme/app/pull/1")).toEqual({
      kind: "open",
      url: "https://github.com/acme/app/pull/1",
      label: "Open",
    });
    for (const url of ["javascript:alert(1)", "http://github.com/acme/app/pull/1", "data:,x"]) {
      expect(emptyStateFor(url)).toBeUndefined();
    }
  });
});

describe("git API", () => {
  it("registers an extension's host provider until it deactivates", () => {
    const { api, gitHosts, deactivate } = setup();
    const url = "https://7.git.example.com/org/repo/pull/5";
    expect(api.git.matchPullRequestUrl(url)).toBeUndefined();
    api.git.registerHostProvider({
      id: "pub.prs.host",
      matchUrl: (candidate) =>
        candidate === url
          ? { host: "7.git.example.com", owner: "org", repo: "repo", number: 5 }
          : undefined,
    });
    expect(api.git.matchPullRequestUrl(url)).toEqual({
      providerId: "pub.prs.host",
      host: "7.git.example.com",
      owner: "org",
      repo: "repo",
      number: 5,
    });
    expect(api.git.matchPullRequestUrl("https://github.com/a/b/pull/1")).toMatchObject({
      providerId: "github",
    });
    deactivate();
    expect(gitHosts.match(url)).toBeUndefined();
    // After deactivation a registration does nothing.
    api.git.registerHostProvider({ id: "pub.late", matchUrl: () => undefined });
    expect(gitHosts.match(url)).toBeUndefined();
  });

  it("refuses a malformed provider and an async answer", () => {
    const { api, logError } = setup();
    expect(() => api.git.registerHostProvider({ id: "", matchUrl: () => undefined })).toThrow(
      TypeError,
    );
    api.git.registerHostProvider({
      id: "pub.async",
      matchUrl: (() => Promise.resolve(undefined)) as never,
    });
    expect(api.git.matchPullRequestUrl("https://x.example.com/a/b/pull/1")).toBeUndefined();
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/returned a promise/));
  });
});
