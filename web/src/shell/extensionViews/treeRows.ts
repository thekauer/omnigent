// Pure helpers of the extension tree view: which rows are visible, and the
// expand state each view keeps per chat session.

import type { RailRevealRequest, RailTreeNode } from "../railViews";

/** The cache key of the roots' children. */
export const ROOT_KEY = "";

/** A folder's rows animating in (it was expanded) or out (it is collapsing). */
export type TreeRowMotion = "enter" | "exit";

export interface VisibleTreeRow {
  node: RailTreeNode;
  depth: number;
  open: boolean;
  /** Set on the rows below a folder that is expanding or collapsing. */
  motion?: TreeRowMotion;
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
  motions: ReadonlyMap<string, TreeRowMotion> = new Map(),
): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string, depth: number, inherited: TreeRowMotion | undefined) => {
    for (const node of children.get(parent) ?? []) {
      // A provider that hands out one element twice must not loop forever.
      if (seen.has(node.handle)) continue;
      seen.add(node.handle);
      const open = isNodeOpen(node, expanded);
      const own = motions.get(node.handle);
      // A collapsing folder already reads as closed; its rows animate out below it.
      rows.push({
        node,
        depth,
        open: open && own !== "exit",
        ...(inherited ? { motion: inherited } : {}),
      });
      if (open) walk(node.handle, depth + 1, own ?? inherited);
    }
  };
  walk(ROOT_KEY, 0, undefined);
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

/** The row to move to from `index` for a navigation key, or undefined to do nothing. */
export function keyboardTarget(
  rows: readonly VisibleTreeRow[],
  index: number,
  key: string,
): { index: number } | { toggle: number } | undefined {
  const row = rows[index];
  if (!row) return rows.length > 0 && key === "ArrowDown" ? { index: 0 } : undefined;
  if (key === "ArrowDown") return index + 1 < rows.length ? { index: index + 1 } : undefined;
  if (key === "ArrowUp") return index > 0 ? { index: index - 1 } : undefined;
  if (key === "Home") return rows.length > 0 ? { index: 0 } : undefined;
  if (key === "End") return rows.length > 0 ? { index: rows.length - 1 } : undefined;
  const collapsible = row.node.collapsible !== "none";
  if (key === "ArrowRight") {
    if (collapsible && !row.open) return { toggle: index };
    if (collapsible && rows[index + 1]?.depth === row.depth + 1) return { index: index + 1 };
    return undefined;
  }
  if (key === "ArrowLeft") {
    if (collapsible && row.open) return { toggle: index };
    for (let parent = index - 1; parent >= 0; parent -= 1) {
      if (rows[parent].depth < row.depth) return { index: parent };
    }
  }
  return undefined;
}

/** A muted line that stands in for rows still coming, such as "Loading…" under a folder. */
export function isPlaceholderNode(node: RailTreeNode): boolean {
  return (
    node.collapsible === "none" &&
    !node.hasCommand &&
    node.icon === undefined &&
    node.resourcePath === undefined
  );
}

/**
 * Whether a reveal can no longer match: a level of its path (the roots, then
 * each ancestor's children) loaded since the reveal was asked (`asked`, the
 * children then) lacks the next handle. A level still loading (not there, or
 * showing a placeholder), or not reloaded since, may yet match.
 */
export function revealCannotMatch(
  request: RailRevealRequest,
  children: ReadonlyMap<string, readonly RailTreeNode[]>,
  asked: ReadonlyMap<string, readonly RailTreeNode[]>,
): boolean {
  let parent = ROOT_KEY;
  for (const handle of [...request.ancestors, request.handle]) {
    const level = children.get(parent);
    if (level === undefined) return false;
    if (level === asked.get(parent) || level.some(isPlaceholderNode)) {
      if (!level.some((node) => node.handle === handle)) return false;
      parent = handle;
      continue;
    }
    if (!level.some((node) => node.handle === handle)) return true;
    parent = handle;
  }
  return false;
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
