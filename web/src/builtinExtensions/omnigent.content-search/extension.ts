// The Content search tab: a query form (with Match case, Whole word, Regular
// expression and include/exclude globs) over the workspace on screen, its
// matches grouped by file with the match marked, each opening the file at the
// match. Searches run on submit; each chat session keeps its own form, its
// latest results and a search still running when another session comes on screen.
import type * as Omnigent from "omnigent";
import {
  childrenOf,
  formOf,
  groupMatches,
  problemMessage,
  queryOf,
  type SearchNode,
  type SearchOutcome,
  statusMessage,
  treeItemFor,
} from "./searchModel";
import { omnigent } from "./omnigent";

export const VIEW_ID = "omnigent.content-search.view";

interface SessionSearch {
  outcome?: SearchOutcome;
  running?: Omnigent.CancellationTokenSource;
}

export function activate(context: Omnigent.ExtensionContext): void {
  const searches = new Map<string, SessionSearch>();
  let roots: SearchNode[] = [];
  const changed = new omnigent.EventEmitter<void>();
  const provider: Omnigent.TreeDataProvider<SearchNode> = {
    onDidChangeTreeData: changed.event,
    getChildren: (element) => (element ? childrenOf(element) : roots),
    getTreeItem: (element) => treeItemFor(element, omnigent.TreeItemCollapsibleState),
  };
  const view = omnigent.window.createTreeView(VIEW_ID, { treeDataProvider: provider });
  const input = view.searchInput;
  if (!input) throw new Error("the Content search view has no search input");

  const current = (): SessionSearch | undefined => {
    const session = omnigent.workspace.activeSessionId;
    return session === undefined ? undefined : searches.get(session);
  };
  const validate = () => {
    const form = formOf(input.value);
    input.validationMessage = problemMessage(
      omnigent.workspace.validateTextSearchQuery(queryOf(form)),
      form.wholeWord,
    );
    input.enabled = form.query.trim() !== "" && current()?.running === undefined;
  };
  const rebuild = () => {
    const search = current();
    const searching = search?.running !== undefined;
    const result = searching ? undefined : search?.outcome?.result;
    roots = result ? groupMatches(result.matches) : [];
    const { message, severity } = statusMessage(search?.outcome, searching);
    view.message = message;
    view.messageSeverity = severity;
    validate();
    changed.fire();
  };

  const run = (value: Omnigent.SearchInputValue) => {
    const session = omnigent.workspace.activeSessionId;
    if (session === undefined) return;
    const form = formOf(value);
    const search = searches.get(session) ?? {};
    searches.set(session, search);
    if (search.running) return;
    const source = new omnigent.CancellationTokenSource();
    search.running = source;
    rebuild();
    void omnigent.window
      .withProgress({ title: "Searching…", location: { viewId: VIEW_ID } }, () =>
        omnigent.workspace.findTextInFiles(
          queryOf(form),
          { include: form.include, exclude: form.exclude },
          source.token,
        ),
      )
      .then(
        (result) => {
          search.outcome = { query: form.query, result };
        },
        (error: unknown) => {
          if (source.token.isCancellationRequested) return;
          search.outcome = {
            query: form.query,
            error: error instanceof Error ? error.message : String(error),
          };
        },
      )
      .finally(() => {
        if (search.running === source) search.running = undefined;
        source.dispose();
        rebuild();
      });
  };

  context.subscriptions.push(
    view,
    changed,
    input.onDidChangeValue(validate),
    input.onDidAccept(run),
    // Another workspace on screen: its own results. Not on changed-files updates,
    // which would rebuild (and jump) the results while the agent edits files.
    omnigent.workspace.onDidChangeActiveSessionId(rebuild),
    {
      dispose: () => {
        for (const search of searches.values()) search.running?.cancel();
      },
    },
  );
  rebuild();
}
