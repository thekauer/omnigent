// The window's extension host, shipped in every build: it activates the built-in
// extensions at startup, and the dev loader adds dev-path extensions to the same
// host. Built-ins load from the bundle, so their views register before the first
// render and core tabs never show a blank panel.
import { builtInExtensions } from "@/builtinExtensions";
import { refreshRunnerHealth } from "@/hooks/useRunnerHealth";
import { hostReconnectProviders } from "@/lib/hostReconnectProviders";
import { type RailViewRegistry, railViews } from "@/shell/railViews";
import { type WorkspaceBridge, workspaceBridge } from "@/shell/workspaceBridge";
import { registerBuiltInCommands } from "./builtinCommands";
import { CommandRegistry } from "./commands";
import { ContextKeyService } from "./contextKeys";
import { type ExtensionDescription, ExtensionHost, type ExtensionHostOptions } from "./host";
import { toastNotifications } from "./progress";
import { sessionHeaderItems } from "./sessionHeaderItems";
import { chatStoreSessionSource, SessionsService } from "./sessionsService";
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
      contextKeys.set(`config.${name}`, value);
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
    // A view coming on screen after the list failed (a 502 on the first fetch, say)
    // retries it, as the classic tab's own query did when it mounted.
    onViewShown: () => {
      if (workspace.changedFilesError === undefined) return;
      bridge.refreshChangedFiles().catch(() => {});
    },
  });
  const host = new ExtensionHost({
    services: {
      headerItems: sessionHeaderItems,
      sessions: new SessionsService(chatStoreSessionSource()),
      commands,
      notifications: toastNotifications,
      hostReconnect: { registry: hostReconnectProviders, onReconnected: refreshRunnerHealth },
      views,
      workspace,
    },
    ...options.hostOptions,
  });
  const builtInsStarted = host.start(options.builtIns ?? builtInExtensions());
  return {
    host,
    commands,
    contextKeys,
    workspace,
    builtInsStarted,
    dispose: async () => {
      await host.dispose();
      builtInCommands.dispose();
      settingsSubscription.dispose();
      views.dispose();
      workspace.dispose();
    },
  };
}

let runtime: ExtensionRuntime | undefined;

/** The window's extension runtime; created, with the built-ins started, on first call. */
export function startExtensionHost(): ExtensionRuntime {
  runtime ??= createExtensionRuntime();
  return runtime;
}
