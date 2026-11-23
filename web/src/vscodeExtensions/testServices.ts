// Host services for tests: real registries, recorded notifications.
import { HostReconnectProviderRegistry } from "@/lib/hostReconnectProviders";
import type { HostServices } from "./api";
import { CommandRegistry } from "./commands";
import type { Notifications } from "./progress";
import { SessionHeaderItemRegistry } from "./sessionHeaderItems";
import { SessionsService } from "./sessionsService";

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

export function hostServices(overrides: Partial<HostServices> = {}): HostServices {
  return {
    headerItems: overrides.headerItems ?? new SessionHeaderItemRegistry(),
    sessions: overrides.sessions ?? emptySessions(),
    commands: overrides.commands ?? new CommandRegistry(),
    notifications: overrides.notifications ?? recordingNotifications(),
    hostReconnect: overrides.hostReconnect ?? { registry: new HostReconnectProviderRegistry() },
  };
}
