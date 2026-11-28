// The compact lists of the built-in Inbox, Automations and Canvas containers (layout plan L4):
// host components (`builtInView`) the side bar draws when the activity bar switches to their
// container. Each lists what its page shows in full, with a link to the page; they mount only
// while their container is on screen, so their queries run only then.

import { ClockIcon, InboxIcon, LayoutDashboardIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { canvasLocation } from "@/canvas/canvasNavigation";
import { MAIN_CANVAS_ID, projectCanvasId } from "@/canvas/canvasLayout";
import { useProjects } from "@/hooks/useConversations";
import { useQuery } from "@tanstack/react-query";
import { SCHEDULED_TASKS_KEY } from "@/hooks/useScheduledTasks";
import { listScheduledTasks } from "@/lib/scheduledTasksApi";
import { Parts } from "@/workbench/layoutService";
import { usePartVisible } from "./useWorkbenchParts";
import { useSidebarData } from "@/hooks/useSidebarData";
import {
  isConversationUnseen,
  isExplicitlyUnread,
  useReadStateSnapshot,
} from "@/hooks/useUnseenConversations";
import { collectUnreadInboxItems } from "@/lib/inbox";
import { Link, useLocation, useParams } from "@/lib/routing";
import { cn } from "@/lib/utils";
import {
  type BuiltInViewBadge,
  type BuiltInViewProps,
  registerBuiltInView,
  registerBuiltInViewBadge,
} from "./builtInViews";
import { PrimaryNavLink } from "./PrimaryNavLink";
import { SIDEBAR_ROW_MOBILE_INSET } from "./sidebarStyles";

/** The Inbox row's count: what needs the viewer (prompts, automations) and unread sessions. */
export function useInboxCount(): { count: number; incomplete: boolean; capped: boolean } {
  const sidebarData = useSidebarData();
  const { conversationId: activeConversationId } = useParams<{ conversationId: string }>();
  // Unread sessions as the Inbox lists them; like its row dot, the open session counts only
  // when marked unread.
  const unread = useReadStateSnapshot(
    () =>
      collectUnreadInboxItems(
        sidebarData.inboxRows,
        (id, updatedAt, status) =>
          isConversationUnseen(id, updatedAt, status) &&
          (id !== activeConversationId || isExplicitlyUnread(id)),
      ).length,
  );
  return {
    count: sidebarData.inboxCount + unread,
    incomplete: sidebarData.inboxCountIncomplete,
    capped: sidebarData.inboxCountCapped,
  };
}

function useInboxBadge(): BuiltInViewBadge | undefined {
  const { count, incomplete, capped } = useInboxCount();
  if (count === 0 && !incomplete) return undefined;
  const more = incomplete || capped;
  return {
    value: count,
    ...(more ? { label: `${count > 0 ? count : ""}+` } : {}),
    tooltip: `${count}${more ? "+" : ""} in the Inbox`,
  };
}

function CompactList({
  viewId,
  label,
  testId,
  loading,
  empty,
  children,
  footer,
}: {
  /** The view drawn, so the focused view is found by its element. */
  viewId: string;
  label: string;
  testId: string;
  loading: boolean;
  empty: string;
  children: ReactNode[];
  footer: ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-view={viewId}>
      <nav
        aria-label={label}
        data-testid={testId}
        className={cn(
          "ui-scroll flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pt-2 pb-3",
          SIDEBAR_ROW_MOBILE_INSET,
        )}
      >
        {children.length > 0 ? (
          children
        ) : (
          <p role="status" className="px-2 py-1 text-muted-foreground text-sm">
            {loading ? "Loading…" : empty}
          </p>
        )}
      </nav>
      <div className={cn("shrink-0 px-2 pb-1", SIDEBAR_ROW_MOBILE_INSET)}>{footer}</div>
    </div>
  );
}

function PageLink({
  to,
  label,
  icon,
  active,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}) {
  return (
    <PrimaryNavLink
      to={to}
      label={label}
      icon={icon}
      active={active}
      componentId={`sidebar.${label.toLowerCase().replace(/\s+/g, "_")}`}
    />
  );
}

/** `omnigent.inbox.list`: the sessions waiting for the viewer, then the unread ones. */
function InboxListView({ view }: BuiltInViewProps) {
  const { serverInboxRows, inboxRows, identityReady } = useSidebarData();
  const { pathname } = useLocation();
  const { conversationId } = useParams<{ conversationId: string }>();
  const unreadIds = useReadStateSnapshot(() =>
    collectUnreadInboxItems(inboxRows, isConversationUnseen)
      .map(({ row }) => row.id)
      .join("\n"),
  );
  const waiting = serverInboxRows.filter((row) => (row.pending_elicitations_count ?? 0) > 0);
  const unread = unreadIds === "" ? [] : unreadIds.split("\n");
  const byId = new Map(inboxRows.map((row) => [row.id, row]));
  const rows = [
    ...waiting.map((row) => ({ row, note: "Waiting for you" })),
    ...unread
      .map((id) => byId.get(id))
      .filter((row) => row !== undefined && !waiting.some((other) => other.id === row.id))
      .map((row) => ({ row: row!, note: "Unread" })),
  ];
  return (
    <CompactList
      viewId={view.id}
      label="Inbox"
      testId="inbox-list-view"
      loading={!identityReady}
      empty="Nothing needs you."
      footer={
        <PageLink
          to="/inbox"
          label="Open Inbox"
          icon={InboxIcon}
          active={pathname.endsWith("/inbox")}
        />
      }
    >
      {rows.map(({ row, note }) => (
        <CompactRow
          key={row.id}
          to={`/c/${encodeURIComponent(row.id)}`}
          title={row.title ?? "Untitled session"}
          note={note}
          active={row.id === conversationId}
        />
      ))}
    </CompactList>
  );
}

/** `omnigent.automations.list`: the viewer's automations. */
function AutomationsListView({ view }: BuiltInViewProps) {
  // The page's query (and its cache) without its poll: the side bar may show this all day.
  const sideBarVisible = usePartVisible(Parts.SIDEBAR_PART);
  const tasks = useQuery({
    queryKey: SCHEDULED_TASKS_KEY,
    queryFn: listScheduledTasks,
    staleTime: 30_000,
    enabled: sideBarVisible,
  });
  const { pathname } = useLocation();
  const { taskId } = useParams<{ taskId: string }>();
  return (
    <CompactList
      viewId={view.id}
      label="Automations"
      testId="automations-list-view"
      loading={tasks.isPending}
      empty={tasks.isError ? "Automations couldn't be loaded." : "No automations yet."}
      footer={
        <PageLink
          to="/tasks"
          label="All automations"
          icon={ClockIcon}
          active={pathname.endsWith("/tasks")}
        />
      }
    >
      {(tasks.data ?? []).map((task) => (
        <CompactRow
          key={task.id}
          to={`/tasks/${encodeURIComponent(task.id)}`}
          title={task.name}
          active={task.id === taskId}
        />
      ))}
    </CompactList>
  );
}

/** `omnigent.canvas.list`: the main canvas and one per project. */
function CanvasListView({ view }: BuiltInViewProps) {
  const projects = useProjects();
  const { pathname, search } = useLocation();
  const current = new URLSearchParams(search).get("canvas") ?? MAIN_CANVAS_ID;
  const onCanvas = pathname.includes("/canvas");
  const canvases = [
    { id: MAIN_CANVAS_ID, title: "Main canvas" },
    ...(projects.data ?? []).map((project) => ({
      id: projectCanvasId(project),
      title: project.name,
    })),
  ];
  return (
    <CompactList
      viewId={view.id}
      label="Canvases"
      testId="canvas-list-view"
      loading={projects.isPending}
      empty="No canvases."
      footer={null}
    >
      {canvases.map((canvas) => {
        const target = canvasLocation(canvas.id);
        return (
          <CompactRow
            key={canvas.id}
            to={target.pathname + target.search}
            title={canvas.title}
            icon={LayoutDashboardIcon}
            active={onCanvas && current === canvas.id}
          />
        );
      })}
    </CompactList>
  );
}

function CompactRow({
  to,
  title,
  note,
  icon: Icon,
  active,
}: {
  to: string;
  title: string;
  note?: string;
  icon?: LucideIcon;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-8 items-center gap-2 rounded-(--radius-otto-button) px-2 py-1 text-ui",
        "text-foreground hover:bg-muted dark:hover:bg-muted/50",
        active && "bg-[var(--sidebar-active)] text-[var(--sidebar-active-foreground)]",
      )}
    >
      {Icon && <Icon className="ui-icon text-muted-foreground" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {note && <span className="shrink-0 text-muted-foreground text-xs">{note}</span>}
    </Link>
  );
}

registerBuiltInView("inboxList", InboxListView);
registerBuiltInView("automationsList", AutomationsListView);
registerBuiltInView("canvasList", CanvasListView);
registerBuiltInViewBadge("inboxList", useInboxBadge);
