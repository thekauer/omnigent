// Shows a pull request in a session's Pull Requests tab: the built-in Pull
// Requests extension's `omnigent.pull-requests.reveal`, run through the
// workspace bridge so the shell never reaches into the extension.
import { type WorkspaceBridge, workspaceBridge } from "./workspaceBridge";

export const REVEAL_PULL_REQUEST_COMMAND = "omnigent.pull-requests.reveal";

/** Selects `url` in `sessionId`'s Pull Requests tab, on its Summary, before the tab shows. */
export function revealPullRequest(
  sessionId: string,
  url: string,
  bridge: WorkspaceBridge = workspaceBridge,
): void {
  bridge.executeCommand(REVEAL_PULL_REQUEST_COMMAND, sessionId, url).catch((error) => {
    console.error(`[omnigent-extensions] ${REVEAL_PULL_REQUEST_COMMAND} failed`, error);
  });
}
