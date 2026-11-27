// Node-side entries (`main`) of dev-path extensions, for the dev plugin in
// vite.omnigentExtensions.ts: a child-process host that runs them, and the
// dev-only endpoint the page calls their commands through.
//
// Trust model: a Node entry is trusted local code, like a VS Code extension's
// `main`. The endpoint's guards keep other sites and other local users' pages
// from running its commands: a per-boot token from the virtual module, exact
// Origin and Host checks for this dev server, a JSON body cap, and only commands
// the named extension registered.

import { fork, type ChildProcess } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

export const NODE_HOST_SCRIPT = path.resolve(__dirname, "vite.omnigentNodeHost.mjs");
export const COMMAND_TOKEN_HEADER = "x-omnigent-extension-token";
/** Largest command request body, in bytes. */
export const MAX_COMMAND_BODY_BYTES = 64 * 1024;
/** How long the dev server waits for the Node host to activate every entry. */
export const NODE_HOST_READY_TIMEOUT_MS = 40_000;
const COMMAND_PATH = /^\/([^/]+)\/commands\/([^/]+)$/;

/** One extension with a Node entry, as the host process is told about it. */
export interface NodeExtensionDescription {
  id: string;
  version: string;
  directory: string;
  mainPath: string;
}

/** A `withProgress` event from a Node command, relayed to the page as NDJSON. */
export interface NodeProgressEvent {
  scope: number;
  kind: "start" | "report" | "end";
  title?: string;
  message?: string;
  increment?: number;
  error?: string;
}

type HostMessage =
  | { type: "started" | "ready" }
  | {
      type: "activated" | "commands";
      extensionId: string;
      commands: string[];
      timeouts?: Record<string, number>;
    }
  | { type: "activationFailed"; extensionId: string; error: string }
  | { type: "log"; extensionId: string; level: "info" | "warn" | "error"; message: string }
  | { type: "progress"; callId: number; event: NodeProgressEvent }
  | { type: "pong"; seq: number }
  | { type: "callStarted"; callId: number }
  | { type: "result"; callId: number; value?: unknown }
  | { type: "error"; callId: number; message: string };

interface PendingCall {
  extensionId: string;
  command: string;
  /** When the host started running it, epoch ms; unset while it is queued. */
  startedAt?: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress: (event: NodeProgressEvent) => void;
}

/** Default per-call timeout; a command may set its own when it registers. */
export const NODE_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
/** How long a requested restart waits for running commands before failing them. */
export const NODE_RESTART_GRACE_MS = 30_000;
/** First delay before restarting a host that exited on its own; it doubles per crash. */
export const NODE_RESTART_DELAY_MS = 1000;
export const NODE_MAX_RESTART_DELAY_MS = 30_000;
/** A host up this long before it crashed restarts after the first delay again. */
export const NODE_STABLE_UPTIME_MS = 60_000;
/** How often the dev server pings the host to check that its event loop is not blocked. */
export const NODE_HEARTBEAT_INTERVAL_MS = 2000;
/** Unanswered pings in a row after which the host counts as unresponsive and is killed. */
export const NODE_HEARTBEAT_MAX_MISSES = 5;
/** Grace between SIGTERM and SIGKILL for processes the extensions left behind. */
const PROCESS_GROUP_KILL_GRACE_MS = 2000;
/** The host runs as a process group leader, so its extensions' processes can be killed with it. */
const USE_PROCESS_GROUP = process.platform !== "win32";

/** `stopped`: not wanted; `restarting`: waiting to start again after a crash. */
export type NodeExtensionHostStatus = "stopped" | "starting" | "running" | "restarting";

export interface NodeExecuteOptions {
  /** Aborting fails the call (the page went away); the host drops its outcome. */
  signal?: AbortSignal;
}

export interface NodeExtensionHostOptions {
  script?: string;
  readyTimeoutMs?: number;
  /** Per-call timeout for commands that set none. */
  commandTimeoutMs?: number;
  restartGraceMs?: number;
  restartDelayMs?: number;
  maxRestartDelayMs?: number;
  stableUptimeMs?: number;
  /**
   * Heartbeat period; 0 turns the heartbeat off. Defaults to
   * OMNIGENT_NODE_HOST_HEARTBEAT_INTERVAL_MS, then NODE_HEARTBEAT_INTERVAL_MS.
   */
  heartbeatIntervalMs?: number;
  /**
   * Missed pings that make the host unresponsive. Defaults to
   * OMNIGENT_NODE_HOST_HEARTBEAT_MISSES, then NODE_HEARTBEAT_MAX_MISSES.
   */
  heartbeatMaxMisses?: number;
  /** Extra environment for the host process (tests). */
  env?: NodeJS.ProcessEnv;
  log?: Pick<Console, "log" | "warn" | "error">;
}

const LOG_PREFIX = "[omnigent-extensions] node host:";

/** A non-negative integer from the environment, or `fallback` when unset or invalid. */
function envCount(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

/** Calls `onLine` once per complete line of `stream`, and for a last unterminated one at its end. */
function forEachLine(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): void {
  if (!stream) return;
  stream.setEncoding("utf8");
  let partial = "";
  stream.on("data", (chunk: string) => {
    const lines = (partial + chunk).split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) if (line) onLine(line);
  });
  stream.on("end", () => {
    if (partial) onLine(partial);
    partial = "";
  });
}

/** Signals the process group `pid` leads, then kills what is left of it after a grace. */
function killProcessGroup(pid: number | undefined): void {
  if (!USE_PROCESS_GROUP || pid === undefined) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return; // The group is already gone.
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Everything exited on SIGTERM.
    }
  }, PROCESS_GROUP_KILL_GRACE_MS);
  timer.unref();
}

/**
 * Runs the Node entries in one child process. A crash or a hung entry never
 * takes the dev server down: calls in flight fail, a host that exits on its own
 * restarts with backoff, and a requested restart waits for running calls only
 * for a grace period.
 */
export class NodeExtensionHost {
  private readonly script: string;
  private readonly readyTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly restartGraceMs: number;
  private readonly restartDelayMs: number;
  private readonly maxRestartDelayMs: number;
  private readonly stableUptimeMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatMaxMisses: number;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly log: Pick<Console, "log" | "warn" | "error">;
  private child: ChildProcess | undefined;
  private childReady = false;
  private extensions: readonly NodeExtensionDescription[] = [];
  private readonly commandsByExtension = new Map<string, string[]>();
  private readonly commandTimeouts = new Map<string, number>();
  private readonly pending = new Map<number, PendingCall>();
  private nextCallId = 1;
  private readyPromise: Promise<void> = Promise.resolve();
  /** Crashes since the last stable run, for the restart backoff. */
  private crashes = 0;
  private crashRestartTimer: ReturnType<typeof setTimeout> | undefined;
  private restartDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  private restartGraceTimer: ReturnType<typeof setTimeout> | undefined;
  /** A requested restart is waiting for running calls to finish. */
  private restartWaiting = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  /** Pings to the current host since its last answer. */
  private unansweredPings = 0;
  /** When the oldest of those pings was sent, epoch ms. */
  private firstUnansweredPingAt = 0;

  constructor(options: NodeExtensionHostOptions = {}) {
    this.script = options.script ?? NODE_HOST_SCRIPT;
    this.readyTimeoutMs = options.readyTimeoutMs ?? NODE_HOST_READY_TIMEOUT_MS;
    this.commandTimeoutMs = options.commandTimeoutMs ?? NODE_COMMAND_TIMEOUT_MS;
    this.restartGraceMs = options.restartGraceMs ?? NODE_RESTART_GRACE_MS;
    this.restartDelayMs = options.restartDelayMs ?? NODE_RESTART_DELAY_MS;
    this.maxRestartDelayMs = options.maxRestartDelayMs ?? NODE_MAX_RESTART_DELAY_MS;
    this.stableUptimeMs = options.stableUptimeMs ?? NODE_STABLE_UPTIME_MS;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ??
      envCount("OMNIGENT_NODE_HOST_HEARTBEAT_INTERVAL_MS", NODE_HEARTBEAT_INTERVAL_MS);
    this.heartbeatMaxMisses = Math.max(
      1,
      options.heartbeatMaxMisses ??
        envCount("OMNIGENT_NODE_HOST_HEARTBEAT_MISSES", NODE_HEARTBEAT_MAX_MISSES),
    );
    this.env = options.env;
    this.log = options.log ?? console;
  }

  /** Resolves once every entry activated or failed (or the host gave up waiting). */
  get ready(): Promise<void> {
    return this.readyPromise;
  }

  get running(): boolean {
    return this.child !== undefined;
  }

  get status(): NodeExtensionHostStatus {
    if (this.child !== undefined) return this.childReady ? "running" : "starting";
    return this.crashRestartTimer === undefined ? "stopped" : "restarting";
  }

  get callsInFlight(): number {
    return this.pending.size;
  }

  /** The commands `extensionId` registered on the Node side, sorted. */
  commandsOf(extensionId: string): readonly string[] {
    return this.commandsByExtension.get(extensionId) ?? [];
  }

  /** Every extension's Node commands, for the page. */
  allCommands(): Record<string, string[]> {
    return Object.fromEntries(
      [...this.commandsByExtension].filter(([, commands]) => commands.length > 0),
    );
  }

  /** Starts (or restarts) the host for `extensions`, failing calls in flight. */
  start(
    extensions: readonly NodeExtensionDescription[],
    reason = "the Node extension host was stopped",
  ): Promise<void> {
    this.stop(reason);
    this.extensions = extensions;
    this.crashes = 0;
    if (extensions.length === 0) {
      this.readyPromise = Promise.resolve();
      return this.readyPromise;
    }
    return this.launch();
  }

  private launch(): Promise<void> {
    const extensions = this.extensions;
    const child = fork(this.script, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: [],
      env: {
        ...process.env,
        ...(USE_PROCESS_GROUP ? { OMNIGENT_NODE_HOST_PROCESS_GROUP: "1" } : {}),
        ...this.env,
      },
      serialization: "json",
      // Its own process group, so processes its extensions start die with it.
      detached: USE_PROCESS_GROUP,
    });
    this.child = child;
    this.childReady = false;
    const startedAt = Date.now();
    forEachLine(child.stdout, (line) => this.log.log(`${LOG_PREFIX} ${line}`));
    forEachLine(child.stderr, (line) => this.log.error(`${LOG_PREFIX} ${line}`));

    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      markReady = () => {
        if (this.child === child && !this.childReady) {
          this.childReady = true;
          this.startHeartbeat(child, startedAt, markReady);
        }
        resolve();
      };
    });
    const timer = setTimeout(() => {
      this.log.error(`${LOG_PREFIX} entries not activated after ${this.readyTimeoutMs}ms`);
      markReady();
    }, this.readyTimeoutMs);
    this.readyPromise = ready.finally(() => clearTimeout(timer));

    child.on("message", (message: HostMessage) => {
      if (this.child !== child) return;
      this.onMessage(message, markReady);
    });
    child.on("error", (error) => {
      this.log.error(`${LOG_PREFIX} ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      killProcessGroup(child.pid);
      if (this.child !== child) return;
      this.stopHeartbeat();
      this.child = undefined;
      this.childReady = false;
      this.clearCommands();
      markReady();
      this.log.error(`${LOG_PREFIX} exited unexpectedly (${signal ?? `code ${code}`})`);
      this.failPending("the Node extension host exited");
      this.scheduleCrashRestart(Date.now() - startedAt);
    });
    child.send({ type: "activate", extensions });
    return this.readyPromise;
  }

  /**
   * Pings the host every interval once its entries are activated, like VS Code's
   * unresponsive extension host detection: a host whose event loop stays blocked
   * (a command busy-looping, say) for `heartbeatMaxMisses` pings is killed with
   * its process group and restarted, so it cannot wedge every other extension.
   */
  private startHeartbeat(child: ChildProcess, startedAt: number, markReady: () => void): void {
    this.stopHeartbeat();
    this.unansweredPings = 0;
    if (this.heartbeatIntervalMs <= 0) return;
    let seq = 0;
    this.heartbeatTimer = setInterval(() => {
      if (this.child !== child || !child.connected) return;
      if (this.unansweredPings >= this.heartbeatMaxMisses) {
        this.killUnresponsive(child, startedAt, markReady);
        return;
      }
      if (this.unansweredPings === 0) this.firstUnansweredPingAt = Date.now();
      this.unansweredPings += 1;
      seq += 1;
      child.send({ type: "ping", seq });
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.unansweredPings = 0;
  }

  /** Kills a host that stopped answering pings, fails its calls and restarts it with backoff. */
  private killUnresponsive(child: ChildProcess, startedAt: number, markReady: () => void): void {
    const silentMs = Date.now() - this.firstUnansweredPingAt;
    const misses = this.unansweredPings;
    this.stopHeartbeat();
    // The host runs one handler at a time to its first await, so a handler that
    // blocks it is the call it started last: list started calls newest first.
    const now = Date.now();
    const calls = [...this.pending.values()];
    const describe = (call: PendingCall) => `${call.extensionId}: ${call.command}`;
    const running = calls
      .filter((call) => call.startedAt !== undefined)
      .sort((a, b) => b.startedAt! - a.startedAt!)
      .map((call) => `${describe(call)} (for ${now - call.startedAt!}ms)`);
    const queued = calls.filter((call) => call.startedAt === undefined).map(describe);
    const blamed =
      (running.length > 0
        ? `while running ${running.join(", ")}`
        : "with no command running (activation or extension timer code)") +
      (queued.length > 0 ? `, with ${queued.join(", ")} queued` : "");
    this.log.error(
      `${LOG_PREFIX} not responding for ${silentMs}ms (${misses} heartbeats missed) ${blamed}; killing it`,
    );
    this.child = undefined;
    this.childReady = false;
    this.clearCommands();
    markReady();
    if (USE_PROCESS_GROUP && child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The group is already gone.
      }
    }
    child.kill("SIGKILL");
    this.failPending(
      `the Node extension host stopped responding for ${silentMs}ms ${blamed} and was killed; it restarts automatically`,
    );
    this.scheduleCrashRestart(Date.now() - startedAt);
  }

  /** Starts the host again after it exited on its own, waiting longer after each quick crash. */
  private scheduleCrashRestart(uptimeMs: number): void {
    if (uptimeMs >= this.stableUptimeMs) this.crashes = 0;
    const delay = Math.min(this.restartDelayMs * 2 ** this.crashes, this.maxRestartDelayMs);
    this.crashes += 1;
    this.log.error(`${LOG_PREFIX} restarting in ${delay}ms`);
    this.crashRestartTimer = setTimeout(() => {
      this.crashRestartTimer = undefined;
      void this.launch();
    }, delay);
  }

  private clearCommands(): void {
    this.commandsByExtension.clear();
    this.commandTimeouts.clear();
  }

  private setCommands(
    extensionId: string,
    commands: string[],
    timeouts: Record<string, number> = {},
  ): void {
    for (const command of this.commandsByExtension.get(extensionId) ?? []) {
      this.commandTimeouts.delete(command);
    }
    this.commandsByExtension.set(extensionId, commands);
    for (const [command, timeoutMs] of Object.entries(timeouts)) {
      this.commandTimeouts.set(command, timeoutMs);
    }
  }

  private onMessage(message: HostMessage, markReady: () => void): void {
    switch (message.type) {
      case "ready":
        markReady();
        return;
      case "activated":
        this.setCommands(message.extensionId, message.commands, message.timeouts);
        this.log.log(`[omnigent-extensions] activated ${message.extensionId} (node)`);
        return;
      case "commands":
        this.setCommands(message.extensionId, message.commands, message.timeouts);
        return;
      case "activationFailed":
        this.setCommands(message.extensionId, []);
        this.commandsByExtension.delete(message.extensionId);
        this.log.error(
          `[omnigent-extensions] ${message.extensionId} (node): activation failed: ${message.error}`,
        );
        return;
      case "log": {
        const line = `[omnigent-extensions] ${message.extensionId} (node): ${message.message}`;
        if (message.level === "error") this.log.error(line);
        else if (message.level === "warn") this.log.warn(line);
        else this.log.log(line);
        return;
      }
      case "progress":
        this.pending.get(message.callId)?.onProgress(message.event);
        return;
      case "result":
      case "error": {
        const call = this.pending.get(message.callId);
        if (!call) return;
        this.pending.delete(message.callId);
        if (message.type === "result") call.resolve(message.value);
        else call.reject(new Error(message.message));
        return;
      }
      case "pong":
        this.unansweredPings = 0;
        return;
      case "callStarted": {
        const call = this.pending.get(message.callId);
        if (call) call.startedAt = Date.now();
        return;
      }
      case "started":
        return;
    }
  }

  /** Runs `command`, which `extensionId` must have registered. */
  execute(
    extensionId: string,
    command: string,
    args: unknown[],
    onProgress: (event: NodeProgressEvent) => void = () => {},
    options: NodeExecuteOptions = {},
  ): Promise<unknown> {
    const child = this.child;
    if (!child || !child.connected) {
      return Promise.reject(new Error("the Node extension host is not running"));
    }
    if (!this.commandsOf(extensionId).includes(command)) {
      return Promise.reject(new Error(`command '${command}' not found`));
    }
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(new Error(`command '${command}' was cancelled`));
    const callId = this.nextCallId++;
    const timeoutMs = this.commandTimeouts.get(command) ?? this.commandTimeoutMs;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.afterCallSettled();
      };
      /** Fails the call here and tells the host to drop its outcome. */
      const abandon = (message: string) => {
        if (!this.pending.has(callId)) return;
        this.pending.delete(callId);
        if (this.child === child && child.connected) child.send({ type: "cancel", callId });
        settle();
        reject(new Error(message));
      };
      const onAbort = () => abandon(`command '${command}' was cancelled`);
      timer = setTimeout(() => {
        this.log.warn(`[omnigent-extensions] ${extensionId} (node): ${command} timed out`);
        abandon(`command '${command}' timed out after ${timeoutMs}ms`);
      }, timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(callId, {
        extensionId,
        command,
        resolve: (value) => {
          settle();
          resolve(value);
        },
        reject: (error) => {
          settle();
          reject(error);
        },
        onProgress,
      });
      child.send({ type: "execute", callId, extensionId, command, args });
    });
  }

  /**
   * Restarts the host for `extensions` after `debounceMs` without another
   * request, once no command is running, or after the grace period regardless.
   */
  scheduleRestart(extensions: readonly NodeExtensionDescription[], debounceMs: number): void {
    this.extensions = extensions;
    clearTimeout(this.restartDebounceTimer);
    this.restartDebounceTimer = setTimeout(() => {
      this.restartDebounceTimer = undefined;
      if (this.pending.size === 0) {
        this.log.log(`${LOG_PREFIX} restarting for an extension change`);
        return this.restartNow();
      }
      this.restartWaiting = true;
      this.restartGraceTimer ??= setTimeout(() => {
        this.log.warn(
          `${LOG_PREFIX} restarting with ${this.pending.size} command(s) still running after ${this.restartGraceMs}ms`,
        );
        this.restartNow("the Node extension host restarted while the command was running");
      }, this.restartGraceMs);
    }, debounceMs);
  }

  private afterCallSettled(): void {
    if (!this.restartWaiting || this.pending.size > 0) return;
    // Not inside the settling call's own stack.
    setImmediate(() => {
      if (this.restartWaiting && this.pending.size === 0) this.restartNow();
    });
  }

  private restartNow(reason?: string): void {
    void this.start(this.extensions, reason);
  }

  private cancelScheduledRestarts(): void {
    clearTimeout(this.crashRestartTimer);
    clearTimeout(this.restartDebounceTimer);
    clearTimeout(this.restartGraceTimer);
    this.crashRestartTimer = undefined;
    this.restartDebounceTimer = undefined;
    this.restartGraceTimer = undefined;
    this.restartWaiting = false;
  }

  private failPending(message: string): void {
    const calls = [...this.pending.values()];
    this.pending.clear();
    for (const call of calls) call.reject(new Error(message));
  }

  stop(reason = "the Node extension host was stopped"): void {
    this.cancelScheduledRestarts();
    this.stopHeartbeat();
    const child = this.child;
    this.child = undefined;
    this.childReady = false;
    this.clearCommands();
    this.failPending(reason);
    this.restartWaiting = false;
    if (!child) return;
    if (child.connected) {
      child.send({ type: "shutdown" });
      child.disconnect();
    }
    // A host stuck in a deactivate is killed, with its process group.
    const kill = setTimeout(() => {
      child.kill("SIGKILL");
      killProcessGroup(child.pid);
    }, 5000);
    kill.unref();
    child.once("exit", () => clearTimeout(kill));
  }
}

/** A fresh random token, generated once per dev server start. */
export function createCommandToken(): string {
  return randomBytes(32).toString("base64url");
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface CommandEndpointOptions {
  token: string;
  host: Pick<NodeExtensionHost, "commandsOf" | "execute" | "status" | "ready">;
  maxBodyBytes?: number;
}

/**
 * A loopback `Host` header, with or without a port: `localhost`, `127.0.0.1` or
 * `[::1]`, exactly as browsers send them (lower case, no trailing dot).
 */
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::([1-9][0-9]{0,4}))?$/;

/**
 * Why a request may not call this dev server's commands, or undefined when it may.
 *
 * The port is not fixed: the browser may reach the server through a forwarded
 * port (an SSH tunnel from a laptop), so the page's origin is the authority the
 * browser used, not the one the server listens on. What is required instead:
 * `Host` is a loopback name (which stops DNS rebinding, whose Host is the
 * attacker's name), and `Origin` is exactly `http://<Host>`, so the calling page
 * is the one this server served at that address. A page on another local port
 * has another Origin than the Host it sends to, and is refused.
 */
export function commandOriginRefusal(
  origin: string | undefined,
  host: string | undefined,
): string | undefined {
  const loopback = host === undefined ? null : LOOPBACK_HOST.exec(host);
  if (loopback === null || (loopback[1] !== undefined && Number(loopback[1]) > 65535)) {
    return "Host is not this dev server";
  }
  if (origin !== `http://${host}`) return "Origin is not this dev server";
  return undefined;
}

function sendJsonError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | "too-large"> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        resolve("too-large");
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!done) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

/**
 * Middleware for `POST <endpoint>/<extension id>/commands/<command id>`, mounted
 * under the dev extensions endpoint. The body is `{"args": [...]}`; the answer is
 * NDJSON: `{"type":"progress",...}` lines, then one `{"type":"result","value"}`
 * or `{"type":"error","message"}` line.
 */
export function createCommandEndpoint(options: CommandEndpointOptions) {
  const maxBodyBytes = options.maxBodyBytes ?? MAX_COMMAND_BODY_BYTES;
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const pathname = (req.url ?? "").split("?")[0] ?? "";
    const match = COMMAND_PATH.exec(pathname);
    if (!match) return next();
    let extensionId: string;
    let command: string;
    try {
      extensionId = decodeURIComponent(match[1]!);
      command = decodeURIComponent(match[2]!);
    } catch {
      return sendJsonError(res, 400, "the command path is not valid URI encoding");
    }
    void handle(req, res, extensionId, command);
  };

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    extensionId: string,
    command: string,
  ): Promise<void> {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJsonError(res, 405, "commands are run with POST");
    }
    const refusal = commandOriginRefusal(req.headers.origin, req.headers.host);
    if (refusal !== undefined) return sendJsonError(res, 403, refusal);
    const token = req.headers[COMMAND_TOKEN_HEADER];
    if (typeof token !== "string" || !sameToken(token, options.token)) {
      return sendJsonError(res, 403, "missing or wrong extension token");
    }
    const contentType = String(req.headers["content-type"] ?? "")
      .split(";")[0]
      ?.trim();
    if (contentType !== "application/json") {
      return sendJsonError(res, 415, "the body must be application/json");
    }
    if (Number(req.headers["content-length"] ?? 0) > maxBodyBytes) {
      return sendJsonError(res, 413, `the body is larger than ${maxBodyBytes} bytes`);
    }
    const body = await readBody(req, maxBodyBytes).catch(() => undefined);
    if (body === "too-large") {
      return sendJsonError(res, 413, `the body is larger than ${maxBodyBytes} bytes`);
    }
    let args: unknown[];
    try {
      const parsed: unknown = JSON.parse(body?.toString("utf8") ?? "");
      const given = (parsed as { args?: unknown } | null)?.args ?? [];
      if (!Array.isArray(given)) throw new Error("args is not an array");
      args = given;
    } catch {
      return sendJsonError(res, 400, 'the body must be JSON like {"args": [...]}');
    }
    // A host that is starting (after an edit or a crash) is waited for, up to its ready timeout.
    if (options.host.status === "starting") await options.host.ready;
    if (options.host.status === "starting" || options.host.status === "restarting") {
      return sendJsonError(res, 503, "Node extension host is not running");
    }
    if (!options.host.commandsOf(extensionId).includes(command)) {
      return sendJsonError(res, 404, `extension ${extensionId} has no Node command '${command}'`);
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-store");
    res.flushHeaders();
    const write = (line: object) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(line)}\n`);
    };
    // The page closing the request (navigation, reload) cancels the call.
    const disconnected = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) disconnected.abort();
    });
    try {
      const value = await options.host.execute(
        extensionId,
        command,
        args,
        (event) => write({ type: "progress", ...event }),
        { signal: disconnected.signal },
      );
      write(value === undefined ? { type: "result" } : { type: "result", value });
    } catch (error) {
      write({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
    res.end();
  }
}
