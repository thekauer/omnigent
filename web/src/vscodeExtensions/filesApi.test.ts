// The API pieces the Files view relies on: the workspace's files (root, folder
// listings, file search, change events), the refresh and reveal commands,
// tree view reveal and selection, the location bar, the filter's fields and
// the host-drawn menu entries.
import type * as omnigent from "omnigent";
import { describe, expect, it, vi } from "vitest";
import {
  PathUnreachableError,
  RunnerOfflineError,
  type WorkspaceFile,
} from "@/hooks/useWorkspaceChangedFiles";
import { RailViewRegistry } from "@/shell/railViews";
import {
  DEFAULT_WORKSPACE_FILE_SETTINGS,
  type WorkspaceActions,
  WorkspaceBridge,
  type WorkspaceBridgeState,
  WorkspaceUnavailableError,
} from "@/shell/workspaceBridge";
import { CancellationTokenSource, EventEmitter } from "./base";
import { ContextKeyService } from "./contextKeys";
import { OPEN_IN_SUBMENU, parseContributions, TOGGLE_FILTER_FIELDS_COMMAND } from "./contributions";
import { createExtensionRuntime } from "./extensionHost";
import { createTreeViewModel, sanitizeTreeItem } from "./treeView";
import { ViewsService } from "./viewsService";
import { WorkspaceService } from "./workspaceService";

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const file = (path: string, type: WorkspaceFile["type"] = "file"): WorkspaceFile => ({
  path,
  name: path.split("/").at(-1) ?? path,
  type,
  bytes: 4,
  modified_at: 9,
});

function workspace(
  state: Partial<WorkspaceBridgeState> = {},
  actions: Partial<WorkspaceActions> = {},
) {
  const bridge = new WorkspaceBridge();
  const source = bridge.createSource();
  let current: WorkspaceBridgeState = {
    sessionId: "s1",
    changedFiles: [],
    availability: "available",
    servedFromHost: false,
    settings: DEFAULT_WORKSPACE_FILE_SETTINGS,
    rootPath: "/w",
    filesRevision: 0,
    ...state,
  };
  const readDirectory = vi.fn((location: string) =>
    Promise.resolve(location === "" ? [file("a.ts"), file("src", "directory")] : [file("x.ts")]),
  );
  const findFiles = vi.fn(() =>
    Promise.resolve({
      files: [file("src/x.ts")],
      truncated: true,
      hasMore: false,
      unavailable: false,
    }),
  );
  const refreshFiles = vi.fn(() => Promise.resolve());
  source.setActions({
    openFile: vi.fn(),
    refreshChangedFiles: vi.fn(() => Promise.resolve()),
    updateSettings: vi.fn(),
    readDirectory,
    findFiles,
    refreshFiles,
    ...actions,
  });
  source.update(current);
  source.setActive(true);
  const service = new WorkspaceService(bridge);
  return {
    bridge,
    service,
    readDirectory,
    findFiles,
    refreshFiles,
    publish: async (patch: Partial<WorkspaceBridgeState>) => {
      current = { ...current, ...patch };
      source.update(current);
      await flush();
    },
  };
}

describe("workspace files", () => {
  it("names the root and fires when it arrives", async () => {
    const { service, publish } = workspace({ rootPath: undefined });
    expect(service.rootPath).toBeUndefined();
    const events: omnigent.ChangedFilesChangeEvent[] = [];
    service.onDidChangeChangedFiles((event) => events.push(event));
    await publish({ rootPath: "/w" });
    expect(service.rootPath).toBe("/w");
    expect(events.at(-1)?.rootPath).toBe("/w");
  });

  it("lists folders with paths in the form they were asked for, frozen", async () => {
    const { service, readDirectory } = workspace();
    const root = await service.readDirectory("");
    expect(root.map((entry) => [entry.path, entry.type])).toEqual([
      ["a.ts", "file"],
      ["src", "directory"],
    ]);
    expect(root[0]).toEqual({ path: "a.ts", name: "a.ts", type: "file", bytes: 4, modifiedAt: 9 });
    expect(Object.isFrozen(root) && Object.isFrozen(root[0])).toBe(true);
    expect((await service.readDirectory("src/")).map((entry) => entry.path)).toEqual(["src/x.ts"]);
    expect(readDirectory).toHaveBeenLastCalledWith("src");
    expect((await service.readDirectory("/etc")).map((entry) => entry.path)).toEqual(["/etc/x.ts"]);
    expect((await service.readDirectory("/")).map((entry) => entry.path)).toEqual(["/x.ts"]);
  });

  it("refuses a path that climbs out of the workspace, and lists nothing without one", async () => {
    const { service, readDirectory, publish } = workspace();
    await expect(service.readDirectory("../etc")).rejects.toThrow(/cannot contain/);
    await expect(service.readDirectory(42 as unknown as string)).rejects.toThrow(/folder path/);
    await publish({ sessionId: null });
    await expect(service.readDirectory("")).rejects.toMatchObject({ name: "FileSystemError" });
    expect(readDirectory).not.toHaveBeenCalled();
  });

  it.each([
    [new WorkspaceUnavailableError(), "Unavailable", []],
    [new RunnerOfflineError(), "RunnerOffline", []],
    [new PathUnreachableError("outside", ["/w", "/data"]), "NoPermissions", ["/w", "/data"]],
    [new Error("500"), "Unknown", []],
  ])("rejects with a FileSystemError naming why (%s)", async (error, code, roots) => {
    const { service } = workspace({}, { readDirectory: () => Promise.reject(error) });
    await expect(service.readDirectory("")).rejects.toMatchObject({
      name: "FileSystemError",
      code,
      reachableRoots: roots,
      message: error.message,
    });
  });

  it("finds files by name with globs in a folder, paths in its form", async () => {
    const { service, findFiles } = workspace();
    const result = await service.findFiles({
      pattern: " app ",
      include: "*.ts",
      exclude: "dist/**",
      location: "src",
    });
    expect(findFiles).toHaveBeenCalledWith(
      { pattern: "app", include: "*.ts", exclude: "dist/**", location: "src" },
      expect.any(AbortSignal),
    );
    expect(result).toEqual({
      files: [{ path: "src/src/x.ts", name: "x.ts", type: "file", bytes: 4, modifiedAt: 9 }],
      limitHit: true,
    });
    await expect(service.findFiles({ pattern: "  " })).rejects.toThrow(/needs a pattern/);
  });

  it("cancels a file search", async () => {
    let signal: AbortSignal | undefined;
    const { service } = workspace(
      {},
      {
        findFiles: (_query, abort) => {
          signal = abort;
          return new Promise(() => {});
        },
      },
    );
    const source = new CancellationTokenSource();
    const pending = service.findFiles({ pattern: "a" }, source.token);
    source.cancel();
    await expect(pending).rejects.toMatchObject({ name: "Canceled" });
    expect(signal?.aborted).toBe(true);
    const cancelled = new CancellationTokenSource();
    cancelled.cancel();
    await expect(service.findFiles({ pattern: "a" }, cancelled.token)).rejects.toMatchObject({
      name: "Canceled",
    });
  });

  it("says when the files changed on disk, not on a switch", async () => {
    const { service, publish } = workspace();
    const events: omnigent.FilesChangeEvent[] = [];
    service.onDidChangeFiles((event) => events.push(event));
    await publish({ filesRevision: 1 });
    expect(events).toEqual([{ sessionId: "s1" }]);
    await publish({ sessionId: "s2", filesRevision: 2 });
    expect(events).toHaveLength(1);
  });

  it("refreshes the files of the workspace on screen through omnigent.refreshFiles", async () => {
    const { bridge, refreshFiles } = workspace();
    const runtime = createExtensionRuntime({
      registry: new RailViewRegistry(),
      bridge,
      builtIns: [],
    });
    await runtime.commands.execute("omnigent.refreshFiles", [], () => {});
    expect(refreshFiles).toHaveBeenCalledOnce();
    await runtime.dispose();
  });

  it("lets the shell run extension commands through the bridge while a host runs", async () => {
    const { bridge } = workspace();
    await expect(bridge.executeCommand("x.y")).rejects.toThrow(/no extension host/);
    const runtime = createExtensionRuntime({
      registry: new RailViewRegistry(),
      bridge,
      builtIns: [],
    });
    const handler = vi.fn((...args: unknown[]) => args.length);
    runtime.commands.register("pub.ext", "pub.ext.run", handler);
    await expect(bridge.executeCommand("pub.ext.run", "a", { b: 1 })).resolves.toBe(2);
    expect(handler).toHaveBeenCalledWith("a", { b: 1 });
    await runtime.dispose();
    await expect(bridge.executeCommand("pub.ext.run")).rejects.toThrow(/no extension host/);
  });
});

const VIEW = "pub.files.view";
const MANIFEST = {
  views: {
    "omnigent.rightPanel": [
      {
        id: VIEW,
        name: "Files",
        location: true,
        filter: {
          placeholder: "Find",
          fields: [
            { id: "include", label: "files to include", placeholder: "*.ts" },
            { id: "exclude", label: "files to exclude" },
          ],
        },
      },
    ],
  },
  menus: {
    "view/title": [
      { submenu: OPEN_IN_SUBMENU, group: "navigation" },
      { command: TOGGLE_FILTER_FIELDS_COMMAND, group: "filter", tooltip: "Globs" },
    ],
  },
};

interface Node {
  readonly id: string;
  readonly parent?: Node;
}

function views() {
  const registry = new RailViewRegistry();
  const state = { session: "s1" as string | undefined, changed: new EventEmitter<unknown>() };
  const service = new ViewsService({
    registry,
    contextKeys: new ContextKeyService(),
    executeCommand: () => Promise.resolve(),
    showError: () => {},
    workspace: {
      get activeSessionId() {
        return state.session;
      },
      onDidChangeChangedFiles: state.changed.event,
    },
  });
  const { contributions, warnings } = parseContributions("pub.files", MANIFEST);
  expect(warnings).toEqual([]);
  service.addExtension("pub.files", contributions);
  service.extensionSettled("pub.files");
  const a: Node = { id: "a" };
  const b: Node = { id: "b", parent: a };
  const c: Node = { id: "c", parent: b };
  const tree = service.createTreeView<Node>(
    "pub.files",
    VIEW,
    {
      treeDataProvider: {
        getChildren: (node) =>
          node === undefined ? [a] : node === a ? [b] : node === b ? [c] : [],
        getTreeItem: (node) => ({
          id: node.id,
          label: node.id,
          collapsibleState: node === c ? 0 : 1,
        }),
        getParent: (node) => node.parent,
      },
    },
    vi.fn(),
  );
  const view = () => registry.get(VIEW)!;
  const switchTo = (session: string) => {
    state.session = session;
    state.changed.fire({});
  };
  return { registry, service, tree, view, switchTo, nodes: { a, b, c } };
}

describe("tree view reveal and selection", () => {
  it("asks the drawn tree of the session on screen to open the ancestors and show the row", async () => {
    const { tree, view, nodes } = views();
    await tree.reveal(nodes.c, { focus: true, expand: true });
    const model = view().tree!;
    expect(model.takeReveal?.("s2")).toBeUndefined();
    expect(model.takeReveal?.("s1")).toEqual({
      handle: "id:c",
      ancestors: ["id:a", "id:b"],
      select: true,
      focus: true,
      expand: 1,
    });
    expect(model.takeReveal?.("s1")).toBeUndefined();
  });

  it("tells a drawn tree a reveal is waiting", async () => {
    const { tree, view, nodes } = views();
    const listener = vi.fn();
    view().tree!.subscribeReveal?.(listener);
    await tree.reveal(nodes.b, { select: false });
    expect(listener).toHaveBeenCalledOnce();
    expect(view().tree!.takeReveal?.("s1")).toMatchObject({ handle: "id:b", select: false });
  });

  it("needs getParent and item ids", async () => {
    const registry = new RailViewRegistry();
    const model = createTreeViewModel<string>(
      { getChildren: () => [], getTreeItem: (label) => ({ label }) },
      { executeCommand: () => Promise.resolve(), logError: () => {} },
    );
    await expect(model.reveal("x", undefined, "s1")).rejects.toThrow(/getParent/);
    const withParent = createTreeViewModel<string>(
      { getChildren: () => [], getTreeItem: (label) => ({ label }), getParent: () => undefined },
      { executeCommand: () => Promise.resolve(), logError: () => {} },
    );
    await expect(withParent.reveal("x", undefined, "s1")).rejects.toThrow(/TreeItem.id/);
    expect(registry.getSnapshot().views).toEqual([]);
  });

  it("reports the rows the user selected as elements", async () => {
    const { tree, view, nodes } = views();
    const model = view().tree!;
    await model.getChildren(undefined);
    await model.getChildren("id:a");
    const events: (readonly Node[])[] = [];
    tree.onDidChangeSelection((event) => events.push(event.selection));
    model.select?.(["id:b"]);
    model.select?.(["id:b"]);
    model.select?.(["id:gone"]);
    expect(events).toEqual([[nodes.b], []]);
    expect(tree.selection).toEqual([]);
  });
});

describe("tree view location and filter fields", () => {
  it("keeps the location as checked plain data and reports a picked folder", () => {
    const { tree, view, switchTo } = views();
    expect(view().locationBar).toBe(true);
    tree.location = { path: "/w/src", root: "/w", error: "nope" };
    expect(view().location).toEqual({ path: "/w/src", root: "/w", error: "nope" });
    tree.location = { path: "", root: "/w" };
    expect(view().location).toBeUndefined();
    const picked: string[] = [];
    tree.onDidChangeLocation((path) => picked.push(path));
    view().host!.navigate("s1", "/etc");
    view().host!.navigate("s2", "/tmp");
    switchTo("s2");
    view().host!.navigate("s2", "/tmp");
    expect(picked).toEqual(["/etc", "/tmp"]);
  });

  it("keeps the filter's fields per session and fires the filter change for them", () => {
    const { tree, view, switchTo } = views();
    const host = view().host!;
    expect(view().filter?.fields?.map((field) => field.id)).toEqual(["include", "exclude"]);
    const changes: string[] = [];
    tree.onDidChangeFilter((text) => changes.push(text));
    host.setFilterFields("s1", { include: "*.ts", stray: "x" } as Record<string, string>);
    expect(tree.filterFields).toEqual({ include: "*.ts", exclude: "" });
    expect(changes).toEqual([""]);
    switchTo("s2");
    expect(tree.filterFields).toEqual({ include: "", exclude: "" });
    expect(changes).toEqual(["", ""]);
    expect(host.getFilterFields("s1")).toEqual({ include: "*.ts", exclude: "" });
  });

  it("lets the extension set the filter text, so the drawn field shows it", () => {
    const { tree, view } = views();
    view().host!.setFilter("s1", "query");
    const revision = view().filterRevision;
    const changes: string[] = [];
    tree.onDidChangeFilter((text) => changes.push(text));
    tree.setFilter("");
    expect(tree.filter).toBe("");
    expect(view().filterRevision).toBe(revision + 1);
    expect(changes).toEqual([""]);
    tree.setFilter("");
    expect(view().filterRevision).toBe(revision + 1);
  });

  it("draws the Open In menu and the fields toggle as host controls", () => {
    const { view } = views();
    expect(view().actions.map((action) => [action.id, action.kind, action.group])).toEqual([
      [OPEN_IN_SUBMENU, "openIn", "navigation"],
      [TOGGLE_FILTER_FIELDS_COMMAND, "filterFields", "filter"],
    ]);
    expect(view().actions[1].tooltip).toBe("Globs");
  });

  it("warns about malformed filter fields", () => {
    const { warnings } = parseContributions("pub.bad", {
      views: {
        "omnigent.rightPanel": [
          {
            id: "pub.bad.view",
            name: "Bad",
            filter: { placeholder: "x", fields: [{ id: "a" }, {}, { id: "a", label: "A" }] },
          },
          { id: "pub.bad.two", name: "Two", filter: { placeholder: "x", fields: "no" } },
        ],
      },
    });
    expect(warnings).toEqual([
      expect.stringContaining('"filter.fields[0]" needs a label'),
      expect.stringContaining('"filter.fields[1]" needs a unique "id"'),
      expect.stringContaining('"filter.fields" must be an array'),
    ]);
  });
});

describe("tree item labels", () => {
  it("keeps long text-match lines and paths, with their highlights", () => {
    const long = `${"x".repeat(300)}match`;
    const line = sanitizeTreeItem(
      { label: { label: long, highlights: [[300, 305]] }, line: 3 },
      "h",
    );
    expect(line.node.label).toHaveLength(305);
    expect(line.node.highlights).toEqual([[300, 305]]);
    const path = `${"dir/".repeat(80)}file.ts`;
    expect(sanitizeTreeItem({ label: path, resourceUri: { path } }, "p").node.label).toBe(path);
    expect(sanitizeTreeItem({ label: "y".repeat(300) }, "plain").node.label).toHaveLength(200);
  });
});
