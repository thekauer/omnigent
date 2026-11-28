// The app-wide commands the ⌘K palette lists in its Actions group, and how a
// typed query filters them.

import { useMemo } from "react";
import {
  CalendarClockIcon,
  InboxIcon,
  LayoutTemplateIcon,
  type LucideIcon,
  MoveIcon,
  PanelLeftIcon,
  PanelRightIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";

import {
  newSessionShortcutKeys,
  rightSidebarToggleShortcutKeys,
  settingsShortcutKeys,
  sidebarToggleShortcutKeys,
} from "@/components/KeyboardShortcut";
import { useIsMobileViewport } from "@/hooks/useIsMobileViewport";
import { useLocation, useNavigate } from "@/lib/routing";
import { useSettingsRoute } from "@/shell/settingsNav";
import { settingsSearchCommand } from "@/shell/settingsSearch/settingsSearchCommand";
import { toggleActivityBarVisibility } from "@/workbench/activityBar";
import {
  MOVE_VIEW_COMMAND,
  RESET_LAYOUT_COMMAND,
  RESET_VIEW_LOCATIONS_COMMAND,
  resetLayout,
  TOGGLE_ACTIVITY_BAR_COMMAND,
} from "@/workbench/layoutCommands";
import { layoutService } from "@/workbench/layoutService";
import { layoutState } from "@/workbench/layoutState";
import { activeWorkbenchScope } from "@/workbench/workbenchScope";
import { resetViewLocations } from "@/workbench/viewLocations";

export interface ActionCommand {
  id: string;
  label: string;
  /** Mirrors the icon on the equivalent button elsewhere in the UI. */
  icon: LucideIcon;
  /** Extra terms the client-side filter matches against (beyond the label). */
  keywords: string[];
  run: () => void;
  /** Chord shown beside the row when the same action has a shortcut. */
  shortcut?: readonly string[];
}

export interface AppCommandOptions {
  /** Flip the left (Conversations) sidebar, owned by AppShell. */
  onToggleLeftSidebar: () => void;
  /** Flip the right (Workspace) sidebar, owned by AppShell. */
  onToggleRightSidebar: () => void;
  /** False on grid routes, where ⌘⌥] belongs to the grid's own workspace. */
  rightSidebarShortcutEnabled: boolean;
}

/** Commands available everywhere, in the order the palette lists them. */
export function useAppCommands({
  onToggleLeftSidebar,
  onToggleRightSidebar,
  rightSidebarShortcutEnabled,
}: AppCommandOptions): ActionCommand[] {
  const navigate = useNavigate();
  const { inSettings } = useSettingsRoute();
  const { pathname, search } = useLocation();
  const mobile = useIsMobileViewport();
  return useMemo<ActionCommand[]>(
    () => [
      {
        id: "new-chat",
        label: "New chat",
        icon: SquarePenIcon,
        keywords: ["compose", "start", "new session"],
        run: () => navigate("/"),
        shortcut: newSessionShortcutKeys(),
      },
      {
        id: "go-inbox",
        label: "Go to Inbox",
        icon: InboxIcon,
        keywords: ["notifications", "comments", "needs response"],
        run: () => navigate("/inbox"),
      },
      {
        id: "go-tasks",
        label: "Go to Automations",
        icon: CalendarClockIcon,
        keywords: ["scheduled", "recurring", "cron", "automation", "schedule"],
        run: () => navigate("/tasks"),
      },
      {
        id: "go-settings",
        label: "Go to Settings",
        icon: SettingsIcon,
        keywords: ["preferences", "configuration", "account"],
        run: () => navigate("/settings"),
        shortcut: settingsShortcutKeys(),
      },
      settingsSearchCommand({
        settingsLocation: inSettings ? { pathname, search } : null,
        mobile,
        navigate,
      }),
      {
        id: "toggle-left-sidebar",
        label: "Toggle conversations sidebar",
        icon: PanelLeftIcon,
        keywords: ["panel", "left", "sessions list", "workbench.action.toggleSidebarVisibility"],
        run: onToggleLeftSidebar,
        shortcut: sidebarToggleShortcutKeys(),
      },
      {
        id: "toggle-right-sidebar",
        label: "Toggle workspace sidebar",
        icon: PanelRightIcon,
        keywords: ["panel", "right", "files", "terminal", "workbench.action.toggleAuxiliaryBar"],
        run: onToggleRightSidebar,
        shortcut: rightSidebarShortcutEnabled ? rightSidebarToggleShortcutKeys() : undefined,
      },
      {
        id: RESET_LAYOUT_COMMAND,
        label: "View: Reset Layout",
        icon: LayoutTemplateIcon,
        keywords: ["layout", "reset", "side bar", "activity bar", "widths", RESET_LAYOUT_COMMAND],
        run: () => resetLayout(layoutService),
      },
      {
        id: TOGGLE_ACTIVITY_BAR_COMMAND,
        label: "View: Toggle Activity Bar Visibility",
        icon: PanelLeftIcon,
        keywords: ["activity bar", "icons", "rail", TOGGLE_ACTIVITY_BAR_COMMAND],
        run: () => toggleActivityBarVisibility(),
      },
      {
        id: MOVE_VIEW_COMMAND,
        label: "View: Move View…",
        icon: MoveIcon,
        keywords: ["move", "view", "side bar", "secondary side bar", MOVE_VIEW_COMMAND],
        run: () => activeWorkbenchScope().moveViewPicker.open(),
      },
      {
        id: RESET_VIEW_LOCATIONS_COMMAND,
        label: "View: Reset View Locations",
        icon: LayoutTemplateIcon,
        keywords: ["move", "view", "reset", "locations", RESET_VIEW_LOCATIONS_COMMAND],
        run: () => resetViewLocations(layoutState),
      },
    ],
    [
      navigate,
      pathname,
      search,
      inSettings,
      mobile,
      onToggleLeftSidebar,
      onToggleRightSidebar,
      rightSidebarShortcutEnabled,
    ],
  );
}

/** The commands whose label or a keyword contains `query`, ignoring case; all of them for a blank query. */
export function filterAppCommands<Command extends { label: string; keywords: readonly string[] }>(
  commands: readonly Command[],
  query: string,
): readonly Command[] {
  const q = query.trim().toLowerCase();
  if (q === "") return commands;
  return commands.filter(
    (command) =>
      command.label.toLowerCase().includes(q) ||
      command.keywords.some((keyword) => keyword.toLowerCase().includes(q)),
  );
}
