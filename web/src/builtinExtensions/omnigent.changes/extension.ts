// The Changes tab: the changed files of the workspace on screen, as a flat list
// with folder subtitles or as a folder tree ("View as List" / "View as Tree",
// remembered per chat session), grouped by repository, with the search field,
// sort order and hidden-files toggle of the Files views.
import type * as Omnigent from "omnigent";
import {
  buildChangesModel,
  type ChangeNode,
  isHiddenPath,
  normalizeMode,
  normalizeSortOrder,
  type SortOrder,
  treeItemFor,
  type ViewMode,
  viewMessage,
} from "./changesModel";
import { omnigent } from "./omnigent";

export const VIEW_ID = "omnigent.changes.view";
export const VIEW_AS_TREE_COMMAND = "omnigent.changes.viewAsTree";
export const VIEW_AS_LIST_COMMAND = "omnigent.changes.viewAsList";
export const REFRESH_COMMAND = "omnigent.changes.refresh";
export const SHOW_HIDDEN_COMMAND = "omnigent.changes.showHiddenFiles";
export const HIDE_HIDDEN_COMMAND = "omnigent.changes.hideHiddenFiles";
export const SORT_COMMANDS: Readonly<Record<string, SortOrder>> = Object.freeze({
  "omnigent.changes.sortByName": "alpha",
  "omnigent.changes.sortByRecent": "recent",
  "omnigent.changes.sortBySize": "size",
  "omnigent.changes.sortByType": "type",
});
/** Context keys the view/title `when` clauses read. */
export const VIEW_MODE_CONTEXT_KEY = "omnigent.changes.viewMode";
export const HAS_HIDDEN_CONTEXT_KEY = "omnigent.changes.hasHiddenFiles";
/** The workspaceState key of the mode, per chat session. */
export const VIEW_MODE_STATE_KEY = "viewMode";
const FILES_SECTION = "omnigent.files";

export function activate(context: Omnigent.ExtensionContext): void {
  let mode: ViewMode = "list";
  let roots: ChangeNode[] = [];
  let session: string | undefined;
  const changed = new omnigent.EventEmitter<void>();
  const settings = () => omnigent.workspace.getConfiguration(FILES_SECTION);
  const setContext = (key: string, value: unknown) =>
    void omnigent.commands.executeCommand("setContext", key, value);

  const provider: Omnigent.TreeDataProvider<ChangeNode> = {
    onDidChangeTreeData: changed.event,
    getChildren: (element) => (element ? (element.kind === "file" ? [] : element.children) : roots),
    getTreeItem: (element) =>
      treeItemFor(element, omnigent.TreeItemCollapsibleState, "omnigent.openFile"),
  };
  const view = omnigent.window.createTreeView(VIEW_ID, { treeDataProvider: provider });

  const rebuild = () => {
    const files = omnigent.workspace.getChangedFiles();
    const error = omnigent.workspace.changedFilesError;
    const availability = omnigent.workspace.availability;
    const showHidden = settings().get<boolean>("showHidden", true);
    const model = buildChangesModel({
      files: files ?? [],
      mode,
      sort: normalizeSortOrder(settings().get("sortOrder")),
      showHidden,
      query: view.filter,
    });
    roots = model.roots;
    view.notice = availability === "available" ? undefined : availability;
    const { message, severity } = viewMessage(
      { files, error, query: view.filter },
      model,
      SHOW_HIDDEN_COMMAND,
    );
    view.message = message;
    view.messageSeverity = severity;
    view.tag = omnigent.workspace.servedFromHost
      ? {
          text: "Asleep",
          icon: "moon",
          tooltip:
            "Agent is asleep. Files are shown live from the host; send a message to wake it.",
        }
      : undefined;
    view.badge = files?.length
      ? { value: files.length, tooltip: `${files.length} changed` }
      : undefined;
    setContext(
      HAS_HIDDEN_CONTEXT_KEY,
      (files ?? []).some((file) => isHiddenPath(file.path)),
    );
    changed.fire();
  };
  const applyMode = (next: ViewMode) => {
    mode = next;
    setContext(VIEW_MODE_CONTEXT_KEY, mode);
    rebuild();
  };
  const readMode = () => normalizeMode(context.workspaceState.get(VIEW_MODE_STATE_KEY));
  const setMode = async (next: ViewMode) => {
    applyMode(next);
    // Without a chat session there is nothing to remember it for.
    if (omnigent.workspace.activeSessionId !== undefined) {
      await context.workspaceState.update(VIEW_MODE_STATE_KEY, next);
    }
  };
  const onWorkspace = () => {
    const next = omnigent.workspace.activeSessionId;
    if (next !== session) {
      session = next;
      applyMode(readMode());
    } else {
      rebuild();
    }
  };

  context.subscriptions.push(
    view,
    changed,
    omnigent.commands.registerCommand(VIEW_AS_TREE_COMMAND, () => setMode("tree")),
    omnigent.commands.registerCommand(VIEW_AS_LIST_COMMAND, () => setMode("list")),
    omnigent.commands.registerCommand(REFRESH_COMMAND, () =>
      omnigent.commands.executeCommand("omnigent.refreshChangedFiles"),
    ),
    omnigent.commands.registerCommand(SHOW_HIDDEN_COMMAND, () =>
      settings().update("showHidden", true),
    ),
    omnigent.commands.registerCommand(HIDE_HIDDEN_COMMAND, () =>
      settings().update("showHidden", false),
    ),
    ...Object.entries(SORT_COMMANDS).map(([command, sort]) =>
      omnigent.commands.registerCommand(command, () => settings().update("sortOrder", sort)),
    ),
    omnigent.workspace.onDidChangeChangedFiles(onWorkspace),
    omnigent.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(FILES_SECTION)) rebuild();
    }),
    view.onDidChangeFilter(rebuild),
    // A list that failed to load (a 502 on the first fetch, say) retries when shown.
    view.onDidChangeVisibility(({ visible }) => {
      if (visible && omnigent.workspace.changedFilesError !== undefined) {
        void omnigent.commands.executeCommand("omnigent.refreshChangedFiles");
      }
    }),
  );
  session = omnigent.workspace.activeSessionId;
  applyMode(readMode());
}
