// Layout of a session tree as a graph of cards: each subtree is as wide as its
// children, a parent centered above them. Pure, over plain nodes.
import type { RailAgentState, RailTreeNode } from "./railViews";

export type AgentActivity = RailAgentState;

export interface AgentNodeData {
  label: string;
  activity: AgentActivity;
  statusLabel: string;
  sessionId: string;
  isActive: boolean;
  preview: string | null;
  /** The row the node stands for: its decorations (cost) and command. */
  node?: RailTreeNode;
  [key: string]: unknown;
}

export interface TreeNode {
  id: string;
  label: string;
  activity: AgentActivity;
  statusLabel: string;
  preview: string | null;
  node?: RailTreeNode;
  children: TreeNode[];
}

interface LayoutNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: AgentNodeData;
}

interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  animated: boolean;
  style: { stroke: string; strokeWidth: number; opacity: number };
}

export const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const HORIZONTAL_GAP = 40;
const VERTICAL_GAP = 30;

const edgeDefaults = {
  type: "default",
  animated: false,
  style: { stroke: "var(--muted-foreground)", strokeWidth: 1.5, opacity: 0.3 },
};

export function computeSubtreeWidths(node: TreeNode): Map<string, number> {
  const widths = new Map<string, number>();
  function walk(n: TreeNode): number {
    if (n.children.length === 0) {
      widths.set(n.id, NODE_WIDTH);
      return NODE_WIDTH;
    }
    const total =
      n.children.reduce((sum, c) => sum + walk(c), 0) + (n.children.length - 1) * HORIZONTAL_GAP;
    widths.set(n.id, Math.max(NODE_WIDTH, total));
    return Math.max(NODE_WIDTH, total);
  }
  walk(node);
  return widths;
}

export function layoutTree(
  root: TreeNode,
  activeId: string,
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const subtreeWidths = computeSubtreeWidths(root);
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  function place(node: TreeNode, x: number, y: number) {
    nodes.push({
      id: node.id,
      type: "agent",
      position: { x: x - NODE_WIDTH / 2, y },
      data: {
        label: node.label,
        activity: node.activity,
        statusLabel: node.statusLabel,
        sessionId: node.id,
        isActive: node.id === activeId,
        preview: node.preview,
        ...(node.node === undefined ? {} : { node: node.node }),
      },
    });

    if (node.children.length === 0) return;

    const childY = y + NODE_HEIGHT + VERTICAL_GAP;
    const totalChildrenWidth =
      node.children.reduce((sum, c) => sum + (subtreeWidths.get(c.id) ?? NODE_WIDTH), 0) +
      (node.children.length - 1) * HORIZONTAL_GAP;

    let childX = x - totalChildrenWidth / 2;

    for (const child of node.children) {
      const childWidth = subtreeWidths.get(child.id) ?? NODE_WIDTH;
      const childCenterX = childX + childWidth / 2;

      edges.push({
        id: `${node.id}->${child.id}`,
        source: node.id,
        target: child.id,
        ...edgeDefaults,
        animated: child.activity === "working",
        style: {
          ...edgeDefaults.style,
          opacity: child.activity === "working" ? 0.6 : 0.3,
        },
      });

      place(child, childCenterX, childY);
      childX += childWidth + HORIZONTAL_GAP;
    }
  }

  place(root, 0, 0);
  return { nodes, edges };
}

/**
 * The graph's tree from loaded tree rows: `children` maps a parent handle (""
 * for the roots) to its rows. The first root is the graph's root; a row seen
 * twice is drawn once.
 */
export function treeFromRows(
  children: ReadonlyMap<string, readonly RailTreeNode[]>,
  maxDepth: number,
): TreeNode | null {
  const root = children.get("")?.[0];
  if (!root) return null;
  const visited = new Set<string>();
  const build = (row: RailTreeNode, depth: number): TreeNode => {
    visited.add(row.handle);
    return {
      id: row.sessionId ?? row.handle,
      label: row.label,
      activity: row.agentStatus?.state ?? "idle",
      statusLabel: row.agentStatus?.label ?? "Idle",
      // The root's card names it; its preview stays in the list.
      preview: depth === 0 ? null : (row.description ?? null),
      node: row,
      children:
        depth >= maxDepth
          ? []
          : (children.get(row.handle) ?? [])
              .filter((child) => !visited.has(child.handle))
              .map((child) => build(child, depth + 1)),
    };
  };
  return build(root, 0);
}
