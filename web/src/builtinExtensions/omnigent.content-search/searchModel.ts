// The pure part of the Content search view: the query a form value sends, the
// alert for a query that cannot be sent, the results grouped by file as tree
// items, and the status lines above them.
import type * as Omnigent from "omnigent";

export const OPEN_FILE_COMMAND = "omnigent.openFile";

/** The form's option and field ids, as the manifest names them. */
export interface SearchForm {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  include: string;
  exclude: string;
}

export function formOf(value: Omnigent.SearchInputValue): SearchForm {
  return {
    query: value.query,
    caseSensitive: value.options.caseSensitive === true,
    wholeWord: value.options.wholeWord === true,
    regex: value.options.regex === true,
    include: value.fields.include ?? "",
    exclude: value.fields.exclude ?? "",
  };
}

export function queryOf(form: SearchForm): Omnigent.TextSearchQuery {
  return {
    pattern: form.query,
    isRegExp: form.regex,
    isCaseSensitive: form.caseSensitive,
    isWordMatch: form.wholeWord,
  };
}

const PROBLEM_MESSAGES: Readonly<Record<Omnigent.TextSearchQueryProblem, string>> = {
  tooLong: "This search is too long to match whole words. Shorten it, or turn off Whole word.",
  unopenedGroup:
    "This expression closes a group it never opened, so it can’t match whole words. Balance its parentheses, or turn off Whole word.",
  verbose:
    "Whole word can’t be used with verbose mode (?x). Remove that flag, or turn off Whole word.",
};

export function problemMessage(
  problem: Omnigent.TextSearchQueryProblem | undefined,
): string | undefined {
  return problem === undefined ? undefined : PROBLEM_MESSAGES[problem];
}

/** A finished search of one chat session: what was asked and what came back. */
export interface SearchOutcome {
  query: string;
  result?: Omnigent.TextSearchComplete;
  error?: string;
}

export type SearchNode =
  | { kind: "file"; path: string; matches: Omnigent.TextSearchMatch[] }
  | { kind: "match"; path: string; match: Omnigent.TextSearchMatch };

/** The matches grouped by file, files in the order their first match came. */
export function groupMatches(matches: readonly Omnigent.TextSearchMatch[]): SearchNode[] {
  const files = new Map<string, Omnigent.TextSearchMatch[]>();
  for (const match of matches) {
    const group = files.get(match.path) ?? [];
    group.push(match);
    files.set(match.path, group);
  }
  return [...files].map(([path, group]) => ({ kind: "file", path, matches: group }));
}

export function childrenOf(node: SearchNode): SearchNode[] {
  return node.kind === "file"
    ? node.matches.map((match) => ({ kind: "match", path: node.path, match }))
    : [];
}

export function treeItemFor(
  node: SearchNode,
  states: typeof Omnigent.TreeItemCollapsibleState,
): Omnigent.TreeItem {
  if (node.kind === "file") {
    return {
      id: `file:${node.path}`,
      label: node.path,
      tooltip: node.path,
      resourceUri: { path: node.path },
      iconPath: "file",
      collapsibleState: states.Expanded,
    };
  }
  const { match, path } = node;
  return {
    id: `match:${path}:${match.line}:${match.column}`,
    label: { label: match.preview.text, highlights: match.preview.matches.map(([s, e]) => [s, e]) },
    resourceUri: { path },
    line: match.line,
    accessibilityInformation: { label: `Open ${path} at line ${match.line}` },
    command: {
      command: OPEN_FILE_COMMAND,
      title: "Open",
      arguments: [path, { line: match.line, column: match.column }],
    },
  };
}

/**
 * The lines above the results: the prompt before any search, the error, or the
 * count of matches with the truncation or searcher warning. Nothing while one runs.
 */
export function statusMessage(
  outcome: SearchOutcome | undefined,
  searching: boolean,
): { message: string | undefined; severity: "info" | "error" | undefined } {
  if (searching) return { message: undefined, severity: undefined };
  if (!outcome) return { message: "Enter text and press Enter to search.", severity: undefined };
  if (outcome.error !== undefined) return { message: outcome.error, severity: "error" };
  const result = outcome.result;
  if (!result) return { message: undefined, severity: undefined };
  const files = new Set(result.matches.map((match) => match.path)).size;
  const lines = [
    result.matches.length === 0
      ? `No matches for “${outcome.query}”.`
      : `${result.matches.length} matching lines in ${files} files for “${outcome.query}”.`,
  ];
  if (result.limitHit || result.message) {
    lines.push(
      result.message ||
        `Showing the first ${result.matches.length} matching lines. Narrow your query for more results.`,
    );
  }
  return { message: lines.join("\n"), severity: undefined };
}
