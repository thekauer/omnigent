// Node-side host for dev-path extensions with a `main` entry, run by the dev
// plugin (vite.omnigentExtensions.ts) as a child process, like VS Code's
// extension host process: extension code never runs in, or blocks, the dev
// server. It talks to the plugin over the fork IPC channel.
//
// `import * as omnigent from "omnigent/node"` inside an extension folder resolves
// to that extension's Node API: version, Disposable, commands.registerCommand,
// window.withProgress and window.createOutputChannel.
//
// Trust model: a Node entry is trusted local code with the developer's full
// access, as in VS Code. Nothing here sandboxes it, but like VS Code's host one
// extension's uncaught exception or process.exit() is logged against it rather
// than ending the process.

import { AsyncLocalStorage } from "node:async_hooks";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const API_VERSION = "0.1.0";
const API_URL_PREFIX = "omnigent-node-api:";
const LOAD_TIMEOUT_MS = Number(process.env.OMNIGENT_NODE_HOST_LOAD_TIMEOUT_MS) || 20_000;
const ACTIVATION_TIMEOUT_MS =
  Number(process.env.OMNIGENT_NODE_HOST_ACTIVATION_TIMEOUT_MS) || 10_000;
/** Largest command result, as JSON bytes. */
const MAX_RESULT_BYTES = Number(process.env.OMNIGENT_NODE_HOST_MAX_RESULT_BYTES) || 1024 * 1024;
/** The dev server forked this host as a process group leader (see vite.omnigentNodeExtensions.ts). */
const GROUP_LEADER = process.env.OMNIGENT_NODE_HOST_PROCESS_GROUP === "1";
/** Longest per-command timeout an extension may ask for. */
const MAX_COMMAND_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const realExit = process.exit.bind(process);

/** @type {Map<string, { id: string, version: string, directory: string }>} */
const extensions = new Map();
/** @type {Map<string, ReturnType<typeof createApi>>} */
const apis = new Map();
/** Command id to its owner, handler and optional timeout. */
/** @type {Map<string, { extensionId: string, handler: (...args: unknown[]) => unknown, timeoutMs?: number }>} */
const commands = new Map();
/** The command call (`{ callId, extensionId }`) a `withProgress` belongs to. */
const currentCall = new AsyncLocalStorage();
/** Calls the dev server gave up on (timeout, disconnect): their outcome is dropped. */
const cancelledCalls = new Set();
let progressScopes = 0;

function send(message) {
  // The dev server may be gone (a restart or shutdown); there is no one to tell.
  if (process.connected) process.send(message, undefined, {}, () => {});
}

function describeError(error) {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

function log(extensionId, level, message) {
  send({ type: "log", extensionId, level, message });
}

function isInside(file, directory) {
  const relative = path.relative(directory, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** The extension whose folder contains `parentURL`, the deepest one when nested. */
function extensionFor(parentURL) {
  if (!parentURL || !parentURL.startsWith("file:")) return undefined;
  return extensionForPath(fileURLToPath(parentURL));
}

function extensionForPath(file) {
  let best;
  for (const extension of extensions.values()) {
    if (!isInside(file, extension.directory)) continue;
    if (!best || extension.directory.length > best.directory.length) best = extension;
  }
  return best;
}

/** The extension whose file is nearest the top of `stack`, like VS Code's attribution. */
function extensionForStack(stack) {
  if (typeof stack !== "string") return undefined;
  for (const [, location] of stack.matchAll(/(file:\/\/[^\s)]+|\/[^\s():]+)/g)) {
    let file = location.replace(/(:\d+)+$/, "");
    try {
      if (file.startsWith("file:")) file = fileURLToPath(file);
    } catch {
      continue;
    }
    const extension = extensionForPath(file);
    if (extension) return extension;
  }
  return undefined;
}

/** Who to blame for `error`: its stack first, then the command call it ran in. */
function blame(error) {
  const fromStack = extensionForStack(error instanceof Error ? error.stack : undefined);
  if (fromStack) return fromStack.id;
  return currentCall.getStore()?.extensionId;
}

function describeFailure(error) {
  if (error instanceof Error) return error.stack || describeError(error);
  return String(error);
}

/** Logs a failure no command caught, against its extension when one can be named. */
function reportUncaught(kind, error) {
  const extensionId = blame(error);
  if (extensionId) log(extensionId, "error", `${kind}: ${describeFailure(error)}`);
  else console.error(`[omnigent-extensions] ${kind} in the Node host`, error);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "omnigent/node") return nextResolve(specifier, context);
    const extension = extensionFor(context.parentURL);
    if (!extension) {
      throw new Error(`"omnigent/node" can only be imported from an extension folder`);
    }
    return { url: `${API_URL_PREFIX}${encodeURIComponent(extension.id)}`, shortCircuit: true };
  },
  load(url, context, nextLoad) {
    if (!url.startsWith(API_URL_PREFIX)) return nextLoad(url, context);
    const id = decodeURIComponent(url.slice(API_URL_PREFIX.length));
    const source = [
      `const api = globalThis[Symbol.for("omnigent.nodeExtensionApis")].get(${JSON.stringify(id)});`,
      ...["version", "Disposable", "commands", "window"].map(
        (name) => `export const ${name} = api.${name};`,
      ),
      "export default api;",
    ].join("\n");
    return { format: "module", source, shortCircuit: true };
  },
});
globalThis[Symbol.for("omnigent.nodeExtensionApis")] = apis;

class Disposable {
  static from(...items) {
    let pending = items;
    return new Disposable(() => {
      const list = pending;
      pending = undefined;
      for (const item of list ?? []) {
        try {
          item.dispose();
        } catch (error) {
          console.error("[omnigent-extensions] dispose failed", error);
        }
      }
    });
  }

  constructor(callOnDispose) {
    this.callOnDispose = callOnDispose;
  }

  dispose() {
    const callback = this.callOnDispose;
    this.callOnDispose = undefined;
    return callback?.();
  }
}

function commandList(extensionId) {
  return [...commands]
    .filter(([, entry]) => entry.extensionId === extensionId)
    .map(([id]) => id)
    .sort();
}

/** Command timeouts the extension set, by command id. */
function commandTimeouts(extensionId) {
  const timeouts = {};
  for (const [id, entry] of commands) {
    if (entry.extensionId === extensionId && entry.timeoutMs !== undefined) {
      timeouts[id] = entry.timeoutMs;
    }
  }
  return timeouts;
}

function sendCommands(extensionId, type = "commands") {
  send({
    type,
    extensionId,
    commands: commandList(extensionId),
    timeouts: commandTimeouts(extensionId),
  });
}

function createApi(extension) {
  const resources = new Set();
  let disposed = false;

  /** `options.timeoutMs` replaces the dev server's default per-call timeout. */
  function registerCommand(id, handler, options) {
    if (typeof id !== "string" || id === "") throw new TypeError("command id must be a string");
    if (typeof handler !== "function") throw new TypeError("command handler must be a function");
    const timeoutMs = options?.timeoutMs;
    if (
      timeoutMs !== undefined &&
      (typeof timeoutMs !== "number" ||
        !Number.isFinite(timeoutMs) ||
        timeoutMs <= 0 ||
        timeoutMs > MAX_COMMAND_TIMEOUT_MS)
    ) {
      throw new TypeError(
        `timeoutMs must be a positive number of at most ${MAX_COMMAND_TIMEOUT_MS}`,
      );
    }
    if (disposed) {
      log(extension.id, "warn", `registerCommand(${id}) called after deactivation; ignoring it`);
      return new Disposable(() => {});
    }
    if (commands.has(id)) throw new Error(`command '${id}' already exists`);
    commands.set(id, { extensionId: extension.id, handler, timeoutMs });
    sendCommands(extension.id);
    const registration = new Disposable(() => {
      resources.delete(registration);
      if (commands.get(id)?.handler !== handler) return;
      commands.delete(id);
      sendCommands(extension.id);
    });
    resources.add(registration);
    return registration;
  }

  /** Progress inside a command call streams to the browser; outside one it is logged. */
  async function withProgress(options, task) {
    const title = typeof options?.title === "string" ? options.title : "";
    const call = currentCall.getStore();
    const scope = (progressScopes += 1);
    const emit = (event) => {
      if (call) {
        if (!cancelledCalls.has(call.callId)) {
          send({ type: "progress", callId: call.callId, event: { scope, ...event } });
        }
      } else if (event.kind === "report" && event.message) {
        log(extension.id, "info", `${title}: ${event.message}`);
      }
    };
    emit({ kind: "start", title });
    const progress = Object.freeze({
      report(value) {
        const message = typeof value?.message === "string" ? value.message : undefined;
        const increment = typeof value?.increment === "number" ? value.increment : undefined;
        emit({ kind: "report", message, increment });
      },
    });
    try {
      const result = await task(progress);
      emit({ kind: "end" });
      return result;
    } catch (error) {
      emit({ kind: "end", error: describeError(error) });
      throw error;
    }
  }

  function createOutputChannel(name) {
    const prefix = typeof name === "string" && name ? `${name}: ` : "";
    const write = (level) => (message) => log(extension.id, level, `${prefix}${String(message)}`);
    return Object.freeze({
      name: String(name),
      appendLine: write("info"),
      info: write("info"),
      warn: write("warn"),
      error: write("error"),
      dispose() {},
    });
  }

  const api = Object.freeze({
    version: API_VERSION,
    Disposable,
    commands: Object.freeze({ registerCommand }),
    window: Object.freeze({ withProgress, createOutputChannel }),
  });
  return {
    api,
    dispose() {
      disposed = true;
      const owned = [...resources];
      resources.clear();
      for (const resource of owned) resource.dispose();
    },
  };
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** @type {Map<string, { module: any, context: any, handle: ReturnType<typeof createApi> }>} */
const active = new Map();

async function activateExtension(description) {
  extensions.set(description.id, description);
  const handle = createApi(description);
  apis.set(description.id, handle.api);
  const context = Object.freeze({
    subscriptions: [],
    extension: Object.freeze({ id: description.id, version: description.version }),
  });
  const cleanUp = () => {
    for (const subscription of context.subscriptions.splice(0)) {
      try {
        subscription.dispose();
      } catch (error) {
        log(description.id, "error", `dispose failed: ${describeError(error)}`);
      }
    }
    handle.dispose();
  };
  try {
    const module = await withTimeout(
      import(pathToFileURL(description.mainPath).href),
      LOAD_TIMEOUT_MS,
      `loading ${description.mainPath} timed out after ${LOAD_TIMEOUT_MS}ms`,
    );
    if (typeof module.activate !== "function") {
      throw new Error("main entry does not export an activate function");
    }
    await withTimeout(
      Promise.resolve().then(() => module.activate(context)),
      ACTIVATION_TIMEOUT_MS,
      `activate timed out after ${ACTIVATION_TIMEOUT_MS}ms`,
    );
    active.set(description.id, { module, context, handle });
    sendCommands(description.id, "activated");
  } catch (error) {
    cleanUp();
    send({ type: "activationFailed", extensionId: description.id, error: describeError(error) });
  }
}

async function execute({ callId, extensionId, command, args }) {
  const entry = commands.get(command);
  if (!entry || entry.extensionId !== extensionId) {
    send({ type: "error", callId, message: `command '${command}' not found` });
    return;
  }
  /** @type {object} */
  let outcome;
  try {
    const value = await currentCall.run({ callId, extensionId }, () =>
      entry.handler(...(args ?? [])),
    );
    // Results cross to the browser as JSON.
    const json = value === undefined ? undefined : JSON.stringify(value);
    const bytes = json === undefined ? 0 : Buffer.byteLength(json);
    outcome =
      bytes > MAX_RESULT_BYTES
        ? {
            type: "error",
            callId,
            message: `the result of '${command}' is ${bytes} bytes, more than the ${MAX_RESULT_BYTES} byte limit`,
          }
        : { type: "result", callId, value: json === undefined ? undefined : JSON.parse(json) };
  } catch (error) {
    outcome = { type: "error", callId, message: describeError(error) };
  }
  if (cancelledCalls.delete(callId)) return;
  send(outcome);
}

/** Ends the host, taking processes its extensions started (its process group) with it. */
function exitHost(code) {
  if (GROUP_LEADER && process.platform !== "win32") {
    // The signal reaches this process too; it is leaving anyway.
    process.on("SIGTERM", () => {});
    try {
      process.kill(-process.pid, "SIGTERM");
    } catch {
      // No group to signal.
    }
  }
  realExit(code);
}

async function deactivateAll() {
  for (const [id, { module, context, handle }] of active) {
    try {
      // Extensions deactivate one after another, as they activated.
      // oxlint-disable-next-line no-await-in-loop
      await withTimeout(
        Promise.resolve().then(() => module.deactivate?.()),
        ACTIVATION_TIMEOUT_MS,
        "deactivate timed out",
      );
    } catch (error) {
      log(id, "error", `deactivate failed: ${describeError(error)}`);
    }
    for (const subscription of context.subscriptions.splice(0)) {
      try {
        subscription.dispose();
      } catch (error) {
        log(id, "error", `dispose failed: ${describeError(error)}`);
      }
    }
    handle.dispose();
  }
  active.clear();
}

process.on("message", (message) => {
  switch (message?.type) {
    case "activate":
      void Promise.all(message.extensions.map(activateExtension)).then(() =>
        send({ type: "ready" }),
      );
      break;
    case "execute":
      void execute(message);
      break;
    case "cancel":
      cancelledCalls.add(message.callId);
      break;
    case "shutdown":
      void deactivateAll().finally(() => exitHost(0));
      break;
  }
});
process.on("disconnect", () => {
  void deactivateAll().finally(() => exitHost(0));
});
// One extension's failure must not end the host for every other extension.
process.on("uncaughtException", (error) => reportUncaught("uncaught exception", error));
process.on("unhandledRejection", (error) => reportUncaught("unhandled rejection", error));
// As in VS Code, process.exit() from extension code is refused; the host keeps running.
process.exit = function exit(code) {
  const error = new Error(
    `process.exit() is not allowed in a Node extension (called with ${String(code)}); the Node extension host keeps running`,
  );
  const extensionId = blame(error);
  if (extensionId) log(extensionId, "error", `refused ${describeFailure(error)}`);
  else console.error("[omnigent-extensions] refused process.exit()", error);
  throw error;
};
send({ type: "started" });
