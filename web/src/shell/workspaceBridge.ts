// What the workspace shell offers extension APIs: the changed files, availability
// and file settings of the workspace on screen, plus its file opener and
// refresh. Each workspace surface (the shell's session, a selected grid cell)
// registers a source; the most recently activated active source is the one on
// screen. Plain module state, so the extension host never reaches into React or
// the query cache.

import type { QueryClient } from "@tanstack/react-query";
import type * as omnigent from "omnigent";
import type {
  WorkspaceChangedFile,
  WorkspaceFile,
  WorkspaceFileSearchResult,
} from "@/hooks/useWorkspaceChangedFiles";
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
  /** The workspace root's absolute path: undefined while unknown, null without a filesystem. */
  readonly rootPath?: string | null;
  /** Bumped whenever the session's file listings were invalidated (a turn ended, the server said so). */
  readonly filesRevision?: number;
}

/** The session has no filesystem environment (its listing answered 404). */
export class WorkspaceUnavailableError extends Error {
  constructor() {
    super("This workspace has no files");
    this.name = "WorkspaceUnavailableError";
  }
}

/** A file search of the workspace (or a browsed folder) by name, with include and exclude globs. */
export interface WorkspaceFileQuery {
  readonly pattern: string;
  readonly include: string;
  readonly exclude: string;
  /** "" for the workspace root, a workspace-relative folder, or an absolute host path. */
  readonly location: string;
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
  /**
   * Lists a folder ("" the root, workspace-relative, or absolute on the host);
   * entry paths are relative to it. Rejects with the listing's error.
   */
  readDirectory?: (location: string) => Promise<readonly WorkspaceFile[]>;
  /** Searches files by name; result paths are relative to the query's location. */
  findFiles?: (
    query: WorkspaceFileQuery,
    signal: AbortSignal,
  ) => Promise<WorkspaceFileSearchResult>;
  /** Marks the session's listings and searches stale and reloads its changed files. */
  refreshFiles?: () => Promise<void>;
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

/** A merge, as the merge dialog sends it. */
export interface WorkspacePullRequestMerge {
  readonly method: "merge" | "squash" | "rebase";
  /** The head commit shown; the provider refuses the merge if the branch moved. */
  readonly expectedHead: string;
  readonly account?: string;
}

/** What a workspace surface does for its session's pull requests; each rejects when it cannot. */
export interface WorkspacePullRequestsActions {
  /** Links a pull request; resolves to the one the host selected. */
  link: (url: string) => Promise<{ selectedUrl: string | undefined }>;
  /** Unlinks one; resolves to the urls still linked. */
  unlink: (url: string) => Promise<{ remaining: string[] }>;
  /** Reads every pull request query of the session again. */
  refresh: () => Promise<void>;
  merge: (url: string, merge: WorkspacePullRequestMerge) => Promise<void>;
  updateLabels: (url: string, change: { add: string[]; remove: string[] }) => Promise<void>;
  updateReviewers: (
    url: string,
    change: {
      add: { login: string; kind: "user" | "team" }[];
      remove: { login: string; kind: "user" | "team" }[];
    },
  ) => Promise<void>;
  postComment: (url: string, body: string) => Promise<void>;
}

/** What the views watching the pull requests want read: how many, and the latest focus. */
export interface WorkspacePullRequestsWatch {
  readonly watchers: number;
  /** Some watcher has them on screen, so they poll; passive watchers only read. */
  readonly polling: boolean;
  readonly focus: omnigent.PullRequestsFocus | undefined;
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
  /** Replace the session's pull requests, a plain snapshot (`undefined` without the tab). */
  updatePullRequests: (pullRequests: omnigent.SessionPullRequests | undefined) => void;
  setPullRequestsActions: (actions: WorkspacePullRequestsActions | null) => void;
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
  pullRequests: omnigent.SessionPullRequests | undefined;
  pullRequestsActions: WorkspacePullRequestsActions | null;
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
    (left.agentCostsEnabled ?? false) === (right.agentCostsEnabled ?? false) &&
    left.rootPath === right.rootPath &&
    (left.filesRevision ?? 0) === (right.filesRevision ?? 0)
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
  private pullRequests: omnigent.SessionPullRequests | undefined;
  private readonly pullRequestsListeners = new Set<() => void>();
  private readonly pullRequestsWatchers: {
    focus: omnigent.PullRequestsFocus | undefined;
    list: boolean;
    passive: boolean;
  }[] = [];
  private pullRequestsWatchState: WorkspacePullRequestsWatch = Object.freeze({
    watchers: 0,
    polling: false,
    focus: undefined,
  });
  private readonly pullRequestsWatchListeners = new Set<() => void>();
  /** The latest focus any watch set, kept for passive watches once that watch ends. */
  private lastPullRequestsFocus: omnigent.PullRequestsFocus | undefined;

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
      pullRequests: undefined,
      pullRequestsActions: null,
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
      updatePullRequests: (pullRequests) => {
        if (disposed || entry.pullRequests === pullRequests) return;
        entry.pullRequests = pullRequests;
        if (this.front === entry) this.publishPullRequests();
      },
      setPullRequestsActions: (actions) => {
        if (!disposed) entry.pullRequestsActions = actions;
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
    this.publishPullRequests();
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

  private publishPullRequests(): void {
    const next = this.front?.pullRequests;
    if (next === this.pullRequests) return;
    this.pullRequests = next;
    for (const listener of [...this.pullRequestsListeners]) listener();
  }

  /** The pull requests of the workspace on screen, as its surface published them. */
  getPullRequests = (): omnigent.SessionPullRequests | undefined => this.pullRequests;

  subscribePullRequests = (listener: () => void): (() => void) => {
    this.pullRequestsListeners.add(listener);
    return () => this.pullRequestsListeners.delete(listener);
  };

  /** How many views watch the pull requests, and the latest focus any of them set. */
  pullRequestsWatch = (): WorkspacePullRequestsWatch => this.pullRequestsWatchState;

  subscribePullRequestsWatch = (listener: () => void): (() => void) => {
    this.pullRequestsWatchListeners.add(listener);
    return () => this.pullRequestsWatchListeners.delete(listener);
  };

  /**
   * Keeps the pull requests of the workspace on screen read and polled until
   * disposed. A `list` watch (a page that lists them and opens each on its own)
   * keeps every listed one read, whatever the latest focus shows. A `passive`
   * watch (a view drawn but hidden, such as in a collapsed rail) reads them
   * without polling.
   */
  watchPullRequests(options: { list?: boolean; passive?: boolean } = {}): {
    setFocus: (focus: omnigent.PullRequestsFocus | undefined) => void;
    dispose: () => void;
  } {
    const watcher = {
      focus: undefined as omnigent.PullRequestsFocus | undefined,
      list: options.list === true,
      passive: options.passive === true,
    };
    this.pullRequestsWatchers.push(watcher);
    this.notifyPullRequestsWatch();
    let done = false;
    return {
      setFocus: (focus) => {
        if (done) return;
        watcher.focus = focus;
        if (focus) this.lastPullRequestsFocus = focus;
        // The latest focus wins, as the last view to choose a pull request does.
        const index = this.pullRequestsWatchers.indexOf(watcher);
        this.pullRequestsWatchers.splice(index, 1);
        this.pullRequestsWatchers.push(watcher);
        this.notifyPullRequestsWatch();
      },
      dispose: () => {
        if (done) return;
        done = true;
        this.pullRequestsWatchers.splice(this.pullRequestsWatchers.indexOf(watcher), 1);
        this.notifyPullRequestsWatch();
      },
    };
  }

  private notifyPullRequestsWatch(): void {
    let focus: omnigent.PullRequestsFocus | undefined;
    for (const watcher of this.pullRequestsWatchers) focus = watcher.focus ?? focus;
    focus ??= this.pullRequestsWatchers.length > 0 ? this.lastPullRequestsFocus : undefined;
    if (focus?.details && this.pullRequestsWatchers.some((watcher) => watcher.list)) {
      focus = { ...focus, details: false };
    }
    const previous = this.pullRequestsWatchState;
    const watchers = this.pullRequestsWatchers.length;
    const polling = this.pullRequestsWatchers.some((watcher) => !watcher.passive);
    if (
      previous.watchers === watchers &&
      previous.polling === polling &&
      previous.focus?.sessionId === focus?.sessionId &&
      previous.focus?.url === focus?.url &&
      previous.focus?.details === focus?.details
    ) {
      return;
    }
    this.pullRequestsWatchState = Object.freeze({ watchers, polling, focus });
    for (const listener of [...this.pullRequestsWatchListeners]) listener();
  }

  /**
   * The pull request actions of the workspace on screen; throws when another
   * session's workspace is on screen.
   */
  pullRequestsActions(sessionId: string): WorkspacePullRequestsActions {
    const front = this.front;
    if (!front) throw new Error("no workspace is open");
    if (front.state.sessionId !== sessionId) {
      throw new Error(`session ${sessionId} is not the workspace on screen`);
    }
    if (!front.pullRequestsActions) throw new Error("this workspace has no pull requests");
    return front.pullRequestsActions;
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

  /** Lists a folder of the workspace on screen; see {@link WorkspaceActions.readDirectory}. */
  readDirectory(location: string): Promise<readonly WorkspaceFile[]> {
    const read = this.actions().readDirectory;
    if (!read) return Promise.reject(new Error("this workspace has no files"));
    return read(location);
  }

  findFiles(query: WorkspaceFileQuery, signal: AbortSignal): Promise<WorkspaceFileSearchResult> {
    const find = this.actions().findFiles;
    if (!find) return Promise.reject(new Error("this workspace has no files"));
    return find(query, signal);
  }

  async refreshFiles(): Promise<void> {
    const actions = this.actions();
    await (actions.refreshFiles ?? actions.refreshChangedFiles)();
  }

  private commandRunner: ((command: string, args: readonly unknown[]) => Promise<unknown>) | null =
    null;

  /** Set by the extension host: how the shell runs an extension's command. */
  setCommandRunner(
    runner: ((command: string, args: readonly unknown[]) => Promise<unknown>) | null,
  ): void {
    this.commandRunner = runner;
  }

  /** Runs a command of the window's extensions (such as `omnigent.revealInFiles`) from the shell. */
  executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    if (!this.commandRunner) return Promise.reject(new Error("no extension host is running"));
    return this.commandRunner(command, args);
  }

  updateSettings(patch: Partial<WorkspaceFileSettings>): void {
    this.actions().updateSettings(patch);
  }
}

export const workspaceBridge = new WorkspaceBridge();
