// Rows of a tree view whose items are chat sessions (`resourceUri` with scheme
// "session"), drawn as the Agents list: a root row with its harness avatar, then
// its sub-agents indented under dashed guides, each with a status tile, an agent
// avatar, the label, a preview line and its decorations (routed model, cost).
// Every row links to its session, so cmd/middle-click opens it in a new tab.

import type { ComponentType, MouseEvent, SVGProps } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleDotIcon,
  CircleHelpIcon,
  CornerDownRightIcon,
  EllipsisIcon,
  PauseIcon,
  UnplugIcon,
} from "lucide-react";
import { ComposerAgentIcon } from "@/components/ComposerAgentIcon";
import { RunningDot } from "@/components/RunningDot";
import { Link, useLocation } from "@/lib/routing";
import { sessionNavigationSearch } from "@/lib/sessionNavigation";
import { cn } from "@/lib/utils";
import { railViewIcon } from "../railViewIcons";
import type { RailAgentState, RailAgentStatus, RailTreeNode } from "../railViews";

type RowIcon = ComponentType<SVGProps<SVGSVGElement>>;

// Settled states are dimmed so live agents dominate; a disconnected runner stays full-strength.
const SETTLED_STATE: Record<RailAgentState, boolean> = {
  launching: false,
  working: false,
  awaiting: false,
  failed: false,
  disconnected: false,
  other: false,
  done: true,
  idle: true,
};

const STATUS_AVATAR_CLASS: Record<RailAgentState, string> = {
  launching: "bg-muted text-muted-foreground",
  working: "bg-muted text-muted-foreground",
  awaiting: "bg-warning/15 text-warning",
  failed: "bg-destructive/10 text-destructive",
  disconnected: "bg-muted text-muted-foreground",
  other: "bg-muted text-muted-foreground",
  done: "bg-success/10 text-success",
  idle: "bg-muted text-muted-foreground",
};

const STATUS_AVATAR_ICON: Record<RailAgentState, RowIcon | null> = {
  launching: null,
  working: null,
  awaiting: CircleHelpIcon,
  failed: CircleAlertIcon,
  disconnected: UnplugIcon,
  other: EllipsisIcon,
  done: CheckIcon,
  idle: PauseIcon,
};

/** Compact state tile before a sub-agent's avatar. */
function StatusAvatar({ status }: { status: RailAgentStatus }) {
  const title = status.detail ? `${status.label}: ${status.detail}` : status.label;
  const Icon = STATUS_AVATAR_ICON[status.state];
  return (
    <span
      aria-label={title}
      title={title}
      data-testid="subagent-status-avatar"
      data-activity={status.state}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md",
        STATUS_AVATAR_CLASS[status.state],
      )}
    >
      {Icon ? (
        <Icon aria-hidden="true" className="size-3.5" />
      ) : (
        <RunningDot className="size-3.5 text-current" />
      )}
    </span>
  );
}

function Decorations({ node, className }: { node: RailTreeNode; className?: string }) {
  const parts = node.decoration?.parts ?? [];
  return parts.map((part, index) => (
    <span
      key={`${part.text}\n${part.tooltip ?? ""}`}
      title={part.tooltip}
      className={cn(
        "shrink-0 truncate font-mono text-[10px] tabular-nums text-muted-foreground",
        index === 0 && className,
      )}
    >
      {part.text}
    </span>
  ));
}

function AgentAvatar({ node, className }: { node: RailTreeNode; className: string }) {
  if (node.agentIcon) {
    return (
      <ComposerAgentIcon
        agent={{ name: node.agentIcon.agent, harness: node.agentIcon.harness }}
        className={className}
      />
    );
  }
  const Icon = railViewIcon(node.icon) ?? railViewIcon("bot");
  return Icon ? <Icon className={cn(className, "text-muted-foreground")} /> : null;
}

const ROOT_GUIDE_CENTER_PX = 26;
// The root avatar's center sits at 26px (10px row inset + 16px); direct children
// center on that guide, deeper levels keep the step.
const ROW_BASE_PADDING_PX = 14;
const ROW_DEPTH_STEP_PX = 90;
const SUBAGENT_ROW_OFFSET_PX = 26;
const ROW_VERTICAL_PADDING_PX = 4;
const ROW_CONNECTOR_SIZE_PX = 24;

function rowPaddingLeft(depth: number): number {
  return (
    ROW_BASE_PADDING_PX + (depth - 1) * ROW_DEPTH_STEP_PX - (depth > 1 ? SUBAGENT_ROW_OFFSET_PX : 0)
  );
}

export interface SessionRowProps {
  node: RailTreeNode;
  depth: number;
  /** Whether the root's guide continues past this row to a later first-level row. */
  rootGuideContinues: boolean;
  open: boolean;
  /** Whether the row has sub-rows (a collapse toggle). */
  hasChildren: boolean;
  conversationId: string | undefined;
  onToggle: (node: RailTreeNode) => void;
  onRun: (node: RailTreeNode) => void;
}

/** A plain click runs the row's command (opening a sub-agent); others follow the link. */
function linkClick(node: RailTreeNode, onRun: (node: RailTreeNode) => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (!node.hasCommand) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onRun(node);
  };
}

function MainSessionRow({ node, conversationId, onRun }: SessionRowProps) {
  // Session-scoped params (file, diff, comment, ...) stay with their session; global ones carry.
  const search = sessionNavigationSearch(useLocation().search);
  const isActive = node.sessionId === conversationId;
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        style={{ left: ROOT_GUIDE_CENTER_PX }}
        className="pointer-events-none absolute bottom-0 top-10 z-10 border-l border-dashed border-border/70"
      />
      <Link
        to={{ pathname: `/c/${node.sessionId}`, search }}
        data-testid="subagent-main-row"
        data-root-session-id={node.sessionId}
        data-context-value={node.contextValue}
        title={node.tooltip}
        onClick={linkClick(node, onRun)}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left",
          isActive ? "bg-accent" : "hover:bg-muted",
        )}
      >
        <div className="flex w-full items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-[2px]">
              <span
                data-testid="subagent-main-harness-icon"
                className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border bg-background"
              >
                <AgentAvatar node={node} className="size-5" />
              </span>
              <span className="min-w-0 truncate text-base font-semibold">{node.label}</span>
              <Decorations node={node} className="ml-auto" />
            </div>
            {node.description && (
              <p
                data-testid="subagent-main-preview"
                className="truncate text-sm text-muted-foreground"
              >
                {node.description}
              </p>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}

function SubSessionRow({
  node,
  depth,
  rootGuideContinues,
  open,
  hasChildren,
  conversationId,
  onToggle,
  onRun,
}: SessionRowProps) {
  const search = sessionNavigationSearch(useLocation().search);
  const isActive = node.sessionId === conversationId;
  const status = node.agentStatus;
  // Settled rows are dimmed, never the row on screen.
  const dim = !isActive && status !== undefined && SETTLED_STATE[status.state];
  const ToggleIcon = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <div className="group/agent relative">
      {depth === 1 ? (
        <>
          <span
            aria-hidden="true"
            data-root-guide-segment="upper"
            style={{ left: ROOT_GUIDE_CENTER_PX, height: ROW_VERTICAL_PADDING_PX }}
            className="pointer-events-none absolute top-0 border-l border-dashed border-border/70"
          />
          {rootGuideContinues && (
            <span
              aria-hidden="true"
              data-root-guide-segment="lower"
              style={{
                left: ROOT_GUIDE_CENTER_PX,
                top: ROW_VERTICAL_PADDING_PX + ROW_CONNECTOR_SIZE_PX,
              }}
              className="pointer-events-none absolute bottom-0 border-l border-dashed border-border/70"
            />
          )}
        </>
      ) : rootGuideContinues ? (
        <span
          aria-hidden="true"
          data-root-guide-segment="continuation"
          style={{ left: ROOT_GUIDE_CENTER_PX }}
          className="pointer-events-none absolute inset-y-0 border-l border-dashed border-border/70"
        />
      ) : null}
      {hasChildren && (
        <button
          type="button"
          data-testid="subagent-collapse-toggle"
          aria-expanded={open}
          aria-label={open ? "Collapse subagents" : "Expand subagents"}
          style={{ left: rowPaddingLeft(depth) }}
          className="absolute top-1 z-10 flex size-6 items-center justify-center rounded-md bg-transparent text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node);
          }}
        >
          <ToggleIcon aria-hidden="true" className="size-3.5" />
        </button>
      )}
      <Link
        to={{ pathname: `/c/${node.sessionId}`, search }}
        data-testid="subagent-row"
        data-child-session-id={node.sessionId}
        data-depth={depth}
        title={node.tooltip}
        onClick={linkClick(node, onRun)}
        style={{ paddingLeft: rowPaddingLeft(depth) }}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-md py-1 pr-1 text-left",
          isActive ? "bg-accent" : "group-hover/agent:bg-muted",
          dim && "opacity-60 group-hover/agent:opacity-100",
        )}
      >
        <div className="flex w-full items-start gap-2">
          {hasChildren ? (
            <span aria-hidden="true" className="size-6 shrink-0" />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-md bg-transparent"
            >
              {depth === 1 ? (
                <CircleDotIcon
                  data-subagent-connector
                  className="size-4 text-muted-foreground/60"
                />
              ) : (
                <CornerDownRightIcon
                  data-subagent-connector
                  className="size-4 text-muted-foreground/60"
                />
              )}
            </span>
          )}
          {status && <StatusAvatar status={status} />}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-[2px]">
              <span
                data-testid="subagent-agent-avatar"
                className="flex size-6 shrink-0 items-center justify-center"
              >
                <AgentAvatar node={node} className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{node.label}</span>
              <Decorations node={node} />
            </div>
            {node.description && (
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{node.description}</p>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}

/** A session row: the tree's root as the main row, deeper rows as sub-agents. */
export function SessionTreeRow(props: SessionRowProps) {
  return props.depth === 0 ? <MainSessionRow {...props} /> : <SubSessionRow {...props} />;
}
