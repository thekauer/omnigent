// Builds the `omnigent` module an extension imports. One instance per extension,
// like VS Code's per-extension `vscode` module, so every call is attributable.
import type * as omnigent from "omnigent";
import type { GitHostProviderRegistry } from "@/lib/gitHostProviders";
import type { HostProgressLocations } from "@/lib/hostProgress";
import type {
  HostReconnectProviderRegistry,
  ReconnectHost,
  ReconnectOutcome,
} from "@/lib/hostReconnectProviders";
import { isThenable } from "@/lib/thenable";
import {
  CancellationTokenSource,
  Disposable,
  EventEmitter,
  disposeAll,
  type DisposableLike,
} from "./base";
import type { CommandHandler, CommandRegistry } from "./commands";
import type { NodeProgressEvent } from "./nodeCommands";
import {
  runWithProgress,
  type Notifications,
  type ProgressNotification,
  type ProgressReport,
  type ProgressReporter,
} from "./progress";
import { SessionHeaderItemAlignment, type SessionHeaderItemRegistry } from "./sessionHeaderItems";
import type { SessionsService } from "./sessionsService";
import type { SessionTreeService } from "./sessionTreeService";
import type { PullRequestsService } from "./pullRequestsService";
import type { TasksService } from "./tasksService";
import type { KeybindingService } from "./keybindings";
import type { ViewsService } from "./viewsService";
import { textSearchQueryProblem, type WorkspaceService } from "./workspaceService";

export const OMNIGENT_API_VERSION = "0.1.0";

/** The module namespace `import * as omnigent from "omnigent"` yields. */
export type OmnigentApi = typeof omnigent;

/**
 * Names the dev plugin re-exports from the per-extension module. Kept in sync
 * with `OMNIGENT_API_EXPORTS` in vite.omnigentExtensions.ts (a test checks it).
 */
export const OMNIGENT_API_EXPORT_NAMES = [
  "version",
  "Disposable",
  "EventEmitter",
  "SessionHeaderItemAlignment",
  "window",
  "sessions",
  "commands",
  "hosts",
  "workspace",
  "git",
  "pullRequests",
  "TreeItemCollapsibleState",
  "CancellationTokenSource",
] as const;

/** As `vscode.TreeItemCollapsibleState`. */
export const TreeItemCollapsibleState = Object.freeze({ None: 0, Collapsed: 1, Expanded: 2 });

export interface HostServices {
  headerItems: SessionHeaderItemRegistry;
  sessions: SessionsService;
  commands: CommandRegistry;
  notifications: Notifications;
  hostReconnect: {
    registry: HostReconnectProviderRegistry;
    /** Called after a provider's reconnect succeeded, to refresh host liveness. */
    onReconnected?: () => void;
  };
  /** Progress shown inline at a host (`withProgress({ location: { hostId } })`). */
  hostProgress: HostProgressLocations;
  views: ViewsService;
  workspace: WorkspaceService;
  sessionTree: SessionTreeService;
  tasks: TasksService;
  pullRequests: PullRequestsService;
  gitHosts: GitHostProviderRegistry;
  /** Contributed keybindings; without it, `contributes.keybindings` is ignored. */
  keybindings?: KeybindingService;
}

export type ExtensionLogger = (message: string, error?: unknown) => void;

/** An API instance plus everything it handed out, for teardown on deactivate. */
export interface ExtensionApiHandle {
  api: OmnigentApi;
  dispose: () => void;
}

/** A disposed item that was never registered, for calls after deactivation. */
function inertSessionHeaderItem(
  extensionId: string,
  id: string | undefined,
  alignment: number | undefined,
  priority: number | undefined,
): omnigent.SessionHeaderItem {
  return {
    id: `${extensionId}.${id ?? "disposed"}`,
    alignment: (alignment === SessionHeaderItemAlignment.Right
      ? SessionHeaderItemAlignment.Right
      : SessionHeaderItemAlignment.Left) as omnigent.SessionHeaderItemAlignment,
    priority: typeof priority === "number" && Number.isFinite(priority) ? priority : undefined,
    text: "",
    tooltip: undefined,
    show: () => {},
    hide: () => {},
    dispose: () => {},
  };
}

export function createExtensionApi(
  extensionId: string,
  services: HostServices,
  logError: ExtensionLogger,
  { builtIn = false }: { builtIn?: boolean } = {},
): ExtensionApiHandle {
  const resources = new Set<DisposableLike>();
  // Once disposed (deactivate, failed or timed-out activation), the instance is
  // inert: a late caller gets handles that are already disposed, nothing more.
  let disposed = false;
  const refuse = (what: string) =>
    logError(`${what} called after the extension was deactivated; ignoring it`);
  const track = <T extends DisposableLike>(resource: T): T => {
    resources.add(resource);
    return resource;
  };

  // Host events delivered to this extension: a throwing or rejecting listener is
  // logged against the extension and never reaches other listeners or the UI.
  const guard = <T>(event: omnigent.Event<T>, name: string): omnigent.Event<T> => {
    return (listener, thisArgs, disposables) => {
      if (disposed) {
        refuse(name);
        return new Disposable(() => {});
      }
      const subscription = event((data) => {
        // A host event already being delivered when the extension was torn down.
        if (disposed) return;
        try {
          const result: unknown = listener.call(thisArgs, data);
          // By shape: zone.js replaces the global Promise, so instanceof misses async listeners.
          if (isThenable(result)) {
            result.then(undefined, (error: unknown) =>
              logError(`${name} listener rejected`, error),
            );
          }
        } catch (error) {
          logError(`${name} listener threw`, error);
        }
      });
      const tracked = track(
        new Disposable(() => {
          resources.delete(tracked);
          subscription.dispose();
        }),
      );
      if (Array.isArray(disposables)) disposables.push(tracked);
      return tracked;
    };
  };

  function createSessionHeaderItem(
    idOrAlignment?: string | omnigent.SessionHeaderItemAlignment,
    alignmentOrPriority?: omnigent.SessionHeaderItemAlignment | number,
    priority?: number,
  ): omnigent.SessionHeaderItem {
    const hasId = typeof idOrAlignment === "string";
    const id = hasId ? idOrAlignment : undefined;
    const alignment = hasId ? alignmentOrPriority : idOrAlignment;
    const itemPriority = hasId ? priority : alignmentOrPriority;
    if (disposed) {
      refuse("createSessionHeaderItem");
      return inertSessionHeaderItem(extensionId, id, alignment, itemPriority);
    }
    const item = services.headerItems.create(extensionId, id, alignment, itemPriority);
    const dispose = item.dispose;
    item.dispose = () => {
      resources.delete(item);
      dispose();
    };
    return track(item);
  }

  const onDidChangeActiveSession = guard(
    services.sessions.onDidChangeActiveSession,
    "onDidChangeActiveSession",
  );
  const onDidChangeUsage = guard(services.sessions.onDidChangeUsage, "onDidChangeUsage");
  const onDidChangeChangedFiles = guard(
    services.workspace.onDidChangeChangedFiles,
    "onDidChangeChangedFiles",
  );
  const onDidChangeActiveSessionId = guard(
    services.workspace.onDidChangeActiveSessionId,
    "onDidChangeActiveSessionId",
  );
  const onDidChangeConfiguration = guard(
    services.workspace.onDidChangeConfiguration,
    "onDidChangeConfiguration",
  );
  const onDidChangeFiles = guard(services.workspace.onDidChangeFiles, "onDidChangeFiles");
  const onDidChangeActiveSessionTree = guard(
    services.sessionTree.onDidChangeActiveSessionTree,
    "onDidChangeActiveSessionTree",
  );
  const onDidChangeChildSessions = guard(
    services.sessionTree.onDidChangeChildSessions,
    "onDidChangeChildSessions",
  );
  const onDidChangeActiveSessionTasks = guard(
    services.tasks.onDidChangeActiveSessionTasks,
    "onDidChangeActiveSessionTasks",
  );

  function watchActiveSessionTasks(): omnigent.Disposable {
    if (disposed) {
      refuse("watchActiveSessionTasks");
      return new Disposable(() => {});
    }
    const watch = services.tasks.watch();
    const tracked = track(
      new Disposable(() => {
        resources.delete(tracked);
        watch.dispose();
      }),
    );
    return tracked;
  }

  function createPlanView(viewId: string): omnigent.PlanView {
    if (disposed) {
      refuse("createPlanView");
      return {
        content: { kind: "loading", label: "" },
        visible: false,
        onDidChangeVisibility: () => new Disposable(() => {}),
        dispose: () => {},
      };
    }
    const view = services.views.createPlanView(extensionId, viewId, logError);
    const dispose = view.dispose;
    view.dispose = () => {
      resources.delete(view);
      dispose();
    };
    return track(view);
  }

  const onDidChangeActiveSessionPullRequests = guard(
    services.pullRequests.onDidChangeActiveSessionPullRequests,
    "onDidChangeActiveSessionPullRequests",
  );

  function watchActiveSessionPullRequests(): omnigent.PullRequestsWatch {
    if (disposed) {
      refuse("watchActiveSessionPullRequests");
      return { focus: undefined, dispose: () => {} };
    }
    const watch = services.pullRequests.watch();
    const dispose = watch.dispose;
    watch.dispose = () => {
      resources.delete(watch);
      dispose();
    };
    return track(watch);
  }

  function createPullRequestView(viewId: string): omnigent.PullRequestView {
    if (disposed) {
      refuse("createPullRequestView");
      return {
        content: { kind: "loading" },
        visible: false,
        onDidChangeVisibility: () => new Disposable(() => {}),
        dispose: () => {},
      };
    }
    const view = services.views.createPullRequestView(extensionId, viewId, logError);
    const dispose = view.dispose;
    view.dispose = () => {
      resources.delete(view);
      dispose();
    };
    return track(view);
  }

  function registerHostProvider(provider: omnigent.GitHostProvider): omnigent.Disposable {
    if (disposed) {
      refuse("registerHostProvider");
      return new Disposable(() => {});
    }
    if (
      typeof provider !== "object" ||
      provider === null ||
      typeof provider.id !== "string" ||
      provider.id === "" ||
      typeof provider.matchUrl !== "function"
    ) {
      throw new TypeError("a git host provider needs an id and a matchUrl function");
    }
    const id = provider.id;
    const matchUrl = provider.matchUrl.bind(provider);
    const unregister = services.gitHosts.register({
      id,
      matchUrl: (url) => {
        const result = matchUrl(url);
        if (isThenable(result)) {
          logError(`git host provider ${id} returned a promise; matchUrl must answer at once`);
          return undefined;
        }
        return result;
      },
    });
    const tracked = track(
      new Disposable(() => {
        resources.delete(tracked);
        unregister();
      }),
    );
    return tracked;
  }

  function createTreeView<T>(
    viewId: string,
    options: omnigent.TreeViewOptions<T>,
  ): omnigent.TreeView<T> {
    if (disposed) {
      refuse("createTreeView");
      return {
        title: undefined,
        description: undefined,
        message: undefined,
        messageSeverity: undefined,
        notice: undefined,
        tag: undefined,
        badge: undefined,
        visible: false,
        onDidChangeVisibility: () => new Disposable(() => {}),
        filter: "",
        onDidChangeFilter: () => new Disposable(() => {}),
        setFilter: () => {},
        filterFields: Object.freeze({}),
        selection: Object.freeze([]),
        onDidChangeSelection: () => new Disposable(() => {}),
        reveal: () => Promise.reject(new Error("the extension was deactivated")),
        location: undefined,
        onDidChangeLocation: () => new Disposable(() => {}),
        searchInput: undefined,
        presentation: "tree",
        dispose: () => {},
      };
    }
    const view = services.views.createTreeView(extensionId, viewId, options, logError);
    const dispose = view.dispose;
    view.dispose = () => {
      resources.delete(view);
      dispose();
    };
    return track(view);
  }
  const reportEmitterError = (error: unknown) => logError("EventEmitter listener threw", error);

  // Progress this extension shows; a Node command's progress joins the latest one.
  const openProgress: ProgressReporter[] = [];
  const trackProgress = (progress: ProgressReporter) => {
    openProgress.push(progress);
    return () => {
      const index = openProgress.lastIndexOf(progress);
      if (index >= 0) openProgress.splice(index, 1);
    };
  };

  function withProgress<R>(
    options: omnigent.ProgressOptions,
    task: (progress: omnigent.Progress<omnigent.ProgressReport>) => R | Promise<R>,
  ): Promise<R> {
    if (disposed) {
      refuse("withProgress");
      return Promise.reject(new Error("the extension was deactivated"));
    }
    const title = typeof options?.title === "string" && options.title ? options.title : extensionId;
    const location = options?.location as { viewId?: unknown; hostId?: unknown } | undefined;
    const hostId = location?.hostId;
    if (hostId !== undefined) {
      if (typeof hostId !== "string" || !hostId) {
        return Promise.reject(new Error("withProgress: location.hostId must be a host id"));
      }
      // Inline at the host, as VS Code's window progress; a failure is not shown there.
      const handle = services.hostProgress.begin(hostId, title);
      const progress: omnigent.Progress<omnigent.ProgressReport> = Object.freeze({
        report(value: omnigent.ProgressReport) {
          if (typeof value?.message === "string") handle.report(value.message);
        },
      });
      const untrack = trackProgress(progress);
      let result: R | Promise<R>;
      try {
        result = task(progress);
      } catch (error) {
        untrack();
        handle.end();
        return Promise.reject(error);
      }
      return Promise.resolve(result).finally(() => {
        untrack();
        handle.end();
      });
    }
    const viewId = location?.viewId;
    if (typeof viewId === "string") {
      let end: () => void;
      try {
        end = services.views.beginProgress(extensionId, viewId, title);
      } catch (error) {
        return Promise.reject(error);
      }
      const report: omnigent.Progress<omnigent.ProgressReport> = { report: () => {} };
      let result: R | Promise<R>;
      try {
        result = task(report);
      } catch (error) {
        end();
        return Promise.reject(error);
      }
      return Promise.resolve(result).finally(end);
    }
    return runWithProgress(services.notifications, title, task, trackProgress);
  }

  function registerCommand(
    id: string,
    handler: (...args: never[]) => unknown,
  ): omnigent.Disposable {
    if (disposed) {
      refuse("registerCommand");
      return new Disposable(() => {});
    }
    const registration = services.commands.register(extensionId, id, handler as CommandHandler, {
      builtIn,
    });
    const tracked = track(
      new Disposable(() => {
        resources.delete(tracked);
        registration.dispose();
      }),
    );
    return tracked;
  }

  /** Shows a Node command's progress in this extension's latest progress, or its own. */
  const nodeProgressSink = () => {
    const notifications = new Map<number, ProgressNotification>();
    const onProgress = (event: NodeProgressEvent) => {
      const joined = openProgress.at(-1);
      if (joined) {
        if (event.kind === "report") {
          joined.report({ message: event.message, increment: event.increment });
        }
        return;
      }
      if (event.kind === "start") {
        notifications.set(
          event.scope,
          services.notifications.openProgress(event.title || extensionId),
        );
      } else if (event.kind === "report") {
        notifications.get(event.scope)?.report(event.message);
      } else {
        notifications.get(event.scope)?.close(event.error);
        notifications.delete(event.scope);
      }
    };
    const closeAll = () => {
      for (const notification of notifications.values()) notification.close();
      notifications.clear();
    };
    return { onProgress, closeAll };
  };

  async function executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    if (disposed) {
      refuse("executeCommand");
      throw new Error("the extension was deactivated");
    }
    const sink = nodeProgressSink();
    try {
      return (await services.commands.execute(id, args, sink.onProgress)) as T;
    } finally {
      sink.closeAll();
    }
  }

  let reconnectProviders = 0;
  function registerReconnectProvider(
    provider: omnigent.HostReconnectProvider,
  ): omnigent.Disposable {
    if (disposed) {
      refuse("registerReconnectProvider");
      return new Disposable(() => {});
    }
    reconnectProviders += 1;
    const providerId = `${extensionId}.hostReconnect#${reconnectProviders}`;
    const plainHost = (host: ReconnectHost): omnigent.ReconnectHost =>
      Object.freeze({
        hostId: host.hostId,
        name: host.name,
        status: host.status,
        sandboxProvider: host.sandboxProvider,
        resumable: host.resumable,
      });
    // One reconnect per host at a time; a second click joins it, and its progress
    // goes to every caller's reporter (the host shows it inline at the host).
    const running = new Map<
      string,
      { result: Promise<void | ReconnectOutcome>; reporters: Set<ProgressReporter>; last?: string }
    >();
    const unregister = services.hostReconnect.registry.register(providerId, {
      canReconnect: (host) => !disposed && provider.canReconnect(plainHost(host)),
      reconnect: (host, session) => {
        const existing = running.get(host.hostId);
        if (existing) {
          existing.reporters.add(session.progress);
          if (existing.last !== undefined) session.progress.report({ message: existing.last });
          return existing.result;
        }
        const entry: {
          result: Promise<void | ReconnectOutcome>;
          reporters: Set<ProgressReporter>;
          last?: string;
        } = { result: Promise.resolve(), reporters: new Set([session.progress]) };
        const progress: ProgressReporter = Object.freeze({
          report(value: ProgressReport) {
            if (typeof value?.message !== "string") return;
            entry.last = value.message;
            for (const reporter of entry.reporters) reporter.report({ message: value.message });
          },
        });
        // A Node command's progress joins this reconnect's.
        const untrack = trackProgress(progress);
        entry.result = (async () => {
          const outcome = await provider.reconnect(plainHost(host), progress);
          services.hostReconnect.onReconnected?.();
          const detail = (outcome as { detail?: unknown } | undefined)?.detail;
          return typeof detail === "string" && detail ? { detail: detail.slice(0, 2000) } : {};
        })().finally(() => {
          untrack();
          running.delete(host.hostId);
        });
        running.set(host.hostId, entry);
        return entry.result;
      },
    });
    const tracked = track(
      new Disposable(() => {
        resources.delete(tracked);
        unregister();
      }),
    );
    return tracked;
  }

  function showMessage(kind: "info" | "error", message: string): Promise<undefined> {
    if (disposed) {
      refuse(kind === "info" ? "showInformationMessage" : "showErrorMessage");
    } else {
      services.notifications[kind](String(message));
    }
    return Promise.resolve(undefined);
  }

  const api: OmnigentApi = {
    version: OMNIGENT_API_VERSION,
    Disposable,
    // Extension-created emitters report listener errors against this extension.
    EventEmitter: class<T> extends EventEmitter<T> {
      constructor() {
        super(reportEmitterError);
      }
    },
    SessionHeaderItemAlignment,
    TreeItemCollapsibleState:
      TreeItemCollapsibleState as unknown as typeof omnigent.TreeItemCollapsibleState,
    window: Object.freeze({
      createSessionHeaderItem,
      createTreeView,
      createPlanView,
      createPullRequestView,
      withProgress,
      showInformationMessage: (message: string) => showMessage("info", message),
      showErrorMessage: (message: string) => showMessage("error", message),
    }),
    commands: Object.freeze({ registerCommand, executeCommand }),
    hosts: Object.freeze({ registerReconnectProvider }),
    git: Object.freeze({
      registerHostProvider,
      matchPullRequestUrl: (url: string) => {
        const match = services.gitHosts.match(String(url));
        return match ? Object.freeze({ ...match }) : undefined;
      },
    }),
    pullRequests: Object.freeze({
      get activeSessionPullRequests() {
        return services.pullRequests.activeSessionPullRequests;
      },
      onDidChangeActiveSessionPullRequests,
      watchActiveSessionPullRequests,
    }),
    workspace: Object.freeze({
      get activeSessionId() {
        return services.workspace.activeSessionId;
      },
      getChangedFiles: () => services.workspace.getChangedFiles(),
      get changedFilesError() {
        return services.workspace.changedFilesError;
      },
      get availability() {
        return services.workspace.availability;
      },
      get servedFromHost() {
        return services.workspace.servedFromHost;
      },
      onDidChangeChangedFiles,
      onDidChangeActiveSessionId,
      getConfiguration: (section?: string) => services.workspace.getConfiguration(section),
      onDidChangeConfiguration,
      findTextInFiles: (
        query: omnigent.TextSearchQuery,
        options?: omnigent.FindTextInFilesOptions,
        token?: omnigent.CancellationToken,
      ) => {
        if (disposed) {
          refuse("findTextInFiles");
          return Promise.reject(new Error("the extension was deactivated"));
        }
        return services.workspace.findTextInFiles(query, options, token);
      },
      validateTextSearchQuery: (query: omnigent.TextSearchQuery) => textSearchQueryProblem(query),
      get rootPath() {
        return services.workspace.rootPath;
      },
      fs: Object.freeze({
        readDirectory: (path: string) => {
          if (disposed) {
            refuse("readDirectory");
            return Promise.reject(new Error("the extension was deactivated"));
          }
          return services.workspace.readDirectory(path);
        },
      }),
      findFiles: (query: omnigent.FileSearchQuery, token?: omnigent.CancellationToken) => {
        if (disposed) {
          refuse("findFiles");
          return Promise.reject(new Error("the extension was deactivated"));
        }
        return services.workspace.findFiles(query, token);
      },
      onDidChangeFiles,
    }),
    sessions: Object.freeze({
      get activeSession() {
        return services.sessions.activeSession;
      },
      get activeSessionUsage() {
        return services.sessions.activeSessionUsage;
      },
      onDidChangeActiveSession,
      onDidChangeUsage,
      get activeSessionTreeRoot() {
        return services.sessionTree.activeSessionTreeRoot;
      },
      onDidChangeActiveSessionTree,
      getChildSessions: (sessionId: string) => services.sessionTree.getChildSessions(sessionId),
      getSession: (sessionId: string) => services.sessionTree.getSession(sessionId),
      onDidChangeChildSessions,
      get activeSessionTasks() {
        return services.tasks.activeSessionTasks;
      },
      onDidChangeActiveSessionTasks,
      watchActiveSessionTasks,
    }),
    CancellationTokenSource,
  };

  return {
    api: Object.freeze(api),
    dispose: () => {
      disposed = true;
      const owned = [...resources];
      resources.clear();
      disposeAll(owned, (error) => logError("dispose failed", error));
    },
  };
}
