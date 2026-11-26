// @vitest-environment node
// The Files view's pure logic: the tree, the change overlay, the order, the
// locations, the search results and the tree items.
import { describe, expect, it } from "vitest";
import { compareChangedFiles } from "@/shell/changedFilesOrder";
import {
  buildTree,
  compareFiles,
  type Entry,
  joinLocation,
  lazyChildren,
  locationOf,
  relativeTo,
  scopeChanges,
  searchView,
  type SortOrder,
  statusMaps,
  treeItemFor,
  visibleNodes,
} from "./filesModel";

const CollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;
const entry = (path: string, type: Entry["type"] = "file", bytes: number | null = 1): Entry => ({
  path,
  name: path.split("/").at(-1) ?? path,
  type,
  bytes,
  modifiedAt: null,
});
const change = (path: string, status: "added" | "modified" | "deleted" = "modified") => ({
  path,
  name: path.split("/").at(-1) ?? path,
  repositoryRoot: undefined,
  status,
  bytes: 1,
  modifiedAt: null,
  linesAdded: null,
  linesRemoved: null,
});
const names = (nodes: { name: string }[]) => nodes.map((node) => node.name);

describe("order", () => {
  it.each<SortOrder>(["alpha", "recent", "size", "type"])("sorts as core does (%s)", (sort) => {
    const files = [
      { name: "b.ts", path: "b.ts", bytes: 5, modifiedAt: 2 },
      { name: "a.md", path: "a.md", bytes: null, modifiedAt: null },
      { name: "c.css", path: "c.css", bytes: 9, modifiedAt: 7 },
      { name: "d.ts", path: "d.ts", bytes: 5, modifiedAt: 2 },
    ];
    const core = files
      .map((file) => ({ ...file, modified_at: file.modifiedAt }))
      .sort(compareChangedFiles(sort))
      .map((file) => file.path);
    expect([...files].sort(compareFiles(sort)).map((file) => file.path)).toEqual(core);
  });
});

describe("locations", () => {
  it("sends folders inside the workspace relative, others absolute", () => {
    expect(locationOf(null, "/w")).toBe("");
    expect(locationOf("/w", "/w/")).toBe("");
    expect(locationOf("/w/src", "/w")).toBe("src");
    expect(locationOf("/w-old/src", "/w")).toBe("/w-old/src");
    expect(locationOf("/etc", undefined)).toBe("/etc");
  });

  it("joins and relativizes paths", () => {
    expect(joinLocation("", "a")).toBe("a");
    expect(joinLocation("/", "etc")).toBe("/etc");
    expect(joinLocation("src", "a.ts")).toBe("src/a.ts");
    expect(relativeTo("src", "src/a.ts")).toBe("a.ts");
    expect(relativeTo("src", "srcx/a.ts")).toBeUndefined();
    expect(relativeTo("", "/etc/hosts")).toBeUndefined();
    expect(relativeTo("/", "/etc")).toBe("etc");
  });
});

describe("tree", () => {
  it("puts folders first and keeps listed folders lazy", () => {
    const roots = buildTree([entry("b.ts"), entry("src", "directory"), entry("a.ts")], []);
    expect(names(roots)).toEqual(["src", "a.ts", "b.ts"]);
    expect(roots[0]).toMatchObject({ kind: "dir", lazy: true, children: [] });
  });

  it("adds changed files the listing lacks, with the folders on their paths", () => {
    const changes = scopeChanges([change("gone.ts", "deleted"), change("src/new.ts", "added")], "");
    const roots = buildTree([entry("src", "directory"), entry("kept.ts")], changes);
    expect(names(roots)).toEqual(["src", "gone.ts", "kept.ts"]);
    const src = roots[0];
    expect(src.kind === "dir" && names(src.children)).toEqual(["new.ts"]);
    const deep = buildTree([], scopeChanges([change("a/b/c.ts")], ""));
    expect(deep[0]).toMatchObject({ kind: "dir", name: "a", lazy: false });
  });

  it("merges a folder's listing with the changes known under it", () => {
    const known = buildTree([], scopeChanges([change("src/lib/x.ts", "added")], ""));
    const src = known[0];
    if (src.kind !== "dir") throw new Error("expected a folder");
    const children = lazyChildren([entry("src/lib", "directory"), entry("src/a.ts")], src.children);
    expect(names(children)).toEqual(["lib", "a.ts"]);
    const lib = children[0];
    expect(lib.kind === "dir" && names(lib.children)).toEqual(["x.ts"]);
  });

  it("scopes changes to the browsed folder, and none outside the workspace", () => {
    const files = [change("src/a.ts"), change("docs/b.md")];
    expect(scopeChanges(files, "src").map((file) => file.path)).toEqual(["a.ts"]);
    expect(scopeChanges(files, "/etc")).toEqual([]);
  });

  it("rolls a folder's status up: added, then modified, then deleted", () => {
    const maps = statusMaps(
      scopeChanges(
        [change("a/x", "deleted"), change("a/y", "modified"), change("b/z", "deleted")],
        "",
      ),
    );
    expect(maps.folders.get("a")).toBe("modified");
    expect(maps.folders.get("b")).toBe("deleted");
    expect(maps.files.get("a/x")).toBe("deleted");
  });

  it("hides dot-prefixed names unless hidden files are shown", () => {
    const nodes = [entry(".env"), entry("a")];
    expect(names(visibleNodes(nodes, false))).toEqual(["a"]);
    expect(names(visibleNodes(nodes, true))).toEqual([".env", "a"]);
  });
});

describe("search results", () => {
  const complete = (paths: Entry[], limitHit = false) => ({
    query: "q",
    result: { files: paths.map((file) => ({ ...file })), limitHit },
    error: undefined,
  });

  it("lists folders first, then files, by the order, relative to the browsed folder", () => {
    const shown = searchView(
      complete([entry("src/b.ts"), entry("src/lib", "directory"), entry("src/a.ts")]),
      "src",
      true,
      "alpha",
      "show",
    );
    expect(shown.results.map((result) => result.entry.path)).toEqual(["lib", "a.ts", "b.ts"]);
    expect(shown.message).toBeUndefined();
  });

  it("words every state as the classic list did", () => {
    expect(
      searchView({ query: "q", result: undefined, error: undefined }, "", true, "alpha", "s")
        .message,
    ).toBe("Searching…");
    expect(
      searchView({ query: "q", result: undefined, error: "boom" }, "", true, "alpha", "s"),
    ).toMatchObject({
      message: "Search failed: boom",
      severity: "error",
    });
    expect(searchView(complete([]), "", true, "alpha", "s").message).toBe('No files match "q"');
    expect(
      searchView(complete([entry(".a/x"), entry(".b")]), "", false, "alpha", "show").message,
    ).toBe("2 matches in hidden directories. [Show hidden files](command:show)");
  });
});

describe("tree items", () => {
  const context = {
    location: "src",
    statuses: statusMaps(
      scopeChanges([change("src/a.ts", "deleted"), change("src/lib/b.ts", "added")], "src"),
    ),
    openFileCommand: "open",
    openFolderCommand: "folder",
    revealFolderCommand: "reveal",
  };

  it("names rows by location and path, with workspace paths and commands", () => {
    const [lib] = buildTree([entry("lib", "directory")], []);
    expect(treeItemFor(lib, context, CollapsibleState)).toMatchObject({
      id: "dir:src\u0000lib",
      label: "lib",
      resourceUri: { path: "src/lib" },
      iconPath: "folder",
      gitStatus: "added",
      collapsibleState: CollapsibleState.Collapsed,
      command: { command: "folder", arguments: ["lib"] },
    });
    const file = { kind: "file" as const, name: "a.ts", path: "a.ts", bytes: 3, modifiedAt: null };
    const item = treeItemFor(file, context, CollapsibleState);
    expect(item).toMatchObject({
      id: "file:src\u0000a.ts",
      resourceUri: { path: "src/a.ts" },
      gitStatus: "deleted",
      command: { command: "open", arguments: ["src/a.ts"] },
    });
    // A deleted file has no size.
    expect(item.size).toBeUndefined();
  });

  it("draws folder results as a path that reveals the folder", () => {
    const item = treeItemFor(
      { kind: "result", entry: entry("lib/deep", "directory") },
      context,
      CollapsibleState,
    );
    expect(item).toMatchObject({
      label: "lib/deep",
      iconPath: "folder",
      collapsibleState: CollapsibleState.None,
      command: { command: "reveal", arguments: ["lib/deep"] },
    });
  });

  it("draws a placeholder without a resource or command", () => {
    const item = treeItemFor(
      { kind: "placeholder", id: "p", text: "Loading…" },
      context,
      CollapsibleState,
    );
    expect(item).toEqual({ id: "p", label: "Loading…", collapsibleState: CollapsibleState.None });
  });
});
