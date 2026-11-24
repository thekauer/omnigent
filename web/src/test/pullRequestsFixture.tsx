// Test fixture for the built-in Pull Requests view: the built-ins in the real host,
// with a workspace surface's pull request publisher in front for the session, and
// the view's page as the rail draws it. The hooks the publisher and the host's
// details read are the ones the classic panel's tests mocked.
import { QueryClient } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { ExtensionRailView } from "@/shell/extensionViews/ExtensionRailView";
import type { PullRequestSubtab } from "@/shell/PullRequestPanelDetails";
import { RailViewRegistry } from "@/shell/railViews";
import { REVEAL_PULL_REQUEST_COMMAND } from "@/shell/revealPullRequest";
import { WorkspacePullRequestsPublisher } from "@/shell/useWorkspacePullRequestsSource";
import { WorkspaceBridge } from "@/shell/workspaceBridge";
import { type BuiltInHarness, startBuiltIns } from "@/test/builtInExtensions";
import { VIEW_ID } from "@/builtinExtensions/omnigent.pull-requests/extension";

/** Lets the pull requests reach the view: the publisher's commit, the API's coalescing, the redraw. */
export async function settlePullRequests(): Promise<void> {
  // Microtasks only, so it also runs under fake timers.
  for (let round = 0; round < 3; round += 1) {
    // oxlint-disable-next-line no-await-in-loop
    await act(async () => {
      let turns = Promise.resolve();
      for (let turn = 0; turn < 20; turn += 1) turns = turns.then(() => undefined);
      await turns;
    });
  }
}

export function startPullRequests(sessionId = "conv_1"): Promise<BuiltInHarness> {
  return startBuiltIns({
    registry: new RailViewRegistry(),
    bridge: new WorkspaceBridge(),
    sessionId,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  });
}

/** Selects `url` in the session's tab, as the composer's link does before showing it. */
export async function revealPullRequestIn(
  harness: BuiltInHarness,
  sessionId: string,
  url: string,
): Promise<void> {
  await act(async () => {
    await harness.bridge.executeCommand(REVEAL_PULL_REQUEST_COMMAND, sessionId, url);
  });
}

/**
 * The Pull Requests tab for `conversationId`, as the classic `PullRequestPanel`
 * took it: the surface's publisher and the view's page. `active` is whether the
 * rail shows it; `onOpenPullRequest` draws it as a sidebar page's list.
 */
export function PullRequestsPage({
  harness,
  conversationId,
  active = true,
  onOpenPullRequest,
}: {
  harness: BuiltInHarness;
  conversationId: string;
  active?: boolean;
  onOpenPullRequest?: (url: string, section?: PullRequestSubtab) => void;
}) {
  // The workspace on screen follows the page's session, as AppShell's source does.
  useLayoutEffect(() => {
    if (harness.state().sessionId !== conversationId) {
      harness.source.update({ ...harness.state(), sessionId: conversationId });
      void harness.publish({ sessionId: conversationId });
    }
  }, [harness, conversationId]);
  return (
    <>
      <WorkspacePullRequestsPublisher
        source={harness.source}
        bridge={harness.bridge}
        sessionId={conversationId}
        active
      />
      <ExtensionRailView
        viewId={VIEW_ID}
        settled
        conversationId={conversationId}
        registry={harness.registry}
        visible={active}
        onOpenPullRequest={onOpenPullRequest}
        bridge={harness.bridge}
      />
    </>
  );
}
