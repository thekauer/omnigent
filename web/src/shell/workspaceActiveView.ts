// What the workspace rail shows for a selection: an open shell or file in front,
// over the selected page. A pure function, so any sidebar that restores the rail's
// selection shows exactly what the rail would.

import { extensionRailTabViewId, type RightRailTab } from "./railTabs";

/** The page beneath any open shell or file. */
export type WorkspaceScopeView = "sidechat" | "browser" | "empty" | "files" | "extension";

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
export const EXTENSION_BACKED_TABS: readonly RightRailTab[] = [
  "changes",
  "content-search",
  "github",
  "subagents",
  "tasks",
];

/** Whether an extension-backed tab has its page here; otherwise it falls back like an unavailable tab. */
function extensionTabAvailable(
  tab: RightRailTab,
  availability: WorkspaceViewAvailability,
): boolean {
  if (tab === "content-search") return availability.showContentSearch;
  if (tab === "subagents") return availability.hasAgentTree;
  if (tab === "tasks") return availability.showTasksTab;
  if (tab === "github") return availability.showGithubTab;
  return true;
}

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
  const extensionBacked =
    rightRailTab !== null &&
    EXTENSION_BACKED_TABS.includes(rightRailTab) &&
    extensionTabAvailable(rightRailTab, availability);
  const extensionViewId = extensionBacked
    ? (availability.builtInTabViewId?.(rightRailTab) ?? null)
    : extensionRailTabViewId(rightRailTab);
  const scope: WorkspaceScopeView =
    sideChatSelected && !availability.mobile
      ? "sidechat"
      : browserSelected && availability.showBrowserTab
        ? "browser"
        : rightRailTab === null
          ? "empty"
          : extensionViewId !== null || extensionBacked
            ? "extension"
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
