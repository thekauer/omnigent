// The API pieces the Content search and Agents views rely on: search inputs on
// views, view progress, presentation and badge fields, the text search, view
// focus commands with their availability keys, and the session commands.
import type * as omnigent from "omnigent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticatedFetch } from "@/lib/identity";
import { RailViewRegistry } from "@/shell/railViews";
import {
  DEFAULT_WORKSPACE_FILE_SETTINGS,
  type WorkspaceActions,
  WorkspaceBridge,
} from "@/shell/workspaceBridge";
import { memoryExtensionState } from "@/test/builtInExtensions";
import { createExtensionApi } from "./api";
import { CancellationTokenSource, EventEmitter } from "./base";
import { CommandRegistry } from "./commands";
import { ContextKeyService } from "./contextKeys";
import { parseContributions } from "./contributions";
import { createExtensionRuntime } from "./extensionHost";
import { hostServices, testViewsService } from "./testServices";
import { ViewsService } from "./viewsService";
import { textSearchQueryProblem, WorkspaceService } from "./workspaceService";

vi.mock("@/lib/identity", () => ({ authenticatedFetch: vi.fn() }));

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
const VIEW = "pub.find.view";
const SEARCH_VIEW = {
  views: {
    "omnigent.rightPanel": [
      {
        id: VIEW,
        name: "Find",
        searchInput: {
          placeholder: "Find text",
          options: [{ id: "caseSensitive", title: "Match case" }],
          fields: [{ id: "include", label: "Include", placeholder: "src/**" }],
          fieldsToggle: { title: "Show globs", ariaLabel: "Globs" },
          hint: "Searches files.",
        },
      },
    ],
  },
};

function setup() {
  const registry = new RailViewRegistry();
  const commands = new CommandRegistry();
  const workspace = {
    activeSessionId: "s1" as string | undefined,
    changed: new EventEmitter<unknown>(),
  };
  const views = new ViewsService({
    registry,
    contextKeys: new ContextKeyService(),
    executeCommand: (command, args) => commands.execute(command, args, () => {}),
    showError: () => {},
    workspace: {
      get activeSessionId() {
        return workspace.activeSessionId;
      },
      onDidChangeChangedFiles: workspace.changed.event,
    },
  });
  const { contributions, warnings } = parseContributions("pub.find", SEARCH_VIEW);
  expect(warnings).toEqual([]);
  views.addExtension("pub.find", contributions);
  views.extensionSettled("pub.find");
  const tree = views.createTreeView<string>(
    "pub.find",
    VIEW,
    { treeDataProvider: { getChildren: () => [], getTreeItem: (label: string) => ({ label }) } },
    vi.fn(),
  );
  const host = () => registry.get(VIEW)!.host!;
  const switchTo = (session: string) => {
    workspace.activeSessionId = session;
    workspace.changed.fire(undefined);
  };
  return { registry, views, tree, host, switchTo };
}

afterEach(() => vi.mocked(authenticatedFetch).mockReset());

describe("view search inputs", () => {
  it("parses searchInput, defaulting what it leaves out, and warns about bad entries", () => {
    const { contributions, warnings } = parseContributions("pub.x", {
      views: {
        "omnigent.rightPanel": [
          {
            id: "pub.x.a",
            name: "A",
            searchInput: {
              placeholder: "Find",
              options: [{ id: "ok", title: "Ok" }, { id: "1bad" }],
            },
          },
          { id: "pub.x.b", name: "B", searchInput: { options: [] } },
        ],
      },
    });
    expect(contributions.views[0].searchInput).toEqual({
      placeholder: "Find",
      ariaLabel: "Find",
      submitTitle: "Search",
      options: [{ id: "ok", title: "Ok" }],
      fields: [],
      fieldsToggle: undefined,
      fieldsHint: undefined,
      hint: undefined,
    });
    expect(contributions.views[1].searchInput).toBeUndefined();
    expect(warnings).toHaveLength(2);
  });

  it("keeps the value per chat session and tells the extension of edits and switches", () => {
    const { tree, host, switchTo } = setup();
    const input = tree.searchInput!;
    expect(input.value).toEqual({
      query: "",
      options: { caseSensitive: false },
      fields: { include: "" },
    });
    const seen: omnigent.SearchInputValue[] = [];
    input.onDidChangeValue((value) => seen.push(value));
    host().setSearchInput("s1", {
      query: "needle",
      options: { caseSensitive: true, stray: true },
      fields: { include: "src/**", other: "x" },
    });
    // Only the contributed options and fields are kept.
    expect(input.value).toEqual({
      query: "needle",
      options: { caseSensitive: true },
      fields: { include: "src/**" },
    });
    switchTo("s2");
    expect(input.value.query).toBe("");
    host().setSearchInput("s2", { query: "other", options: {}, fields: {} });
    switchTo("s1");
    expect(input.value.query).toBe("needle");
    expect(seen.map((value) => value.query)).toEqual(["needle", "", "other", "needle"]);
    // A form drawn for another session than the one on screen does not reach the extension.
    host().setSearchInput("s2", { query: "late", options: {}, fields: {} });
    expect(seen).toHaveLength(4);
    expect(host().getSearchInput("s2").query).toBe("late");
  });

  it("accepts only while enabled and valid, and shows the extension's state", () => {
    const { tree, host, registry } = setup();
    const input = tree.searchInput!;
    const accepted = vi.fn();
    input.onDidAccept(accepted);
    host().setSearchInput("s1", { query: "x", options: {}, fields: {} });
    host().acceptSearchInput("s1");
    expect(accepted).toHaveBeenCalledWith(expect.objectContaining({ query: "x" }));
    input.validationMessage = "Too long";
    expect(registry.get(VIEW)?.searchValidation).toBe("Too long");
    host().acceptSearchInput("s1");
    input.validationMessage = undefined;
    input.enabled = false;
    expect(registry.get(VIEW)?.searchEnabled).toBe(false);
    host().acceptSearchInput("s1");
    input.enabled = true;
    // Not the session on screen.
    host().acceptSearchInput("s2");
    expect(accepted).toHaveBeenCalledOnce();
  });

  it("has no search input without the contribution", () => {
    const services = hostServices();
    const { contributions } = parseContributions("pub.plain", {
      views: { "omnigent.rightPanel": [{ id: "pub.plain.view", name: "Plain" }] },
    });
    services.views.addExtension("pub.plain", contributions);
    const api = createExtensionApi("pub.plain", services, vi.fn()).api;
    const view = api.window.createTreeView("pub.plain.view", {
      treeDataProvider: { getChildren: () => [], getTreeItem: () => ({}) },
    });
    expect(view.searchInput).toBeUndefined();
  });
});

describe("view presentation, badges and progress", () => {
  it("publishes the presentation and the badge's label and tone", () => {
    const { tree, registry } = setup();
    tree.presentation = "graph";
    expect(registry.get(VIEW)?.presentation).toBe("graph");
    tree.presentation = "nonsense" as never;
    expect(registry.get(VIEW)?.presentation).toBe("tree");
    tree.badge = { value: 5, tooltip: "2/5", label: "2/5", tone: "success" };
    expect(registry.get(VIEW)?.badge).toEqual({
      value: 5,
      tooltip: "2/5",
      label: "2/5",
      tone: "success",
    });
    tree.badge = { value: 5, tooltip: "5", tone: "loud" as never };
    expect(registry.get(VIEW)?.badge).toEqual({ value: 5, tooltip: "5" });
  });

  it("shows view progress through withProgress until the task settles, only in its own views", async () => {
    const registry = new RailViewRegistry();
    const commands = new CommandRegistry();
    const services = hostServices({ commands, views: testViewsService(commands, { registry }) });
    const { contributions } = parseContributions("pub.find", SEARCH_VIEW);
    services.views.addExtension("pub.find", contributions);
    const api = createExtensionApi("pub.find", services, vi.fn()).api;
    let finish!: () => void;
    const running = api.window.withProgress(
      { title: "Searching…", location: { viewId: VIEW } },
      () =>
        new Promise<string>((resolve) => {
          finish = () => resolve("done");
        }),
    );
    expect(registry.get(VIEW)?.progress.map((entry) => entry.title)).toEqual(["Searching…"]);
    finish();
    await expect(running).resolves.toBe("done");
    expect(registry.get(VIEW)?.progress).toEqual([]);
    await expect(
      api.window.withProgress({ title: "x", location: { viewId: "pub.other.view" } }, () => 1),
    ).rejects.toThrow("no view with id 'pub.other.view'");
  });

  it("records each view progress with its session and removes it when it ends", () => {
    const { views, registry, switchTo } = setup();
    const endFirst = views.beginProgress("pub.find", VIEW, "Searching…");
    switchTo("s2");
    const endSecond = views.beginProgress("pub.find", VIEW, "Again…");
    expect(registry.get(VIEW)?.progress).toEqual([
      { title: "Searching…", sessionId: "s1" },
      { title: "Again…", sessionId: "s2" },
    ]);
    endFirst();
    endFirst();
    expect(registry.get(VIEW)?.progress).toEqual([{ title: "Again…", sessionId: "s2" }]);
    endSecond();
    expect(registry.get(VIEW)?.progress).toEqual([]);
    expect(() => views.beginProgress("pub.other", VIEW, "x")).toThrow();
  });
});

describe("workspace text search", () => {
  function workspaceOn(sessionId: string | null) {
    const bridge = new WorkspaceBridge();
    const source = bridge.createSource();
    source.update({
      sessionId,
      changedFiles: [],
      availability: "available",
      servedFromHost: false,
      settings: DEFAULT_WORKSPACE_FILE_SETTINGS,
    });
    source.setActions({} as WorkspaceActions);
    source.setActive(true);
    return new WorkspaceService(bridge);
  }

  const respond = (body: unknown) =>
    vi.mocked(authenticatedFetch).mockResolvedValue(new Response(JSON.stringify(body)));

  it("searches the workspace on screen and returns plain matches with their ranges", async () => {
    respond({
      matches: [
        { path: "a.ts", line: 3, column: 5, text: "let needle = 1", match_start: 4, match_end: 10 },
      ],
      truncated: true,
      warning: "Some ignore files could not be read.",
    });
    await flush();
    const result = await workspaceOn("s1").findTextInFiles(
      { pattern: "needle", isCaseSensitive: true },
      { include: "src/**", exclude: "*.min.js" },
      undefined,
    );
    expect(result).toEqual({
      matches: [
        {
          path: "a.ts",
          line: 3,
          column: 5,
          preview: { text: "let needle = 1", matches: [[4, 10]] },
        },
      ],
      limitHit: true,
      message: "Some ignore files could not be read.",
    });
    expect(Object.isFrozen(result.matches[0])).toBe(true);
    const url = new URL(String(vi.mocked(authenticatedFetch).mock.calls[0][0]), "http://test");
    expect(url.pathname).toBe("/v1/sessions/s1/resources/environments/default/content-search");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "needle",
      case_sensitive: "true",
      regex: "false",
      include: "src/**",
      exclude: "*.min.js",
    });
  });

  it("matches whole words through a bounded expression", async () => {
    respond({ matches: [], truncated: false, warning: null });
    await workspaceOn("s1").findTextInFiles({ pattern: "C++", isWordMatch: true }, {}, undefined);
    const url = new URL(String(vi.mocked(authenticatedFetch).mock.calls[0][0]), "http://test");
    expect(url.searchParams.get("q")).toBe("\\bC\\+\\+");
    expect(url.searchParams.get("regex")).toBe("true");
  });

  it("refuses what cannot be searched, before sending anything", async () => {
    const workspace = workspaceOn("s1");
    await expect(workspace.findTextInFiles({ pattern: "" }, {}, undefined)).rejects.toThrow(
      TypeError,
    );
    await expect(
      workspace.findTextInFiles(
        { pattern: "a)|(b", isRegExp: true, isWordMatch: true },
        {},
        undefined,
      ),
    ).rejects.toThrow("unopenedGroup");
    await expect(
      workspaceOn(null).findTextInFiles({ pattern: "x" }, {}, undefined),
    ).rejects.toThrow("no workspace is open");
    expect(authenticatedFetch).not.toHaveBeenCalled();
  });

  it("says why a query cannot be searched", () => {
    expect(textSearchQueryProblem({ pattern: "a".repeat(4096), isWordMatch: true })).toBe(
      "tooLong",
    );
    expect(textSearchQueryProblem({ pattern: "a".repeat(4096) })).toBeUndefined();
    expect(textSearchQueryProblem({ pattern: "a)|(b", isRegExp: true, isWordMatch: true })).toBe(
      "unopenedGroup",
    );
    expect(textSearchQueryProblem({ pattern: "(?x)a", isRegExp: true, isWordMatch: true })).toBe(
      "verbose",
    );
    expect(textSearchQueryProblem({ pattern: "a)|(b", isRegExp: true })).toBeUndefined();
  });

  it("cancels a running search: the request is aborted and the promise rejects as Canceled", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(authenticatedFetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          signal = (init as RequestInit | undefined)?.signal ?? undefined;
          signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const source = new CancellationTokenSource();
    const running = workspaceOn("s1").findTextInFiles({ pattern: "x" }, {}, source.token);
    await flush();
    source.cancel();
    await expect(running).rejects.toMatchObject({ name: "Canceled" });
    expect(signal?.aborted).toBe(true);
    // Already cancelled: nothing is sent.
    vi.mocked(authenticatedFetch).mockClear();
    await expect(
      workspaceOn("s1").findTextInFiles({ pattern: "x" }, {}, source.token),
    ).rejects.toMatchObject({ name: "Canceled" });
    expect(authenticatedFetch).not.toHaveBeenCalled();
  });
});

describe("CancellationTokenSource", () => {
  it("fires once, and tells a late listener at once", async () => {
    const source = new CancellationTokenSource();
    const first = vi.fn();
    source.token.onCancellationRequested(first);
    expect(source.token.isCancellationRequested).toBe(false);
    source.cancel();
    source.cancel();
    expect(source.token.isCancellationRequested).toBe(true);
    expect(first).toHaveBeenCalledOnce();
    const late = vi.fn();
    source.token.onCancellationRequested(late);
    await flush();
    expect(late).toHaveBeenCalledOnce();
  });
});

describe("view focus commands and session commands", () => {
  async function runtime() {
    const registry = new RailViewRegistry();
    const bridge = new WorkspaceBridge();
    const source = bridge.createSource();
    const openSession = vi.fn();
    const openFile = vi.fn();
    source.update({
      sessionId: "s1",
      changedFiles: [],
      availability: "available",
      servedFromHost: false,
      settings: DEFAULT_WORKSPACE_FILE_SETTINGS,
    });
    source.setActions({
      openFile,
      refreshChangedFiles: () => Promise.resolve(),
      updateSettings: () => {},
      openSession,
    });
    source.setActive(true);
    const started = createExtensionRuntime({
      registry,
      bridge,
      hostOptions: { extensionState: memoryExtensionState() },
    });
    await started.builtInsStarted;
    return { started, bridge, openSession, openFile };
  }

  it("registers <view>.focus for every view; it reveals through the rail of the session on screen", async () => {
    const { started, bridge } = await runtime();
    const view = "omnigent.changes.view";
    const key = `view.${view}.available`;
    expect(started.contextKeys.get(key)).toBeUndefined();
    await expect(started.commands.execute(`${view}.focus`, [], () => {})).resolves.toBe(false);
    const reveal = vi.fn(() => true);
    const rail = bridge.createRail();
    rail.update({ sessionId: "s1", views: [view], reveal });
    expect(started.contextKeys.get(key)).toBe(true);
    await expect(started.commands.execute(`${view}.focus`, [], () => {})).resolves.toBe(true);
    expect(reveal).toHaveBeenCalledWith(view);
    // A rail for another session is not the one on screen.
    rail.update({ sessionId: "s2", views: [view], reveal });
    expect(started.contextKeys.get(key)).toBeUndefined();
    rail.dispose();
    await started.dispose();
  });

  it("opens sessions and sub-agents, and files at a position, through the workspace", async () => {
    const { started, openSession, openFile } = await runtime();
    const run = (command: string, ...args: unknown[]) =>
      started.commands.execute(command, args, () => {});
    await run("omnigent.openSession", "conv_a");
    await run("omnigent.openSubagent", "conv_b");
    expect(openSession.mock.calls).toEqual([
      ["conv_a", { asSubagent: false }],
      ["conv_b", { asSubagent: true }],
    ]);
    await expect(run("omnigent.openSubagent", "")).rejects.toThrow(TypeError);
    await run("omnigent.openFile", "a.ts", { line: 3, column: 2, stray: 1 });
    await run("omnigent.openFile", "b.ts", { line: -1 });
    expect(openFile.mock.calls).toEqual([["a.ts", { line: 3, column: 2 }], ["b.ts"]]);
    await started.dispose();
  });
});
