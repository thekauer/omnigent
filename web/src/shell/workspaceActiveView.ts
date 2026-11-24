// What the workspace rail shows for a selection: an open shell or file in front,
// over the selected page. A pure function, so any sidebar that restores the rail's
// selection shows exactly what the rail would.

import { extensionRailTabViewId, type RightRailTab } from "./railTabs";

/** The page beneath any open shell or file. */
export type WorkspaceScopeView =
  | "sidechat"
  | "browser"
  | "github"
  | "tasks"
  | "subagents"
  | "empty"
  | "content-search"
  | "files"
  | "extension";

export interface WorkspaceSelection {
  rightRailTab: RightRailTab | null;
  selectedFilePath: string | null;
  selectedTerminalKey: string | null;
  selectedBrowserId: string | null;
  selectedSideChatId: string | null;
}

export interface WorkspaceViewAvailability {
  /** Whether the selected shell's terminal is present. */
  terminalPresent: (key: string) => boolean;
  showBrowserTab: boolean;
  showGithubTab: boolean;
  /** Whether the session has a Tasks page. */
  showTasksTab: boolean;
  showContentSearch: boolean;
  hasAgentTree: boolean;
  /** Phones show side chats in their own drawer, not the rail. */
  mobile: boolean;
  /** The view a built-in extension registered for a built-in tab (Changes), if any. */
  builtInTabViewId?: (tab: RightRailTab) => string | undefined;
}

/** Built-in tabs whose page is a built-in extension's view. */
export const EXTENSION_BACKED_TABS: readonly RightRailTab[] = ["changes"];

export interface WorkspaceActiveView {
  /** The shell shown in front, when its terminal is present. */
  terminalKey: string | null;
  /** The file shown in front when no shell is. */
  filePath: string | null;
  scope: WorkspaceScopeView;
  /**
   * The extension view of the selected page: an `ext:` tab's, or the built-in
   * extension's view of a tab such as Changes. Null on the `extension` scope when
   * that view is not registered (yet).
   */
  extensionViewId: string | null;
  sideChatSelected: boolean;
  browserSelected: boolean;
}

export function resolveWorkspaceActiveView(
  selection: WorkspaceSelection,
  availability: WorkspaceViewAvailability,
): WorkspaceActiveView {
  const { rightRailTab, selectedFilePath, selectedTerminalKey } = selection;
  const terminalKey =
    selectedTerminalKey !== null && availability.terminalPresent(selectedTerminalKey)
      ? selectedTerminalKey
      : null;
  // A selected shell counts even while its terminal is missing, so a page doesn't flash in.
  const nothingInFront = selectedFilePath === null && selectedTerminalKey === null;
  const sideChatSelected =
    rightRailTab === "sidechat" && nothingInFront && selection.selectedSideChatId !== null;
  const browserSelected =
    rightRailTab === "browser" && nothingInFront && selection.selectedBrowserId !== null;
  const extensionBacked = rightRailTab !== null && EXTENSION_BACKED_TABS.includes(rightRailTab);
  const extensionViewId = extensionBacked
    ? (availability.builtInTabViewId?.(rightRailTab) ?? null)
    : extensionRailTabViewId(rightRailTab);
  const scope: WorkspaceScopeView =
    sideChatSelected && !availability.mobile
      ? "sidechat"
      : browserSelected && availability.showBrowserTab
        ? "browser"
        : rightRailTab === "github" && availability.showGithubTab
          ? "github"
          : rightRailTab === "tasks" && availability.showTasksTab
            ? "tasks"
            : rightRailTab === "subagents" && availability.hasAgentTree
              ? "subagents"
              : rightRailTab === null
                ? "empty"
                : extensionViewId !== null || extensionBacked
                  ? "extension"
                  : rightRailTab === "content-search" && availability.showContentSearch
                    ? "content-search"
                    : "files";
  return {
    terminalKey,
    filePath: terminalKey === null ? selectedFilePath : null,
    scope,
    extensionViewId,
    sideChatSelected,
    browserSelected,
  };
}
