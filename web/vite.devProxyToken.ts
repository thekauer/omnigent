// Databricks CLI token cache for the dev server's backend proxy.
//
// The CLI is run asynchronously, at most once at a time, so a slow or hanging
// `databricks auth token` never blocks the dev server: while a refresh runs,
// requests keep the cached token, and only a request with no usable token waits.

import { spawn } from "node:child_process";

// CLI-minted OAuth tokens are short-lived (about an hour), so a long-running dev
// server re-fetches shortly before expiry instead of caching one forever.
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
// Used when the CLI omits an expiry.
export const TOKEN_FALLBACK_TTL_MS = 5 * 60 * 1000;
// Back-off after a failed lookup, so a missing login doesn't run the CLI on every request.
export const TOKEN_FAILURE_RETRY_MS = 30 * 1000;
// The CLI's own limit (its default is an hour, which covers a browser login).
export const CLI_TIMEOUT = "30s";
// Backstop for a CLI that ignores its --timeout: the call fails then, whatever the CLI does.
export const CLI_KILL_TIMEOUT_MS = 35_000;
// After the backstop's SIGTERM, a CLI that is still running gets SIGKILL.
export const CLI_KILL_GRACE_MS = 2000;
const CLI_MAX_OUTPUT_BYTES = 1024 * 1024;

export interface CliToken {
  value: string | null;
  /** Epoch ms; NaN when the CLI reported no expiry. */
  expiresAt: number;
}

/** Runs `databricks <args>` and returns its stdout. */
export type RunCli = (args: string[]) => Promise<string>;

export interface CliRunnerOptions {
  command?: string;
  timeoutMs?: number;
  killGraceMs?: number;
}

/**
 * A RunCli that settles by its own timer: unlike execFile's timeout, which
 * waits for the child to close, a CLI that ignores SIGTERM (or a grandchild
 * holding its stdout) cannot keep the call pending.
 */
export function createCliRunner({
  command = "databricks",
  timeoutMs = CLI_KILL_TIMEOUT_MS,
  killGraceMs = CLI_KILL_GRACE_MS,
}: CliRunnerOptions = {}): RunCli {
  return (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = (error: Error | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(Buffer.concat(chunks).toString("utf8"));
      };
      const kill = (reason: string) => {
        finish(new Error(`${command} ${reason}`));
        child.kill("SIGTERM");
        const force = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }, killGraceMs);
        force.unref();
      };
      const timer = setTimeout(() => kill(`timed out after ${timeoutMs}ms`), timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > CLI_MAX_OUTPUT_BYTES) kill("printed more than 1 MiB");
        else chunks.push(chunk);
      });
      child.on("error", (error) => finish(error));
      child.on("close", (code, signal) => {
        if (code === 0) finish(undefined);
        else finish(new Error(`${command} exited (${signal ?? `code ${code}`})`));
      });
    });
}

export const runDatabricksCli: RunCli = createCliRunner();

export interface DevProxyTokenOptions {
  /** `--host`, plus `--profile` when one is selected. */
  authArgs: string[];
  runCli?: RunCli;
  now?: () => number;
}

interface CachedToken {
  value: string | null;
  refreshAt: number;
  /** Epoch ms after which the value must not be sent; Infinity when unknown. */
  expiresAt: number;
  fetchedAt: number;
}

export class DevProxyToken {
  private readonly authArgs: string[];
  private readonly runCli: RunCli;
  private readonly now: () => number;
  private cached: CachedToken | undefined;
  private inFlight: Promise<string | null> | undefined;
  private forceNext = false;

  constructor(options: DevProxyTokenOptions) {
    this.authArgs = options.authArgs;
    this.runCli = options.runCli ?? runDatabricksCli;
    this.now = options.now ?? Date.now;
  }

  /**
   * The token to send now, without waiting. Starts a background refresh when the
   * cached one is due; a token past its expiry is never returned.
   */
  current(): string | null {
    if (this.refreshDue()) void this.refresh();
    const cached = this.cached;
    if (!cached || this.now() >= cached.expiresAt) return null;
    return cached.value;
  }

  /** A usable token, waiting for the CLI only when none is cached (or it expired). */
  async ensure(): Promise<string | null> {
    const usable = this.current();
    if (usable !== null) return usable;
    if (this.cached && !this.refreshDue() && this.inFlight === undefined) return null;
    return this.refresh();
  }

  /** A 401 means the token was revoked or expired early: refresh it, at most once per back-off. */
  invalidateAfter401(): void {
    if (!this.cached) return;
    if (this.now() - this.cached.fetchedAt < TOKEN_FAILURE_RETRY_MS) return;
    this.forceNext = true;
  }

  private refreshDue(): boolean {
    return !this.cached || this.forceNext || this.now() >= this.cached.refreshAt;
  }

  /** One shared refresh; concurrent callers join it. */
  refresh(): Promise<string | null> {
    this.inFlight ??= this.fetchAndCache().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async fetchToken(forceRefresh: boolean): Promise<CliToken> {
    const args = ["auth", "token", ...this.authArgs, "--output", "json", "--timeout", CLI_TIMEOUT];
    const output = await this.runCli(forceRefresh ? [...args, "--force-refresh"] : args);
    const response = JSON.parse(output) as { access_token?: string; expiry?: string };
    const expiresAt = response.expiry ? Date.parse(response.expiry) : Number.NaN;
    return { value: response.access_token ?? null, expiresAt };
  }

  private async fetchAndCache(): Promise<string | null> {
    const forced = this.forceNext;
    this.forceNext = false;
    try {
      let token = await this.fetchToken(forced);
      // The CLI can hand back a cached token already inside the refresh margin;
      // mint a fresh one once rather than serving it until it expires.
      if (
        !forced &&
        token.value &&
        Number.isFinite(token.expiresAt) &&
        token.expiresAt - TOKEN_REFRESH_MARGIN_MS <= this.now()
      ) {
        try {
          token = await this.fetchToken(true);
        } catch {
          // Keep the nearly-expired token; the next request past refreshAt retries.
        }
      }
      // Retry times count from when the CLI answered, not from when it was asked.
      const answeredAt = this.now();
      const { value, expiresAt } = token;
      const refreshAt = !value
        ? answeredAt + TOKEN_FAILURE_RETRY_MS
        : Number.isFinite(expiresAt)
          ? Math.max(answeredAt + TOKEN_FAILURE_RETRY_MS, expiresAt - TOKEN_REFRESH_MARGIN_MS)
          : answeredAt + TOKEN_FALLBACK_TTL_MS;
      this.cached = {
        value,
        refreshAt,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : Number.POSITIVE_INFINITY,
        fetchedAt: answeredAt,
      };
    } catch {
      // Keep serving a still-valid token after a failed refresh.
      const answeredAt = this.now();
      const previous = this.cached;
      this.cached =
        previous && previous.value && answeredAt < previous.expiresAt
          ? { ...previous, refreshAt: answeredAt + TOKEN_FAILURE_RETRY_MS }
          : {
              value: null,
              refreshAt: answeredAt + TOKEN_FAILURE_RETRY_MS,
              expiresAt: Number.POSITIVE_INFINITY,
              fetchedAt: answeredAt,
            };
    }
    return this.current();
  }
}

export interface StartupCheck {
  /** Resolves the first token; waits for the CLI (see DevProxyToken.ensure). */
  ensure: () => Promise<string | null>;
  /** Asks the CLI again regardless of the failure back-off (DevProxyToken.refresh). */
  retry: () => Promise<string | null>;
  /** This process already started a dev server (Vite is restarting it, say after a config edit). */
  restarted: boolean;
}

/**
 * Whether the dev server may start: it waits for the first CLI answer, retries
 * a failed lookup once, and never stops a restarting server, whose requests
 * keep retrying the token, over a lookup that failed this time.
 */
export async function checkStartupToken({
  ensure,
  retry,
  restarted,
}: StartupCheck): Promise<"authenticated" | "keep-running" | "exit"> {
  let token = await ensure();
  if (!token) token = await retry();
  if (token) return "authenticated";
  return restarted ? "keep-running" : "exit";
}
