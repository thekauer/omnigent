// Shows a folder or a file in the Files tab of a session: the built-in Files
// extension's `omnigent.revealInFiles`, run through the workspace bridge so the
// shell never reaches into the extension.
import { type WorkspaceBridge, workspaceBridge } from "./workspaceBridge";

export const REVEAL_IN_FILES_COMMAND = "omnigent.revealInFiles";

/**
 * Browses `sessionId`'s Files tree at a folder (an absolute path), or shows a
 * file in it (absolute or workspace-relative); live when its tree is on
 * screen, else when it is next drawn.
 */
export function revealInFiles(
  sessionId: string,
  path: string,
  kind: "folder" | "file" = "folder",
  bridge: WorkspaceBridge = workspaceBridge,
): void {
  bridge.executeCommand(REVEAL_IN_FILES_COMMAND, path, { sessionId, kind }).catch((error) => {
    console.error(`[omnigent-extensions] ${REVEAL_IN_FILES_COMMAND} failed`, error);
  });
}
