// The content area of an extension view's rail tab: its title bar with the
// view/title actions, then its tree, drawn with the same rows as the Files tree
// and the Changes list and windowed like them.

import { useVirtualizer } from "@tanstack/react-virtual";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ChangedFileRow, FileGroupHeader } from "../FlatFileList";
import { FileRowItem, FolderRowItem } from "../FolderTree";
import { railViewIcon } from "../railViewIcons";
import {
  changedStatusOf,
  type RailTreeDecorationTone,
  type RailTreeModel,
  type RailTreeNode,
  type RailView,
  type RailViewRegistry,
  railViews,
  useRailViews,
} from "../railViews";
import {
  isListLayout,
  isNodeOpen,
  missingChildren,
  readExpandState,
  ROOT_KEY,
  type VisibleTreeRow,
  visibleTreeRows,
  writeExpandState,
} from "./treeRows";

const NO_PROVIDER_MESSAGE = "There is no data provider registered that can provide view data.";
// Deeper trees still load, as their nodes are expanded.
const MAX_TREE_DEPTH = 32;
// The Changes list spaces its rows by 2px; the Files tree does not.
const LIST_ROW_GAP_PX = 2;

const TONE_CLASS: Record<RailTreeDecorationTone, string> = {
  added: "text-green-600 dark:text-green-400",
  removed: "text-destructive",
  muted: "text-muted-foreground",
};

function Decoration({
  decoration,
  className,
}: {
  decoration: NonNullable<RailTreeNode["decoration"]>;
  className?: string;
}) {
  // Keyed by each part's offset in the text: unique, and stable while the text is.
  let offset = 0;
  const content =
    decoration.parts.length > 0
      ? decoration.parts.map((part) => {
          const key = offset;
          offset += part.text.length + 1;
          return part.tone ? (
            <span key={key} className={TONE_CLASS[part.tone]}>
              {part.text}
            </span>
          ) : (
            <Fragment key={key}>{part.text}</Fragment>
          );
        })
      : decoration.text;
  return (
    <span className={cn("font-mono text-[10px]", className)} aria-label={decoration.title}>
      {content}
    </span>
  );
}

function TreeRow({
  row,
  conversationId,
  onToggle,
  onRun,
}: {
  row: VisibleTreeRow;
  conversationId: string | undefined;
  onToggle: (node: RailTreeNode) => void;
  onRun: (node: RailTreeNode) => void;
}) {
  const { node, depth, open } = row;
  const status = changedStatusOf(node.status);
  if (node.collapsible !== "none") {
    if (node.icon === "folder") {
      return (
        <FolderRowItem
          name={node.label}
          path={node.resourcePath ?? node.label}
          depth={depth}
          open={open}
          status={status}
          onToggle={() => onToggle(node)}
        />
      );
    }
    const Icon = railViewIcon(node.icon);
    return (
      <FileGroupHeader
        label={node.label}
        icon={Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" /> : null}
        count={node.description}
        ariaLabel={node.tooltip ?? node.label}
        collapsed={!open}
        onToggle={() => onToggle(node)}
      />
    );
  }
  if (node.resourcePath !== undefined && node.description !== undefined) {
    return (
      <ChangedFileRow
        path={node.resourcePath}
        name={node.label}
        dir={node.description}
        status={status}
        isDeleted={status === "deleted"}
        diffstat={node.decoration ? <Decoration decoration={node.decoration} /> : null}
        bytes={null}
        onFileSelect={() => onRun(node)}
        conversationId={conversationId}
      />
    );
  }
  if (node.resourcePath !== undefined) {
    return (
      <FileRowItem
        path={node.resourcePath}
        displayLabel={node.label}
        depth={depth}
        fileStatus={status}
        bytes={null}
        meta={
          node.decoration ? (
            <Decoration decoration={node.decoration} className="group-hover:invisible" />
          ) : null
        }
        onFileSelect={() => onRun(node)}
        conversationId={conversationId}
      />
    );
  }
  const Icon = railViewIcon(node.icon);
  return (
    <button
      type="button"
      className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md py-0.5 pr-1 pl-2 text-left hover:bg-muted"
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      title={node.tooltip}
      onClick={() => onRun(node)}
    >
      {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="truncate text-ui">{node.label}</span>
      {node.description && (
        <span className="truncate text-muted-foreground text-sm">{node.description}</span>
      )}
    </button>
  );
}

/** Loads a tree model's children on demand and reloads what is shown when it changes. */
function useTreeChildren(
  tree: RailTreeModel | undefined,
  expanded: ReadonlyMap<string, boolean>,
): { children: ReadonlyMap<string, readonly RailTreeNode[]>; loaded: boolean } {
  const [children, setChildren] = useState<ReadonlyMap<string, readonly RailTreeNode[]>>(
    () => new Map(),
  );
  const [loaded, setLoaded] = useState(false);
  const [generation, setGeneration] = useState(0);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const inFlight = useRef(new Set<string>());

  const load = useCallback(
    (parent: string) =>
      tree!.getChildren(parent === ROOT_KEY ? undefined : parent).then(
        (nodes) => nodes,
        () => [] as readonly RailTreeNode[],
      ),
    [tree],
  );

  useEffect(() => tree?.subscribe(() => setGeneration((value) => value + 1)), [tree]);

  // On mount and on every change: reload the roots, then each open node level by level
  // (a node's element is only current once its parent reloaded), and swap them in at
  // once so the tree does not flash empty.
  useEffect(() => {
    if (!tree) return;
    let cancelled = false;
    inFlight.current.clear();
    const next = new Map<string, readonly RailTreeNode[]>();
    const loadLevel = async (level: readonly string[], depth: number): Promise<void> => {
      const entries = await Promise.all(
        level.map(async (parent) => [parent, await load(parent)] as const),
      );
      const nextLevel: string[] = [];
      for (const [parent, nodes] of entries) {
        next.set(parent, nodes);
        for (const node of nodes) {
          if (isNodeOpen(node, expandedRef.current) && !next.has(node.handle)) {
            nextLevel.push(node.handle);
          }
        }
      }
      if (!cancelled && nextLevel.length > 0 && depth < MAX_TREE_DEPTH) {
        await loadLevel(nextLevel, depth + 1);
      }
    };
    void loadLevel([ROOT_KEY], 0).then(() => {
      if (cancelled) return;
      setChildren(next);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [tree, generation, load]);

  // Open nodes whose children are not loaded yet (a user expanded them, or they start open).
  const rows = useMemo(() => visibleTreeRows(children, expanded), [children, expanded]);
  const generationRef = useRef(generation);
  generationRef.current = generation;
  useEffect(() => {
    if (!tree) return;
    const startedIn = generationRef.current;
    for (const parent of missingChildren(rows, children)) {
      if (inFlight.current.has(parent)) continue;
      inFlight.current.add(parent);
      void load(parent).then((nodes) => {
        // A reload since then owns the cache; its own pass loads what is open.
        if (!inFlight.current.delete(parent) || startedIn !== generationRef.current) return;
        setChildren((previous) => new Map(previous).set(parent, nodes));
      });
    }
  }, [tree, rows, children, load]);

  return { children, loaded };
}

function ViewTitle({ view }: { view: RailView }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-[2px] px-2">
      <h2 className="shrink-0 pl-1 font-medium text-ui">{view.title ?? view.name}</h2>
      {view.description && (
        <span className="min-w-0 truncate pl-1.5 text-muted-foreground text-sm">
          {view.description}
        </span>
      )}
      <div className="ml-auto flex items-center gap-[2px]">
        <TooltipProvider>
          {view.actions.map((action) => {
            const Icon = railViewIcon(action.icon);
            return (
              <Tooltip key={action.id}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={action.title}
                    aria-pressed={action.toggled}
                    data-view-action={action.id}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={action.run}
                  >
                    {Icon ? <Icon /> : <span className="text-xs">{action.title}</span>}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{action.title}</TooltipContent>
              </Tooltip>
            );
          })}
        </TooltipProvider>
      </div>
    </div>
  );
}

function ViewTree({
  view,
  tree,
  conversationId,
}: {
  view: RailView;
  tree: RailTreeModel;
  conversationId: string | undefined;
}) {
  const [expanded, setExpanded] = useState<ReadonlyMap<string, boolean>>(() =>
    readExpandState(conversationId, view.id),
  );
  const { children, loaded } = useTreeChildren(tree, expanded);
  const rows = useMemo(() => visibleTreeRows(children, expanded), [children, expanded]);
  const listLayout = isListLayout(rows);
  const scrollRef = useRef<HTMLElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 25,
    overscan: 12,
    gap: listLayout ? LIST_ROW_GAP_PX : 0,
    getItemKey: (index) => rows[index]?.node.handle ?? index,
  });
  const toggle = useCallback(
    (node: RailTreeNode) => {
      setExpanded((previous) => {
        const next = new Map(previous);
        next.set(node.handle, !(previous.get(node.handle) ?? node.collapsible === "expanded"));
        writeExpandState(conversationId, view.id, next);
        return next;
      });
    },
    [conversationId, view.id],
  );
  const run = useCallback(
    (node: RailTreeNode) => {
      if (node.hasCommand) tree.runCommand(node.handle);
    },
    [tree],
  );
  let body: ReactNode = null;
  if (!loaded) {
    body = <p className="px-2 py-1 text-muted-foreground text-sm">Loading…</p>;
  } else if (rows.length > 0) {
    body = (
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <div
              key={item.key}
              data-index={item.index}
              data-tree-item={row.node.handle}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <TreeRow row={row} conversationId={conversationId} onToggle={toggle} onRun={run} />
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <section
      ref={scrollRef}
      className={cn("min-h-0 flex-1 overflow-y-auto px-2 pb-2", listLayout ? "pt-1" : "pt-0")}
    >
      {view.message && <p className="px-2 py-1 text-muted-foreground text-sm">{view.message}</p>}
      <TooltipProvider>{body}</TooltipProvider>
    </section>
  );
}

/** An extension view's page in the rail, looked up by id in the view registry. */
export function ExtensionRailView({
  viewId,
  settled,
  conversationId,
  registry = railViews,
}: {
  viewId: string;
  /** Whether extensions have finished loading, so a missing view is really gone. */
  settled: boolean;
  conversationId: string | undefined;
  registry?: RailViewRegistry;
}) {
  const { views } = useRailViews(registry);
  const view = views.find((candidate) => candidate.id === viewId);
  if (!view) {
    return settled ? null : (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  return (
    <div
      data-testid={`extension-view-${view.id}`}
      className="@container/filespanel flex min-h-0 flex-1 flex-col overflow-hidden bg-card"
    >
      <ViewTitle view={view} />
      <div className="workspace-panel-header-divider shrink-0 border-t border-border" />
      {view.tree ? (
        <ViewTree
          key={conversationId}
          view={view}
          tree={view.tree}
          conversationId={conversationId}
        />
      ) : (
        <section className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">
          <p className="px-2 py-1 text-muted-foreground text-sm">
            {view.loading ? "Loading…" : (view.message ?? NO_PROVIDER_MESSAGE)}
          </p>
        </section>
      )}
    </div>
  );
}
