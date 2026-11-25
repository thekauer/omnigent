// Host services for tests: real registries, recorded notifications.
import { HostProgressLocations } from "@/lib/hostProgress";
import { HostReconnectProviderRegistry } from "@/lib/hostReconnectProviders";
import type { HostServices } from "./api";
import { CommandRegistry } from "./commands";
import type { Notifications } from "./progress";
import { SessionHeaderItemRegistry } from "./sessionHeaderItems";
import { SessionsService } from "./sessionsService";
import { SessionTreeService } from "./sessionTreeService";
import { GitHostProviderRegistry } from "@/lib/gitHostProviders";
import { PullRequestsService } from "./pullRequestsService";
import { TasksService } from "./tasksService";
import { RailViewRegistry } from "@/shell/railViews";
import { WorkspaceBridge } from "@/shell/workspaceBridge";
import { ContextKeyService } from "./contextKeys";
import { ViewsService } from "./viewsService";
import { WorkspaceService } from "./workspaceService";

export interface RecordedNotification {
  kind: "progress" | "info" | "error";
  title: string;
  messages: (string | undefined)[];
  closed: boolean;
  error?: string;
}

/** Notifications that record what an extension showed. */
export function recordingNotifications(): Notifications & { shown: RecordedNotification[] } {
  const shown: RecordedNotification[] = [];
  return {
    shown,
    openProgress(title) {
      const entry: RecordedNotification = { kind: "progress", title, messages: [], closed: false };
      shown.push(entry);
      return {
        report(message) {
          if (!entry.closed) entry.messages.push(message);
        },
        close(error) {
          if (entry.closed) return;
          entry.closed = true;
          if (error !== undefined) entry.error = error;
        },
      };
    },
    info(message) {
      shown.push({ kind: "info", title: message, messages: [], closed: true });
    },
    error(message) {
      shown.push({ kind: "error", title: message, messages: [], closed: true });
    },
  };
}

const emptySessions = () =>
  new SessionsService({
    getState: () => ({
      sessionId: null,
      totalCostUsd: null,
      costHidden: false,
      usageByModel: null,
    }),
    subscribe: () => () => {},
  });

/** Views over their own registry and context keys, running commands through `commands`. */
export function testViewsService(
  commands: CommandRegistry,
  options: {
    registry?: RailViewRegistry;
    contextKeys?: ContextKeyService;
    showError?: (message: string) => void;
  } = {},
): ViewsService {
  return new ViewsService({
    registry: options.registry ?? new RailViewRegistry(),
    contextKeys: options.contextKeys ?? new ContextKeyService(),
    executeCommand: (command, args) => commands.execute(command, args, () => {}),
    showError: options.showError ?? (() => {}),
  });
}

export function hostServices(overrides: Partial<HostServices> = {}): HostServices {
  const commands = overrides.commands ?? new CommandRegistry();
  return {
    headerItems: overrides.headerItems ?? new SessionHeaderItemRegistry(),
    sessions: overrides.sessions ?? emptySessions(),
    commands,
    notifications: overrides.notifications ?? recordingNotifications(),
    hostReconnect: overrides.hostReconnect ?? { registry: new HostReconnectProviderRegistry() },
    hostProgress: overrides.hostProgress ?? new HostProgressLocations(),
    views: overrides.views ?? testViewsService(commands),
    workspace: overrides.workspace ?? new WorkspaceService(new WorkspaceBridge()),
    sessionTree: overrides.sessionTree ?? new SessionTreeService(new WorkspaceBridge()),
    tasks: overrides.tasks ?? new TasksService(new WorkspaceBridge()),
    pullRequests: overrides.pullRequests ?? new PullRequestsService(new WorkspaceBridge()),
    gitHosts: overrides.gitHosts ?? new GitHostProviderRegistry(),
    ...(overrides.keybindings ? { keybindings: overrides.keybindings } : {}),
    ...(overrides.themes ? { themes: overrides.themes } : {}),
    ...(overrides.colorThemes ? { colorThemes: overrides.colorThemes } : {}),
  };
}
