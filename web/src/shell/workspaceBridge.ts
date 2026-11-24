// What the workspace shell offers extension APIs: the changed files, availability
// and file settings of the workspace on screen, plus its file opener and
// refresh. Each workspace surface (the shell's session, a selected grid cell)
// registers a source; the most recently activated active source is the one on
// screen. Plain module state, so the extension host never reaches into React or
// the query cache.

import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";
import type { ChangedSort } from "@/lib/changedSort";

/** Why a workspace cannot be read right now, when the shell knows. */
export type WorkspaceAvailability =
  "available" | "agentAsleep" | "sandboxOffline" | "sandboxStarting";

/** The file settings a workspace surface keeps (sort order, hidden files). */
export interface WorkspaceFileSettings {
  readonly sortOrder: ChangedSort;
  readonly showHidden: boolean;
}

export interface WorkspaceBridgeState {
  readonly sessionId: string | null;
  /** The session's changed files; undefined while they load or when loading failed. */
  readonly changedFiles: readonly WorkspaceChangedFile[] | undefined;
  /** Why they could not be loaded. */
  readonly error?: string;
  readonly availability: WorkspaceAvailability;
  /** The agent is asleep but its host serves the workspace. */
  readonly servedFromHost: boolean;
  readonly settings: WorkspaceFileSettings;
}

export interface WorkspaceActions {
  openFile: (path: string) => void;
  refreshChangedFiles: () => Promise<void>;
  updateSettings: (patch: Partial<WorkspaceFileSettings>) => void;
}

export const DEFAULT_WORKSPACE_FILE_SETTINGS: WorkspaceFileSettings = Object.freeze({
  sortOrder: "alpha",
  showHidden: true,
});

export const EMPTY_WORKSPACE_STATE: WorkspaceBridgeState = Object.freeze({
  sessionId: null,
  changedFiles: undefined,
  availability: "available",
  servedFromHost: false,
  settings: DEFAULT_WORKSPACE_FILE_SETTINGS,
});

/** One workspace surface's registration. */
export interface WorkspaceSource {
  /** Replace what the surface shows; a no-op when nothing changed. */
  update: (state: WorkspaceBridgeState) => void;
  setActions: (actions: WorkspaceActions | null) => void;
  /** An active source can be the one on screen; activating it brings it to the front. */
  setActive: (active: boolean) => void;
  dispose: () => void;
}

interface SourceEntry {
  state: WorkspaceBridgeState;
  actions: WorkspaceActions | null;
  active: boolean;
  /** When it was last activated; the highest active one is in front. */
  order: number;
}

function sameState(left: WorkspaceBridgeState, right: WorkspaceBridgeState): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.changedFiles === right.changedFiles &&
    left.error === right.error &&
    left.availability === right.availability &&
    left.servedFromHost === right.servedFromHost &&
    left.settings.sortOrder === right.settings.sortOrder &&
    left.settings.showHidden === right.settings.showHidden
  );
}

export class WorkspaceBridge {
  private readonly sources = new Set<SourceEntry>();
  private readonly listeners = new Set<() => void>();
  private nextOrder = 0;
  private front: SourceEntry | null = null;
  private state: WorkspaceBridgeState = EMPTY_WORKSPACE_STATE;

  /** The workspace on screen; empty without an active source. */
  getState = (): WorkspaceBridgeState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Registers a workspace surface, inactive until it calls `setActive(true)`. */
  createSource(): WorkspaceSource {
    const entry: SourceEntry = {
      state: EMPTY_WORKSPACE_STATE,
      actions: null,
      active: false,
      order: 0,
    };
    this.sources.add(entry);
    let disposed = false;
    return {
      update: (state) => {
        if (disposed || sameState(entry.state, state)) return;
        entry.state = state;
        if (this.front === entry) this.publish();
      },
      setActions: (actions) => {
        if (!disposed) entry.actions = actions;
      },
      setActive: (active) => {
        if (disposed || entry.active === active) return;
        entry.active = active;
        if (active) entry.order = ++this.nextOrder;
        this.publish();
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.sources.delete(entry);
        this.publish();
      },
    };
  }

  private publish(): void {
    let front: SourceEntry | null = null;
    for (const entry of this.sources) {
      if (entry.active && (front === null || entry.order > front.order)) front = entry;
    }
    this.front = front;
    const next = front?.state ?? EMPTY_WORKSPACE_STATE;
    if (next === this.state) return;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  private actions(): WorkspaceActions {
    const actions = this.front?.actions;
    if (!actions) throw new Error("no workspace is open");
    return actions;
  }

  openFile(path: string): void {
    this.actions().openFile(path);
  }

  async refreshChangedFiles(): Promise<void> {
    await this.actions().refreshChangedFiles();
  }

  updateSettings(patch: Partial<WorkspaceFileSettings>): void {
    this.actions().updateSettings(patch);
  }
}

export const workspaceBridge = new WorkspaceBridge();
