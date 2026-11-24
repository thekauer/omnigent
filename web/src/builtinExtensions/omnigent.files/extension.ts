// The Files tab: the folders and files of the workspace on screen (or a folder
// it browses), listed lazily as folders open, with the session's changed files
// laid over them, a search by name with include and exclude globs, the sort
// order and hidden-files toggle of the Files views, and `omnigent.revealInFiles`
// for the rest of the app.
import type * as Omnigent from "omnigent";
import {
  ALL_HIDDEN,
  buildTree,
  type DirNode,
  type Entry,
  FOLDER_FAILED,
  type FilesElement,
  type ItemContext,
  joinLocation,
  LOADING,
  lazyChildren,
  listingError,
  locationOf,
  NO_FILES,
  normalizeSortOrder,
  parentPath,
  type PlaceholderNode,
  relativeTo,
  type SearchState,
  scopeChanges,
  searchView,
  statusMaps,
  type TreeNode,
  treeItemFor,
  unreachableText,
  visibleNodes,
  workingDirOf,
} from "./filesModel";
import { omnigent } from "./omnigent";

export const VIEW_ID = "omnigent.files.view";
export const REFRESH_COMMAND = "omnigent.files.refresh";
export const SHOW_HIDDEN_COMMAND = "omnigent.files.showHiddenFiles";
export const HIDE_HIDDEN_COMMAND = "omnigent.files.hideHiddenFiles";
export const OPEN_FOLDER_COMMAND = "omnigent.files.openFolder";
export const REVEAL_FOLDER_COMMAND = "omnigent.files.revealFolder";
/** For the rest of the app: browse to a folder, or show a file in the tree. */
export const REVEAL_IN_FILES_COMMAND = "omnigent.revealInFiles";
export const SORT_COMMANDS: Readonly<Record<string, string>> = Object.freeze({
  "omnigent.files.sortByName": "alpha",
  "omnigent.files.sortByRecent": "recent",
  "omnigent.files.sortBySize": "size",
  "omnigent.files.sortByType": "type",
});
export const HAS_HIDDEN_CONTEXT_KEY = "omnigent.files.hasHiddenFiles";
export const HIDDEN_TOOLTIP_CONTEXT_KEY = "omnigent.files.hiddenFilesTooltip";
const FILES_SECTION = "omnigent.files";
/** As the classic search field: the search runs once typing paused this long. */
export const SEARCH_DEBOUNCE_MS = 300;

interface Listing {
  entries?: readonly Omnigent.FileEntry[];
  error?: Omnigent.FileSystemError;
  loading: boolean;
  /** A reload is due: the cached entries stay on screen until it lands. */
  stale: boolean;
}

interface SessionFiles {
  /** The absolute folder browsed; null for the workspace root. */
  browse: string | null;
  /** Folder listings by their API path ("" the root). */
  readonly listings: Map<string, Listing>;
  search:
    | (SearchState & { key: string; running: Omnigent.CancellationTokenSource | undefined })
    | undefined;
}

const MAX_SESSIONS = 100;

export function activate(context: Omnigent.ExtensionContext): void {
  const sessions = new Map<string, SessionFiles>();
  const changed = new omnigent.EventEmitter<void>();
  const settings = () => omnigent.workspace.getConfiguration(FILES_SECTION);
  const setContext = (key: string, value: unknown) =>
    void omnigent.commands.executeCommand("setContext", key, value);
  const sessionKey = () => omnigent.workspace.activeSessionId ?? "";
  const stateOf = (key = sessionKey()): SessionFiles => {
    let state = sessions.get(key);
    if (!state) {
      state = { browse: null, listings: new Map(), search: undefined };
      sessions.set(key, state);
      while (sessions.size > MAX_SESSIONS) {
        const oldest = sessions.keys().next().value;
        if (oldest === undefined || oldest === key) break;
        sessions.delete(oldest);
      }
    }
    return state;
  };
  const location = () => locationOf(stateOf().browse, omnigent.workspace.rootPath);
  const sort = () => normalizeSortOrder(settings().get("sortOrder"));
  const showHidden = () => settings().get<boolean>("showHidden", true);
  const relativeEntries = (entries: readonly Omnigent.FileEntry[], at: string): Entry[] =>
    entries.flatMap((entry) => {
      const path = relativeTo(at, entry.path);
      return path ? [{ ...entry, path }] : [];
    });

  /** Loads a folder's listing if it is missing or stale; fires a change when it lands. */
  const loads = new Map<Listing, Promise<void>>();
  const ensureListing = (path: string): Promise<void> => {
    const key = sessionKey();
    const state = stateOf(key);
    const listing = state.listings.get(path);
    if (listing?.loading) return loads.get(listing) ?? Promise.resolve();
    if (listing && !listing.stale) return Promise.resolve();
    if (omnigent.workspace.rootPath === undefined) return Promise.resolve();
    const next: Listing = { ...listing, loading: true, stale: false };
    state.listings.set(path, next);
    const load = omnigent.workspace.fs.readDirectory(path).then(
      (entries) => {
        if (state.listings.get(path) !== next) return;
        state.listings.set(path, { entries, loading: false, stale: false });
        if (sessionKey() === key) update();
      },
      (error: Omnigent.FileSystemError) => {
        if (state.listings.get(path) !== next) return;
        // A folder that loaded before keeps its entries when a reload fails.
        state.listings.set(path, {
          ...(next.entries ? { entries: next.entries } : {}),
          error,
          loading: false,
          stale: false,
        });
        if (sessionKey() === key) update();
      },
    );
    loads.set(next, load);
    void load.finally(() => loads.delete(next));
    return load;
  };

  /** Marks the session's listings for a reload and reloads the ones on screen. */
  const reloadListings = () => {
    const state = stateOf();
    for (const listing of state.listings.values()) listing.stale = true;
    state.search = undefined;
    update();
  };

  // The tree of the browsed folder, rebuilt when its listing, the changes or the order change.
  let cache: { key: unknown[]; roots: TreeNode[] } | undefined;
  const rootsOf = (entries: readonly Omnigent.FileEntry[]) => {
    const at = location();
    const changes = scopeChanges(omnigent.workspace.getChangedFiles() ?? [], at);
    const key = [entries, omnigent.workspace.getChangedFiles(), sort(), at];
    if (!cache || cache.key.some((value, index) => value !== key[index])) {
      cache = { key, roots: buildTree(relativeEntries(entries, at), changes, sort()) };
    }
    return cache.roots;
  };
  const itemContext = (): ItemContext => ({
    location: location(),
    statuses: statusMaps(scopeChanges(omnigent.workspace.getChangedFiles() ?? [], location())),
    openFileCommand: "omnigent.openFile",
    openFolderCommand: OPEN_FOLDER_COMMAND,
    revealFolderCommand: REVEAL_FOLDER_COMMAND,
  });
  const placeholder = (parent: string, kind: string, text: string): PlaceholderNode => ({
    kind: "placeholder",
    id: `${kind}:${location()}\u0000${parent}`,
    text,
  });

  let searchResults: FilesElement[] = [];
  const childrenOf = (element: FilesElement | undefined): FilesElement[] => {
    if (element === undefined) {
      if (activeQuery() !== "") return searchResults;
      const root = stateOf().listings.get(location());
      if (!root?.entries) {
        ensureListing(location());
        return [];
      }
      if (root.stale) ensureListing(location());
      return visibleNodes(rootsOf(root.entries), showHidden());
    }
    if (element.kind !== "dir") return [];
    const rows: FilesElement[] = [];
    let children: TreeNode[] = element.children;
    if (element.lazy) {
      const path = joinLocation(location(), element.path);
      const listing = stateOf().listings.get(path);
      if (!listing || listing.stale) ensureListing(path);
      const current = stateOf().listings.get(path);
      if (current?.entries) {
        children = lazyChildren(
          relativeEntries(current.entries, location()),
          element.children,
          sort(),
        );
      } else if (current?.error) {
        rows.push(placeholder(element.path, "error", FOLDER_FAILED));
      } else {
        rows.push(placeholder(element.path, "loading", LOADING));
      }
    }
    const visible = visibleNodes(children, showHidden());
    if (rows.length === 0 && visible.length === 0 && children.length > 0) {
      rows.push(placeholder(element.path, "hidden", ALL_HIDDEN));
    }
    return [...rows, ...visible];
  };

  const provider: Omnigent.TreeDataProvider<FilesElement> = {
    onDidChangeTreeData: changed.event,
    getChildren: childrenOf,
    getTreeItem: (element) =>
      treeItemFor(element, itemContext(), omnigent.TreeItemCollapsibleState),
    getParent: (element) => {
      if (element.kind !== "dir" && element.kind !== "file") return undefined;
      const parent = parentPath(element.path);
      return parent === "" ? undefined : folderAt(parent);
    },
  };
  /** A folder element by path, for `reveal` (ids depend only on the path). */
  const folderAt = (path: string): DirNode => ({
    kind: "dir",
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    children: [],
    lazy: true,
  });
  const view = omnigent.window.createTreeView(VIEW_ID, { treeDataProvider: provider });

  // ---- Search -------------------------------------------------------------------
  let debounced = { query: "", include: "", exclude: "" };
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const activeQuery = () => debounced.query;
  const runSearch = () => {
    const state = stateOf();
    const query = debounced.query;
    if (query === "") {
      state.search?.running?.cancel();
      state.search = undefined;
      searchResults = [];
      return;
    }
    const at = location();
    const key = JSON.stringify([query, debounced.include, debounced.exclude, at]);
    if (state.search?.key === key) return;
    state.search?.running?.cancel();
    const running = new omnigent.CancellationTokenSource();
    const search: NonNullable<SessionFiles["search"]> = {
      key,
      query,
      result: undefined,
      error: undefined,
      running,
    };
    state.search = search;
    const session = sessionKey();
    omnigent.workspace
      .findFiles(
        { pattern: query, include: debounced.include, exclude: debounced.exclude, location: at },
        running.token,
      )
      .then(
        (result) => {
          if (state.search !== search) return;
          state.search = { ...search, result, running: undefined };
          if (sessionKey() === session) update();
        },
        (error: Error) => {
          if (state.search !== search || error.name === "Canceled") return;
          state.search = { ...search, error: error.message, running: undefined };
          if (sessionKey() === session) update();
        },
      );
  };
  const readFilter = () => ({
    query: view.filter.trim(),
    include: (view.filterFields.include ?? "").trim(),
    exclude: (view.filterFields.exclude ?? "").trim(),
  });
  const onFilter = (immediate: boolean) => {
    clearTimeout(debounceTimer);
    const next = readFilter();
    // Clearing the field returns to the tree at once; typing waits for a pause.
    if (immediate || next.query === "") {
      debounced = next;
      update();
      return;
    }
    debounceTimer = setTimeout(() => {
      debounced = readFilter();
      update();
    }, SEARCH_DEBOUNCE_MS);
  };

  // ---- The view's state -----------------------------------------------------------
  const update = () => {
    const root = omnigent.workspace.rootPath;
    const state = stateOf();
    const at = location();
    const files = omnigent.workspace.getChangedFiles() ?? [];
    const hiddenCount = files.filter((file) =>
      file.path.split("/").some((part) => part.startsWith(".")),
    ).length;
    setContext(HAS_HIDDEN_CONTEXT_KEY, hiddenCount > 0);
    setContext(
      HIDDEN_TOOLTIP_CONTEXT_KEY,
      `${hiddenCount} file${hiddenCount === 1 ? "" : "s"} in hidden directories. Click to show.`,
    );
    view.tag = omnigent.workspace.servedFromHost
      ? {
          text: "Asleep",
          icon: "moon",
          tooltip:
            "Agent is asleep. Files are shown live from the host; send a message to wake it.",
        }
      : undefined;
    const rootListing = state.listings.get(at);
    const unreachable =
      rootListing?.error?.code === "NoPermissions" ? rootListing.error : undefined;
    const workingDir = workingDirOf(state.browse, root);
    view.location =
      workingDir && root
        ? {
            path: workingDir,
            root,
            ...(unreachable ? { error: unreachableText(unreachable) } : {}),
          }
        : undefined;
    const availability = omnigent.workspace.availability;
    // An asleep sandbox with nothing loaded: say so rather than "No files in workspace".
    const sandboxAsleep =
      (availability === "sandboxOffline" || availability === "sandboxStarting") &&
      !rootListing?.entries;
    let message: string | undefined;
    let severity: "error" | undefined;
    let notice: Omnigent.ViewNotice | undefined = sandboxAsleep ? availability : undefined;
    runSearch();
    if (!notice && activeQuery() !== "" && state.search) {
      const shown = searchView(state.search, at, showHidden(), sort(), SHOW_HIDDEN_COMMAND);
      searchResults = shown.results;
      message = shown.message;
      severity = shown.severity;
    } else if (!notice) {
      searchResults = [];
      if (root === undefined) {
        const error = omnigent.workspace.changedFilesError;
        if (error !== undefined) {
          message = `Failed to load: ${error}`;
          severity = "error";
        } else if (availability === "agentAsleep") {
          notice = "agentAsleep";
        } else {
          message = LOADING;
        }
      } else if (!rootListing?.entries) {
        const error = rootListing?.error;
        if (!error) {
          message = LOADING;
          ensureListing(at);
        } else if (error.code === "RunnerOffline") {
          // A runner that went offline after it was up is asleep; a new session has no files yet.
          if (availability === "agentAsleep") notice = "agentAsleep";
          else message = NO_FILES;
        } else if (error.code === "Unavailable") {
          message = NO_FILES;
        } else {
          message = listingError(error);
          severity = "error";
        }
      } else {
        const roots = rootsOf(rootListing.entries);
        if (roots.length === 0) message = NO_FILES;
        else if (visibleNodes(roots, showHidden()).length === 0) message = ALL_HIDDEN;
      }
    }
    view.notice = notice;
    view.message = message;
    view.messageSeverity = severity;
    changed.fire();
  };

  /** Browses `path` (absolute; the root when it is the root) in `key`'s workspace. */
  const browseTo = (path: string | null, key = sessionKey()) => {
    const state = stateOf(key);
    const root = key === sessionKey() ? omnigent.workspace.rootPath : undefined;
    const next = path === null || path === root ? null : path;
    if (state.browse === next) return;
    state.browse = next;
    state.search = undefined;
    if (key === sessionKey()) update();
  };
  const leaveSearch = () => {
    clearTimeout(debounceTimer);
    debounced = { ...readFilter(), query: "" };
    view.setFilter("");
  };

  let session = omnigent.workspace.activeSessionId;
  let rootPath = omnigent.workspace.rootPath;
  let availability = omnigent.workspace.availability;
  context.subscriptions.push(
    view,
    changed,
    omnigent.commands.registerCommand(REFRESH_COMMAND, async () => {
      await omnigent.commands.executeCommand("omnigent.refreshFiles");
      reloadListings();
      // The button spins until the folder on screen reloaded.
      await ensureListing(location());
    }),
    omnigent.commands.registerCommand(SHOW_HIDDEN_COMMAND, () =>
      settings().update("showHidden", true),
    ),
    omnigent.commands.registerCommand(HIDE_HIDDEN_COMMAND, () =>
      settings().update("showHidden", false),
    ),
    ...Object.entries(SORT_COMMANDS).map(([command, order]) =>
      omnigent.commands.registerCommand(command, () => settings().update("sortOrder", order)),
    ),
    // A double-clicked folder becomes the browsed one.
    omnigent.commands.registerCommand(OPEN_FOLDER_COMMAND, (relative: unknown) => {
      const root = omnigent.workspace.rootPath;
      const workingDir = workingDirOf(stateOf().browse, root);
      if (typeof relative !== "string" || !workingDir) return;
      browseTo(`${workingDir.replace(/\/$/, "")}/${relative}`);
    }),
    // A folder picked from the search results: back to the tree, shown there.
    omnigent.commands.registerCommand(REVEAL_FOLDER_COMMAND, (relative: unknown) => {
      if (typeof relative !== "string" || relative === "") return;
      leaveSearch();
      update();
      return view.reveal(folderAt(relative), { select: true, expand: false });
    }),
    omnigent.commands.registerCommand(
      REVEAL_IN_FILES_COMMAND,
      (path: unknown, options?: { sessionId?: unknown; kind?: unknown }) => {
        if (typeof path !== "string" || path === "") {
          throw new TypeError(`${REVEAL_IN_FILES_COMMAND} needs a path`);
        }
        const key =
          typeof options?.sessionId === "string" && options.sessionId !== ""
            ? options.sessionId
            : sessionKey();
        const onScreen = key === sessionKey();
        if (onScreen) leaveSearch();
        if (options?.kind !== "file") {
          browseTo(path, key);
          return;
        }
        // A file: shown in the tree of a folder that holds it, its folders opened.
        const root = onScreen ? omnigent.workspace.rootPath : undefined;
        const absolute =
          path.startsWith("/") || !root ? path : `${root.replace(/\/$/, "")}/${path}`;
        const state = stateOf(key);
        const workingDir = workingDirOf(state.browse, root);
        const inside = workingDir && absolute.startsWith(`${workingDir.replace(/\/$/, "")}/`);
        if (!inside) {
          const withinRoot = root && absolute.startsWith(`${root.replace(/\/$/, "")}/`);
          browseTo(withinRoot ? null : parentPath(absolute) || "/", key);
        }
        if (!onScreen) return;
        update();
        const base = workingDirOf(stateOf(key).browse, root) ?? "";
        const relative = absolute.slice(base.replace(/\/$/, "").length + 1);
        const file: TreeNode = {
          kind: "file",
          name: relative.slice(relative.lastIndexOf("/") + 1),
          path: relative,
          bytes: null,
          modifiedAt: null,
        };
        return view.reveal(file, { select: true, focus: false });
      },
    ),
    view.onDidChangeLocation((path) => browseTo(path)),
    view.onDidChangeFilter(() => onFilter(false)),
    omnigent.workspace.onDidChangeChangedFiles(() => {
      const next = omnigent.workspace.activeSessionId;
      if (next !== session) {
        session = next;
        rootPath = omnigent.workspace.rootPath;
        availability = omnigent.workspace.availability;
        cache = undefined;
        onFilter(true);
        return;
      }
      // The workspace answered (its root, or a runner that came back): load again.
      if (
        omnigent.workspace.rootPath !== rootPath ||
        omnigent.workspace.availability !== availability
      ) {
        rootPath = omnigent.workspace.rootPath;
        availability = omnigent.workspace.availability;
        const state = stateOf();
        for (const [path, listing] of state.listings) {
          if (!listing.entries) state.listings.delete(path);
        }
      }
      update();
    }),
    omnigent.workspace.onDidChangeFiles(() => reloadListings()),
    omnigent.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(FILES_SECTION)) {
        cache = undefined;
        update();
      }
    }),
    { dispose: () => clearTimeout(debounceTimer) },
  );
  debounced = readFilter();
  update();
}
