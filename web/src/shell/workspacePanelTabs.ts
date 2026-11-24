/**
 * Labels, icons and trigger presentation for the Workspace rail's fixed panel
 * tabs (Files, Changes, Pull Requests, Agents, Tasks, Content search) and the
 * tabs of extension views. `WorkspacePanel` draws every trigger from these
 * descriptors with one tab-agnostic renderer.
 */

import {
  BotIcon,
  FileDiffIcon,
  FolderTreeIcon,
  GitPullRequestIcon,
  ListChecksIcon,
  type LucideIcon,
  SearchIcon,
} from "lucide-react";
import { ARIA_MOD_KEY, MOD_KEY, SHIFT_KEY } from "@/components/KeyboardShortcut";
import { cn } from "@/lib/utils";
import {
  type BuiltInRailTab,
  type ExtensionRailTab,
  extensionRailTabViewId,
  TAB_BADGE_BASE,
} from "./railTabs";
import { DEFAULT_RAIL_VIEW_ICON, railViewIcon } from "./railViewIcons";
import { builtInTabView, type RailView } from "./railViews";

/** The rail's fixed built-in panel tabs: everything but the dynamic browser and side-chat modes. */
export type WorkspacePanelTab = Exclude<BuiltInRailTab, "browser" | "sidechat">;

/** Every tab the strip draws a fixed trigger for: the built-ins and extension views. */
export type RailPanelTab = WorkspacePanelTab | ExtensionRailTab;

/** What a tab's trigger may depend on, gathered once per render by `WorkspacePanel`. */
export interface WorkspacePanelTabContext {
  pending: boolean;
  showFilesPanel: boolean;
  showGithubTab: boolean;
  /** Whether the session has a Tasks tab. */
  showTasksTab: boolean;
  showContentSearch: boolean;
  agentCount: number;
  subagentsWorking: number;
  /** This tab's ⌃N digit among the visible fixed tabs, if it has one. */
  digit: string | undefined;
  /** `aria-keyshortcuts` for that digit. */
  digitAriaShortcut: string | undefined;
}

/** A trailing visually hidden badge, such as the Changes count. */
export interface WorkspacePanelTabBadge {
  text: string | number;
  className: string;
}

export interface WorkspacePanelTabDescriptor {
  label: string;
  icon: LucideIcon;
  /** Whether the tab strip draws this tab's trigger. */
  shown: (context: WorkspacePanelTabContext) => boolean;
  /** Defaults to `label`. */
  ariaLabel?: (context: WorkspacePanelTabContext) => string;
  /** Defaults to the ⌃N digit; an override returning `undefined` shows no shortcut. */
  tooltipShortcut?: (context: WorkspacePanelTabContext) => string | readonly string[] | undefined;
  /** Defaults to the ⌃N digit's chord; an override returning `undefined` omits it. */
  ariaKeyShortcuts?: (context: WorkspacePanelTabContext) => string | undefined;
  badge?: (context: WorkspacePanelTabContext) => WorkspacePanelTabBadge | null;
}

export const WORKSPACE_PANEL_TABS: Record<WorkspacePanelTab, WorkspacePanelTabDescriptor> = {
  "content-search": {
    label: "Content search",
    icon: SearchIcon,
    shown: ({ showContentSearch, showFilesPanel }) => showContentSearch && showFilesPanel,
    tooltipShortcut: () => [MOD_KEY, SHIFT_KEY, "F"],
    ariaKeyShortcuts: ({ digitAriaShortcut }) =>
      `${ARIA_MOD_KEY}+Shift+F ${digitAriaShortcut ?? ""}`.trim(),
  },
  files: {
    label: "Files",
    icon: FolderTreeIcon,
    shown: ({ pending, showFilesPanel }) => pending || showFilesPanel,
  },
  // Its page, label, icon and badge come from the built-in Changes extension's view.
  changes: {
    label: "Changes",
    icon: FileDiffIcon,
    shown: ({ pending, showFilesPanel }) => pending || showFilesPanel,
  },
  github: {
    label: "Pull Requests",
    icon: GitPullRequestIcon,
    shown: ({ pending, showGithubTab }) => pending || showGithubTab,
  },
  tasks: {
    label: "Tasks",
    icon: ListChecksIcon,
    shown: ({ showTasksTab }) => showTasksTab,
  },
  subagents: {
    label: "Agents",
    icon: BotIcon,
    shown: () => true,
    ariaLabel: ({ subagentsWorking, agentCount }) =>
      subagentsWorking > 0 ? `Agents ${subagentsWorking}/${agentCount}` : `Agents ${agentCount}`,
    badge: ({ subagentsWorking, agentCount }) => ({
      text: subagentsWorking > 0 ? `${subagentsWorking}/${agentCount}` : agentCount,
      className: cn(
        TAB_BADGE_BASE,
        "sr-only",
        subagentsWorking > 0 ? "text-success" : "text-muted-foreground",
      ),
    }),
  },
};

/** The trigger of an extension view's tab; its badge reads like the Changes count. */
export function extensionViewTabDescriptor(view: RailView): WorkspacePanelTabDescriptor {
  return {
    label: view.name,
    icon: railViewIcon(view.icon) ?? DEFAULT_RAIL_VIEW_ICON,
    shown: () => true,
    ariaLabel: () =>
      view.badge && view.badge.value > 0
        ? `${view.name} ${view.badge.tooltip || view.badge.value}`
        : view.name,
    badge: () =>
      view.badge && view.badge.value > 0 ? { text: view.badge.value, className: "sr-only" } : null,
  };
}

/**
 * The descriptor of any fixed tab: a built-in's from {@link WORKSPACE_PANEL_TABS},
 * an extension view's from its registered view; null for a view not registered (yet).
 */
export function railTabDescriptor(
  tab: RailPanelTab,
  views: readonly RailView[],
): WorkspacePanelTabDescriptor | null {
  const viewId = extensionRailTabViewId(tab);
  if (viewId === null) {
    const builtIn = WORKSPACE_PANEL_TABS[tab as WorkspacePanelTab];
    // A built-in extension's view stands in for the tab: its name, icon and badge,
    // in the built-in tab's place and with its visibility.
    const view = builtInTabView(views, tab);
    if (!view) return builtIn;
    const viewDescriptor = extensionViewTabDescriptor(view);
    return {
      ...viewDescriptor,
      icon: railViewIcon(view.icon) ?? builtIn.icon,
      shown: builtIn.shown,
    };
  }
  const view = views.find((candidate) => candidate.id === viewId);
  return view ? extensionViewTabDescriptor(view) : null;
}

/** The resolved props one tab trigger draws. */
export interface WorkspacePanelTabPresentation {
  label: string;
  icon: LucideIcon;
  ariaLabel: string;
  tooltipShortcut: string | readonly string[] | undefined;
  ariaKeyShortcuts: string | undefined;
  badge: WorkspacePanelTabBadge | null;
}

/** Resolve a descriptor against the current context; `null` when it isn't drawn. */
export function workspacePanelTabPresentation(
  descriptor: WorkspacePanelTabDescriptor,
  context: WorkspacePanelTabContext,
): WorkspacePanelTabPresentation | null {
  if (!descriptor.shown(context)) return null;
  return {
    label: descriptor.label,
    icon: descriptor.icon,
    ariaLabel: descriptor.ariaLabel ? descriptor.ariaLabel(context) : descriptor.label,
    tooltipShortcut: descriptor.tooltipShortcut
      ? descriptor.tooltipShortcut(context)
      : context.digit,
    ariaKeyShortcuts: descriptor.ariaKeyShortcuts
      ? descriptor.ariaKeyShortcuts(context)
      : context.digitAriaShortcut,
    badge: descriptor.badge ? descriptor.badge(context) : null,
  };
}
