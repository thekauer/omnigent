// Pure helpers of the extension tree view: which rows are visible, and the
// expand state each view keeps per chat session.

import type { RailTreeNode } from "../railViews";

/** The cache key of the roots' children. */
export const ROOT_KEY = "";

export interface VisibleTreeRow {
  node: RailTreeNode;
  depth: number;
  open: boolean;
}

/** Whether `node` shows its children: the user's choice, else its own collapsible state. */
export function isNodeOpen(node: RailTreeNode, expanded: ReadonlyMap<string, boolean>): boolean {
  if (node.collapsible === "none") return false;
  return expanded.get(node.handle) ?? node.collapsible === "expanded";
}

/** The rows on screen, depth first; an open node whose children have not loaded shows none yet. */
export function visibleTreeRows(
  children: ReadonlyMap<string, readonly RailTreeNode[]>,
  expanded: ReadonlyMap<string, boolean>,
): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      // A provider that hands out one element twice must not loop forever.
      if (seen.has(node.handle)) continue;
      seen.add(node.handle);
      const open = isNodeOpen(node, expanded);
      rows.push({ node, depth, open });
      if (open) walk(node.handle, depth + 1);
    }
  };
  walk(ROOT_KEY, 0);
  return rows;
}

/** Open nodes on screen whose children are not loaded. */
export function missingChildren(
  rows: readonly VisibleTreeRow[],
  children: ReadonlyMap<string, readonly RailTreeNode[]>,
): string[] {
  return rows
    .filter((row) => row.open && !children.has(row.node.handle))
    .map((row) => row.node.handle);
}

/** Whether the rows read as a list (no folders), which spaces them like the Changes list. */
export function isListLayout(rows: readonly VisibleTreeRow[]): boolean {
  return !rows.some((row) => row.node.icon === "folder" && row.node.collapsible !== "none");
}

const MAX_EXPAND_STATES = 100;
// Per chat session and view, most recently used last.
const expandStates = new Map<string, Map<string, boolean>>();

function expandStateKey(sessionId: string | undefined, viewId: string): string {
  return `${sessionId ?? ""}\n${viewId}`;
}

/** The expand choices of one view in one chat session (kept in memory for the page). */
export function readExpandState(
  sessionId: string | undefined,
  viewId: string,
): ReadonlyMap<string, boolean> {
  return expandStates.get(expandStateKey(sessionId, viewId)) ?? new Map();
}

export function writeExpandState(
  sessionId: string | undefined,
  viewId: string,
  state: ReadonlyMap<string, boolean>,
): void {
  const key = expandStateKey(sessionId, viewId);
  expandStates.delete(key);
  expandStates.set(key, new Map(state));
  while (expandStates.size > MAX_EXPAND_STATES) {
    const oldest = expandStates.keys().next().value;
    if (oldest === undefined) break;
    expandStates.delete(oldest);
  }
}

/** For tests. */
export function clearExpandStates(): void {
  expandStates.clear();
}
