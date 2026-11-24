// Pure logic of the Changes view: filtering, sorting, repository groups, and the
// list and folder tree it shows. No API calls, so it is tested on its own.
import type * as omnigent from "omnigent";

export type ViewMode = "list" | "tree";
export type SortOrder = "alpha" | "recent" | "size" | "type";
type Status = omnigent.ChangedFile["status"];
type ChangedFile = omnigent.ChangedFile;

export type ChangeNode =
  | { kind: "repo"; id: string; root: string; count: number; children: ChangeNode[] }
  | {
      kind: "folder";
      id: string;
      name: string;
      path: string;
      status: Status;
      children: ChangeNode[];
    }
  | { kind: "file"; id: string; file: ChangedFile; dir: string | undefined };

const OTHER_FILES = "Other files";
// U+2212, as the Changes list draws it.
const MINUS = "−";

export function normalizeMode(value: unknown): ViewMode {
  return value === "tree" ? "tree" : "list";
}

export function normalizeSortOrder(value: unknown): SortOrder {
  return value === "recent" || value === "size" || value === "type" ? value : "alpha";
}

/** A path with any dot-prefixed segment, such as `.github/x` or `a/.env`. */
export function isHiddenPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function byNullableDescending(
  left: number | null,
  right: number | null,
  a: ChangedFile,
  b: ChangedFile,
): number {
  if (left === null && right === null) return a.path.localeCompare(b.path);
  if (left === null) return 1;
  if (right === null) return -1;
  if (left !== right) return right - left;
  return a.path.localeCompare(b.path);
}

/** The Files views' order: by path, newest first, largest first, or by extension. */
export function compareChangedFiles(sort: SortOrder) {
  return (a: ChangedFile, b: ChangedFile): number => {
    if (sort === "recent") return byNullableDescending(a.modifiedAt, b.modifiedAt, a, b);
    if (sort === "size") return byNullableDescending(a.bytes, b.bytes, a, b);
    if (sort === "type") {
      const left = fileExtension(a.name);
      const right = fileExtension(b.name);
      if (left !== right) return left.localeCompare(right);
    }
    return a.path.localeCompare(b.path);
  };
}

/** Files grouped by repository: groups by root with "Other files" last, files sorted. */
export function groupByRepository(files: readonly ChangedFile[], sort: SortOrder = "alpha") {
  const groups = new Map<string, ChangedFile[]>();
  for (const file of files) {
    const root = file.repositoryRoot ?? "";
    const group = groups.get(root) ?? [];
    group.push(file);
    groups.set(root, group);
  }
  return [...groups]
    .sort(([left], [right]) => (left === "" ? 1 : right === "" ? -1 : left.localeCompare(right)))
    .map(([root, groupFiles]) => ({ root, files: groupFiles.sort(compareChangedFiles(sort)) }));
}

function displayPath(file: ChangedFile): string {
  const root = file.repositoryRoot;
  return root && file.path.startsWith(`${root}/`) ? file.path.slice(root.length + 1) : file.path;
}

/** The flat rows of one group: each file with its folder as the subtitle. */
function listNodes(files: readonly ChangedFile[]): ChangeNode[] {
  return files.map((file) => {
    const shown = displayPath(file);
    const slash = shown.lastIndexOf("/");
    return {
      kind: "file",
      id: `list:${file.path}`,
      file,
      dir: slash > 0 ? shown.slice(0, slash) : "",
    };
  });
}

const STATUS_PRIORITY: Record<Status, number> = { added: 3, modified: 2, deleted: 1 };

/** The strongest status: added, then modified, then deleted (as the Files tree). */
export function rollUpStatus(statuses: Iterable<Status>): Status | undefined {
  let strongest: Status | undefined;
  for (const status of statuses) {
    if (!strongest || STATUS_PRIORITY[status] > STATUS_PRIORITY[strongest]) strongest = status;
  }
  return strongest;
}

interface Folder {
  name: string;
  path: string;
  folders: Map<string, Folder>;
  files: ChangedFile[];
}

/** A folder tree of one group's files: folders first, by path; files in `sort` order. */
export function buildFolderTree(
  files: readonly ChangedFile[],
  root: string,
  sort: SortOrder = "alpha",
): ChangeNode[] {
  const top: Folder = { name: "", path: "", folders: new Map(), files: [] };
  for (const file of files) {
    const parts = displayPath(file).split("/");
    let folder = top;
    for (const part of parts.slice(0, -1)) {
      let next = folder.folders.get(part);
      if (!next) {
        const relative = folder.path ? `${folder.path}/${part}` : part;
        next = { name: part, path: relative, folders: new Map(), files: [] };
        folder.folders.set(part, next);
      }
      folder = next;
    }
    folder.files.push(file);
  }
  const convert = (folder: Folder): { nodes: ChangeNode[]; statuses: Status[] } => {
    const statuses: Status[] = [];
    const folderNodes: ChangeNode[] = [...folder.folders.values()]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((child) => {
        const converted = convert(child);
        statuses.push(...converted.statuses);
        return {
          kind: "folder",
          id: `dir:${root}\u0000${child.path}`,
          name: child.name,
          path: root ? `${root}/${child.path}` : child.path,
          status: rollUpStatus(converted.statuses) ?? "modified",
          children: converted.nodes,
        };
      });
    const fileNodes: ChangeNode[] = [...folder.files]
      .sort(compareChangedFiles(sort))
      .map((file) => {
        statuses.push(file.status);
        return { kind: "file", id: `file:${file.path}`, file, dir: undefined };
      });
    return { nodes: [...folderNodes, ...fileNodes], statuses };
  };
  return convert(top).nodes;
}

export interface ChangesInput {
  files: readonly ChangedFile[];
  mode: ViewMode;
  sort: SortOrder;
  showHidden: boolean;
  /** The view's filter text; matched case-insensitively against names and paths. */
  query: string;
}

export interface ChangesModel {
  roots: ChangeNode[];
  /** Files in hidden directories that are not shown. */
  hiddenCount: number;
  /** Every file is hidden. */
  allHidden: boolean;
  /** No file matches the query (and some would be shown without it). */
  noMatch: boolean;
}

/**
 * The view's roots: repository groups when any file has a repository root, else
 * the list or folder tree directly. Groups and their files keep the sort order;
 * the query only filters, so typing never re-sorts.
 */
export function buildChangesModel(input: ChangesInput): ChangesModel {
  const { files, mode, sort, showHidden } = input;
  const visible = showHidden ? [...files] : files.filter((file) => !isHiddenPath(file.path));
  const query = input.query.trim().toLowerCase();
  const groups = groupByRepository(visible, sort)
    .map(({ root, files: groupFiles }) => ({
      root,
      files:
        query === ""
          ? groupFiles
          : groupFiles.filter(
              (file) =>
                file.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query),
            ),
    }))
    .filter((group) => group.files.length > 0);
  const content = (group: { root: string; files: ChangedFile[] }) =>
    mode === "tree" ? buildFolderTree(group.files, group.root, sort) : listNodes(group.files);
  const grouped = files.some((file) => file.repositoryRoot);
  const roots: ChangeNode[] = grouped
    ? groups.map((group) => ({
        kind: "repo",
        id: `repo:${group.root}`,
        root: group.root,
        count: group.files.length,
        children: content(group),
      }))
    : groups.length > 0
      ? content(groups[0])
      : [];
  return {
    roots,
    hiddenCount: files.length - visible.length,
    allHidden: files.length > 0 && visible.length === 0,
    noMatch: visible.length > 0 && groups.length === 0,
  };
}

/** `+N −M` as the Changes list shows it; undefined when both are zero or unknown. */
export function decorationFor(file: ChangedFile): omnigent.TreeItemDecoration | undefined {
  const { linesAdded: added, linesRemoved: removed } = file;
  if ((added ?? 0) === 0 && (removed ?? 0) === 0) return undefined;
  const parts: omnigent.TreeItemDecorationPart[] = [];
  if (added !== null) parts.push({ text: `+${added}`, tone: "added" });
  if (added !== null && removed !== null) parts.push({ text: " " });
  if (removed !== null) parts.push({ text: `${MINUS}${removed}`, tone: "removed" });
  const title = [added !== null && `${added} lines added`, removed !== null && `${removed} removed`]
    .filter(Boolean)
    .join(", ");
  return { parts, title };
}

export function treeItemFor(
  node: ChangeNode,
  collapsible: typeof omnigent.TreeItemCollapsibleState,
  openFileCommand: string,
): omnigent.TreeItem {
  if (node.kind === "repo") {
    const name = node.root || OTHER_FILES;
    return {
      id: node.id,
      label: name,
      description: String(node.count),
      tooltip: `${name}, ${node.count} changed files`,
      iconPath: node.root ? "git-branch" : undefined,
      collapsibleState: collapsible.Expanded,
    };
  }
  if (node.kind === "folder") {
    return {
      id: node.id,
      label: node.name,
      resourceUri: { path: node.path },
      iconPath: "folder",
      gitStatus: node.status,
      collapsibleState: collapsible.Expanded,
    };
  }
  const { file } = node;
  return {
    id: node.id,
    label: file.name,
    description: node.dir,
    tooltip: file.path,
    resourceUri: { path: file.path },
    iconPath: "file",
    gitStatus: file.status,
    decoration: decorationFor(file),
    collapsibleState: collapsible.None,
    command: { command: openFileCommand, title: "Open File", arguments: [file.path] },
    // The list shows the size at rest; a deleted file has none.
    ...(node.dir !== undefined && file.bytes !== null && file.status !== "deleted"
      ? { size: file.bytes }
      : {}),
  };
}

const plural = (count: number) => (count === 1 ? "" : "s");

/** What the view shows above or instead of its rows, as the classic Changes list did. */
export function viewMessage(
  state: {
    files: readonly ChangedFile[] | undefined;
    error: string | undefined;
    query: string;
  },
  model: ChangesModel,
  showHiddenCommand: string,
): { message: string | undefined; severity: "info" | "error" | undefined } {
  if (state.error !== undefined) {
    return { message: `Failed to load: ${state.error}`, severity: "error" };
  }
  if (state.files === undefined) return { message: "Loading…", severity: undefined };
  if (state.files.length === 0) {
    return { message: "No workspace changes yet", severity: undefined };
  }
  const show = `[Click to show](command:${showHiddenCommand})`;
  if (model.allHidden) {
    return { message: `All changes are in hidden files. ${show}`, severity: undefined };
  }
  if (model.noMatch) {
    return { message: `No changed files match "${state.query.trim()}"`, severity: undefined };
  }
  if (model.hiddenCount > 0) {
    return {
      message: `${model.hiddenCount} file${plural(model.hiddenCount)} hidden. ${show}`,
      severity: undefined,
    };
  }
  return { message: undefined, severity: undefined };
}
