// The window's extension host, shipped in every build: it activates the built-in
// extensions at startup, and the dev loader adds dev-path extensions to the same
// host. Built-ins load from the bundle, so their views register before the first
// render and core tabs never show a blank panel.
import { builtInExtensions } from "@/builtinExtensions";
import { refreshRunnerHealth } from "@/hooks/useRunnerHealth";
import { type GitHostProviderRegistry, gitHostProviders } from "@/lib/gitHostProviders";
import { hostProgress } from "@/lib/hostProgress";
import { hostReconnectProviders } from "@/lib/hostReconnectProviders";
import { type RailViewRegistry, railViews } from "@/shell/railViews";
import { type WorkspaceBridge, workspaceBridge } from "@/shell/workspaceBridge";
import { registerBuiltInCommands } from "./builtinCommands";
import { CommandRegistry } from "./commands";
import { Disposable } from "./base";
import { ContextKeyService } from "./contextKeys";
import { KeybindingService } from "./keybindings";
import { type ExtensionDescription, ExtensionHost, type ExtensionHostOptions } from "./host";
import { toastNotifications } from "./progress";
import { sessionHeaderItems } from "./sessionHeaderItems";
import { chatStoreSessionSource, SessionsService } from "./sessionsService";
import { SessionTreeService } from "./sessionTreeService";
import { PullRequestsService } from "./pullRequestsService";
import { TasksService } from "./tasksService";
import { ViewsService } from "./viewsService";
import { WorkspaceService } from "./workspaceService";

export interface ExtensionRuntime {
  readonly host: ExtensionHost;
  readonly commands: CommandRegistry;
  readonly contextKeys: ContextKeyService;
  readonly workspace: WorkspaceService;
  /** Resolves once the built-in extensions settled. */
  readonly builtInsStarted: Promise<void>;
  dispose: () => Promise<void>;
}

export interface ExtensionRuntimeOptions {
  registry?: RailViewRegistry;
  bridge?: WorkspaceBridge;
  builtIns?: readonly ExtensionDescription[];
  /** The window's git host providers by default. */
  gitHosts?: GitHostProviderRegistry;
  hostOptions?: Partial<ExtensionHostOptions>;
}

/** Builds the host and its services, and starts the built-in extensions. */
export function createExtensionRuntime(options: ExtensionRuntimeOptions = {}): ExtensionRuntime {
  const registry = options.registry ?? railViews;
  const bridge = options.bridge ?? workspaceBridge;
  const commands = new CommandRegistry();
  const contextKeys = new ContextKeyService();
  const workspace = new WorkspaceService(bridge);
  const builtInCommands = registerBuiltInCommands(commands, { contextKeys, workspace: bridge });
  // `config.<setting>` context keys, as in VS Code, so `when` and `toggled` can read settings.
  const syncSettings = () => {
    for (const [name, value] of Object.entries(workspace.settingValues())) {
      contextKeys.setHost(`config.${name}`, value);
    }
  };
  syncSettings();
  const settingsSubscription = workspace.onDidChangeConfiguration(syncSettings);
  const views = new ViewsService({
    registry,
    contextKeys,
    executeCommand: (command, args) => commands.execute(command, args, () => {}),
    showError: (message) => toastNotifications.error(message),
    workspace,
    // VS Code's `<view>.focus`: the workspace on screen shows the view's tab and focuses it.
    registerFocusCommand: (extensionId, command, viewId, builtIn) =>
      commands.register(extensionId, command, () => bridge.rail()?.reveal(viewId) ?? false, {
        builtIn,
      }),
  });
  // `view.<id>.available` while the workspace on screen can show that view's tab.
  let availableViews = new Set<string>();
  const syncAvailableViews = () => {
    const next = new Set(bridge.rail()?.views ?? []);
    for (const viewId of availableViews) {
      if (!next.has(viewId)) contextKeys.setHost(`view.${viewId}.available`, undefined);
    }
    for (const viewId of next) contextKeys.setHost(`view.${viewId}.available`, true);
    availableViews = next;
  };
  syncAvailableViews();
  const railSubscription = new Disposable(bridge.subscribeRails(syncAvailableViews));
  const keybindings = new KeybindingService({
    contextKeys,
    executeCommand: (command) => commands.execute(command, [], () => {}),
    logError: (message, error) => console.error(`[omnigent-extensions] ${message}`, error),
  });
  const sessionTree = new SessionTreeService(bridge);
  const tasks = new TasksService(bridge);
  const pullRequests = new PullRequestsService(bridge);
  const sessions = new SessionsService(chatStoreSessionSource());
  const host = new ExtensionHost({
    services: {
      headerItems: sessionHeaderItems,
      sessions,
      commands,
      notifications: toastNotifications,
      hostReconnect: { registry: hostReconnectProviders, onReconnected: refreshRunnerHealth },
      hostProgress,
      views,
      workspace,
      sessionTree,
      tasks,
      pullRequests,
      gitHosts: options.gitHosts ?? gitHostProviders,
      keybindings,
    },
    ...options.hostOptions,
  });
  // The shell runs built-in commands (such as `omnigent.revealInFiles`) through its bridge;
  // an extension's commands, in the page or on the Node side, are not the shell's to run.
  bridge.setCommandRunner((command, args) => commands.executeBuiltIn(command, args));
  const builtInsStarted = host.start(options.builtIns ?? builtInExtensions());
  return {
    host,
    commands,
    contextKeys,
    workspace,
    builtInsStarted,
    dispose: async () => {
      bridge.setCommandRunner(null);
      await host.dispose();
      builtInCommands.dispose();
      settingsSubscription.dispose();
      railSubscription.dispose();
      keybindings.dispose();
      views.dispose();
      workspace.dispose();
      sessionTree.dispose();
      tasks.dispose();
      pullRequests.dispose();
      sessions.dispose();
    },
  };
}

// The window's one runtime, shared by the standalone app and every embedded
// OmnigentApp on the page. The standalone app keeps it for the page's lifetime;
// embeds hold it while mounted, and the last one to unmount disposes it.
let runtime: ExtensionRuntime | undefined;
/** Set once a caller keeps the runtime for the page's lifetime. */
let pinned = false;
/** Mounted embeds holding the runtime. */
let holds = 0;
let disposeTimer: ReturnType<typeof setTimeout> | undefined;
/** A disposal still removing the previous runtime's views. */
let disposing: Promise<void> | undefined;
/** Created after `disposing` settles, for a hold taken meanwhile. */
let restarting = false;

function ensureRuntime(): void {
  if (runtime || restarting) return;
  if (!disposing) {
    runtime = createExtensionRuntime();
    return;
  }
  // The previous runtime's views keep their ids until its disposal finishes, so
  // the next one starts after it; a restored extension tab waits meanwhile.
  restarting = true;
  const viewsLoaded = railViews.beginLoading();
  void disposing.finally(() => {
    restarting = false;
    if (holds > 0 || pinned) runtime ??= createExtensionRuntime();
    viewsLoaded();
  });
}

function cancelScheduledDispose(): void {
  if (disposeTimer === undefined) return;
  clearTimeout(disposeTimer);
  disposeTimer = undefined;
}

/**
 * The window's extension runtime, kept for the page's lifetime; created, with
 * the built-ins started, on first call. For the standalone app and the dev loader.
 */
export function startExtensionHost(): ExtensionRuntime {
  pinned = true;
  cancelScheduledDispose();
  if (!runtime) {
    if (disposing) throw new Error("the extension host is still being disposed");
    runtime = createExtensionRuntime();
  }
  return runtime;
}

/**
 * Starts the window's extension runtime, with the built-ins, unless it already
 * runs. Idempotent and synchronous, so a caller can run it before its first
 * render and the built-in views are registered by then. It takes no hold: pair
 * it with {@link retainExtensionHost}.
 */
export function ensureExtensionHost(): void {
  cancelScheduledDispose();
  ensureRuntime();
}

/**
 * Holds the window's extension runtime, starting it if needed, until the
 * returned release runs. When the last hold is released and nothing keeps the
 * runtime for the page's lifetime, it is disposed after the current task, so an
 * immediate remount (React StrictMode, a host re-rendering its route) reuses it.
 */
export function retainExtensionHost(): () => void {
  holds += 1;
  ensureExtensionHost();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds > 0 || pinned) return;
    cancelScheduledDispose();
    disposeTimer = setTimeout(() => {
      disposeTimer = undefined;
      if (holds > 0 || pinned || !runtime) return;
      const current = runtime;
      runtime = undefined;
      const done = current.dispose().catch((error: unknown) => {
        console.error("[omnigent-extensions] could not dispose the extension host", error);
      });
      disposing = done;
      void done.finally(() => {
        if (disposing === done) disposing = undefined;
      });
    }, 0);
  };
}

/** The window's runtime, if one runs. */
export function currentExtensionHost(): ExtensionRuntime | undefined {
  return runtime;
}
