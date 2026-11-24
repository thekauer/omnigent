// The parts of a task's look that the Tasks view, a workflow run's row and the
// workflow graph share: its state's glyph, label and color, its ⋯ menu, its card,
// and the progress strip of a list of tasks.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CheckIcon,
  EllipsisIcon,
  Loader2Icon,
  MessageCircleQuestionMarkIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { StepDescription } from "@/components/workflows/StepDescription";
import { markdownPreviewText } from "@/lib/markdownPreviewText";
import { formatDuration, formatMessageTimestamp } from "@/lib/relativeTime";
import {
  failedUpstream,
  stepStatusLabel,
  textOf,
  WAITING_FOR_YOU,
  type JournalPlanStep,
  type StepProgress,
  type StepState,
} from "@/lib/sessionJournal";
import { cn } from "@/lib/utils";
import type { TaskAction } from "@/lib/workflow";

export const STATE_LABELS: Record<StepState, string> = {
  waiting: "Not started",
  ready: "Ready",
  running: "Running",
  stopped: "Stopped",
  needs_input: WAITING_FOR_YOU,
  done: "Done",
  failed: "Failed",
};

/** What a task that hasn't started says when a task it waits on failed. */
export const CANT_START = "Can't start";

export const SEGMENT_COLORS: Record<StepState, string> = {
  waiting: "bg-foreground/10",
  ready: "bg-session-active/25",
  running: "bg-session-active animate-pulse motion-reduce:animate-none",
  stopped: "bg-status-gray",
  needs_input: "bg-brand-accent",
  done: "bg-success",
  failed: "bg-destructive",
};

export function clock(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** A running step's time so far, counting up every second. */
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Twice a second, so the count turns over close to each whole second.
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  return <>{formatDuration(now / 1000 - since)}</>;
}

/** A step's state as a small circle: numbered while it waits, filled once it ends. */
export function StepGlyph({ state, number }: { state: StepState; number?: number }) {
  const shape = "flex size-[18px] shrink-0 items-center justify-center rounded-full";
  const label = STATE_LABELS[state];
  switch (state) {
    case "running":
      return (
        <span role="img" aria-label={label} className={cn(shape, "text-session-active")}>
          <Loader2Icon
            className="size-[18px] animate-spin motion-reduce:animate-none"
            strokeWidth={2.25}
          />
        </span>
      );
    case "needs_input":
      return (
        <span role="img" aria-label={label} className={cn(shape, "text-brand-accent")}>
          <MessageCircleQuestionMarkIcon className="size-[18px]" strokeWidth={2.25} />
        </span>
      );
    case "done":
      return (
        <span role="img" aria-label={label} className={cn(shape, "bg-success/15 text-success")}>
          <CheckIcon className="size-3" strokeWidth={3} />
        </span>
      );
    case "failed":
      return (
        <span
          role="img"
          aria-label={label}
          className={cn(shape, "bg-destructive/15 text-destructive")}
        >
          <XIcon className="size-3" strokeWidth={3} />
        </span>
      );
    case "stopped":
      return (
        <span
          role="img"
          aria-label={label}
          className={cn(shape, "border border-dashed border-status-gray")}
        >
          <span className="size-1.5 rounded-full bg-status-gray" />
        </span>
      );
    default:
      return (
        <span
          role="img"
          aria-label={label}
          className={cn(
            shape,
            "border text-[10px] font-medium tabular-nums",
            state === "ready"
              ? "border-session-active/60 bg-session-active/[0.08] text-session-active"
              : "border-border-strong text-muted-foreground",
          )}
        >
          {number}
        </span>
      );
  }
}

/** "Can't start · Run the tests failed", for a task held up by the failed tasks named. */
export function CantStart({ failedNames }: { failedNames: readonly string[] }) {
  return (
    <>
      <span className="font-medium">{CANT_START}</span>
      {` · ${listNames(failedNames)} failed`}
    </>
  );
}

/** A step's goal as one line of plain text, for a row or card that shows only its start. */
export function goalPreview(step: JournalPlanStep): string | null {
  return step.goal && markdownPreviewText(step.goal);
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: readonly string[]): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// What a task's ⋯ menu offers: Run while it's ready, Continue once it's stopped or
// while it waits for you, Retry once it failed, Stop while it runs.
type MenuAction = TaskAction | "stop";
const MENU_ACTION_LABELS: Record<MenuAction, string> = {
  run: "Run",
  continue: "Continue",
  proceed: "Continue",
  retry: "Retry",
  stop: "Stop",
};

const TASK_ACTION_FOR_STATE: Partial<Record<StepState, TaskAction>> = {
  ready: "run",
  stopped: "continue",
  needs_input: "proceed",
  failed: "retry",
};

export interface TaskMenuAction {
  action: MenuAction;
  onSelect: () => void;
}

/**
 * A task's menu action for its state, when the viewer can take it.
 *
 * @param onTaskAction Asks the agent to run, continue or retry the task; absent when the viewer can't send.
 * @param onStop Asks the main agent to stop the workflow and its workers; absent unless work is active.
 */
export function taskMenuAction(
  item: StepProgress,
  onTaskAction: ((action: TaskAction, taskName: string) => void) | undefined,
  onStop: (() => void) | undefined,
): TaskMenuAction | undefined {
  if (item.state === "running") return onStop && { action: "stop", onSelect: onStop };
  const action = TASK_ACTION_FOR_STATE[item.state];
  if (action === undefined || !onTaskAction) return undefined;
  return { action, onSelect: () => onTaskAction(action, item.step.name) };
}

/** A task's ⋯ menu, on its row, its timeline card and its graph node: the action its state offers. */
export function TaskMenu({
  taskName,
  menuAction,
  testIdPrefix,
  className,
  onOpenChange,
}: {
  taskName: string;
  menuAction: TaskMenuAction;
  /** Prefixes the button's and the item's test IDs, e.g. `tasks-row`. */
  testIdPrefix: string;
  className: string;
  /** Also told the menu closed when it goes while open, e.g. once its task has no action. */
  onOpenChange?: (open: boolean) => void;
}) {
  const openRef = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(
    () => () => {
      if (openRef.current) onOpenChangeRef.current?.(false);
    },
    [],
  );
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        openRef.current = open;
        onOpenChange?.(open);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${taskName}`}
          className={className}
          data-testid={`${testIdPrefix}-menu`}
        >
          <EllipsisIcon aria-hidden className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          data-testid={`${testIdPrefix}-${menuAction.action}`}
          onSelect={() => menuAction.onSelect()}
        >
          {menuAction.action === "stop" ? (
            <SquareIcon className="size-3.5 fill-current" />
          ) : menuAction.action === "retry" ? (
            <RotateCcwIcon className="size-4" />
          ) : (
            <PlayIcon className="size-4" />
          )}
          {MENU_ACTION_LABELS[menuAction.action]}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const STATUS_LINE_COLORS: Partial<Record<StepState, string>> = {
  ready: "text-session-active",
  running: "text-session-active",
  failed: "text-destructive",
};

/**
 * Where a task stands in a few words, e.g. "Done · 8:56 PM", "Waiting on Run the
 * tests" or "Can't start · Run the tests failed".
 */
function statusLine(
  item: StepProgress,
  pending: readonly string[],
  failedNames: readonly string[] = [],
): ReactNode {
  const { startedAt, status } = item;
  const ended = status ? formatMessageTimestamp(status.created_at) : null;
  switch (item.state) {
    case "waiting":
      if (failedNames.length > 0) return `${CANT_START} · ${listNames(failedNames)} failed`;
      return pending.length > 0 ? `Waiting on ${listNames(pending)}` : "Not started";
    case "ready":
      return "Ready to start";
    case "running":
      return startedAt === null ? (
        "Running"
      ) : (
        <>
          Running · <Elapsed since={startedAt} />
        </>
      );
    case "stopped":
      return status
        ? `Stopped · ${stepStatusLabel("started", startedAt ?? status.created_at, false).toLowerCase()}`
        : "Stopped";
    case "done":
      return ended ? `Done · ${ended}` : "Done";
    case "failed":
      return ended ? `Failed · ${ended}` : "Failed";
    case "needs_input":
      return WAITING_FOR_YOU;
  }
}

/**
 * What a task's hover card says: which task it is, where it stands, and its
 * newest result or the start of its goal.
 *
 * @param pending - The tasks it waits on that aren't done, by name.
 * @param failedNames - The failed tasks it waits on, by name, when that's why it can't start.
 * @param full - Show the whole goal as Markdown, below a result too, for a graph node whose box
 *   cuts both short.
 * @param menu - Its ⋯ menu, in the top corner.
 */
export function TaskCardDetails({
  item,
  number,
  total,
  pending,
  failedNames,
  full = false,
  menu,
}: {
  item: StepProgress;
  number: number;
  total: number;
  pending: readonly string[];
  failedNames: readonly string[];
  full?: boolean;
  menu?: ReactNode;
}) {
  const text = item.status ? textOf(item.status) : null;
  const detail =
    item.state === "waiting" || item.state === "ready" ? item.step.goal : (text ?? item.step.goal);
  const detailIsGoal = detail === item.step.goal;
  // A cut card shows the start of its goal as plain text, if any text remains.
  const shownDetail = detailIsGoal && !full ? goalPreview(item.step) : detail;
  const goal = full && !detailIsGoal ? item.step.goal : null;
  return (
    <>
      <span className="flex w-full items-center justify-between gap-3">
        <span className="text-muted-foreground">
          Task {number} of {total}
        </span>
        {menu}
      </span>
      <span className="font-medium">{item.step.name}</span>
      <span className="flex items-center gap-1.5">
        <StepGlyph state={item.state} number={number} />
        <span className={STATUS_LINE_COLORS[item.state]}>
          {statusLine(item, pending, failedNames)}
        </span>
      </span>
      {shownDetail &&
        (full && detailIsGoal ? (
          <StepDescription text={shownDetail} />
        ) : (
          <span className={cn("text-muted-foreground", !full && "line-clamp-3")}>
            {shownDetail}
          </span>
        ))}
      {goal && (
        <>
          <span className="text-muted-foreground">Goal</span>
          <StepDescription text={goal} />
        </>
      )}
    </>
  );
}

/** Past this many tasks, the strip is too crowded for dependency arcs. */
const MAX_HOVER_ARC_TASKS = 40;
/** How high a hover arc rises above the strip at most, in pixels. */
const ARC_HEIGHT = 14;

// The ⋯ button in the corner of a segment's card.
const CARD_MENU_BUTTON =
  "-my-1 -mr-1.5 shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * One segment per task; hovering one shows a card with which task it is, where
 * it stands and, given `menuActionFor`, its ⋯ menu. Hovering a plan's segment
 * draws arcs to the tasks it waits on and the tasks that wait on it.
 */
export function ProgressStrip({
  progress,
  fromPlan,
  onSelect,
  menuActionFor,
}: {
  progress: readonly StepProgress[];
  /** Whether the tasks are a plan's steps, the only tasks that say what they wait on. */
  fromPlan: boolean;
  onSelect: (stepId: string) => void;
  /** What a task's card offers in its ⋯ menu, as its row's menu does; none when absent. */
  menuActionFor?: (item: StepProgress) => TaskMenuAction | undefined;
}) {
  const names = new Map(progress.map((item) => [item.step.id, item.step.name]));
  const done = new Set(
    progress.filter((item) => item.state === "done").map((item) => item.step.id),
  );
  const blocked = failedUpstream(progress);
  const showDependencyArcs = fromPlan && progress.length <= MAX_HOVER_ARC_TASKS;
  const roomy = progress.length <= 24;
  const gap = roomy ? 6 : 4;
  const [hovered, setHovered] = useState<number | null>(null);
  const focusIndex =
    showDependencyArcs && hovered !== null && hovered < progress.length ? hovered : null;
  // The tasks the hovered one waits on, and the tasks that wait on it.
  const related = new Set<number>();
  if (focusIndex !== null) {
    const focusStep = progress[focusIndex].step;
    progress.forEach((item, index) => {
      if (
        focusStep.depends_on.includes(item.step.id) ||
        item.step.depends_on.includes(focusStep.id)
      ) {
        related.add(index);
      }
    });
  }
  const lit = (index: number) => focusIndex === null || index === focusIndex || related.has(index);
  // A segment's width, as CSS: the strip's width less its gaps, shared out.
  const unit = `((100% - ${(progress.length - 1) * gap}px) / ${progress.length})`;
  // The task whose card shows, one at a time, and the task whose card's ⋯ menu
  // is open, which keeps that card up while the pointer is in the menu.
  const [cardStep, setCardStep] = useState<string | null>(null);
  const [menuStep, setMenuStep] = useState<string | null>(null);
  return (
    <div
      className={cn(
        "relative flex h-4 items-center",
        // A plan's strip keeps room above it for the hover arcs.
        showDependencyArcs ? "mt-px -mb-[5px]" : "-my-[5px]",
        !showDependencyArcs && (progress.length > 16 ? "gap-px" : "gap-[3px]"),
      )}
      // In pixels, so the arcs' calc() lands on each segment's center.
      style={showDependencyArcs ? { columnGap: gap } : undefined}
      data-testid="tasks-progress"
      data-links={showDependencyArcs ? "true" : undefined}
      onPointerLeave={() => setHovered(null)}
    >
      {focusIndex !== null && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-[11px]"
          style={{ height: ARC_HEIGHT }}
        >
          {[...related].map((index) => {
            const from = Math.min(index, focusIndex);
            const span = Math.abs(index - focusIndex);
            return (
              <span
                key={index}
                className="absolute bottom-0 border-x-[1.5px] border-t-[1.5px] border-muted-foreground"
                style={{
                  left: `calc(${from + 0.5} * ${unit} + ${from * gap}px)`,
                  width: `calc(${span} * (${unit} + ${gap}px))`,
                  height: Math.min(4 + span * 2, ARC_HEIGHT),
                  borderTopLeftRadius: "50% 100%",
                  borderTopRightRadius: "50% 100%",
                }}
                data-testid="tasks-progress-arc"
              />
            );
          })}
        </div>
      )}
      {progress.map((item, index) => {
        const pending = item.step.depends_on
          .filter((id) => !done.has(id))
          .map((id) => names.get(id) ?? id);
        const failedNames = (blocked.get(item.step.id) ?? []).map((id) => names.get(id) ?? id);
        const menuAction = menuActionFor?.(item);
        const stepId = item.step.id;
        return (
          <HoverCard
            key={stepId}
            open={cardStep === stepId || menuStep === stepId}
            onOpenChange={(open) =>
              setCardStep((current) => (open ? stepId : current === stepId ? null : current))
            }
            // Once one card shows, moving along the strip shows the next at once.
            openDelay={cardStep === null ? 100 : 0}
            closeDelay={100}
          >
            <HoverCardTrigger asChild>
              <button
                type="button"
                aria-label={`Task ${index + 1}, ${item.step.name}: ${failedNames.length > 0 ? CANT_START : STATE_LABELS[item.state]}`}
                onClick={() => onSelect(item.step.id)}
                onPointerEnter={() => setHovered(index)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
                className="group relative flex h-full min-w-0 flex-1 cursor-pointer items-center focus-visible:outline-none"
                data-testid="tasks-progress-segment"
                data-dimmed={!lit(index) || undefined}
              >
                <span
                  className={cn(
                    "h-1.5 w-full rounded-full transition-[height,opacity] duration-150 group-hover:h-2 group-focus-visible:h-2 group-focus-visible:ring-2 group-focus-visible:ring-ring/50",
                    SEGMENT_COLORS[item.state],
                    !lit(index) && "animate-none opacity-30",
                  )}
                />
              </button>
            </HoverCardTrigger>
            <HoverCardContent
              side="bottom"
              sideOffset={8}
              // break-words would let a long path or command set the text's width past the card.
              className="flex w-fit max-w-72 flex-col items-start gap-1 wrap-anywhere px-3 py-2 text-sm"
              data-testid="tasks-progress-card"
            >
              <TaskCardDetails
                item={item}
                number={index + 1}
                total={progress.length}
                pending={pending}
                failedNames={failedNames}
                menu={
                  menuAction && (
                    <TaskMenu
                      taskName={item.step.name}
                      menuAction={menuAction}
                      testIdPrefix="tasks-progress"
                      className={CARD_MENU_BUTTON}
                      onOpenChange={(open) => {
                        setMenuStep(open ? stepId : null);
                        // Picking an action, or closing the menu, puts the card away too.
                        if (!open) setCardStep(null);
                      }}
                    />
                  )
                }
              />
            </HoverCardContent>
          </HoverCard>
        );
      })}
    </div>
  );
}
