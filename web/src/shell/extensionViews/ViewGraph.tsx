// A tree view drawn as a graph of cards (`TreeView.presentation = "graph"`): every
// node loaded and expanded, laid out top-down. For trees of sessions: each card
// shows the label, decorations (cost), a status dot and tint, the preview line and
// the status label; the session on screen is ringed. Clicking a card runs its
// command, or opens its session.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Node, NodeProps, NodeTypes } from "@xyflow/react";
import { Background, Handle, Position, ReactFlow } from "@xyflow/react";
import { GraphZoomControls } from "@/components/GraphZoomControls";
import { RunningDot } from "@/components/RunningDot";
import { Badge } from "@/components/ui/badge";
import { useLocation, useNavigate } from "@/lib/routing";
import { sessionNavigationSearch } from "@/lib/sessionNavigation";
import { cn } from "@/lib/utils";
import type { RailTreeModel, RailTreeNode } from "../railViews";
import {
  type AgentActivity,
  type AgentNodeData,
  layoutTree,
  NODE_WIDTH,
  treeFromRows,
} from "../subagentGraphLayout";
import { activityDotClassName } from "../subagentStatus";
import { ROOT_KEY } from "./treeRows";

import "@xyflow/react/dist/style.css";

/** Levels below the root the graph loads. */
const MAX_GRAPH_DEPTH = 8;

// Per-activity border and background tint; the dot color is the list's.
const ACTIVITY_TINT: Record<AgentActivity, { border: string; bg: string }> = {
  working: { border: "border-brand-accent", bg: "bg-brand-accent/5" },
  awaiting: { border: "border-warning", bg: "bg-warning/5" },
  failed: { border: "border-destructive", bg: "bg-destructive/5" },
  launching: { border: "border-muted-foreground/40", bg: "bg-muted/30" },
  disconnected: { border: "border-muted-foreground/30", bg: "bg-card" },
  done: { border: "border-muted-foreground/30", bg: "bg-card" },
  idle: { border: "border-muted-foreground/30", bg: "bg-card" },
  other: { border: "border-muted-foreground/30", bg: "bg-card" },
};

function NodeStatusDot({ activity }: { activity: AgentActivity }) {
  if (activity === "working") return <RunningDot />;
  if (activity === "awaiting") {
    return (
      <Badge className="border-transparent bg-warning/15 text-warning text-[9px] px-1 py-0">
        !
      </Badge>
    );
  }
  return (
    <span
      className={cn("inline-block size-2 shrink-0 rounded-full", activityDotClassName(activity))}
    />
  );
}

function AgentNodeComponent({ data }: NodeProps<Node<AgentNodeData>>) {
  const { label, activity, statusLabel, isActive, preview, node } = data;
  const tint = ACTIVITY_TINT[activity];
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground/40 !w-1.5 !h-1.5 !border-0"
      />
      <div
        data-testid="graph-node"
        data-session-id={data.sessionId}
        className={cn(
          "rounded-lg border px-3 py-2 shadow-sm transition-colors hover:shadow-md cursor-pointer",
          tint.border,
          tint.bg,
          isActive && "ring-2 ring-ring ring-offset-1 ring-offset-background",
        )}
        style={{ width: NODE_WIDTH }}
      >
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium leading-tight">{label}</span>
          <span className="flex-1" />
          {node?.decoration?.parts.map((part) => (
            <span
              key={`${part.text}\n${part.tooltip ?? ""}`}
              title={part.tooltip}
              className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
            >
              {part.text}
            </span>
          ))}
          <NodeStatusDot activity={activity} />
        </div>
        {preview && (
          <p className="mt-1 truncate text-[10px] leading-tight text-muted-foreground">{preview}</p>
        )}
        {!["idle", "done"].includes(activity) && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">{statusLabel}</p>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground/40 !w-1.5 !h-1.5 !border-0"
      />
    </>
  );
}

const nodeTypes: NodeTypes = { agent: AgentNodeComponent };

/** Every node of `tree` down to {@link MAX_GRAPH_DEPTH}, reloaded on each change. */
function useWholeTree(tree: RailTreeModel): ReadonlyMap<string, readonly RailTreeNode[]> {
  const [children, setChildren] = useState<ReadonlyMap<string, readonly RailTreeNode[]>>(
    () => new Map(),
  );
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let frame: number | null = null;
    const unsubscribe = tree.subscribe(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setGeneration((value) => value + 1);
      });
    });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [tree]);
  useEffect(() => {
    let cancelled = false;
    const next = new Map<string, readonly RailTreeNode[]>();
    const load = (parent: string) =>
      tree.getChildren(parent === ROOT_KEY ? undefined : parent).catch(() => []);
    const loadLevel = async (level: readonly string[], depth: number): Promise<void> => {
      const entries = await Promise.all(
        level.map(async (parent) => [parent, await load(parent)] as const),
      );
      const nextLevel: string[] = [];
      for (const [parent, nodes] of entries) {
        next.set(parent, nodes);
        for (const node of nodes) {
          if (node.collapsible !== "none" && !next.has(node.handle)) nextLevel.push(node.handle);
        }
      }
      if (!cancelled && nextLevel.length > 0 && depth < MAX_GRAPH_DEPTH) {
        await loadLevel(nextLevel, depth + 1);
      }
    };
    void loadLevel([ROOT_KEY], 0).then(() => {
      if (!cancelled) setChildren(next);
    });
    return () => {
      cancelled = true;
    };
  }, [tree, generation]);
  return children;
}

export function ViewGraph({
  tree,
  conversationId,
}: {
  tree: RailTreeModel;
  conversationId: string | undefined;
}) {
  const children = useWholeTree(tree);
  const { nodes, edges } = useMemo(() => {
    const root = treeFromRows(children, MAX_GRAPH_DEPTH);
    return root ? layoutTree(root, conversationId ?? "") : { nodes: [], edges: [] };
  }, [children, conversationId]);
  const navigate = useNavigate();
  const location = useLocation();
  const handleNodeClick = useCallback(
    (event: ReactMouseEvent, graphNode: Node<AgentNodeData>) => {
      const row = graphNode.data.node;
      const plain =
        event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
      if (row?.hasCommand && plain) {
        tree.runCommand(row.handle);
        return;
      }
      if (row?.sessionId === undefined) return;
      navigate({
        pathname: `/c/${row.sessionId}`,
        search: sessionNavigationSearch(location.search),
      });
    },
    [navigate, location.search, tree],
  );
  return (
    <div
      data-workspace-panel-surface
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-card"
    >
      <div className="h-full w-full" style={{ minHeight: 200 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          panOnDrag
          panOnScroll
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          minZoom={0.1}
          maxZoom={3}
        >
          <Background bgColor="var(--card)" />
          <GraphZoomControls />
        </ReactFlow>
      </div>
    </div>
  );
}
