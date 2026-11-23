// Host reconnect providers: who handles "Reconnect host" for a session's host.
// Like VS Code's remote authority resolvers, the first provider that can handle
// a host reconnects it; with none, Reconnect host keeps its default behavior.
// The built-in server wake (resumable managed hosts) is a provider too.

import { isThenable } from "./thenable";

export { isThenable };

/** The host a reconnect is asked for. Plain data. */
export interface ReconnectHost {
  readonly hostId: string;
  /** The host's name; its id when the host record is not loaded. */
  readonly name: string;
  readonly status: "online" | "offline" | "unknown";
  /** The managed sandbox provider; `null` for a user-connected host or when unknown. */
  readonly sandboxProvider: string | null;
  /** The server can resume the host (a resumable managed sandbox). */
  readonly resumable: boolean;
}

/** What Reconnect host gives a provider besides the host: the session's built-in actions. */
export interface ReconnectSession {
  readonly sessionId: string | null;
  /** Sends `retry_session` and tracks the wake as the host status dot shows it. */
  readonly wakeSandbox: () => Promise<void>;
}

export interface HostReconnectProvider {
  /** Cheap and side-effect free; also called when the host menu opens, to warm caches. */
  canReconnect: (host: ReconnectHost) => boolean | Promise<boolean>;
  reconnect: (host: ReconnectHost, session: ReconnectSession) => Promise<void>;
}

interface Registration {
  readonly id: string;
  readonly provider: HostReconnectProvider;
}

/** How long an async `canReconnect` may take before the provider is skipped. */
export const CAN_RECONNECT_TIMEOUT_MS = 5_000;

export type ProviderErrorReporter = (providerId: string, message: string, error?: unknown) => void;

const defaultReporter: ProviderErrorReporter = (providerId, message, error) => {
  console.warn(`[host-reconnect] ${providerId}: ${message}`, error);
};

export interface SelectedReconnectProvider {
  readonly id: string;
  readonly provider: HostReconnectProvider;
}

export class HostReconnectProviderRegistry {
  private readonly registrations: Registration[] = [];
  private readonly report: ProviderErrorReporter;
  private readonly timeoutMs: number;

  constructor(options: { report?: ProviderErrorReporter; canReconnectTimeoutMs?: number } = {}) {
    this.report = options.report ?? defaultReporter;
    this.timeoutMs = options.canReconnectTimeoutMs ?? CAN_RECONNECT_TIMEOUT_MS;
  }

  /** Adds `provider` after the existing ones; returns its unregister function. */
  register(id: string, provider: HostReconnectProvider): () => void {
    const registration: Registration = { id, provider };
    this.registrations.push(registration);
    return () => {
      const index = this.registrations.indexOf(registration);
      if (index >= 0) this.registrations.splice(index, 1);
    };
  }

  get size(): number {
    return this.registrations.length;
  }

  /**
   * The first provider, in registration order, whose `canReconnect` is true.
   * Synchronous while every answer is: the built-in wake decides on the click,
   * as before. A provider that throws, rejects or exceeds the timeout is
   * skipped and reported, so it cannot break the providers after it or the
   * default behavior.
   */
  select(
    host: ReconnectHost,
  ): SelectedReconnectProvider | undefined | Promise<SelectedReconnectProvider | undefined> {
    const pending = [...this.registrations];
    for (let index = 0; index < pending.length; index += 1) {
      const registration = pending[index]!;
      const answer = this.ask(registration, host);
      if (isThenable<boolean>(answer)) {
        return this.selectAsync(answer, registration, pending.slice(index + 1), host);
      }
      if (answer) return registration;
    }
    return undefined;
  }

  /** Asks every provider about `host` and drops the answers, so they can warm caches. */
  warm(host: ReconnectHost): void {
    for (const registration of [...this.registrations]) void this.ask(registration, host);
  }

  private async selectAsync(
    first: Promise<boolean>,
    firstRegistration: Registration,
    rest: Registration[],
    host: ReconnectHost,
  ): Promise<SelectedReconnectProvider | undefined> {
    if (await first) return firstRegistration;
    for (const registration of rest) {
      // In order: the first provider that says yes wins, so later ones wait.
      // oxlint-disable-next-line no-await-in-loop
      if (await this.ask(registration, host)) return registration;
    }
    return undefined;
  }

  /** The provider's answer; `false` when it throws, rejects or times out. */
  private ask(registration: Registration, host: ReconnectHost): boolean | Promise<boolean> {
    let answer: boolean | Promise<boolean>;
    try {
      answer = registration.provider.canReconnect(host);
    } catch (error) {
      this.report(registration.id, "canReconnect threw", error);
      return false;
    }
    if (!isThenable<boolean>(answer)) return answer === true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        this.report(registration.id, `canReconnect timed out after ${this.timeoutMs}ms`);
        resolve(false);
      }, this.timeoutMs);
    });
    const settled = Promise.resolve(answer).then(
      (value) => value === true,
      (error: unknown) => {
        this.report(registration.id, "canReconnect rejected", error);
        return false;
      },
    );
    return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
  }
}

/**
 * The built-in provider: the server resumes a resumable managed host's sandbox
 * and starts the agent, tracked by Reconnect host's wake state.
 */
export const serverWakeReconnectProvider: HostReconnectProvider = {
  canReconnect: (host) => host.resumable,
  reconnect: (_host, session) => session.wakeSandbox(),
};
export const SERVER_WAKE_PROVIDER_ID = "omnigent.serverWake";

/** The window's providers. The built-in one is first, so it decides on the click as before. */
export const hostReconnectProviders = new HostReconnectProviderRegistry();
hostReconnectProviders.register(SERVER_WAKE_PROVIDER_ID, serverWakeReconnectProvider);
