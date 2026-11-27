// The activity bar (layout plan L4), VS Code's: one item per primary side bar container that has
// a view to show, in the user's order. Clicking an item shows its container in the side bar;
// clicking the active one while the side bar is open hides the side bar. Items carry their
// views' badges, drag to reorder, hide from the right-click menu (layout state) and move with
// the arrow keys. At `default` it is a vertical bar beside the side bar with the Accounts and
// Manage items at its bottom; at `top` and `bottom` a row inside the side bar.

import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type ActivityBarLocation,
  moveActivityBarItem,
  orderActivityBarItems,
  setActivityBarItemHidden,
  useActivityBarItems,
} from "@/workbench/activityBar";
import { layoutService, Parts, partHook } from "@/workbench/layoutService";
import type { ViewContainerDescriptor } from "@/workbench/viewContainers";
import {
  type BuiltInViewBadge,
  BuiltInViewBadgeProviders,
  useBuiltInViewBadges,
} from "./builtInViews";
import { DEFAULT_RAIL_VIEW_ICON, railViewIcon } from "./railViewIcons";
import type { RailView, RailViewContribution } from "./railViews";
import { SidebarServerPicker } from "./SidebarServerPicker";
import { SIDEBAR_ELEMENT_ID } from "./sidebarStyles";
import { useActiveViewContainer, usePartVisible, useWorkbenchPart } from "./useWorkbenchParts";
import { useSideBarContainers } from "./ViewContainerViews";

interface ActivityBarEntry {
  readonly container: ViewContainerDescriptor;
  readonly views: readonly RailViewContribution[];
}

/** The items the bar draws: containers with a view to show, the user's hidden ones left out. */
export function useActivityBarEntries(): {
  readonly shown: readonly ActivityBarEntry[];
  readonly all: readonly ActivityBarEntry[];
  readonly hidden: readonly string[];
} {
  const containers = useSideBarContainers();
  const state = useActivityBarItems();
  const all = orderActivityBarItems(
    containers.map((entry) => ({ ...entry, id: entry.container.id })),
    state,
  );
  const shown = all.filter((entry) => !state.hidden.includes(entry.container.id));
  // Hiding every item would leave nothing to switch with: the first stays.
  return { shown: shown.length > 0 ? shown : all.slice(0, 1), all, hidden: state.hidden };
}

/** Clicking an item, as VS Code's: show the container, or hide the side bar for the active one. */
export function activateViewContainer(containerId: string, active: boolean, open: boolean): void {
  if (active && open) layoutService.setPartHidden(true, Parts.SIDEBAR_PART);
  else layoutService.openViewContainer(containerId);
}

export function ActivityBar({ location }: { location: Exclude<ActivityBarLocation, "hidden"> }) {
  const { shown, all, hidden } = useActivityBarEntries();
  const activeId = useActiveViewContainer();
  const sideBarOpen = usePartVisible(Parts.SIDEBAR_PART);
  const vertical = location === "default";
  const listRef = useRef<HTMLDivElement>(null);
  const focusActive = useCallback(() => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    (items.find((item) => item.getAttribute("aria-selected") === "true") ?? items[0])?.focus();
  }, []);
  // The bar beside the side bar is the activity bar part; the rows inside it are its placement.
  useWorkbenchPart(
    Parts.ACTIVITYBAR_PART,
    { visible: true, setHidden: () => {}, focus: focusActive },
    true,
  );
  const [dragged, setDragged] = useState<string | null>(null);
  // Every item's id, the hidden ones too, so a move keeps their places.
  const ids = all.map((entry) => entry.container.id);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    const next =
      event.key === (vertical ? "ArrowDown" : "ArrowRight")
        ? (index + 1) % items.length
        : event.key === (vertical ? "ArrowUp" : "ArrowLeft")
          ? (index - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };
  const activeShown = shown.some((entry) => entry.container.id === activeId)
    ? activeId
    : shown[0]?.container.id;
  return (
    <TooltipProvider>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-part={partHook(Parts.ACTIVITYBAR_PART)}
            data-location={location}
            className={cn(
              "activitybar flex shrink-0 select-none",
              vertical
                ? "h-full w-(--ui-activitybar-width,48px) flex-col items-center justify-between border-r border-border bg-sidebar py-2"
                : "items-center",
            )}
          >
            <div
              ref={listRef}
              role="tablist"
              aria-label="Views"
              aria-orientation={vertical ? "vertical" : "horizontal"}
              onKeyDown={onKeyDown}
              className={cn("flex gap-1", vertical ? "flex-col items-center" : "items-center")}
            >
              {shown.map((entry) => {
                const id = entry.container.id;
                const active = id === activeShown && sideBarOpen;
                return (
                  <ActivityBarItem
                    key={id}
                    entry={entry}
                    active={active}
                    selected={id === activeShown}
                    vertical={vertical}
                    onClick={() => activateViewContainer(id, id === activeShown, sideBarOpen)}
                    onDragStart={() => setDragged(id)}
                    onDragEnd={() => setDragged(null)}
                    onDrop={() => {
                      if (dragged !== null && dragged !== id) moveActivityBarItem(ids, dragged, id);
                      setDragged(null);
                    }}
                  />
                );
              })}
            </div>
            <BuiltInViewBadgeProviders />
            {vertical && <SidebarServerPicker placement="activitybar" />}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent data-testid="activitybar-menu">
          <ContextMenuLabel>Views</ContextMenuLabel>
          <ContextMenuSeparator />
          {all.map((entry) => {
            const isHidden = hidden.includes(entry.container.id);
            const lastShown = !isHidden && shown.length === 1;
            return (
              <ContextMenuCheckboxItem
                key={entry.container.id}
                checked={!isHidden}
                disabled={lastShown}
                onCheckedChange={(checked) => {
                  setActivityBarItemHidden(entry.container.id, !checked);
                  // Hiding the container on screen shows the first one left.
                  if (!checked && entry.container.id === activeShown) {
                    const next = shown.find((other) => other.container.id !== entry.container.id);
                    if (next) layoutService.setActiveViewContainer(next.container.id);
                  }
                }}
              >
                {entry.container.title}
              </ContextMenuCheckboxItem>
            );
          })}
        </ContextMenuContent>
      </ContextMenu>
    </TooltipProvider>
  );
}

function ActivityBarItem({
  entry,
  active,
  selected,
  vertical,
  onClick,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  entry: ActivityBarEntry;
  /** The container is shown in the open side bar. */
  active: boolean;
  /** The container the side bar shows (open or not): the roving tab stop. */
  selected: boolean;
  vertical: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const { container, views } = entry;
  const Icon = railViewIcon(container.icon) ?? DEFAULT_RAIL_VIEW_ICON;
  const badge = useContainerBadge(views);
  const [dropTarget, setDropTarget] = useState(false);
  const label = badge
    ? `${container.title} (${badge.tooltip || badge.label || badge.value})`
    : container.title;
  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="tab"
          aria-selected={selected}
          aria-controls={SIDEBAR_ELEMENT_ID}
          aria-label={label}
          tabIndex={selected ? 0 : -1}
          draggable
          data-view-container={container.id}
          data-active={active || undefined}
          onClick={onClick}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", container.id);
            onDragStart();
          }}
          onDragEnd={() => {
            setDropTarget(false);
            onDragEnd();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDropTarget(true);
          }}
          onDragLeave={() => setDropTarget(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDropTarget(false);
            onDrop();
          }}
          className={cn(
            "activitybar-item relative flex cursor-pointer items-center justify-center rounded-[var(--radius-otto-button)] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
            vertical ? "size-10" : "size-8",
            active && "bg-[var(--sidebar-active)] text-[var(--sidebar-active-foreground)]",
            active &&
              (vertical
                ? "before:absolute before:inset-y-2 before:-left-1 before:w-0.5 before:rounded-full before:bg-[var(--sidebar-active-foreground)]"
                : "before:absolute before:inset-x-2 before:-bottom-1 before:h-0.5 before:rounded-full before:bg-[var(--sidebar-active-foreground)]"),
            dropTarget && "ring-2 ring-ring",
          )}
        >
          <Icon className="ui-icon size-5" aria-hidden />
          {badge && (
            <span
              data-slot="activitybar-badge"
              aria-hidden
              className="absolute top-0.5 right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-medium text-primary-foreground tabular-nums"
            >
              {badge.label ?? badge.value}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side={vertical ? "right" : "bottom"}>{container.title}</TooltipContent>
    </Tooltip>
  );
}

/** The container's badge: its tree views' badges summed, with its built-in views' own. */
function useContainerBadge(views: readonly RailViewContribution[]): BuiltInViewBadge | undefined {
  const builtIn = useBuiltInViewBadges();
  const tree = sumTreeBadges(views);
  let value = tree?.value ?? 0;
  let label: string | undefined;
  let tooltip = tree?.tooltip ?? "";
  for (const view of views) {
    const badge = view.builtInView === undefined ? undefined : builtIn.get(view.builtInView);
    if (!badge) continue;
    value += badge.value;
    label = badge.label;
    tooltip = badge.tooltip;
  }
  return value > 0 || label !== undefined
    ? { value, tooltip, ...(label === undefined ? {} : { label }) }
    : undefined;
}

function sumTreeBadges(views: readonly RailViewContribution[]): BuiltInViewBadge | undefined {
  let value = 0;
  const tooltips: string[] = [];
  for (const view of views) {
    const badge = (view as Partial<RailView>).badge;
    if (!badge || badge.value <= 0) continue;
    value += badge.value;
    if (badge.tooltip) tooltips.push(badge.tooltip);
  }
  return value > 0 ? { value, tooltip: tooltips.join(", ") } : undefined;
}
