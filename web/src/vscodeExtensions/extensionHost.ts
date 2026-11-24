// The window's extension host, shipped in every build: it activates the built-in
// extensions at startup, and the dev loader adds dev-path extensions to the same
// host. Built-ins load from the bundle, so their views register before the first
// render and core tabs never show a blank panel.
import { builtInExtensions } from "@/builtinExtensions";
import { refreshRunnerHealth } from "@/hooks/useRunnerHealth";
import { type GitHostProviderRegistry, gitHostProviders } from "@/lib/gitHostProviders";
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
  const host = new ExtensionHost({
    services: {
      headerItems: sessionHeaderItems,
      sessions: new SessionsService(chatStoreSessionSource()),
      commands,
      notifications: toastNotifications,
      hostReconnect: { registry: hostReconnectProviders, onReconnected: refreshRunnerHealth },
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
    },
  };
}

let runtime: ExtensionRuntime | undefined;

/** The window's extension runtime; created, with the built-ins started, on first call. */
export function startExtensionHost(): ExtensionRuntime {
  runtime ??= createExtensionRuntime();
  return runtime;
}
