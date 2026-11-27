// The content area of an extension view's rail tab: its title bar with the
// view/title actions, an optional filter field with its own actions, then its
// tree, drawn with the same rows as the Files tree and the Changes list and
// windowed like them.

import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRightIcon, FileIcon, FilterIcon, SearchIcon, XIcon } from "lucide-react";
import {
  Fragment,
  lazy,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { BrowseLocationBar } from "../BrowseLocationBar";
import { CopyPathButton } from "../CopyPathButton";
import { FileRowItem, FolderRowItem, SearchDirRow, TreePlaceholderRow } from "../fileTreeRows";
import { OpenInMenu } from "../OpenInMenu";
import { useSession } from "@/hooks/useSession";
import { useWorkspaceEnvironment } from "@/hooks/useWorkspaceChangedFiles";
import { isOwnerLevel } from "@/lib/permissionsApi";
import { railViewIcon } from "../railViewIcons";
import {
  changedStatusOf,
  type RailTreeDecorationTone,
  type RailTreeModel,
  type RailRevealRequest,
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
  keyboardTarget,
  missingChildren,
  readExpandState,
  revealCannotMatch,
  ROOT_KEY,
  type TreeRowMotion,
  type VisibleTreeRow,
  visibleTreeRows,
  writeExpandState,
} from "./treeRows";
import { SessionTreeRow } from "./SessionTreeRow";
import { ViewSearchForm } from "./ViewSearchForm";
import { ViewPullRequests } from "./ViewPullRequests";
import type { WorkspaceBridge } from "../workspaceBridge";
import { ViewPlan } from "./ViewPlan";

const ViewGraph = lazy(() =>
  import("./ViewGraph").then((module) => ({ default: module.ViewGraph })),
);

const NO_PROVIDER_MESSAGE = "There is no data provider registered that can provide view data.";
// Deeper trees still load, as their nodes are expanded.
const MAX_TREE_DEPTH = 32;
// The Changes list spaces its rows by 2px; the Files tree does not.
const LIST_ROW_GAP_PX = 2;
// The Agents list spaces its rows by 1px.
const SESSION_ROW_GAP_PX = 1;
// A folder's rows slide in or out for this long, as the classic Files tree's did.
const TREE_MOTION_MS = 180;
// A revealed row flashes for as long as the shared flash animation plays.
const REVEAL_FLASH_MS = 800;
/** How long a reveal waits for its row, as `TreeView.reveal` waits for the tree to be drawn. */
const REVEAL_TIMEOUT_MS = 30_000;

const TONE_CLASS: Record<RailTreeDecorationTone, string> = {
  added: "text-(--diff-stat-added)",
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

/** `text` with `highlights` marked. */
function HighlightedText({
  text,
  highlights,
}: {
  text: string;
  highlights: RailTreeNode["highlights"];
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const [start, end] of highlights ?? []) {
    if (start < last) continue;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    last = end;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** A row's place in a session tree: whether the root's guide runs past it. */
export interface RowContext {
  rootGuideContinues: boolean;
  hasChildren: boolean;
  first: boolean;
}

function TreeRow({
  row,
  context,
  conversationId,
  onToggle,
  onRun,
  highlighted = false,
}: {
  row: VisibleTreeRow;
  context: RowContext;
  conversationId: string | undefined;
  onToggle: (node: RailTreeNode) => void;
  onRun: (node: RailTreeNode) => void;
  /** Briefly flashed, as a row `TreeView.reveal` brought into view. */
  highlighted?: boolean;
}) {
  const { node, depth, open } = row;
  const status = changedStatusOf(node.status);
  if (node.sessionId !== undefined) {
    return (
      <SessionTreeRow
        node={node}
        depth={depth}
        rootGuideContinues={context.rootGuideContinues}
        open={open}
        hasChildren={context.hasChildren}
        conversationId={conversationId}
        onToggle={onToggle}
        onRun={onRun}
      />
    );
  }
  if (node.line !== undefined) {
    // A text match: its line number, then the line with the match marked.
    return (
      <button
        type="button"
        aria-label={node.accessibleLabel}
        title={node.tooltip}
        onClick={() => onRun(node)}
        className="flex w-full cursor-pointer gap-2 rounded px-2 py-1 pl-6 text-left font-mono text-xs hover:bg-muted focus-visible:outline focus-visible:outline-ring"
        style={depth > 1 ? { paddingLeft: `${depth * 16 + 8}px` } : undefined}
      >
        <span className="shrink-0 text-muted-foreground">{node.line}</span>
        <span className="min-w-0 truncate whitespace-pre">
          <HighlightedText text={node.label} highlights={node.highlights} />
        </span>
      </button>
    );
  }
  if (node.collapsible !== "none" && node.icon === "file" && node.resourcePath !== undefined) {
    // The file of text matches: always open, as the search results list it.
    return (
      <span className={cn("ml-1.5 flex items-center gap-1 pb-2", !context.first && "pt-2")}>
        <FileIcon className="size-4 shrink-0" />
        <h3 className="break-all text-xs leading-normal font-semibold" title={node.tooltip}>
          {node.label}
        </h3>
      </span>
    );
  }
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
          // A folder's command (such as browsing into it) runs on a double click.
          onNavigate={node.hasCommand ? () => onRun(node) : undefined}
          highlighted={highlighted}
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
  if (node.resourcePath !== undefined && node.icon === "folder") {
    // A folder that is not a tree node (a search result): its path, going to it on a click.
    return (
      <SearchDirRow path={node.resourcePath} label={node.label} onRevealDir={() => onRun(node)} />
    );
  }
  if (node.resourcePath !== undefined) {
    return (
      <FileRowItem
        path={node.resourcePath}
        displayLabel={node.label}
        // A label with a slash is a path (a search result): truncated at its start.
        labelIsPath={node.label.includes("/")}
        depth={depth}
        fileStatus={status}
        bytes={node.size ?? null}
        highlighted={highlighted}
        // The diffstat before the status letter, as in the list.
        diffstat={node.decoration ? <Decoration decoration={node.decoration} /> : undefined}
        onFileSelect={() => onRun(node)}
        conversationId={conversationId}
      />
    );
  }
  if (!node.hasCommand && node.icon === undefined) {
    // Neither a resource nor a command: a muted line, such as "Loading…" under a folder.
    return <TreePlaceholderRow depth={depth} text={node.label} />;
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

/** A view message: plain text, one paragraph per line, with `[text](command:id)` links drawn as buttons. */
function ViewMessage({
  view,
  spacious = false,
  small = false,
}: {
  view: RailView;
  spacious?: boolean;
  small?: boolean;
}) {
  // Each line once: a repeated line would say nothing new.
  const lines = [...new Set((view.message ?? "").split("\n").filter((line) => line !== ""))];
  return lines.map((line) => (
    <ViewMessageLine key={line} view={view} message={line} spacious={spacious} small={small} />
  ));
}

function ViewMessageLine({
  view,
  message,
  spacious,
  small,
}: {
  view: RailView;
  message: string;
  spacious: boolean;
  small: boolean;
}) {
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
  const error = view.messageSeverity === "error";
  return (
    <p
      role={error ? "alert" : "status"}
      className={cn(
        "break-words",
        spacious ? "p-2" : "px-2 py-1",
        // Above search results, the summary lines are the results list's small print.
        small ? "text-xs" : "text-sm",
        error ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {parts}
    </p>
  );
}

/**
 * The view's welcome content (`contributes.viewsWelcome`), drawn while it has nothing else to
 * show: a line holding only a command link is a button, other links are inline.
 */
function ViewWelcome({ view }: { view: RailView }) {
  return (
    <div data-slot="view-welcome" className="flex flex-col gap-2 p-2 text-sm text-muted-foreground">
      {view.welcome.flatMap((block, blockIndex) =>
        block.contents
          .split("\n")
          .filter((line) => line.trim() !== "")
          .map((line, lineIndex) => {
            const key = `${blockIndex}:${lineIndex}`;
            const alone = /^\s*\[([^\]]+)\]\(command:([A-Za-z0-9._-]+)\)\s*$/.exec(line);
            if (alone) {
              return (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  className="w-full"
                  onClick={() => view.host?.runCommand(alone[2])}
                >
                  {alone[1]}
                </Button>
              );
            }
            return <WelcomeLine key={key} view={view} line={line} />;
          }),
      )}
    </div>
  );
}

function WelcomeLine({ view, line }: { view: RailView; line: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of line.matchAll(MESSAGE_LINK)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(line.slice(last, index));
    const command = match[2];
    parts.push(
      <button
        key={index}
        type="button"
        className="cursor-pointer text-foreground underline"
        onClick={() => view.host?.runCommand(command)}
      >
        {match[1]}
      </button>,
    );
    last = index + match[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return <p className="break-words">{parts}</p>;
}

/** A task the view shows progress for (`withProgress` with the view's location). */
function ViewProgress({ title }: { title: string }) {
  return (
    <div role="status" className="flex items-center gap-2 p-2 text-sm">
      <Spinner /> {title}
    </div>
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
  // Toggles (a command with `toggled`, such as List / Graph view) are the compact
  // pressed-or-not pair of a segmented control.
  if (action.toggled !== undefined) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={action.toggled ? "secondary" : "ghost"}
            size="icon-xs"
            aria-label={action.title}
            aria-pressed={action.toggled}
            data-view-action={action.id}
            disabled={running}
            onClick={run}
          >
            {Icon ? <Icon className="size-3.5" /> : <span className="text-xs">{action.title}</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{action.tooltip ?? action.title}</TooltipContent>
      </Tooltip>
    );
  }
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

export function ActionList({
  actions,
  renderHostAction,
}: {
  actions: readonly RailViewTitleAction[];
  /** Draws an entry of a host-drawn kind (`kind`), such as the filter's fields toggle. */
  renderHostAction?: (action: RailViewTitleAction) => ReactNode;
}) {
  return (
    <TooltipProvider>
      {actions.map((action) =>
        action.kind ? (
          <Fragment key={action.id}>{renderHostAction?.(action) ?? null}</Fragment>
        ) : action.items ? (
          <SubmenuButton key={action.id} action={action} />
        ) : (
          <ActionButton key={action.id} action={action} />
        ),
      )}
    </TooltipProvider>
  );
}

/** A view's location bar (`TreeView.location`): what the session may browse comes from the host. */
function ViewLocationBar({
  view,
  conversationId,
}: {
  view: RailView;
  conversationId: string | undefined;
}) {
  const { session } = useSession(conversationId);
  const environment = useWorkspaceEnvironment(conversationId, { enabled: true });
  const location = view.location;
  if (!location) return null;
  return (
    <BrowseLocationBar
      current={location.path}
      workspace={location.root}
      hostId={session?.hostId ?? null}
      canBrowseOutside={isOwnerLevel(session?.permissionLevel ?? null)}
      reach={environment.data?.reachable ?? null}
      onNavigate={(path) => view.host?.navigate(conversationId, path)}
      error={location.error ?? null}
    />
  );
}

/** A stacked view's header toggles it, as a VS Code pane header. */
export interface ViewCollapse {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}

function ViewTitle({
  view,
  onClose,
  closeLabel,
  conversationId,
  collapse,
}: {
  view: RailView;
  onClose?: () => void;
  closeLabel: string;
  conversationId: string | undefined;
  collapse?: ViewCollapse;
}) {
  const TagIcon = railViewIcon(view.tag?.icon);
  const navigation = view.actions.filter((action) => action.group === "navigation");
  // Open In sits last, after the drawer's Close, as in the classic Files header.
  const openIn = navigation.find((action) => action.kind === "openIn");
  return (
    <div
      data-slot="view-title"
      className="flex h-(--ui-view-title-height) shrink-0 items-center gap-(--ui-view-title-gap) px-(--ui-view-title-padding-x)"
    >
      {collapse ? (
        <button
          type="button"
          data-slot="view-title-label"
          aria-expanded={!collapse.collapsed}
          onClick={collapse.onToggle}
          className="ui-label flex min-w-0 shrink-0 cursor-pointer items-center gap-1 font-medium text-ui"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              !collapse.collapsed && "rotate-90",
            )}
          />
          <span className="truncate">{view.title ?? view.name}</span>
        </button>
      ) : view.locationBar ? (
        <ViewLocationBar view={view} conversationId={conversationId} />
      ) : (
        <h2 data-slot="view-title-label" className="ui-label shrink-0 pl-1 font-medium text-ui">
          {view.title ?? view.name}
        </h2>
      )}
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
      <div className={cn("ml-auto flex items-center gap-[2px]", collapse?.collapsed && "hidden")}>
        {view.location && (
          // Its own provider, as each header control brings one.
          <TooltipProvider>
            <CopyPathButton path={view.location.path} label="Copy folder path" />
          </TooltipProvider>
        )}
        <ActionList actions={navigation.filter((action) => action !== openIn)} />
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
        {openIn && view.location && <OpenInMenu path={view.location.path} directory />}
      </div>
    </div>
  );
}

/** The view's filter field and the actions next to it, laid out as the Files views' search bar. */
function ViewFilter({
  view,
  conversationId,
  inputRef,
}: {
  view: RailView;
  conversationId: string | undefined;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const filter = view.filter;
  const host = view.host;
  const [text, setText] = useState(() => host?.getFilter(conversationId) ?? "");
  const [fields, setFields] = useState(() => host?.getFilterFields(conversationId) ?? {});
  const [showFields, setShowFields] = useState(false);
  // The extension set the text (as when a revealed result ends its search): show it.
  const revision = view.filterRevision;
  const revisionRef = useRef(revision);
  useEffect(() => {
    if (revisionRef.current === revision) return;
    revisionRef.current = revision;
    setText(host?.getFilter(conversationId) ?? "");
  }, [revision, host, conversationId]);
  if (!filter) return null;
  const fieldsActive = Object.values(fields).some((value) => value.trim() !== "");
  const renderHostAction = (action: RailViewTitleAction) =>
    action.kind === "filterFields" && filter.fields ? (
      <Tooltip key={action.id}>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={showFields ? "Hide search filters" : "Show search filters"}
            aria-expanded={showFields}
            data-view-action={action.id}
            className={cn(
              "shrink-0",
              showFields || fieldsActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setShowFields((value) => !value)}
          >
            <FilterIcon />
            {fieldsActive && !showFields && (
              <span
                className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
                aria-hidden
              />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{action.tooltip ?? action.title}</TooltipContent>
      </Tooltip>
    ) : null;
  return (
    <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center gap-2 px-2 py-2 @max-[400px]/filespanel:flex-col @max-[400px]/filespanel:items-stretch">
        <div className="flex min-w-0 flex-1 items-center gap-[2px]">
          <div className="flex min-w-0 flex-1 items-center gap-[6px] rounded-lg border border-border px-[10px] py-[4px] transition-colors focus-within:border-border-strong">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
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
          <ActionList
            actions={view.actions.filter((action) => action.group === "filter")}
            renderHostAction={renderHostAction}
          />
        </div>
      </div>
      {showFields && filter.fields && (
        <div className="flex flex-col gap-1.5 border-border border-t px-3 py-2">
          {filter.fields.map((field) => (
            <label key={field.id} className="flex flex-col gap-0.5">
              <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                {field.label}
              </span>
              <input
                aria-label={field.label}
                className="w-full rounded border border-border bg-transparent px-2 py-1 font-mono text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
                onChange={(event) => {
                  const next = { ...fields, [field.id]: event.target.value };
                  setFields(next);
                  host?.setFilterFields(conversationId, next);
                }}
                placeholder={field.placeholder}
                type="text"
                value={fields[field.id] ?? ""}
              />
            </label>
          ))}
        </div>
      )}
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
  const [motions, setMotions] = useState<ReadonlyMap<string, TreeRowMotion>>(() => new Map());
  const motionTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = motionTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);
  const rows = useMemo(
    () => visibleTreeRows(children, expanded, motions),
    [children, expanded, motions],
  );
  const listLayout = isListLayout(rows);
  const sessionLayout = rows.some((row) => row.node.sessionId !== undefined);
  // Text matches under their files read as the search results list: no row gap, padded.
  const matchLayout = rows.some((row) => row.node.line !== undefined);
  const contexts = useMemo(() => rowContexts(rows, children), [rows, children]);
  const scrollRef = useRef<HTMLElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 25,
    overscan: 12,
    gap: sessionLayout ? SESSION_ROW_GAP_PX : matchLayout ? 0 : listLayout ? LIST_ROW_GAP_PX : 0,
    getItemKey: (index) => rows[index]?.node.handle ?? index,
  });
  const setOpen = useCallback(
    (handles: readonly string[], open: boolean) => {
      setExpanded((previous) => {
        if (handles.every((handle) => previous.get(handle) === open)) return previous;
        const next = new Map(previous);
        for (const handle of handles) next.set(handle, open);
        writeExpandState(conversationId, view.id, next);
        return next;
      });
    },
    [conversationId, view.id],
  );
  // A folder's rows slide in when it opens and out before it closes, as in the classic Files tree.
  const startMotion = useCallback(
    (handle: string, motion: TreeRowMotion) => {
      const timers = motionTimers.current;
      clearTimeout(timers.get(handle));
      setMotions((previous) => new Map(previous).set(handle, motion));
      const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      timers.set(
        handle,
        setTimeout(
          () => {
            timers.delete(handle);
            if (motion === "exit") setOpen([handle], false);
            setMotions((previous) => {
              if (previous.get(handle) !== motion) return previous;
              const next = new Map(previous);
              next.delete(handle);
              return next;
            });
          },
          reduceMotion ? 0 : TREE_MOTION_MS,
        ),
      );
    },
    [setOpen],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const select = useCallback(
    (handle: string) => {
      setSelected(handle);
      tree.select?.([handle]);
    },
    [tree],
  );
  const toggle = useCallback(
    (node: RailTreeNode) => {
      select(node.handle);
      const open = isNodeOpen(node, expanded) && motions.get(node.handle) !== "exit";
      if (node.icon !== "folder") {
        setOpen([node.handle], !open);
        return;
      }
      if (open) {
        startMotion(node.handle, "exit");
        return;
      }
      setOpen([node.handle], true);
      startMotion(node.handle, "enter");
    },
    [expanded, motions, select, setOpen, startMotion],
  );
  const run = useCallback(
    (node: RailTreeNode) => {
      select(node.handle);
      if (node.hasCommand) tree.runCommand(node.handle);
    },
    [select, tree],
  );
  // `TreeView.reveal`: open the ancestors, then once the row is there, scroll to it and flash it.
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealTick, setRevealTick] = useState(0);
  const pendingReveal = useRef<RailRevealRequest | null>(null);
  // The children loaded when the pending reveal arrived: only a level loaded since can rule it out.
  const childrenAtReveal = useRef<ReadonlyMap<string, readonly RailTreeNode[]>>(new Map());
  const childrenRef = useRef(children);
  childrenRef.current = children;
  const revealExpiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(flashTimer.current);
      clearTimeout(revealExpiry.current);
    },
    [],
  );
  // A reveal belongs to the conversation it was asked in; another one on screen drops it.
  useEffect(
    () => () => {
      pendingReveal.current = null;
      clearTimeout(revealExpiry.current);
    },
    [conversationId],
  );
  useEffect(() => {
    const take = tree.takeReveal;
    if (!take) return;
    const apply = () => {
      const request = take(conversationId);
      if (!request) return;
      setOpen(
        request.expand > 0 ? [...request.ancestors, request.handle] : request.ancestors,
        true,
      );
      pendingReveal.current = request;
      childrenAtReveal.current = childrenRef.current;
      // A row that never shows up (it was removed, or its ancestors never load) is given up on.
      clearTimeout(revealExpiry.current);
      revealExpiry.current = setTimeout(() => {
        if (pendingReveal.current === request) pendingReveal.current = null;
      }, REVEAL_TIMEOUT_MS);
      setRevealTick((value) => value + 1);
    };
    apply();
    return tree.subscribeReveal?.(apply);
  }, [tree, conversationId, setOpen]);
  const ready = loaded && !stale;
  const focusIndex = useRef<number | null>(null);
  // Whether the row focused next is also selected (the keyboard), as VS Code's selection follows focus.
  const focusSelects = useRef(false);
  const [focusTick, setFocusTick] = useState(0);
  const focusRow = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return;
      select(row.node.handle);
      focusIndex.current = index;
      focusSelects.current = true;
      virtualizer.scrollToIndex(index);
      setFocusTick((value) => value + 1);
    },
    [rows, select, virtualizer],
  );
  // Focus lands once the row is drawn (a scrolled-off row mounts after the scroll).
  useEffect(() => {
    const index = focusIndex.current;
    if (index === null) return;
    const item = scrollRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    const button = item?.querySelector<HTMLElement>("button, a");
    if (!item || !button) return;
    focusIndex.current = null;
    button.focus({ preventScroll: true });
    // The row drawn at the index may have changed since the key was pressed (a folder's
    // children just loaded): the row that takes focus is the one selected.
    const handle = item.dataset.treeItem;
    if (focusSelects.current && handle !== undefined && handle !== selected) select(handle);
    focusSelects.current = false;
  });
  useEffect(() => {
    const request = pendingReveal.current;
    if (!request || !ready) return;
    const index = rows.findIndex((row) => row.node.handle === request.handle);
    if (index === -1) {
      // Not there yet while a lazy ancestor is still loading; dropped once it cannot be.
      if (revealCannotMatch(request, children, childrenAtReveal.current)) {
        pendingReveal.current = null;
        clearTimeout(revealExpiry.current);
      }
      return;
    }
    pendingReveal.current = null;
    clearTimeout(revealExpiry.current);
    virtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" });
    setRevealed(request.handle);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setRevealed(null), REVEAL_FLASH_MS);
    if (request.select) select(request.handle);
    if (request.focus) {
      focusIndex.current = index;
      focusSelects.current = request.select;
      setFocusTick((value) => value + 1);
    }
  }, [rows, children, ready, revealTick, virtualizer, select]);
  // Arrow keys, Home and End move between rows; Right and Left open, close or go to the parent.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea")) return;
    const current = target.closest<HTMLElement>("[data-index]");
    const index = current ? Number(current.dataset.index) : -1;
    const move = keyboardTarget(rows, index, event.key);
    if (!move) return;
    event.preventDefault();
    if ("toggle" in move) toggle(rows[move.toggle].node);
    else focusRow(move.index);
  };
  void focusTick;
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
              aria-selected={selected === row.node.handle || undefined}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <div
                data-tree-motion={row.motion}
                className={cn(
                  row.motion === "enter" && "file-tree-row-enter",
                  row.motion === "exit" && "file-tree-row-exit",
                )}
              >
                <TreeRow
                  row={row}
                  context={contexts[item.index]}
                  conversationId={conversationId}
                  onToggle={toggle}
                  onRun={run}
                  highlighted={revealed === row.node.handle}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  const progress = view.progress.findLast((entry) => entry.sessionId === conversationId);
  return (
    <section
      ref={scrollRef}
      aria-busy={progress !== undefined}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto px-2 pb-2",
        sessionLayout || matchLayout || view.searchInput
          ? "pt-2"
          : // The Files tab's search results sit right under its search bar, as its tree does.
            listLayout && !view.locationBar
            ? "pt-1"
            : "pt-0",
      )}
      onScroll={handleScroll}
      onKeyDown={onKeyDown}
    >
      {progress && <ViewProgress title={progress.title} />}
      {ready && !view.notice && view.message && (
        <ViewMessage view={view} spacious={view.searchInput !== undefined} small={matchLayout} />
      )}
      {ready && !view.notice && !view.message && rows.length === 0 && view.welcome.length > 0 && (
        <ViewWelcome view={view} />
      )}
      <TooltipProvider>{body}</TooltipProvider>
    </section>
  );
}

/** Per row: whether the root's guide runs past it, whether it has sub-rows, whether it is first. */
function rowContexts(
  rows: readonly VisibleTreeRow[],
  children: ReadonlyMap<string, readonly RailTreeNode[]>,
): RowContext[] {
  // The root guide runs down to the last first-level row.
  let lastFirstLevel = -1;
  rows.forEach((row, index) => {
    if (row.depth === 1) lastFirstLevel = index;
  });
  return rows.map((row, index) => ({
    rootGuideContinues: index < lastFirstLevel,
    hasChildren:
      row.node.collapsible !== "none" &&
      (children.get(row.node.handle) === undefined ||
        (children.get(row.node.handle)?.length ?? 0) > 0),
    first: index === 0,
  }));
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
  focusToken = 0,
  onFocused,
  onOpenPullRequest,
  bridge,
  collapse,
}: {
  /** Stacked in a side bar: the title toggles the view, and a collapsed one draws only it. */
  collapse?: ViewCollapse;
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
  /** Each new non-zero value focuses the view's input (search input or filter). */
  focusToken?: number;
  /** Called once a focus request was carried out. */
  onFocused?: () => void;
  /** A pull request view on a page that shows each pull request on its own opens them here. */
  onOpenPullRequest?: (url: string, section?: "summary" | "comments" | "changes") => void;
  /** The workspace bridge a page's list watch goes through (the window's by default). */
  bridge?: WorkspaceBridge;
}) {
  const { views } = useRailViews(registry, null);
  const view = views.find((candidate) => candidate.id === viewId);
  const host = view?.host;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => (visible && host ? host.reportVisible() : undefined), [visible, host]);
  const onFocusedRef = useRef(onFocused);
  onFocusedRef.current = onFocused;
  const viewPresent = view !== undefined;
  // Only a new token asks again; a view that registers later takes a pending one.
  useEffect(() => {
    if (focusToken === 0 || !inputRef.current) return;
    inputRef.current.focus();
    onFocusedRef.current?.();
  }, [focusToken, viewPresent]);
  if (!view) {
    return settled ? null : (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  if (view.pullRequests) {
    // Pull requests draw their own bar, as the classic tab did: no title bar.
    return (
      <div
        data-testid={`extension-view-${view.id}`}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <ViewPullRequests
          view={view}
          content={view.pullRequests}
          conversationId={conversationId}
          visible={visible}
          onOpenPullRequest={onOpenPullRequest}
          bridge={bridge}
        />
      </div>
    );
  }
  if (view.plan) {
    // A plan draws its own heading, as the classic Tasks tab did: no title bar.
    return (
      <div
        data-testid={`extension-view-${view.id}`}
        className="@container/filespanel flex min-h-0 flex-1 flex-col overflow-hidden bg-card"
      >
        <ViewPlan
          key={`plan:${conversationId}`}
          view={view}
          content={view.plan}
          conversationId={conversationId}
          visible={visible}
        />
      </div>
    );
  }
  return (
    <div
      data-testid={`extension-view-${view.id}`}
      className="@container/filespanel flex min-h-0 flex-1 flex-col overflow-hidden bg-card"
    >
      {view.searchInput ? (
        // A search view's form stands in for its title bar, as VS Code's Search view.
        <ViewSearchForm
          key={`search:${conversationId}`}
          view={view}
          conversationId={conversationId}
          inputRef={inputRef}
        />
      ) : (
        <>
          <ViewTitle
            view={view}
            onClose={onClose}
            closeLabel={closeLabel}
            conversationId={conversationId}
            collapse={collapse}
          />
          {!collapse?.collapsed && (
            <div className="workspace-panel-header-divider shrink-0 border-t border-border" />
          )}
        </>
      )}
      {collapse?.collapsed ? null : (
        <>
          <ViewFilter
            key={`filter:${conversationId}`}
            view={view}
            conversationId={conversationId}
            inputRef={view.searchInput ? undefined : inputRef}
          />
          {view.tree && view.presentation === "graph" ? (
            <Suspense
              fallback={
                <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">
                  Loading graph…
                </div>
              }
            >
              <ViewGraph
                key={`graph:${conversationId}`}
                tree={view.tree}
                conversationId={conversationId}
              />
            </Suspense>
          ) : view.tree ? (
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
              ) : !view.loading && view.message === undefined && view.welcome.length > 0 ? (
                <ViewWelcome view={view} />
              ) : (
                <p className="px-2 py-1 text-muted-foreground text-sm">
                  {view.loading ? "Loading…" : (view.message ?? NO_PROVIDER_MESSAGE)}
                </p>
              )}
            </section>
          )}
        </>
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
