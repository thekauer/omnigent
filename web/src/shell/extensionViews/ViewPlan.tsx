// A plan view's page (`window.createPlanView`): a session's tasks as the Tasks tab
// draws them, from the plain content an extension sets. The summary and progress
// strip stay at the top while the rows scroll; a row opens its history, its ⋯ menu
// offers its action, and the plan opens on a graph. Commands run through the host.

import type * as omnigent from "omnigent";
import {
  type ReactNode,
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronRightIcon, EllipsisIcon, WorkflowIcon } from "lucide-react";
import { SessionActionMenuItem } from "@/components/SessionActionMenuItem";
import { FullscreenIcon } from "@/components/ai-elements/MermaidBlock";
import { RunWorkflowMenu } from "@/components/composer/RunWorkflowMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StepDescription } from "@/components/workflows/StepDescription";
import { SessionDescendantRuns } from "@/components/workflows/WorkflowRunRow";
import {
  CantStart,
  clock,
  Elapsed,
  goalPreview,
  listNames,
  ProgressStrip,
  STATE_LABELS,
  StepGlyph,
  TaskMenu,
  type TaskMenuAction,
} from "@/components/workflows/taskParts";
import { useNow } from "@/hooks/useNow";
import {
  absoluteTime,
  formatMessageTimestamp,
  relativeTime,
  TIMESTAMP_FONT_CLASS,
} from "@/lib/relativeTime";
import {
  type JournalEntry,
  type StepProgress,
  type StepState,
  stepStatusLabel,
  WAITING_FOR_YOU,
} from "@/lib/sessionJournal";
import { Link } from "@/lib/routing";
import { cn } from "@/lib/utils";
import { PlanRunButton } from "@/shell/PlanRunButton";
import { useSessionTasksActions } from "@/store/sessionTasksActions";
import { railViewIcon } from "../railViewIcons";
import type { RailView } from "../railViews";

// React Flow loads only once a plan opens on its graph.
const WorkflowGraphOverlay = lazy(() =>
  import("@/components/workflows/WorkflowStepsGraph").then((module) => ({
    default: module.WorkflowGraphOverlay,
  })),
);

/** The built-in command that scrolls the chat; the graph, which covers the chat, closes first. */
const SHOW_IN_CHAT_COMMAND = "omnigent.showInChat";
const START_WORKFLOW_COMMAND = "omnigent.tasks.startWorkflow";

/** A task's status as the shared task parts read it: a journal status entry. */
function statusEntry(task: omnigent.SessionTask, status: omnigent.TaskStatus): JournalEntry {
  return {
    id: status.id,
    position: 0,
    created_at: status.createdAt,
    scheduled_task_run_id: null,
    step: task.id,
    author: { type: "agent" },
    kind: "status",
    content: { status: status.status, text: status.text },
  };
}

/** A task as the shared task parts (strip, card, graph) take it. */
export function stepProgressOf(task: omnigent.SessionTask): StepProgress {
  return {
    step: { id: task.id, name: task.name, goal: task.goal, depends_on: [...task.dependsOn] },
    state: task.state,
    status: task.status ? statusEntry(task, task.status) : null,
    startedAt: task.startedAt,
    native: task.native,
    activeForm: task.activeForm,
  };
}

/** "3m ago", kept fresh by the shared clock. */
function Ago({ seconds }: { seconds: number }) {
  const now = useNow();
  const ago = relativeTime(seconds * 1000, now.getTime());
  return (
    <time
      dateTime={new Date(seconds * 1000).toISOString()}
      title={absoluteTime(seconds * 1000)}
      className={TIMESTAMP_FONT_CLASS}
    >
      {ago === "now" ? "just now" : `${ago} ago`}
    </time>
  );
}

/** @param failedNames - The failed tasks it waits on, by name, when that's why it can't start. */
function stepDetail(item: StepProgress, failedNames: readonly string[] = []): ReactNode {
  const text =
    item.status && typeof item.status.content.text === "string" ? item.status.content.text : null;
  switch (item.state) {
    case "waiting":
      if (failedNames.length === 0) return goalPreview(item.step);
      return <CantStart failedNames={failedNames} />;
    case "ready": {
      const goal = goalPreview(item.step);
      return (
        <>
          <span className="font-medium text-session-active">Ready</span>
          {goal && ` · ${goal}`}
        </>
      );
    }
    case "needs_input":
      // A running task becomes this while a prompt waits; its start has no text.
      return (
        <>
          <span className="font-medium text-brand-accent">{WAITING_FOR_YOU}</span>
          {` · ${text ?? "Respond in the chat"}`}
        </>
      );
    case "stopped":
      if (!item.status) return item.activeForm;
      return [stepStatusLabel("started", item.startedAt ?? item.status.created_at, false), text]
        .filter(Boolean)
        .join(" · ");
    default:
      return text ?? item.activeForm;
  }
}

/** A running task's time so far, or when a finished one ended, stamped like a chat message. */
function StepMeta({ item, task }: { item: StepProgress; task: omnigent.SessionTask }) {
  const { startedAt, status } = item;
  if (!status || !task.status) return null;
  if (item.state === "done" || item.state === "failed") {
    const endedAt = status.created_at;
    return (
      <time
        dateTime={new Date(endedAt * 1000).toISOString()}
        title={
          startedAt === null
            ? absoluteTime(endedAt * 1000)
            : `${clock(startedAt)} – ${clock(endedAt)}`
        }
      >
        {formatMessageTimestamp(endedAt)}
      </time>
    );
  }
  if (
    startedAt !== null &&
    (item.state === "running" || (item.state === "needs_input" && task.status.status === "started"))
  ) {
    return (
      <span
        className={item.state === "running" ? "text-session-active" : undefined}
        title={`Started ${absoluteTime(startedAt * 1000)}`}
      >
        <Elapsed since={startedAt} />
      </span>
    );
  }
  return null;
}

const ENTRY_LABELS: Record<omnigent.TaskStatus["status"], string> = {
  started: "Started",
  done: "Done",
  needs_input: WAITING_FOR_YOU,
  failed: "Failed",
};

const ENTRY_DOT_COLORS: Record<omnigent.TaskStatus["status"], string> = {
  started: "bg-session-active",
  done: "bg-success",
  needs_input: "bg-brand-accent",
  failed: "bg-destructive",
};

/**
 * Each status a task recorded, oldest first, after what it waits on and its
 * whole goal, which its row shows only the start of. A line marks where each
 * later attempt begins.
 */
function StepHistory({
  task,
  names,
}: {
  task: omnigent.SessionTask;
  names: ReadonlyMap<string, string>;
}) {
  return (
    <div className="mt-1 mb-1.5 flex flex-col gap-2 rounded-lg bg-muted/70 px-3 py-2.5 text-sm">
      {task.dependsOn.length > 0 && (
        <p className="break-words text-muted-foreground">
          After{" "}
          <span className="text-foreground">
            {listNames(task.dependsOn.map((id) => names.get(id) ?? id))}
          </span>
        </p>
      )}
      {task.goal && <StepDescription text={task.goal} />}
      {task.history.length === 0 ? (
        <p className="text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="flex flex-col gap-1" aria-label={`${task.name} history`}>
          {task.history.map((entry) => (
            <Fragment key={entry.id}>
              {entry.restart && (
                <li
                  className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground"
                  data-testid="tasks-history-restart"
                >
                  <span aria-hidden className="h-px flex-1 bg-border" />
                  Restarted
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </li>
              )}
              <li className="flex items-start gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "mt-[7px] size-1.5 shrink-0 rounded-full",
                    ENTRY_DOT_COLORS[entry.status],
                  )}
                />
                <span className="min-w-0 flex-1 break-words text-muted-foreground">
                  <span className="text-foreground">{ENTRY_LABELS[entry.status]}</span>
                  {entry.text && ` · ${entry.text}`}
                </span>
                <time
                  className="shrink-0 tabular-nums text-muted-foreground"
                  dateTime={new Date(entry.createdAt * 1000).toISOString()}
                  title={absoluteTime(entry.createdAt * 1000)}
                >
                  {clock(entry.createdAt)}
                </time>
              </li>
            </Fragment>
          ))}
        </ol>
      )}
    </div>
  );
}

// A task row's small icon buttons: its ⋯ menu and the chevron that opens its history.
const ROW_ICON_BUTTON =
  "mt-1.5 shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

function StepRow({
  entry,
  item,
  number,
  last,
  names,
  flash,
  onRun,
  menuAction,
}: {
  entry: omnigent.PlanViewTask;
  item: StepProgress;
  number: number;
  last: boolean;
  names: ReadonlyMap<string, string>;
  /** True for a moment after a click on its progress segment or its chat marker. */
  flash: boolean;
  onRun: (command: omnigent.Command) => void;
  /** What its ⋯ menu offers: Run, Continue, Retry or Stop; absent for none. */
  menuAction?: TaskMenuAction;
}) {
  const { task } = entry;
  const [open, setOpen] = useState(false);
  const failedNames = task.blockedBy.map((id) => names.get(id) ?? id);
  const detail = stepDetail(item, failedNames);
  const waiting = item.state === "waiting";
  const emphasized =
    item.state === "running" || item.state === "needs_input" || item.state === "failed";
  // A click goes to the task's marker in the chat; one that hasn't started has none.
  const command = entry.command;
  // The agent's own tasks have no history to open.
  const hasHistory = !task.native;
  const tint = flash
    ? "bg-session-active/12"
    : item.state === "running"
      ? "bg-session-active/[0.06]"
      : item.state === "needs_input"
        ? "bg-brand-accent/[0.06]"
        : undefined;
  const rowClassName = cn(
    "grid min-w-0 flex-1 grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-x-3 rounded-lg px-2 py-1.5 text-left",
    command &&
      "cursor-pointer hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  );
  const content = (
    <>
      <span className="pt-[3px]">
        <StepGlyph state={item.state} number={number} />
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block break-words text-ui leading-6",
            waiting ? "text-muted-foreground" : "text-foreground",
            emphasized && "font-medium",
          )}
        >
          {task.name}
        </span>
        {detail && (
          <span className="mt-px line-clamp-3 block break-words text-pretty text-sm text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
      <span className="pt-[3px] text-sm tabular-nums text-muted-foreground">
        <StepMeta item={item} task={task} />
      </span>
    </>
  );
  return (
    <li
      className="relative"
      data-testid="tasks-row"
      data-state={item.state}
      data-step-id={task.id}
      data-flash={flash || undefined}
    >
      {!last && (
        <span
          aria-hidden
          className="absolute top-[31px] -bottom-[5px] left-[16.5px] w-px bg-border"
        />
      )}
      <div className={cn("flex items-start rounded-lg transition-colors duration-500", tint)}>
        {command ? (
          <button
            type="button"
            onClick={() => onRun(command)}
            className={rowClassName}
            title="Show in the chat"
            data-testid="tasks-row-show-in-chat"
          >
            {content}
          </button>
        ) : (
          <div className={rowClassName}>{content}</div>
        )}
        {menuAction && (
          <TaskMenu
            taskName={task.name}
            menuAction={menuAction}
            testIdPrefix="tasks-row"
            className={cn(ROW_ICON_BUTTON, !hasHistory && "mr-1")}
          />
        )}
        {hasHistory && (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} ${task.name} history`}
            onClick={() => setOpen((value) => !value)}
            className={cn(ROW_ICON_BUTTON, "mr-1")}
            data-testid="tasks-row-history"
          >
            <ChevronRightIcon
              aria-hidden
              className={cn("size-4 transition-transform", open && "rotate-90")}
            />
          </button>
        )}
      </div>
      {open && (
        <div className="pr-2 pl-[38px]">
          <StepHistory task={task} names={names} />
        </div>
      )}
    </li>
  );
}

/**
 * Marks a plan that runs a saved workflow, or was saved as one, with the
 * workflow's name on hover. With the Workflows page on, it opens the
 * workflow's page.
 */
function WorkflowChip({
  workflow,
}: {
  workflow: NonNullable<Extract<omnigent.PlanViewContent, { kind: "plan" }>["workflow"]>;
}) {
  const className = "h-5 gap-1 px-1.5 text-xs font-normal text-muted-foreground";
  const label = (
    <>
      <WorkflowIcon className="size-3" />
      Workflow
    </>
  );
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {workflow.linked ? (
            <Badge asChild variant="outline" className={className}>
              <Link
                to={`/workflows/${encodeURIComponent(workflow.id)}`}
                componentId="tasks.plan.workflow"
                data-testid="tasks-plan-workflow"
              >
                {label}
              </Link>
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className={className}
              tabIndex={0}
              data-testid="tasks-plan-workflow"
            >
              {label}
            </Badge>
          )}
        </TooltipTrigger>
        <TooltipContent>{workflow.tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const COUNT_COLORS: Partial<Record<StepState, string>> = {
  needs_input: "text-brand-accent",
  running: "text-session-active",
  failed: "text-destructive",
};

type PlanContent = Extract<omnigent.PlanViewContent, { kind: "plan" }>;

/**
 * The tasks' summary and progress strip. It stays at the top of the panel while
 * the rest scrolls, with a hairline under it once something scrolls beneath.
 */
function TasksHeader({
  content,
  progress,
  stuck,
  onSelect,
  onRun,
  menuActionFor,
  onOpenGraph,
}: {
  content: PlanContent;
  progress: readonly StepProgress[];
  stuck: boolean;
  onSelect: (stepId: string) => void;
  onRun: (command: omnigent.Command) => void;
  menuActionFor: (item: StepProgress) => TaskMenuAction | undefined;
  onOpenGraph?: () => void;
}) {
  const name = content.title;
  const updatedAt = content.updatedAt ?? 0;
  const control = content.runControl;
  // A menu entry runs once this menu has closed, so a dialog it opens keeps focus.
  const afterCloseRef = useRef<omnigent.Command | null>(null);
  const menu = content.menu ?? [];
  return (
    <header
      className={cn(
        "tasks-header sticky top-0 z-10 -mx-2 -mb-7 flex flex-col gap-2.5 px-4 pt-4 pb-3 transition-shadow",
        stuck && "shadow-[0_1px_0_var(--border)]",
      )}
      data-testid="tasks-header"
    >
      <div className="flex flex-col gap-0.5">
        {/* The tab already says Tasks, so the plan's name is the heading. */}
        {(name || updatedAt > 0) && (
          <div className="flex items-baseline justify-between gap-3">
            {name && (
              // The chip follows the name, and wraps under it when the panel is narrow.
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
                <h3
                  className="line-clamp-2 min-w-0 break-words text-ui font-semibold leading-snug"
                  data-testid="tasks-plan-name"
                >
                  {name}
                </h3>
                {content.workflow && <WorkflowChip workflow={content.workflow} />}
              </div>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {updatedAt > 0 && (
                <span className="text-sm text-muted-foreground">
                  Updated <Ago seconds={updatedAt} />
                </span>
              )}
              {control?.kind === "stopping" ? (
                <PlanRunButton control="stopping" size="icon-xs" className="self-center" />
              ) : control ? (
                <PlanRunButton
                  control={control.kind}
                  size="icon-xs"
                  className="self-center"
                  onClick={() => onRun(control.command)}
                />
              ) : null}
              {onOpenGraph && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="View the plan on the graph"
                  title="View the plan on the graph"
                  className="shrink-0 self-center text-muted-foreground"
                  data-testid="tasks-plan-graph"
                  onClick={onOpenGraph}
                >
                  <FullscreenIcon />
                </Button>
              )}
              {menu.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Plan actions"
                      className="shrink-0 self-center text-muted-foreground"
                      data-testid="tasks-plan-menu"
                    >
                      <EllipsisIcon className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    onCloseAutoFocus={(event) => {
                      const command = afterCloseRef.current;
                      if (!command) return;
                      afterCloseRef.current = null;
                      event.preventDefault();
                      requestAnimationFrame(() => onRun(command));
                    }}
                  >
                    {menu.map((item) => {
                      const Icon = railViewIcon(item.icon);
                      return (
                        <SessionActionMenuItem
                          key={item.command.command}
                          data-testid={
                            item.command.command === "omnigent.tasks.saveAsWorkflow"
                              ? "tasks-save-workflow"
                              : undefined
                          }
                          disabledReason={item.disabledReason}
                          onSelect={() => {
                            afterCloseRef.current = item.command;
                          }}
                        >
                          {Icon && <Icon className="size-3.5" />}
                          {item.title}
                        </SessionActionMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </span>
          </div>
        )}
        {!name && <h3 className="sr-only">Tasks</h3>}
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-ui leading-6">
          <span className="font-medium" data-testid="tasks-summary">
            {content.summary}
          </span>
          {(content.counts ?? []).map((count) => (
            <span key={count.state} className="text-sm text-muted-foreground">
              ·{" "}
              <span className={cn("font-medium", COUNT_COLORS[count.state])}>
                {count.count} {STATE_LABELS[count.state].toLowerCase()}
              </span>
            </span>
          ))}
          {content.paused && (
            <span className="text-sm text-muted-foreground" data-testid="tasks-paused">
              · <span className="font-medium text-foreground">{content.paused}</span>
            </span>
          )}
        </p>
      </div>
      <ProgressStrip
        progress={progress}
        fromPlan={content.dependencies}
        onSelect={onSelect}
        menuActionFor={menuActionFor}
      />
    </header>
  );
}

const MESSAGE_LINK = /\[([^\]]+)\]\((command|picker):([A-Za-z0-9._-]+)\)/g;

/** An empty state's message: `[text](command:id)` runs a command, `[text](picker:workflow)` opens Run a workflow. */
function PlanMessage({
  message,
  sessionId,
  onRun,
}: {
  message: string;
  sessionId: string | undefined;
  onRun: (command: omnigent.Command) => void;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of message.matchAll(MESSAGE_LINK)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(message.slice(last, index));
    const [, text, scheme, target] = match;
    if (scheme === "command") {
      parts.push(
        <button
          key={index}
          type="button"
          className="cursor-pointer font-medium text-link hover:underline"
          onClick={() => onRun({ command: target })}
        >
          {text}
        </button>,
      );
    } else if (target === "workflow" && sessionId) {
      parts.push(
        <RunWorkflowMenu
          // A new one for each session, so a pending check opens nothing in the next.
          key={`${index}:${sessionId}`}
          className="cursor-pointer font-medium text-link hover:underline focus-visible:underline focus-visible:outline-none data-[state=open]:underline"
          onStart={(description, savedWorkflow) =>
            onRun({
              command: START_WORKFLOW_COMMAND,
              arguments: [
                sessionId,
                {
                  ...(description === undefined ? {} : { description }),
                  ...(savedWorkflow ? { workflowId: savedWorkflow.id } : {}),
                },
              ],
            })
          }
        >
          {text}
        </RunWorkflowMenu>,
      );
    } else {
      parts.push(text);
    }
    last = index + match[0].length;
  }
  if (last < message.length) parts.push(message.slice(last));
  return parts;
}

function LoadingTasks({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-4 px-4 pt-1">
      <span className="h-3 w-24 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
      {[64, 80, 52].map((width) => (
        <span key={width} className="flex items-start gap-3">
          <span className="size-[18px] shrink-0 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
          <span className="flex flex-1 flex-col gap-1.5 pt-0.5">
            <span
              className="h-3 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
              style={{ width: `${width}%` }}
            />
            <span className="h-2.5 w-2/5 animate-pulse rounded-full bg-muted/70 motion-reduce:animate-none" />
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * `published`, unless it is for another session and `sessionId` has content of its
 * own. Loading, and content without a session, are for the session on screen.
 */
export function planForSession(
  view: Pick<RailView, "planBySession">,
  published: omnigent.PlanViewContent,
  sessionId: string | undefined,
): omnigent.PlanViewContent {
  const publishedFor = published.kind === "loading" ? undefined : published.sessionId;
  if (sessionId === undefined || publishedFor === undefined || publishedFor === sessionId) {
    return published;
  }
  return view.planBySession.get(sessionId) ?? published;
}

/** A plan view's page, for `conversationId`'s workspace. */
export function ViewPlan({
  view,
  content: published,
  conversationId,
  visible,
}: {
  view: RailView;
  content: omnigent.PlanViewContent;
  conversationId: string | undefined;
  /** Whether the page is on screen; the workflow runs below the plan load only then. */
  visible: boolean;
}) {
  const host = view.host;
  // The content follows the session on screen; a pane for another session (a grid
  // cell not in front) draws the last content published for its own session.
  const content = planForSession(view, published, conversationId);
  const contentSession = content.kind === "loading" ? undefined : content.sessionId;
  // Content for another session's workspace (it is still coming on screen) is not shown.
  const stale =
    contentSession !== undefined &&
    conversationId !== undefined &&
    contentSession !== conversationId;
  const plan = !stale && content.kind === "plan" ? content : undefined;
  const progress = useMemo(
    () => plan?.tasks.map((entry) => stepProgressOf(entry.task)) ?? [],
    [plan],
  );
  const names = useMemo(
    () => new Map(plan?.tasks.map((entry) => [entry.task.id, entry.task.name]) ?? []),
    [plan],
  );
  const [graphOpen, setGraphOpen] = useState(false);
  const run = useCallback(
    (command: omnigent.Command) => {
      // The graph covers the chat it scrolls.
      if (command.command === SHOW_IN_CHAT_COMMAND) setGraphOpen(false);
      host?.runCommand(command.command, command.arguments ?? []);
    },
    [host],
  );
  const actions = useMemo(
    () =>
      new Map(
        (plan?.tasks ?? []).flatMap((entry) =>
          entry.action ? [[entry.task.id, entry.action] as const] : [],
        ),
      ),
    [plan],
  );
  const menuActionFor = useCallback(
    (item: StepProgress): TaskMenuAction | undefined => {
      const action = actions.get(item.step.id);
      return action && { action: action.action, onSelect: () => run(action.command) };
    },
    [actions, run],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const [flashStep, setFlashStep] = useState<string | null>(null);
  const jumpToStep = useCallback((stepId: string) => {
    const rows = scrollRef.current?.querySelectorAll<HTMLElement>("[data-step-id]") ?? [];
    const row = [...rows].find((element) => element.dataset.stepId === stepId);
    if (!row) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    setFlashStep(stepId);
  }, []);
  useEffect(() => {
    if (!flashStep) return;
    const timer = window.setTimeout(() => setFlashStep(null), 1400);
    return () => window.clearTimeout(timer);
  }, [flashStep]);
  // A click on a task's chat marker asks for its row once the tab shows.
  const taskToShow = useSessionTasksActions((state) => state.taskToShow);
  const showPlan = plan !== undefined && plan.tasks.length > 0;
  useEffect(() => {
    if (!visible || !showPlan || !taskToShow || taskToShow.conversationId !== conversationId) {
      return;
    }
    const { stepId } = taskToShow;
    useSessionTasksActions.setState({ taskToShow: null });
    // The rail or drawer may still be opening; its rows mount by the next frame.
    requestAnimationFrame(() => jumpToStep(stepId));
  }, [visible, showPlan, taskToShow, conversationId, jumpToStep]);

  let body: ReactNode;
  if (stale || content.kind === "loading") {
    body = <LoadingTasks label={content.kind === "loading" ? content.label : "Loading tasks"} />;
  } else if (content.kind === "error") {
    body = (
      <div role="alert" className="px-2 py-6 text-center text-sm text-muted-foreground">
        <p>{content.message}</p>
        {content.retry && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => content.retry && run(content.retry)}
          >
            Retry
          </Button>
        )}
      </div>
    );
  } else if (content.kind === "empty" || !plan || plan.tasks.length === 0) {
    const empty = content.kind === "empty" ? content : undefined;
    const Icon = railViewIcon(empty?.icon);
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
        {Icon && <Icon aria-hidden className="mb-1.5 size-6 text-muted-foreground" />}
        <p className="text-ui font-medium">{empty?.title}</p>
        <p className="max-w-64 text-sm text-muted-foreground">
          <PlanMessage message={empty?.message ?? ""} sessionId={conversationId} onRun={run} />
        </p>
      </div>
    );
  } else {
    body = (
      <>
        <TasksHeader
          content={plan}
          progress={progress}
          stuck={stuck}
          onSelect={jumpToStep}
          onRun={run}
          menuActionFor={menuActionFor}
          onOpenGraph={plan.graph ? () => setGraphOpen(true) : undefined}
        />
        <section aria-label="Tasks">
          <ol className="flex flex-col">
            {plan.tasks.map((entry, index) => (
              <StepRow
                key={entry.task.id}
                entry={entry}
                item={progress[index]}
                number={index + 1}
                last={index === plan.tasks.length - 1}
                names={names}
                flash={flashStep === entry.task.id}
                onRun={run}
                menuAction={menuActionFor(progress[index])}
              />
            ))}
          </ol>
        </section>
        {visible && plan.runsOfWorkflow && conversationId && (
          <SessionDescendantRuns sessionId={conversationId} workflowId={plan.runsOfWorkflow} />
        )}
        {plan.graph && graphOpen && (
          <Suspense fallback={null}>
            <WorkflowGraphOverlay
              title={plan.title ?? "Tasks"}
              steps={progress.map((item) => item.step)}
              progress={progress}
              menuActionFor={menuActionFor}
              onClose={() => setGraphOpen(false)}
            />
          </Suspense>
        )}
      </>
    );
  }
  return (
    <div
      ref={scrollRef}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="tasks-panel"
      onScroll={(event) => setStuck(event.currentTarget.scrollTop > 0)}
    >
      <div className={cn("flex flex-1 flex-col gap-7 px-2 pb-4", !showPlan && "pt-4")}>{body}</div>
    </div>
  );
}
