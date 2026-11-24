// Test fixture for the built-in Tasks view: the built-ins in the real host, with a
// workspace surface's tasks publisher in front for the session, and the view's page
// as the rail draws it, in a router. The hooks the publisher reads are the ones the
// classic panel's tests mocked.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ExtensionRailView } from "@/shell/extensionViews/ExtensionRailView";
import { RailViewRegistry } from "@/shell/railViews";
import { WorkspaceTasksPublisher } from "@/shell/useWorkspaceTasksSource";
import { WorkspaceBridge } from "@/shell/workspaceBridge";
import { type BuiltInHarness, startBuiltIns } from "@/test/builtInExtensions";
import { VIEW_ID } from "@/builtinExtensions/omnigent.tasks/extension";

/** Lets the tasks reach the view: the publisher's commit, the API's coalescing, the redraw. */
export async function settleTasks(): Promise<void> {
  // Microtasks only, so it also runs under fake timers.
  await act(async () => {
    let turns = Promise.resolve();
    for (let turn = 0; turn < 20; turn += 1) turns = turns.then(() => undefined);
    await turns;
  });
}

export function startTasks(sessionId = "conv"): Promise<BuiltInHarness> {
  return startBuiltIns({
    registry: new RailViewRegistry(),
    bridge: new WorkspaceBridge(),
    sessionId,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  });
}

/** The Tasks page for `sessionId`, with its surface's publisher, as a router's child. */
export function TasksPage({
  harness,
  sessionId,
  onLeave,
  visible = true,
}: {
  harness: BuiltInHarness;
  sessionId: string;
  onLeave?: () => void;
  visible?: boolean;
}) {
  return (
    <>
      <WorkspaceTasksPublisher
        source={harness.source}
        bridge={harness.bridge}
        sessionId={sessionId}
        active
        onLeave={onLeave}
      />
      <ExtensionRailView
        viewId={VIEW_ID}
        settled
        conversationId={sessionId}
        registry={harness.registry}
        visible={visible}
      />
    </>
  );
}

/** Renders the page at `initialEntry` (with `extra` beside it) and lets the tasks arrive. */
export async function renderTasks(
  harness: BuiltInHarness,
  {
    sessionId = "conv",
    onLeave,
    initialEntry = `/c/${sessionId}`,
    extra,
    visible = true,
  }: {
    sessionId?: string;
    onLeave?: () => void;
    initialEntry?: string;
    extra?: ReactNode;
    /** Whether the page is on screen (the rail open). */
    visible?: boolean;
  } = {},
) {
  const client = harness.bridge.queryClient() ?? new QueryClient();
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <TooltipProvider>
          {children}
          {extra}
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  let current = { sessionId, onLeave };
  const page = () => (
    <TasksPage
      harness={harness}
      sessionId={current.sessionId}
      onLeave={current.onLeave}
      visible={visible}
    />
  );
  const view = render(wrap(page()));
  await settleTasks();
  return {
    ...view,
    /** Draws the page again, so the publisher reads the (mocked) hooks again. */
    refresh: async () => {
      view.rerender(wrap(page()));
      await settleTasks();
    },
    /** Shows `nextSession`'s tasks instead, as a session switch does. */
    switchTo: async (nextSession: string, nextOnLeave = current.onLeave) => {
      await harness.publish({ sessionId: nextSession });
      current = { sessionId: nextSession, onLeave: nextOnLeave };
      view.rerender(wrap(page()));
      await settleTasks();
    },
  };
}
