// What the workspace shell offers extension APIs: the active session's changed
// files, published by the shell from its existing query, and the shell's file
// opener and changed-files refresh. Plain module state, so the extension host
// never reaches into React or the query cache.

import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";

export interface WorkspaceBridgeState {
  readonly sessionId: string | null;
  /** The session's changed files; undefined while they load or when loading failed. */
  readonly changedFiles: readonly WorkspaceChangedFile[] | undefined;
  /** Why they could not be loaded. */
  readonly error?: string;
}

export interface WorkspaceActions {
  openFile: (path: string) => void;
  refreshChangedFiles: () => Promise<void>;
}

export class WorkspaceBridge {
  private state: WorkspaceBridgeState = { sessionId: null, changedFiles: undefined };
  private readonly listeners = new Set<() => void>();
  private actions: WorkspaceActions | null = null;

  getState = (): WorkspaceBridgeState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Called by the shell whenever the active session or its changed files change. */
  publishChangedFiles(
    sessionId: string | null,
    changedFiles: readonly WorkspaceChangedFile[] | undefined,
    error?: string,
  ): void {
    if (
      this.state.sessionId === sessionId &&
      this.state.changedFiles === changedFiles &&
      this.state.error === error
    ) {
      return;
    }
    this.state = { sessionId, changedFiles, error };
    for (const listener of [...this.listeners]) listener();
  }

  /** The shell registers its actions while mounted; the latest registration wins. */
  registerActions(actions: WorkspaceActions): () => void {
    this.actions = actions;
    return () => {
      if (this.actions === actions) this.actions = null;
    };
  }

  openFile(path: string): void {
    if (!this.actions) throw new Error("no workspace is open");
    this.actions.openFile(path);
  }

  async refreshChangedFiles(): Promise<void> {
    if (!this.actions) throw new Error("no workspace is open");
    await this.actions.refreshChangedFiles();
  }
}

export const workspaceBridge = new WorkspaceBridge();
