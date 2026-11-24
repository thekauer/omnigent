// Pure logic of the Files view: the folder tree of a browsed location with the
// session's changed files laid over it, lazy folders, sorting, hidden files,
// the search results list and every message the view shows. No API calls, so
// it is tested on its own.
import type * as omnigent from "omnigent";

export type SortOrder = "alpha" | "recent" | "size" | "type";
export type Status = omnigent.ChangedFile["status"];

/** An entry relative to the browsed location (`path` is `src/app.ts` under it). */
export interface Entry {
  readonly path: string;
  readonly name: string;
  readonly type: omnigent.FileType;
  readonly bytes: number | null;
  readonly modifiedAt: number | null;
}

export interface FileNode {
  readonly kind: "file";
  readonly name: string;
  /** Relative to the browsed location. */
  readonly path: string;
  readonly bytes: number | null;
  readonly modifiedAt: number | null;
}

export interface DirNode {
  readonly kind: "dir";
  readonly name: string;
  /** Relative to the browsed location. */
  readonly path: string;
  /** Known children: those of changed files under it, for a folder that is listed lazily. */
  children: TreeNode[];
  /** When known (a listed folder), so folders take part in the "last edited" order. */
  readonly modifiedAt?: number | null;
  /** Listed on demand: its children come from a listing of the folder. */
  readonly lazy: boolean;
}

export type TreeNode = FileNode | DirNode;

/** A muted line under a folder ("Loading…") or above the rows. */
export interface PlaceholderNode {
  readonly kind: "placeholder";
  readonly id: string;
  readonly text: string;
}

/** A search result: a matched file or folder, path relative to the browsed location. */
export interface ResultNode {
  readonly kind: "result";
  readonly entry: Entry;
}

export type FilesElement = TreeNode | PlaceholderNode | ResultNode;

export function normalizeSortOrder(value: unknown): SortOrder {
  return value === "recent" || value === "size" || value === "type" ? value : "alpha";
}

export const isHiddenName = (name: string) => name.startsWith(".");

/** A path with any dot-prefixed segment, such as `.github/x` or `a/.env`. */
export function isHiddenPath(path: string): boolean {
  return path.split("/").some(isHiddenName);
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

interface Sortable {
  readonly name: string;
  readonly path: string;
  readonly bytes: number | null;
  readonly modifiedAt: number | null;
}

function byNullableDescending(
  left: number | null,
  right: number | null,
  a: Sortable,
  b: Sortable,
): number {
  if (left === null && right === null) return a.path.localeCompare(b.path);
  if (left === null) return 1;
  if (right === null) return -1;
  if (left !== right) return right - left;
  return a.path.localeCompare(b.path);
}

/** The Files views' order (core's `compareChangedFiles`): path, newest, largest, or extension. */
export function compareFiles(sort: SortOrder) {
  return (a: Sortable, b: Sortable): number => {
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

function sortableOf(node: TreeNode): Sortable {
  if (node.kind === "file") return node;
  // A folder has a name and (when listed) an mtime, but never a size.
  return { name: node.name, path: node.path, bytes: null, modifiedAt: node.modifiedAt ?? null };
}

/** Folders ahead of files, then each group in `sort` order. */
export function compareNodes(sort: SortOrder) {
  const compare = compareFiles(sort);
  return (a: TreeNode, b: TreeNode): number => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return compare(sortableOf(a), sortableOf(b));
  };
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/**
 * The browsed folder as the API takes it: "" for the root, workspace-relative
 * inside the workspace, absolute outside it. Inside is sent relative because
 * the server lets only owners list absolute paths.
 */
export function locationOf(browse: string | null, root: string | undefined): string {
  if (!browse) return "";
  if (!root) return browse;
  const trimmed = root.replace(/\/$/, "");
  if (browse === trimmed) return "";
  return browse.startsWith(`${trimmed}/`) ? browse.slice(trimmed.length + 1) : browse;
}

/** Joins a location and a path relative to it. */
export function joinLocation(location: string, relative: string): string {
  if (!relative) return location;
  if (!location) return relative;
  return location === "/" ? `/${relative}` : `${location}/${relative}`;
}

/** A path in the API's form, relative to `location` (undefined when outside it). */
export function relativeTo(location: string, path: string): string | undefined {
  if (!location) return path.startsWith("/") ? undefined : path;
  if (path === location) return "";
  const prefix = location === "/" ? "/" : `${location}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}

/** The absolute folder shown: the browsed one, else the workspace root. */
export function workingDirOf(browse: string | null, root: string | undefined): string | undefined {
  return browse ?? root;
}

// ---------------------------------------------------------------------------
// Changed files over the listing
// ---------------------------------------------------------------------------

export interface ScopedChange {
  /** Relative to the browsed location. */
  readonly path: string;
  readonly name: string;
  readonly status: Status;
  readonly bytes: number | null;
  readonly modifiedAt: number | null;
}

/**
 * The changed files under the browsed location, relative to it. Changed files
 * are workspace-relative, so a folder outside the workspace has none.
 */
export function scopeChanges(
  files: readonly omnigent.ChangedFile[],
  location: string,
): ScopedChange[] {
  if (location.startsWith("/")) return [];
  return files.flatMap((file) => {
    const path = relativeTo(location, file.path);
    return path
      ? [
          {
            path,
            name: file.name,
            status: file.status,
            bytes: file.bytes,
            modifiedAt: file.modifiedAt,
          },
        ]
      : [];
  });
}

const STATUS_PRIORITY: Record<Status, number> = { added: 3, modified: 2, deleted: 1 };

export interface StatusMaps {
  readonly files: ReadonlyMap<string, Status>;
  /** Each folder's strongest status of anything inside: added, then modified, then deleted. */
  readonly folders: ReadonlyMap<string, Status>;
}

export function statusMaps(changes: readonly ScopedChange[]): StatusMaps {
  const folders = new Map<string, Status>();
  for (const change of changes) {
    const parts = change.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const folder = parts.slice(0, index).join("/");
      const existing = folders.get(folder);
      if (!existing || STATUS_PRIORITY[change.status] > STATUS_PRIORITY[existing]) {
        folders.set(folder, change.status);
      }
    }
  }
  return { files: new Map(changes.map((change) => [change.path, change.status])), folders };
}

function childDir(parent: DirNode, name: string): DirNode {
  let dir = parent.children.find(
    (child): child is DirNode => child.kind === "dir" && child.name === name,
  );
  if (!dir) {
    dir = {
      kind: "dir",
      name,
      path: parent.path ? `${parent.path}/${name}` : name,
      children: [],
      lazy: false,
    };
    parent.children.push(dir);
  }
  return dir;
}

/**
 * The tree of the browsed folder: its listing, plus changed files that are not
 * in it (deleted files, or created ones the listing has not caught up with),
 * with the folders on their paths. Listed folders are lazy; the others hold the
 * changed files under them.
 */
export function buildTree(
  listing: readonly Entry[],
  changes: readonly ScopedChange[],
  sort: SortOrder = "alpha",
): TreeNode[] {
  const root: DirNode = { kind: "dir", name: "", path: "", children: [], lazy: false };
  const known = new Set(listing.map((entry) => entry.path));
  const extra: Entry[] = changes
    .filter((change) => !known.has(change.path))
    .map((change) => ({
      path: change.path,
      name: change.name,
      type: "file",
      bytes: change.bytes,
      modifiedAt: change.modifiedAt,
    }));
  for (const entry of [...listing, ...extra]) {
    const parts = entry.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) node = childDir(node, part);
    const name = parts[parts.length - 1];
    if (entry.type === "directory") {
      // A folder created for a nested change stays as it is; it lists its own children.
      if (!node.children.some((child) => child.kind === "dir" && child.name === name)) {
        node.children.push({
          kind: "dir",
          name,
          path: entry.path,
          children: [],
          modifiedAt: entry.modifiedAt,
          lazy: true,
        });
      }
      continue;
    }
    node.children.push({
      kind: "file",
      name,
      path: entry.path,
      bytes: entry.bytes,
      modifiedAt: entry.modifiedAt,
    });
  }
  const compare = compareNodes(sort);
  const sortTree = (dir: DirNode) => {
    dir.children.sort(compare);
    for (const child of dir.children) if (child.kind === "dir") sortTree(child);
  };
  sortTree(root);
  return root.children;
}

/** A lazy folder's children: its listing, plus the changed files known under it. */
export function lazyChildren(
  entries: readonly Entry[],
  known: readonly TreeNode[],
  sort: SortOrder = "alpha",
): TreeNode[] {
  const nodes: TreeNode[] = entries.map((entry) =>
    entry.type === "directory"
      ? {
          kind: "dir",
          name: entry.name,
          path: entry.path,
          children: [],
          modifiedAt: entry.modifiedAt,
          lazy: true,
        }
      : {
          kind: "file",
          name: entry.name,
          path: entry.path,
          bytes: entry.bytes,
          modifiedAt: entry.modifiedAt,
        },
  );
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  for (const extra of known) {
    const existing = byPath.get(extra.path);
    if (existing?.kind === "dir" && extra.kind === "dir") {
      existing.children = extra.children;
    } else if (!existing) {
      nodes.push(extra);
      byPath.set(extra.path, extra);
    }
  }
  return nodes.sort(compareNodes(sort));
}

export function visibleNodes<T extends { readonly name: string }>(
  nodes: readonly T[],
  showHidden: boolean,
): T[] {
  return showHidden ? [...nodes] : nodes.filter((node) => !isHiddenName(node.name));
}

/** The parent folder's path of `path` ("" at the top). */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : "";
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const LOADING = "Loading…";
export const NO_FILES = "No files in workspace";
export const FOLDER_FAILED = "Failed to load this folder.";
export const ALL_HIDDEN = "All files are hidden. Click the eye icon to reveal them.";
export const SEARCHING = "Searching…";
const STOPPED_EARLY = "Search stopped early, so results may be incomplete.";

const plural = (count: number, word: string, suffix = "s") =>
  `${count} ${word}${count === 1 ? "" : suffix}`;

/** The view's line for a failed listing of the browsed folder. */
export function listingError(error: { code: string; message: string } | undefined): string {
  return `Failed to load: ${error?.message ?? "unknown error"}`;
}

/** The location bar's line for a folder the session may not browse. */
export function unreachableText(error: omnigent.FileSystemError): string {
  return error.reachableRoots.length > 0
    ? `${error.message}. Reachable: ${error.reachableRoots.join(", ")}`
    : error.message;
}

export interface SearchState {
  /** The query the results are for. */
  readonly query: string;
  readonly result: omnigent.FileSearchComplete | undefined;
  readonly error: string | undefined;
}

/** What a search shows: its result rows, and the line above them. */
export function searchView(
  state: SearchState,
  location: string,
  showHidden: boolean,
  sort: SortOrder,
  showHiddenCommand: string,
): { results: ResultNode[]; message: string | undefined; severity: "error" | undefined } {
  const { result, error } = state;
  if (error !== undefined) {
    return { results: [], message: `Search failed: ${error}`, severity: "error" };
  }
  if (!result) return { results: [], message: SEARCHING, severity: undefined };
  const entries: Entry[] = result.files.flatMap((file) => {
    const path = relativeTo(location, file.path);
    return path ? [{ ...file, path }] : [];
  });
  const truncated = result.limitHit;
  if (entries.length === 0) {
    return {
      results: [],
      message: `No files match "${state.query}"${truncated ? `. ${STOPPED_EARLY.replace("Search", "The search")}` : ""}`,
      severity: undefined,
    };
  }
  const visible = showHidden ? entries : entries.filter((entry) => !isHiddenPath(entry.path));
  if (visible.length === 0) {
    return {
      results: [],
      message: `${plural(entries.length, "match", "es")} in hidden directories. [Show hidden files](command:${showHiddenCommand})${truncated ? ` ${STOPPED_EARLY}` : ""}`,
      severity: undefined,
    };
  }
  // Folders first, as in the tree: a folder is a place to go.
  const compare = compareFiles(sort);
  const ordered = [...visible].sort((a, b) => {
    if ((a.type === "directory") !== (b.type === "directory"))
      return a.type === "directory" ? -1 : 1;
    return compare(a, b);
  });
  return {
    results: ordered.map((entry) => ({ kind: "result", entry })),
    message: truncated ? STOPPED_EARLY : undefined,
    severity: undefined,
  };
}

// ---------------------------------------------------------------------------
// Tree items
// ---------------------------------------------------------------------------

export interface ItemContext {
  /** The browsed location, in the API's form. */
  readonly location: string;
  readonly statuses: StatusMaps;
  readonly openFileCommand: string;
  readonly openFolderCommand: string;
  readonly revealFolderCommand: string;
}

/** Ids name rows per browsed location, so each location keeps its own open folders. */
export function nodeId(location: string, kind: "dir" | "file" | "result", path: string): string {
  return `${kind}:${location}\u0000${path}`;
}

export function treeItemFor(
  element: FilesElement,
  context: ItemContext,
  collapsible: typeof omnigent.TreeItemCollapsibleState,
): omnigent.TreeItem {
  const { location, statuses } = context;
  if (element.kind === "placeholder") {
    return { id: element.id, label: element.text, collapsibleState: collapsible.None };
  }
  if (element.kind === "result") {
    const { entry } = element;
    const path = joinLocation(location, entry.path);
    if (entry.type === "directory") {
      return {
        id: nodeId(location, "result", entry.path),
        label: entry.path,
        tooltip: path,
        resourceUri: { path },
        iconPath: "folder",
        collapsibleState: collapsible.None,
        command: { command: context.revealFolderCommand, title: "Reveal", arguments: [entry.path] },
      };
    }
    return {
      id: nodeId(location, "result", entry.path),
      label: entry.path,
      resourceUri: { path },
      iconPath: "file",
      gitStatus: statuses.files.get(entry.path),
      collapsibleState: collapsible.None,
      command: { command: context.openFileCommand, title: "Open File", arguments: [path] },
      ...(entry.bytes === null ? {} : { size: entry.bytes }),
    };
  }
  const path = joinLocation(location, element.path);
  if (element.kind === "dir") {
    return {
      id: nodeId(location, "dir", element.path),
      label: element.name,
      resourceUri: { path },
      iconPath: "folder",
      gitStatus: statuses.folders.get(element.path),
      // Folders of changed files start open; listed folders load when opened.
      collapsibleState: element.lazy ? collapsible.Collapsed : collapsible.Expanded,
      command: {
        command: context.openFolderCommand,
        title: "Open Folder",
        arguments: [element.path],
      },
    };
  }
  const status = statuses.files.get(element.path);
  return {
    id: nodeId(location, "file", element.path),
    label: element.name,
    resourceUri: { path },
    iconPath: "file",
    gitStatus: status,
    collapsibleState: collapsible.None,
    command: { command: context.openFileCommand, title: "Open File", arguments: [path] },
    // A deleted file has no size.
    ...(element.bytes !== null && status !== "deleted" ? { size: element.bytes } : {}),
  };
}
