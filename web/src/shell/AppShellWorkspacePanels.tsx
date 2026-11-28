import { RenderErrorBoundary } from "@/components/RenderErrorBoundary";
import { isOwnerLevel } from "@/lib/permissionsApi";
import { ExtensionRailView } from "./extensionViews/ExtensionRailView";
import { builtInTabView, useRailViews } from "./railViews";
import { ExecutionLogsPanel } from "./ExecutionLogsPanel";
import { FilesPanelDrawer } from "./FilesPanelDrawer";
import { InlineTerminalsSection } from "./InlineTerminalsSection";
import { MobilePanelDrawer } from "./MobilePanelDrawer";
import { TerminalsPanel } from "./TerminalsPanel";

export interface AppShellWorkspacePanelsProps {
  conversationId: string | undefined;
  terminalFirst: boolean;
  panelOpen: boolean;
  panelInitialKey: string | null;
  setPanelInitialKey: (key: string | null) => void;
  permissionLevel: number | null;
  executionLogsOpen: boolean;
  executionLogsKey: string | null;
  setExecutionLogsKey: (key: string | null) => void;
  showFilesPanel: boolean;
  filesPanelOpen: boolean;
  setFilesPanelOpen: (open: boolean) => void;
  filesDrawerFlatView: boolean;
  rootSessionId: string | null;
  subagentsPanelOpen: boolean;
  setSubagentsPanelOpen: (open: boolean) => void;
  shellsPanelOpen: boolean;
  setShellsPanelOpen: (open: boolean) => void;
  openTerminalsPanel: (key: string) => void;
  githubPanelOpen: boolean;
  setGithubPanelOpen: (open: boolean) => void;
  tasksPanelOpen: boolean;
  setTasksPanelOpen: (open: boolean) => void;
  mobileViewport: boolean;
  railTabsAvailable: { readonly "content-search": boolean; readonly tasks: boolean };
  contentSearchPanelOpen: boolean;
  setContentSearchPanelOpen: (open: boolean) => void;
  /** The secondary side bar view whose phone drawer is open (from the phone menu), if any. */
  viewDrawer: string | null;
  setViewDrawer: (viewId: string | null) => void;
  setMobileFileTarget: (element: HTMLDivElement | null) => void;
}

/**
 * The workspace surfaces that sit beside the chat as siblings of the
 * chat+workspace group: the desktop push panels and the mobile drawers for
 * rail tabs that have no push panel of their own.
 */
export function AppShellWorkspacePanels({
  conversationId,
  terminalFirst,
  panelOpen,
  panelInitialKey,
  setPanelInitialKey,
  permissionLevel,
  executionLogsOpen,
  executionLogsKey,
  setExecutionLogsKey,
  showFilesPanel,
  filesPanelOpen,
  setFilesPanelOpen,
  filesDrawerFlatView,
  rootSessionId,
  subagentsPanelOpen,
  setSubagentsPanelOpen,
  shellsPanelOpen,
  setShellsPanelOpen,
  openTerminalsPanel,
  githubPanelOpen,
  setGithubPanelOpen,
  tasksPanelOpen,
  setTasksPanelOpen,
  mobileViewport,
  railTabsAvailable,
  contentSearchPanelOpen,
  setContentSearchPanelOpen,
  viewDrawer,
  setViewDrawer,
  setMobileFileTarget,
}: AppShellWorkspacePanelsProps) {
  return (
    <>
      {/* Push panels — flex siblings to main, animate width. Only one is open at a time.
          Terminal-first sessions render the terminal inline inside main
          (via MainTerminalView in ChatPage) and never mount the drawer. */}
      {conversationId && !terminalFirst && (
        <TerminalsPanel
          open={panelOpen}
          conversationId={conversationId}
          initialTerminalKey={panelInitialKey}
          // No neighbor to resize against (chat is hidden, FilesPanel
          // owns its own width) — grow via flex-1.
          fluid={panelOpen}
          // Non-owners attach read-only: a shared PTY can't attribute
          // input per-user, so only the owner may type (server-enforced).
          readOnly={!isOwnerLevel(permissionLevel)}
          onClose={() => setPanelInitialKey(null)}
        />
      )}
      {conversationId && (
        <ExecutionLogsPanel
          open={executionLogsOpen}
          conversationId={conversationId}
          initialKey={executionLogsKey}
          onClose={() => setExecutionLogsKey(null)}
        />
      )}
      {conversationId && showFilesPanel && (
        <FilesPanelDrawer
          open={filesPanelOpen}
          onClose={() => setFilesPanelOpen(false)}
          flatView={filesDrawerFlatView}
          conversationId={conversationId}
        />
      )}
      {/* Mobile-only full-screen drawers for the rail tabs that have no
          desktop push panel of their own. `MobilePanelDrawer` is `md:hidden`,
          so these never collide with the desktop rail; they're opened from
          the session-menu FAB above. */}
      {conversationId && rootSessionId && (
        <MobilePanelDrawer
          open={subagentsPanelOpen}
          title="Agents"
          onClose={() => setSubagentsPanelOpen(false)}
          testId="subagents-panel-drawer"
        >
          <BuiltInTabView
            tab="subagents"
            conversationId={conversationId}
            visible={subagentsPanelOpen}
          />
        </MobilePanelDrawer>
      )}
      {conversationId && (
        <MobilePanelDrawer
          open={shellsPanelOpen}
          title="Shells"
          onClose={() => setShellsPanelOpen(false)}
          testId="shells-panel-drawer"
        >
          <InlineTerminalsSection
            conversationId={conversationId}
            onExpand={openTerminalsPanel}
            // Mobile has no tab strip "+" menu, so the drawer carries
            // the "+ New shell" create row.
            showNewShell
          />
        </MobilePanelDrawer>
      )}
      {conversationId && showFilesPanel && (
        <MobilePanelDrawer
          open={githubPanelOpen}
          title="Pull Requests"
          onClose={() => setGithubPanelOpen(false)}
          testId="github-panel-drawer"
        >
          <RenderErrorBoundary name="pull requests" resetKey={conversationId}>
            <BuiltInTabView
              tab="github"
              conversationId={conversationId}
              visible={githubPanelOpen}
            />
          </RenderErrorBoundary>
        </MobilePanelDrawer>
      )}
      {conversationId && mobileViewport && railTabsAvailable.tasks && (
        <MobilePanelDrawer
          open={tasksPanelOpen}
          title="Tasks"
          onClose={() => setTasksPanelOpen(false)}
          testId="tasks-panel-drawer"
        >
          <BuiltInTabView tab="tasks" conversationId={conversationId} visible={tasksPanelOpen} />
        </MobilePanelDrawer>
      )}
      {conversationId && mobileViewport && railTabsAvailable["content-search"] && (
        <MobilePanelDrawer
          open={contentSearchPanelOpen}
          title="Content search"
          onClose={() => setContentSearchPanelOpen(false)}
          testId="content-search-panel-drawer"
        >
          <BuiltInTabView
            tab="content-search"
            conversationId={conversationId}
            visible={contentSearchPanelOpen}
          />
        </MobilePanelDrawer>
      )}
      {conversationId && mobileViewport && (
        <ViewDrawer
          viewId={viewDrawer}
          conversationId={conversationId}
          onClose={() => setViewDrawer(null)}
        />
      )}
      <div ref={setMobileFileTarget} className="md:hidden" />
    </>
  );
}

/** A built-in tab's extension view in a phone's drawer (Agents, Content search, Tasks, Pull Requests). */
function BuiltInTabView({
  tab,
  conversationId,
  visible,
}: {
  tab: "subagents" | "content-search" | "tasks" | "github";
  conversationId: string;
  visible: boolean;
}) {
  const { views, settled } = useRailViews();
  const view = builtInTabView(views, tab);
  return view ? (
    <ExtensionRailView
      viewId={view.id}
      settled={settled}
      conversationId={conversationId}
      visible={visible}
    />
  ) : null;
}

/** Another secondary side bar view in a phone's drawer, opened from the phone menu. */
function ViewDrawer({
  viewId,
  conversationId,
  onClose,
}: {
  viewId: string | null;
  conversationId: string;
  onClose: () => void;
}) {
  const { views, settled } = useRailViews();
  const view = viewId === null ? undefined : views.find((candidate) => candidate.id === viewId);
  return (
    <MobilePanelDrawer
      open={view !== undefined}
      title={view ? (view.title ?? view.name) : ""}
      onClose={onClose}
      testId="view-panel-drawer"
    >
      {view && (
        <ExtensionRailView
          viewId={view.id}
          settled={settled}
          conversationId={conversationId}
          visible
        />
      )}
    </MobilePanelDrawer>
  );
}
