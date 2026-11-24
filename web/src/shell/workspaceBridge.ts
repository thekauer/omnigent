// What the workspace shell offers extension APIs: the changed files, availability
// and file settings of the workspace on screen, plus its file opener and
// refresh. Each workspace surface (the shell's session, a selected grid cell)
// registers a source; the most recently activated active source is the one on
// screen. Plain module state, so the extension host never reaches into React or
// the query cache.

import type { QueryClient } from "@tanstack/react-query";
import type * as omnigent from "omnigent";
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
  /** The top-level session of the session's tree; null until known. */
  readonly rootSessionId?: string | null;
  /** Whether the server reports per-agent costs (the session overview feature). */
  readonly agentCostsEnabled?: boolean;
}

/** Where a file opens: a 1-based line and column. */
export interface WorkspaceFilePosition {
  readonly line?: number;
  readonly column?: number;
}

export interface WorkspaceActions {
  openFile: (path: string, position?: WorkspaceFilePosition) => void;
  refreshChangedFiles: () => Promise<void>;
  updateSettings: (patch: Partial<WorkspaceFileSettings>) => void;
  /** Shows a session; `asSubagent` opens it beside the chat when the user's setting asks for it. */
  openSession?: (sessionId: string, options: { asSubagent: boolean }) => void;
  /** The query cache the surface's session data lives in. */
  readonly queryClient?: QueryClient;
}

/** A task action the composer takes: run, continue, proceed with or retry a task. */
export type WorkspaceTaskAction = "run" | "continue" | "proceed" | "retry";

/** What a workspace surface does for its session's tasks; each throws when it cannot. */
export interface WorkspaceTasksActions {
  /** Scrolls the session's chat to a marker (a task's status, a question). */
  showInChat: (markerId: string) => void;
  startWorkflow: (choice: { description?: string; workflowId?: string }) => void;
  saveWorkflow: (planName: string) => void;
  continuePlan: (planName: string | null) => void;
  stopWork: () => void;
  taskAction: (action: WorkspaceTaskAction, taskName: string) => void;
  /** Loads the journal again after a failure. */
  reload: () => void;
  openWorkflow: (workflowId: string) => void;
}

/**
 * The workspace rail of a session on screen: which extension views it can show
 * now (their tabs are in its strip), and how to bring one to the front.
 */
export interface WorkspaceRail {
  readonly sessionId: string;
  readonly views: readonly string[];
  /** Selects the view's tab, reveals the rail and focuses the view's input; false when it cannot. */
  reveal: (viewId: string) => boolean;
}

export interface WorkspaceRailRegistration {
  update: (rail: WorkspaceRail | null) => void;
  dispose: () => void;
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
  /** Replace the session's tasks, a plain snapshot (`undefined` without a Tasks tab). */
  updateTasks: (tasks: omnigent.SessionTasks | undefined) => void;
  setTasksActions: (actions: WorkspaceTasksActions | null) => void;
  setActions: (actions: WorkspaceActions | null) => void;
  /** An active source can be the one on screen; activating it brings it to the front. */
  setActive: (active: boolean) => void;
  dispose: () => void;
}

interface SourceEntry {
  state: WorkspaceBridgeState;
  actions: WorkspaceActions | null;
  tasks: omnigent.SessionTasks | undefined;
  tasksActions: WorkspaceTasksActions | null;
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
    left.settings.showHidden === right.settings.showHidden &&
    (left.rootSessionId ?? null) === (right.rootSessionId ?? null) &&
    (left.agentCostsEnabled ?? false) === (right.agentCostsEnabled ?? false)
  );
}

export class WorkspaceBridge {
  private readonly sources = new Set<SourceEntry>();
  private readonly listeners = new Set<() => void>();
  private nextOrder = 0;
  private front: SourceEntry | null = null;
  private state: WorkspaceBridgeState = EMPTY_WORKSPACE_STATE;
  private readonly rails = new Map<object, { rail: WorkspaceRail; order: number }>();
  private readonly railListeners = new Set<() => void>();
  private tasks: omnigent.SessionTasks | undefined;
  private readonly tasksListeners = new Set<() => void>();
  private tasksWatchers = 0;
  private readonly tasksWatchListeners = new Set<() => void>();

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
      tasks: undefined,
      tasksActions: null,
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
      updateTasks: (tasks) => {
        if (disposed || entry.tasks === tasks) return;
        entry.tasks = tasks;
        if (this.front === entry) this.publishTasks();
      },
      setTasksActions: (actions) => {
        if (!disposed) entry.tasksActions = actions;
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
    this.publishTasks();
    const next = front?.state ?? EMPTY_WORKSPACE_STATE;
    if (next === this.state) return;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  private publishTasks(): void {
    const next = this.front?.tasks;
    if (next === this.tasks) return;
    this.tasks = next;
    for (const listener of [...this.tasksListeners]) listener();
  }

  /** The tasks of the workspace on screen, as its surface published them. */
  getTasks = (): omnigent.SessionTasks | undefined => this.tasks;

  subscribeTasks = (listener: () => void): (() => void) => {
    this.tasksListeners.add(listener);
    return () => this.tasksListeners.delete(listener);
  };

  /** Whether something on screen wants the tasks loaded (the Tasks view showing). */
  tasksWatched = (): boolean => this.tasksWatchers > 0;

  subscribeTasksWatch = (listener: () => void): (() => void) => {
    this.tasksWatchListeners.add(listener);
    return () => this.tasksWatchListeners.delete(listener);
  };

  /** Keeps the tasks of the workspace on screen loaded until the returned function is called. */
  watchTasks(): () => void {
    let done = false;
    this.tasksWatchers += 1;
    if (this.tasksWatchers === 1) this.notifyTasksWatch();
    return () => {
      if (done) return;
      done = true;
      this.tasksWatchers -= 1;
      if (this.tasksWatchers === 0) this.notifyTasksWatch();
    };
  }

  private notifyTasksWatch(): void {
    for (const listener of [...this.tasksWatchListeners]) listener();
  }

  /**
   * The task actions of the workspace on screen; with `sessionId`, throws when
   * another session's workspace is on screen.
   */
  tasksActions(sessionId?: string): WorkspaceTasksActions {
    const front = this.front;
    if (!front) throw new Error("no workspace is open");
    if (sessionId !== undefined && front.state.sessionId !== sessionId) {
      throw new Error(`session ${sessionId} is not the workspace on screen`);
    }
    if (!front.tasksActions) throw new Error("this workspace has no tasks");
    return front.tasksActions;
  }

  private actions(): WorkspaceActions {
    const actions = this.front?.actions;
    if (!actions) throw new Error("no workspace is open");
    return actions;
  }

  openFile(path: string, position?: WorkspaceFilePosition): void {
    if (position) this.actions().openFile(path, position);
    else this.actions().openFile(path);
  }

  openSession(sessionId: string, options: { asSubagent: boolean }): void {
    const openSession = this.actions().openSession;
    if (!openSession) throw new Error("this workspace cannot open sessions");
    openSession(sessionId, options);
  }

  /** The query cache of the workspace on screen, if it shares one. */
  queryClient(): QueryClient | undefined {
    return this.front?.actions?.queryClient;
  }

  /** Registers a workspace rail; the latest one for the session on screen is used. */
  createRail(): WorkspaceRailRegistration {
    const key = {};
    let disposed = false;
    const notify = () => {
      for (const listener of [...this.railListeners]) listener();
    };
    return {
      update: (rail) => {
        if (disposed) return;
        if (rail === null) this.rails.delete(key);
        else this.rails.set(key, { rail, order: this.rails.get(key)?.order ?? ++this.nextOrder });
        notify();
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (this.rails.delete(key)) notify();
      },
    };
  }

  /** The rail of the session on screen, if one is registered. */
  rail(): WorkspaceRail | undefined {
    const sessionId = this.state.sessionId;
    if (sessionId === null) return undefined;
    let best: { rail: WorkspaceRail; order: number } | undefined;
    for (const entry of this.rails.values()) {
      if (entry.rail.sessionId === sessionId && (!best || entry.order > best.order)) best = entry;
    }
    return best?.rail;
  }

  /** Fires when a rail changes, as well as when the workspace on screen does. */
  subscribeRails = (listener: () => void): (() => void) => {
    this.railListeners.add(listener);
    const unsubscribe = this.subscribe(listener);
    return () => {
      this.railListeners.delete(listener);
      unsubscribe();
    };
  };

  async refreshChangedFiles(): Promise<void> {
    await this.actions().refreshChangedFiles();
  }

  updateSettings(patch: Partial<WorkspaceFileSettings>): void {
    this.actions().updateSettings(patch);
  }
}

export const workspaceBridge = new WorkspaceBridge();
