// The content area of an extension view's rail tab: its title bar with the
// view/title actions, an optional filter field with its own actions, then its
// tree, drawn with the same rows as the Files tree and the Changes list and
// windowed like them.

import { useVirtualizer } from "@tanstack/react-virtual";
import { SearchIcon, XIcon } from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { RunnerAsleepHint } from "../RunnerAsleepHint";
import { useScrollRestore } from "../useScrollRestore";
import { ChangedFileRow, FileGroupHeader } from "../ChangedFileRow";
import { FileRowItem, FolderRowItem } from "../FolderTree";
import { railViewIcon } from "../railViewIcons";
import {
  changedStatusOf,
  type RailTreeDecorationTone,
  type RailTreeModel,
  type RailTreeNode,
  type RailView,
  type RailViewRegistry,
  type RailViewTitleAction,
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
        bytes={node.size ?? null}
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

  // Changes arrive in bursts (a rebuild fires per setting or file event); reload once a frame.
  useEffect(() => {
    if (!tree) return;
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

const MESSAGE_LINK = /\[([^\]]+)\]\(command:([A-Za-z0-9._-]+)\)/g;

/** A view message: plain text, with `[text](command:id)` links drawn as buttons. */
function ViewMessage({ view }: { view: RailView }) {
  const message = view.message ?? "";
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of message.matchAll(MESSAGE_LINK)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(message.slice(last, index));
    const command = match[2];
    parts.push(
      <button
        key={index}
        type="button"
        className="cursor-pointer underline hover:text-foreground"
        onClick={() => view.host?.runCommand(command)}
      >
        {match[1]}
      </button>,
    );
    last = index + match[0].length;
  }
  if (last < message.length) parts.push(message.slice(last));
  return (
    <p
      className={cn(
        "px-2 py-1 text-sm",
        view.messageSeverity === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {parts}
    </p>
  );
}

/** Runs a title action; the button is disabled, and its icon spins, until it finished. */
function useRunningAction(action: { run: () => Promise<void> }) {
  const [running, setRunning] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(() => {
    if (running) return;
    setRunning(true);
    void action.run().finally(() => {
      if (mounted.current) setRunning(false);
    });
  }, [action, running]);
  return { running, run };
}

function ActionButton({ action }: { action: RailViewTitleAction }) {
  const { running, run } = useRunningAction(action);
  const Icon = railViewIcon(action.icon);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={action.title}
          aria-pressed={action.toggled}
          data-view-action={action.id}
          disabled={running}
          className={cn(
            "shrink-0",
            action.tone === "warning"
              ? "text-warning hover:text-warning/80"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={run}
        >
          {Icon ? (
            <Icon className={cn(running && "animate-spin")} />
          ) : (
            <span className="text-xs">{action.title}</span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{action.tooltip ?? action.title}</TooltipContent>
    </Tooltip>
  );
}

/** A submenu of toggles, such as a sort order: the button names the toggled entry. */
function SubmenuButton({ action }: { action: RailViewTitleAction }) {
  const items = action.items ?? [];
  const active = items.find((item) => item.toggled) ?? items[0];
  const Icon = railViewIcon(action.icon);
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={active ? `${action.title}: ${active.title}` : action.title}
              data-view-action={action.id}
              className="shrink-0 gap-[2px] text-muted-foreground hover:text-foreground"
            >
              {Icon && <Icon />}
              <span>{active?.title ?? action.title}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{action.tooltip ?? action.title}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup
          value={items.find((item) => item.toggled)?.id ?? ""}
          onValueChange={(value) => void items.find((item) => item.id === value)?.run()}
        >
          {items.map((item) => {
            const ItemIcon = railViewIcon(item.icon);
            return (
              <DropdownMenuRadioItem key={item.id} value={item.id}>
                {ItemIcon && <ItemIcon className="size-3.5" />}
                {item.title}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActionList({ actions }: { actions: readonly RailViewTitleAction[] }) {
  return (
    <TooltipProvider>
      {actions.map((action) =>
        action.items ? (
          <SubmenuButton key={action.id} action={action} />
        ) : (
          <ActionButton key={action.id} action={action} />
        ),
      )}
    </TooltipProvider>
  );
}

function ViewTitle({
  view,
  onClose,
  closeLabel,
}: {
  view: RailView;
  onClose?: () => void;
  closeLabel: string;
}) {
  const TagIcon = railViewIcon(view.tag?.icon);
  return (
    <div className="flex h-11 shrink-0 items-center gap-[2px] px-2">
      <h2 className="shrink-0 pl-1 font-medium text-ui">{view.title ?? view.name}</h2>
      {view.description && (
        <span className="min-w-0 truncate pl-1.5 text-muted-foreground text-sm">
          {view.description}
        </span>
      )}
      {view.tag && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                data-testid="extension-view-tag"
                className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {TagIcon && <TagIcon className="size-3 shrink-0" />}
                {view.tag.text}
              </span>
            </TooltipTrigger>
            {view.tag.tooltip && <TooltipContent>{view.tag.tooltip}</TooltipContent>}
          </Tooltip>
        </TooltipProvider>
      )}
      <div className="ml-auto flex items-center gap-[2px]">
        <ActionList actions={view.actions.filter((action) => action.group === "navigation")} />
        {onClose && (
          <button
            type="button"
            aria-label={closeLabel}
            className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            <XIcon className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/** The view's filter field and the actions next to it, laid out as the Files views' search bar. */
function ViewFilter({
  view,
  conversationId,
}: {
  view: RailView;
  conversationId: string | undefined;
}) {
  const filter = view.filter;
  const host = view.host;
  const [text, setText] = useState(() => host?.getFilter(conversationId) ?? "");
  if (!filter) return null;
  return (
    <div
      className="shrink-0 flex items-center gap-2 px-2 py-2 @max-[400px]/filespanel:flex-col @max-[400px]/filespanel:items-stretch"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex min-w-0 flex-1 items-center gap-[2px]">
        <div className="flex min-w-0 flex-1 items-center gap-[6px] rounded-lg border border-border px-[10px] py-[4px] transition-colors focus-within:border-border-strong">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            aria-label={filter.ariaLabel}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => {
              setText(event.target.value);
              host?.setFilter(conversationId, event.target.value);
            }}
            placeholder={filter.placeholder}
            type="search"
            value={text}
          />
        </div>
        <ActionList actions={view.actions.filter((action) => action.group === "filter")} />
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
  // Data for another session's workspace (it is still coming on screen) is not shown.
  const dataSession = tree.dataSessionId?.();
  const stale =
    dataSession !== undefined && conversationId !== undefined && dataSession !== conversationId;
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
  const ready = loaded && !stale;
  const handleScroll = useScrollRestore(
    scrollRef,
    conversationId ? `view:${view.id}:${conversationId}` : null,
    ready,
  );
  let body: ReactNode = null;
  if (!ready) {
    body = <p className="px-2 py-1 text-muted-foreground text-sm">Loading…</p>;
  } else if (view.notice) {
    body = (
      <RunnerAsleepHint
        sandboxOffline={view.notice !== "agentAsleep"}
        waking={view.notice === "sandboxStarting"}
      />
    );
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
      onScroll={handleScroll}
    >
      {ready && !view.notice && view.message && <ViewMessage view={view} />}
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
  visible = true,
  onClose,
  closeLabel = "Close",
}: {
  viewId: string;
  /** Whether extensions have finished loading, so a missing view is really gone. */
  settled: boolean;
  conversationId: string | undefined;
  registry?: RailViewRegistry;
  /** Whether the page is on screen (the rail open, the tab not hidden). */
  visible?: boolean;
  /** Draws a close button after the title actions, as in a drawer. */
  onClose?: () => void;
  closeLabel?: string;
}) {
  const { views } = useRailViews(registry);
  const view = views.find((candidate) => candidate.id === viewId);
  const host = view?.host;
  useEffect(() => (visible && host ? host.reportVisible() : undefined), [visible, host]);
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
      <ViewTitle view={view} onClose={onClose} closeLabel={closeLabel} />
      <div className="workspace-panel-header-divider shrink-0 border-t border-border" />
      <ViewFilter key={`filter:${conversationId}`} view={view} conversationId={conversationId} />
      {view.tree ? (
        <ViewTree
          key={`tree:${conversationId}`}
          view={view}
          tree={view.tree}
          conversationId={conversationId}
        />
      ) : (
        <section className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">
          {view.error ? (
            <p role="alert" className="px-2 py-1 text-destructive text-sm">
              {view.name} could not be loaded. Reload the page to try again.
            </p>
          ) : (
            <p className="px-2 py-1 text-muted-foreground text-sm">
              {view.loading ? "Loading…" : (view.message ?? NO_PROVIDER_MESSAGE)}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

/** Shown for a built-in tab whose view never registered, so the panel is never blank. */
export function MissingBuiltInView({ label }: { label: string }) {
  return (
    <section className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">
      <p role="alert" className="px-2 py-1 text-destructive text-sm">
        {label} could not be loaded. Reload the page to try again.
      </p>
    </section>
  );
}
