import type * as omnigent from "omnigent";
import { describe, expect, it } from "vitest";
import { compareChangedFiles as coreCompare, groupChangedFiles } from "@/shell/changedFilesOrder";
import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";
import {
  buildChangesModel,
  buildFolderTree,
  type ChangeNode,
  compareChangedFiles,
  decorationFor,
  groupByRepository,
  isHiddenPath,
  normalizeMode,
  normalizeSortOrder,
  rollUpStatus,
  type SortOrder,
  treeItemFor,
  viewMessage,
} from "./changesModel";

const COLLAPSIBLE = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as typeof omnigent.TreeItemCollapsibleState;

function file(path: string, overrides: Partial<omnigent.ChangedFile> = {}): omnigent.ChangedFile {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    repositoryRoot: undefined,
    status: "modified",
    bytes: 10,
    modifiedAt: null,
    linesAdded: null,
    linesRemoved: null,
    ...overrides,
  };
}

const labels = (nodes: readonly ChangeNode[]): string[] =>
  nodes.map((node) =>
    node.kind === "repo"
      ? `repo:${node.root}`
      : node.kind === "folder"
        ? `${node.name}/`
        : node.file.name,
  );

function model(
  files: omnigent.ChangedFile[],
  overrides: Partial<Parameters<typeof buildChangesModel>[0]> = {},
) {
  return buildChangesModel({
    files,
    mode: "list",
    sort: "alpha",
    showHidden: true,
    query: "",
    ...overrides,
  });
}

describe("changes model", () => {
  it("normalizes stored modes and sort orders", () => {
    expect(normalizeMode("tree")).toBe("tree");
    expect(normalizeMode("list")).toBe("list");
    expect(normalizeMode(undefined)).toBe("list");
    expect(normalizeSortOrder("size")).toBe("size");
    expect(normalizeSortOrder("bogus")).toBe("alpha");
  });

  it("treats any dot-prefixed segment as hidden", () => {
    expect(isHiddenPath(".env")).toBe(true);
    expect(isHiddenPath("a/.github/ci.yml")).toBe(true);
    expect(isHiddenPath("a/b.c")).toBe(false);
  });

  it("orders files the same way as the file viewer's prev/next and the Files tree", () => {
    const files: WorkspaceChangedFile[] = [
      {
        path: "b.ts",
        name: "b.ts",
        status: "modified",
        bytes: 5,
        modified_at: 3,
        lines_added: null,
        lines_removed: null,
      },
      {
        path: "a.md",
        name: "a.md",
        status: "created",
        bytes: null,
        modified_at: 9,
        lines_added: null,
        lines_removed: null,
      },
      {
        path: "c.ts",
        name: "c.ts",
        status: "modified",
        bytes: 50,
        modified_at: null,
        lines_added: null,
        lines_removed: null,
      },
      {
        path: "d.css",
        name: "d.css",
        status: "deleted",
        bytes: 5,
        modified_at: 3,
        lines_added: null,
        lines_removed: null,
      },
    ];
    const asApi = files.map((entry) =>
      file(entry.path, {
        bytes: entry.bytes,
        modifiedAt: entry.modified_at,
        status: entry.status === "created" ? "added" : entry.status,
      }),
    );
    for (const sort of ["alpha", "recent", "size", "type"] as SortOrder[]) {
      const core = groupChangedFiles([...files], sort)[0].files.map((entry) => entry.path);
      expect([...asApi].sort(compareChangedFiles(sort)).map((entry) => entry.path)).toEqual(core);
      expect([...files].sort(coreCompare(sort)).map((entry) => entry.path)).toEqual(core);
    }
  });

  it("groups repositories by root with other files last", () => {
    const groups = groupByRepository([
      file("web/a.ts", { repositoryRoot: "web" }),
      file("notes.md"),
      file("api/a.ts", { repositoryRoot: "api" }),
    ]);
    expect(groups.map((group) => group.root)).toEqual(["api", "web", ""]);
  });

  it("builds a folder tree with folders first and rolled-up status", () => {
    const tree = buildFolderTree(
      [
        file("src/b.ts"),
        file("src/lib/a.ts", { status: "added" }),
        file("README.md", { status: "deleted" }),
      ],
      "",
    );
    expect(labels(tree)).toEqual(["src/", "README.md"]);
    const src = tree[0] as Extract<ChangeNode, { kind: "folder" }>;
    expect(labels(src.children)).toEqual(["lib/", "b.ts"]);
    expect(src.status).toBe("added");
    expect(rollUpStatus(["deleted", "modified"])).toBe("modified");
  });

  it("lists files flat with their folder as the subtitle, inside the repository", () => {
    const { roots } = model([file("web/src/app.ts", { repositoryRoot: "web" })]);
    const repo = roots[0] as Extract<ChangeNode, { kind: "repo" }>;
    expect(repo.count).toBe(1);
    expect(repo.children[0]).toMatchObject({ kind: "file", dir: "src" });
  });

  it("filters by name or full path, case-insensitively, keeping the sort", () => {
    const files = [file("src/Alpha.ts"), file("docs/beta.md"), file("src/gamma.ts")];
    expect(labels(model(files, { query: "ALPHA" }).roots)).toEqual(["Alpha.ts"]);
    expect(labels(model(files, { query: " src/ " }).roots)).toEqual(["Alpha.ts", "gamma.ts"]);
    expect(model(files, { query: "zzz" }).noMatch).toBe(true);
  });

  it("hides dot paths unless shown, and counts them", () => {
    const files = [file(".env"), file("api/.cache/x"), file("z.py")];
    const hidden = model(files, { showHidden: false });
    expect(labels(hidden.roots)).toEqual(["z.py"]);
    expect(hidden.hiddenCount).toBe(2);
    expect(hidden.allHidden).toBe(false);
    expect(model([file(".env")], { showHidden: false }).allHidden).toBe(true);
    expect(labels(model(files).roots)).toEqual([".env", "x", "z.py"]);
  });

  it("drops repository groups the filter empties", () => {
    const files = [
      file("api/src/app.ts", { repositoryRoot: "api" }),
      file("web/src/app.ts", { repositoryRoot: "web" }),
    ];
    expect(labels(model(files, { query: "api/" }).roots)).toEqual(["repo:api"]);
  });

  it("draws +N −M, only −N with zero added, and nothing for 0/0 or unknown counts", () => {
    expect(decorationFor(file("a", { linesAdded: 12, linesRemoved: 3 }))).toEqual({
      parts: [{ text: "+12", tone: "added" }, { text: " " }, { text: "−3", tone: "removed" }],
      title: "12 lines added, 3 removed",
    });
    expect(
      decorationFor(file("a", { linesAdded: 0, linesRemoved: 7 }))?.parts?.map((part) => part.text),
    ).toEqual(["+0", " ", "−7"]);
    expect(decorationFor(file("a", { linesAdded: 0, linesRemoved: 0 }))).toBeUndefined();
    expect(decorationFor(file("a"))).toBeUndefined();
  });

  it("turns nodes into tree items: list rows carry the size, deleted and tree rows do not", () => {
    const [row] = model([file("src/app.ts", { bytes: 2048 })]).roots;
    expect(treeItemFor(row, COLLAPSIBLE, "open")).toMatchObject({
      label: "app.ts",
      description: "src",
      size: 2048,
      command: { command: "open", arguments: ["src/app.ts"] },
    });
    const [gone] = model([file("gone.py", { status: "deleted", bytes: 5 })]).roots;
    expect(treeItemFor(gone, COLLAPSIBLE, "open").size).toBeUndefined();
    const [treeRow] = model([file("a.ts")], { mode: "tree" }).roots;
    expect(treeItemFor(treeRow, COLLAPSIBLE, "open").description).toBeUndefined();
    const [repo] = model([file("web/a.ts", { repositoryRoot: "web" })]).roots;
    expect(treeItemFor(repo, COLLAPSIBLE, "open")).toMatchObject({
      label: "web",
      description: "1",
      tooltip: "web, 1 changed files",
      iconPath: "git-branch",
    });
  });

  it("says why there are no rows, as the classic list did", () => {
    const empty = model([]);
    const message = (files: omnigent.ChangedFile[] | undefined, error?: string, query = "") =>
      viewMessage(
        { files, error, query },
        files ? model(files, { showHidden: false, query }) : empty,
        "show",
      );
    expect(message(undefined, "500 Internal Server Error")).toEqual({
      message: "Failed to load: 500 Internal Server Error",
      severity: "error",
    });
    expect(message(undefined).message).toBe("Loading…");
    expect(message([]).message).toBe("No workspace changes yet");
    expect(message([file(".env")]).message).toBe(
      "All changes are in hidden files. [Click to show](command:show)",
    );
    expect(message([file("a.ts")], undefined, "zz").message).toBe('No changed files match "zz"');
    expect(message([file("a.ts"), file(".env")]).message).toBe(
      "1 file hidden. [Click to show](command:show)",
    );
    expect(message([file("a.ts"), file(".env"), file(".b")]).message).toBe(
      "2 files hidden. [Click to show](command:show)",
    );
    expect(message([file("a.ts")]).message).toBeUndefined();
  });
});
