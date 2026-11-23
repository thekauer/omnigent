// Host-side source of `omnigent.workspace`: the active session's changed files
// as frozen plain data, from the shell's changed-files query (workspaceBridge).
import type * as omnigent from "omnigent";
import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";
import type { WorkspaceBridge, WorkspaceBridgeState } from "@/shell/workspaceBridge";
import { EventEmitter } from "./base";

function toChangedFile(file: WorkspaceChangedFile): omnigent.ChangedFile {
  return Object.freeze({
    path: file.path,
    name: file.name,
    repositoryRoot: file.repository_root || undefined,
    status: file.status === "created" ? "added" : file.status,
    bytes: file.bytes,
    modifiedAt: file.modified_at,
    linesAdded: file.lines_added,
    linesRemoved: file.lines_removed,
  });
}

export class WorkspaceService {
  private readonly emitter = new EventEmitter<omnigent.ChangedFilesChangeEvent>();
  private readonly unsubscribe: () => void;
  private readonly bridge: WorkspaceBridge;
  private source: WorkspaceBridgeState;
  private snapshot: readonly omnigent.ChangedFile[] | undefined;
  private flushScheduled = false;
  private disposed = false;

  /** Fires when the active session's changed files change, including on a session switch. */
  readonly onDidChangeChangedFiles = this.emitter.event;

  constructor(bridge: WorkspaceBridge) {
    this.bridge = bridge;
    this.source = bridge.getState();
    this.snapshot = this.copy(this.source);
    this.unsubscribe = bridge.subscribe(() => this.scheduleFlush());
  }

  private copy(state: WorkspaceBridgeState): readonly omnigent.ChangedFile[] | undefined {
    return state.changedFiles === undefined
      ? undefined
      : Object.freeze(state.changedFiles.map(toChangedFile));
  }

  /** The active session's changed files; `undefined` while they load or without a session. */
  getChangedFiles(): readonly omnigent.ChangedFile[] | undefined {
    return this.source.sessionId === null ? undefined : this.snapshot;
  }

  /** Why the active session's changed files could not be loaded, if they could not. */
  get changedFilesError(): string | undefined {
    return this.source.sessionId === null ? undefined : this.source.error;
  }

  // Coalesced per microtask, like the sessions events: a switch publishes twice.
  private scheduleFlush(): void {
    if (this.flushScheduled || this.disposed) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      if (this.disposed) return;
      const next = this.bridge.getState();
      if (
        next.sessionId === this.source.sessionId &&
        next.changedFiles === this.source.changedFiles &&
        next.error === this.source.error
      ) {
        return;
      }
      this.source = next;
      this.snapshot = this.copy(next);
      this.emitter.fire(
        Object.freeze({
          sessionId: next.sessionId ?? undefined,
          files: this.getChangedFiles(),
          ...(this.changedFilesError === undefined ? {} : { error: this.changedFilesError }),
        }),
      );
    });
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.emitter.dispose();
  }
}
