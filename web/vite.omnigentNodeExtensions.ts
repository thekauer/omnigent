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
  | { type: "activated" | "commands"; extensionId: string; commands: string[] }
  | { type: "activationFailed"; extensionId: string; error: string }
  | { type: "log"; extensionId: string; level: "info" | "warn" | "error"; message: string }
  | { type: "progress"; callId: number; event: NodeProgressEvent }
  | { type: "result"; callId: number; value?: unknown }
  | { type: "error"; callId: number; message: string };

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress: (event: NodeProgressEvent) => void;
}

export interface NodeExtensionHostOptions {
  script?: string;
  readyTimeoutMs?: number;
  /** Extra environment for the host process (tests). */
  env?: NodeJS.ProcessEnv;
  log?: Pick<Console, "log" | "warn" | "error">;
}

/**
 * Runs the Node entries in one child process. A crash or a hung entry never
 * takes the dev server down: calls in flight fail, and `restart` starts afresh.
 */
export class NodeExtensionHost {
  private readonly script: string;
  private readonly readyTimeoutMs: number;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly log: Pick<Console, "log" | "warn" | "error">;
  private child: ChildProcess | undefined;
  private readonly commandsByExtension = new Map<string, string[]>();
  private readonly pending = new Map<number, PendingCall>();
  private nextCallId = 1;
  private readyPromise: Promise<void> = Promise.resolve();

  constructor(options: NodeExtensionHostOptions = {}) {
    this.script = options.script ?? NODE_HOST_SCRIPT;
    this.readyTimeoutMs = options.readyTimeoutMs ?? NODE_HOST_READY_TIMEOUT_MS;
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

  start(extensions: readonly NodeExtensionDescription[]): Promise<void> {
    this.stop();
    if (extensions.length === 0) {
      this.readyPromise = Promise.resolve();
      return this.readyPromise;
    }
    const child = fork(this.script, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: [],
      env: { ...process.env, ...this.env },
      serialization: "json",
    });
    this.child = child;
    const prefix = "[omnigent-extensions] node host:";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) if (line) this.log.log(`${prefix} ${line}`);
    });
    child.stderr?.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) if (line) this.log.error(`${prefix} ${line}`);
    });

    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const timer = setTimeout(() => {
      this.log.error(`${prefix} entries not activated after ${this.readyTimeoutMs}ms`);
      markReady();
    }, this.readyTimeoutMs);
    this.readyPromise = ready.finally(() => clearTimeout(timer));

    child.on("message", (message: HostMessage) => {
      if (this.child !== child) return;
      this.onMessage(message, markReady);
    });
    child.on("error", (error) => {
      this.log.error(`${prefix} ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.commandsByExtension.clear();
      markReady();
      if (code !== 0) {
        this.log.error(`${prefix} exited (${signal ?? `code ${code}`})`);
      }
      this.failPending("the Node extension host exited");
    });
    child.send({ type: "activate", extensions });
    return this.readyPromise;
  }

  private onMessage(message: HostMessage, markReady: () => void): void {
    switch (message.type) {
      case "ready":
        markReady();
        return;
      case "activated":
        this.commandsByExtension.set(message.extensionId, message.commands);
        this.log.log(`[omnigent-extensions] activated ${message.extensionId} (node)`);
        return;
      case "commands":
        this.commandsByExtension.set(message.extensionId, message.commands);
        return;
      case "activationFailed":
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
  ): Promise<unknown> {
    const child = this.child;
    if (!child || !child.connected) {
      return Promise.reject(new Error("the Node extension host is not running"));
    }
    if (!this.commandsOf(extensionId).includes(command)) {
      return Promise.reject(new Error(`command '${command}' not found`));
    }
    const callId = this.nextCallId++;
    return new Promise((resolve, reject) => {
      this.pending.set(callId, { resolve, reject, onProgress });
      child.send({ type: "execute", callId, extensionId, command, args });
    });
  }

  private failPending(message: string): void {
    const calls = [...this.pending.values()];
    this.pending.clear();
    for (const call of calls) call.reject(new Error(message));
  }

  stop(): void {
    const child = this.child;
    this.child = undefined;
    this.commandsByExtension.clear();
    this.failPending("the Node extension host was stopped");
    if (!child) return;
    if (child.connected) {
      child.send({ type: "shutdown" });
      child.disconnect();
    }
    // A host stuck in a deactivate is killed.
    const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
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
  host: Pick<NodeExtensionHost, "commandsOf" | "execute">;
  /** The port the dev server listens on, read per request. */
  port: () => number | undefined;
  maxBodyBytes?: number;
}

/** Hosts a request for this dev server may name, in Origin and Host. */
function allowedAuthorities(port: number): Set<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
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
    void handle(req, res, decodeURIComponent(match[1]!), decodeURIComponent(match[2]!));
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
    const port = options.port();
    const authorities = port === undefined ? new Set<string>() : allowedAuthorities(port);
    const origin = req.headers.origin;
    let originAuthority: string | undefined;
    try {
      const parsed = origin === undefined ? undefined : new URL(origin);
      originAuthority = parsed?.protocol === "http:" ? parsed.host : undefined;
    } catch {
      originAuthority = undefined;
    }
    if (originAuthority === undefined || !authorities.has(originAuthority)) {
      return sendJsonError(res, 403, "Origin is not this dev server");
    }
    if (!authorities.has(req.headers.host ?? "")) {
      return sendJsonError(res, 403, "Host is not this dev server");
    }
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
    try {
      const value = await options.host.execute(extensionId, command, args, (event) =>
        write({ type: "progress", ...event }),
      );
      write(value === undefined ? { type: "result" } : { type: "result", value });
    } catch (error) {
      write({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
    res.end();
  }
}
