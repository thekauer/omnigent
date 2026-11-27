// The window's extension host, shipped in every build: it activates the built-in
// extensions at startup, and the dev loader adds dev-path extensions to the same
// host. Built-ins load from the bundle, so their views register before the first
// render and core tabs never show a blank panel.
import { builtInExtensions } from "@/builtinExtensions";
import { registerLayoutCommands } from "@/workbench/layoutCommands";
import { type LayoutService, layoutService } from "@/workbench/layoutService";
import { type WorkbenchContext, workbenchContext } from "@/workbench/workbenchContext";
import type { ViewContainerRegistry } from "@/workbench/viewContainers";
import {
  type ConfigurationService,
  configurationService,
} from "@/configuration/configurationService";
import { refreshRunnerHealth } from "@/hooks/useRunnerHealth";
import { type GitHostProviderRegistry, gitHostProviders } from "@/lib/gitHostProviders";
import { hostProgress } from "@/lib/hostProgress";
import { hostReconnectProviders } from "@/lib/hostReconnectProviders";
import { type RailViewRegistry, railViews } from "@/shell/railViews";
import { type WorkspaceBridge, workspaceBridge } from "@/shell/workspaceBridge";
import { type ThemeContributionSink, themeService } from "@/theme/themeService";
import { registerBuiltInCommands } from "./builtinCommands";
import { CommandRegistry } from "./commands";
import { Disposable } from "./base";
import { ContextKeyService } from "./contextKeys";
import { type KeybindingScope, KeybindingService } from "./keybindings";
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
  /** Where contributed keybindings dispatch; the whole window by default. */
  keybindingScope?: KeybindingScope;
  /** The workbench the layout commands change; the window's by default. */
  layout?: LayoutService;
  /** Where contributed settings go; the window's configuration service by default. */
  configuration?: ConfigurationService;
  /** Where contributed view containers go; the window's by default. */
  containers?: ViewContainerRegistry;
  /** The shell's context keys mirrored into the runtime's; the window's by default. */
  workbenchContext?: WorkbenchContext;
  /** Where contributed themes go; the window's theme service by default. */
  themes?: ThemeContributionSink & { markStarted?: () => void };
}

/** Builds the host and its services, and starts the built-in extensions. */
export function createExtensionRuntime(options: ExtensionRuntimeOptions = {}): ExtensionRuntime {
  const registry = options.registry ?? railViews;
  const bridge = options.bridge ?? workspaceBridge;
  const commands = new CommandRegistry();
  const contextKeys = new ContextKeyService();
  const workspace = new WorkspaceService(bridge, options.configuration ?? configurationService);
  const themes = options.themes ?? themeService;
  const builtInCommands = registerBuiltInCommands(commands, {
    contextKeys,
    workspace: bridge,
    themes: "select" in themes ? (themes as typeof themeService) : undefined,
  });
  // VS Code's layout commands and the parts' visibility context keys.
  const layoutCommands = registerLayoutCommands(
    commands,
    options.layout ?? layoutService,
    contextKeys,
  );
  // `config.<setting>` context keys, as in VS Code, so `when` and `toggled` can read settings.
  let settingKeys = new Set<string>();
  const syncSettings = () => {
    const next = new Set<string>();
    for (const [name, value] of Object.entries(workspace.settingValues())) {
      try {
        contextKeys.setHost(`config.${name}`, value);
        next.add(name);
      } catch {
        // A key too long for a context key: `when` can't read it, `getConfiguration` can.
      }
    }
    for (const name of settingKeys) {
      if (!next.has(name)) contextKeys.setHost(`config.${name}`, undefined);
    }
    settingKeys = next;
  };
  syncSettings();
  const settingsSubscription = workspace.onDidChangeConfiguration(syncSettings);
  // The shell's workbench keys (`omnigent.session.*`, `omnigent.serverFeature.*`).
  const shellContext = options.workbenchContext ?? workbenchContext;
  const mirrorShellContext = (keys: readonly string[]) => {
    for (const key of keys) {
      try {
        contextKeys.setHost(key, shellContext.get(key));
      } catch {
        // A key too long for a context key.
      }
    }
  };
  mirrorShellContext(Object.keys(shellContext.snapshot()));
  const shellContextSubscription = new Disposable(shellContext.subscribe(mirrorShellContext));
  const views = new ViewsService({
    registry,
    ...(options.containers ? { containers: options.containers } : {}),
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
    scope: options.keybindingScope,
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
      themes,
      configuration: options.configuration ?? configurationService,
    },
    ...options.hostOptions,
  });
  // The shell runs built-in commands (such as `omnigent.revealInFiles`) through its bridge;
  // an extension's commands, in the page or on the Node side, are not the shell's to run.
  bridge.setCommandRunner((command, args) => commands.executeBuiltIn(command, args));
  const builtInsStarted = host.start(options.builtIns ?? builtInExtensions());
  // Built-ins contribute as they start (synchronously): a theme chosen but not among
  // them, nor in an extension still loading, is unavailable from here on.
  themes.markStarted?.();
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
      layoutCommands.dispose();
      settingsSubscription.dispose();
      shellContextSubscription.dispose();
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

/**
 * How long a runtime started by {@link ensureExtensionHost} waits for a hold
 * before it is disposed. A render React discards before commit (it suspended or
 * threw) starts the runtime but never runs the effect that holds it; a render
 * that commits holds it well within this time, even when React yields between
 * render and effects.
 */
export const UNRETAINED_DISPOSE_MS = 1_000;

// Embeds share the window with their host page: their keybindings dispatch only
// from inside a mounted app root. The standalone app owns the page.
const EMBED_KEYBINDING_SCOPE = "appRoot" satisfies KeybindingScope;

function ensureRuntime(): void {
  if (runtime || restarting) return;
  if (!disposing) {
    runtime = createExtensionRuntime({ keybindingScope: EMBED_KEYBINDING_SCOPE });
    return;
  }
  // The previous runtime's views keep their ids until its disposal finishes, so
  // the next one starts after it; a restored extension tab waits meanwhile.
  restarting = true;
  const viewsLoaded = railViews.beginLoading();
  void disposing.finally(() => {
    restarting = false;
    if (holds > 0 || pinned) {
      runtime ??= createExtensionRuntime({ keybindingScope: EMBED_KEYBINDING_SCOPE });
    }
    viewsLoaded();
  });
}

function cancelScheduledDispose(): void {
  if (disposeTimer === undefined) return;
  clearTimeout(disposeTimer);
  disposeTimer = undefined;
}

/** Disposes the runtime after `delayMs` unless a hold or the page keeps it meanwhile. */
function scheduleDispose(delayMs: number): void {
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
  }, delayMs);
}

/**
 * The window's extension runtime, kept for the page's lifetime; created, with
 * the built-ins started, on first call. For the standalone app and the dev loader.
 * Its keybindings dispatch from anywhere in the window.
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
 * it with {@link retainExtensionHost}. A runtime nothing holds or keeps within
 * {@link UNRETAINED_DISPOSE_MS} is disposed. Started here, for embeds, its
 * keybindings dispatch only from inside a mounted `.omnigent-app` root.
 */
export function ensureExtensionHost(): void {
  ensureRuntime();
  if (holds > 0 || pinned) cancelScheduledDispose();
  else scheduleDispose(UNRETAINED_DISPOSE_MS);
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
    scheduleDispose(0);
  };
}

/** The window's runtime, if one runs. */
export function currentExtensionHost(): ExtensionRuntime | undefined {
  return runtime;
}
