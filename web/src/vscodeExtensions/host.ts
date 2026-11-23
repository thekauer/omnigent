// In-page extension host: loads each extension's browser entry, calls its
// `activate(context)` and, on teardown, `deactivate()` plus its subscriptions.
import type * as omnigent from "omnigent";
import { disposeAll } from "./base";
import { createExtensionApi, type ExtensionApiHandle, type HostServices } from "./api";
import { registerExtensionApi } from "./apiRegistry";

/** One extension as the dev plugin describes it (plain data). */
export interface ExtensionDescription {
  readonly id: string;
  readonly version: string;
  readonly activationEvents: readonly string[];
  /** URL the browser entry is imported from. */
  readonly entryUrl: string;
}

interface ExtensionModule {
  activate?: (context: omnigent.ExtensionContext) => unknown;
  deactivate?: () => unknown;
}

interface ActiveExtension {
  module: ExtensionModule;
  context: omnigent.ExtensionContext;
  apiHandle: ExtensionApiHandle;
  unregisterApi: () => void;
}

type LoadOutcome =
  | { kind: "activated"; module: ExtensionModule }
  | { kind: "load-failed" | "activate-failed"; error: unknown }
  | { kind: "no-activate" }
  /** The race was already over (timeout, cancel) when loading finished. */
  | { kind: "abandoned" };

export type ActivationResult = "activated" | "failed" | "skipped";

const SUPPORTED_ACTIVATION_EVENTS = new Set(["*", "onStartupFinished"]);
/** How long `activate` may take before the activation counts as failed (as in the V1 view host). */
export const ACTIVATION_TIMEOUT_MS = 10_000;
/**
 * How long loading the entry and its imports may take. Longer than the activate
 * budget: a page's long-lived streams can hold most of the browser's HTTP/1.1
 * connections, so entries start loading at boot, before those streams open.
 */
export const LOAD_TIMEOUT_MS = 20_000;

export interface ExtensionHostOptions {
  services: HostServices;
  importModule?: (url: string) => Promise<unknown>;
  /** Resolves once the page has finished starting; gates `onStartupFinished`. */
  whenStartupFinished?: () => Promise<void>;
  console?: Pick<Console, "error" | "warn" | "info">;
  activationTimeoutMs?: number;
  loadTimeoutMs?: number;
}

function defaultWhenStartupFinished(): Promise<void> {
  return new Promise((resolve) => {
    const settle = () => setTimeout(resolve, 0);
    if (typeof document === "undefined" || document.readyState === "complete") settle();
    else window.addEventListener("load", settle, { once: true });
  });
}

export class ExtensionHost {
  private readonly services: HostServices;
  private readonly importModule: (url: string) => Promise<unknown>;
  private readonly whenStartupFinished: () => Promise<void>;
  private readonly log: Pick<Console, "error" | "warn" | "info">;
  private readonly activationTimeoutMs: number;
  private readonly loadTimeoutMs: number;
  private readonly active = new Map<string, ActiveExtension>();
  private readonly activating = new Map<string, Promise<ActivationResult>>();
  /**
   * Ids that started an activation in this page. The browser caches an entry
   * module bound to its first API instance, so an id is never activated twice.
   */
  private readonly attempted = new Set<string>();
  /** Ids whose deactivate (or timed-out activation's late cleanup) has not finished. */
  private readonly settling = new Set<string>();
  /** Cancels activations still loading or activating when the host is disposed. */
  private readonly cancelPending = new Set<() => void>();
  private disposed = false;

  constructor(options: ExtensionHostOptions) {
    this.services = options.services;
    this.importModule = options.importModule ?? ((url) => import(/* @vite-ignore */ url));
    this.whenStartupFinished = options.whenStartupFinished ?? defaultWhenStartupFinished;
    this.log = options.console ?? console;
    this.activationTimeoutMs = options.activationTimeoutMs ?? ACTIVATION_TIMEOUT_MS;
    this.loadTimeoutMs = options.loadTimeoutMs ?? LOAD_TIMEOUT_MS;
  }

  isActive(extensionId: string): boolean {
    return this.active.has(extensionId);
  }

  /** Activates `*` extensions now and `onStartupFinished` ones once startup is done. */
  async start(extensions: readonly ExtensionDescription[]): Promise<void> {
    const eager: ExtensionDescription[] = [];
    const afterStartup: ExtensionDescription[] = [];
    for (const extension of extensions) {
      const events = extension.activationEvents;
      for (const event of events) {
        if (!SUPPORTED_ACTIVATION_EVENTS.has(event)) {
          this.log.warn(
            `[omnigent-extensions] ${extension.id}: activation event "${event}" is not supported yet; ignoring it`,
          );
        }
      }
      if (events.includes("*")) eager.push(extension);
      else if (events.includes("onStartupFinished")) afterStartup.push(extension);
      else {
        this.log.warn(
          `[omnigent-extensions] ${extension.id}: no supported activation event; not activating it`,
        );
      }
    }
    const eagerRuns = eager.map((extension) => this.activate(extension));
    if (afterStartup.length === 0) {
      await Promise.all(eagerRuns);
      return;
    }
    // Entries of later extensions start loading now, before the page opens its
    // long-lived streams: HTTP/1.1 allows about six connections per origin, and
    // module requests made later queue behind those streams. Only `activate`
    // waits for the activation event.
    const startupFinished = Promise.all(eagerRuns).then(() => this.whenStartupFinished());
    await Promise.all([
      ...eagerRuns,
      ...afterStartup.map((extension) => this.activate(extension, startupFinished)),
    ]);
  }

  /**
   * Loads `extension` and activates it, once `activateAfter` (if given) resolves.
   * Loading starts at once either way.
   */
  activate(
    extension: ExtensionDescription,
    activateAfter?: Promise<unknown>,
  ): Promise<ActivationResult> {
    if (this.active.has(extension.id)) return Promise.resolve("skipped");
    const pending = this.activating.get(extension.id);
    if (pending) return pending;
    const refuse = (why: string): Promise<ActivationResult> => {
      this.log.warn(`[omnigent-extensions] ${extension.id}: ${why}; not activating it`);
      return Promise.resolve("skipped");
    };
    if (this.disposed) return refuse("the extension host was disposed");
    if (this.settling.has(extension.id)) {
      return refuse("its previous activation is still being torn down");
    }
    if (this.attempted.has(extension.id)) {
      return refuse(
        "it was already activated once in this page and its cached entry module is bound to the old API; reload the page to activate it again",
      );
    }
    this.attempted.add(extension.id);
    const activation = this.doActivate(extension, activateAfter).finally(() =>
      this.activating.delete(extension.id),
    );
    this.activating.set(extension.id, activation);
    return activation;
  }

  private async doActivate(
    extension: ExtensionDescription,
    activateAfter: Promise<unknown> | undefined,
  ): Promise<ActivationResult> {
    const logError = (message: string, error?: unknown) =>
      this.log.error(`[omnigent-extensions] ${extension.id}: ${message}`, error);
    const apiHandle = createExtensionApi(extension.id, this.services, logError);
    // Registered before the import: the entry's `import "omnigent"` looks it up.
    const unregisterApi = registerExtensionApi(extension.id, apiHandle.api);
    const context: omnigent.ExtensionContext = Object.freeze({
      subscriptions: [],
      extension: Object.freeze({ id: extension.id, version: extension.version }),
    });
    const cleanUp = () => {
      disposeAll(context.subscriptions, (error) => logError("dispose failed", error));
      context.subscriptions.length = 0;
      apiHandle.dispose();
    };
    const fail = (message: string, error?: unknown): ActivationResult => {
      logError(message, error);
      cleanUp();
      unregisterApi();
      return "failed";
    };

    // Loading has its own timeout, so a top-level await that never settles does
    // not hold up start() or the extensions after it either.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timeoutMessage = "";
    let raced = false;
    let armTimeout!: (ms: number, message: string) => void;
    const disarmTimeout = () => clearTimeout(timer);
    const timedOut = new Promise<"timeout">((resolve) => {
      armTimeout = (ms, message) => {
        if (raced) return;
        clearTimeout(timer);
        timeoutMessage = message;
        timer = setTimeout(() => resolve("timeout"), ms);
      };
    });
    armTimeout(
      this.loadTimeoutMs,
      `failed to load ${extension.entryUrl}: timed out after ${this.loadTimeoutMs}ms`,
    );
    const run: Promise<LoadOutcome> = (async () => {
      let module: ExtensionModule;
      try {
        module = (await this.importModule(extension.entryUrl)) as ExtensionModule;
      } catch (error) {
        return { kind: "load-failed", error };
      }
      // The load timed out or the host was disposed meanwhile: never activate late.
      if (raced) return { kind: "abandoned" };
      if (typeof module.activate !== "function") return { kind: "no-activate" };
      if (activateAfter !== undefined) {
        // Waiting for the activation event is not part of either budget.
        disarmTimeout();
        await activateAfter;
        if (raced) return { kind: "abandoned" };
      }
      armTimeout(
        this.activationTimeoutMs,
        `activate timed out after ${this.activationTimeoutMs}ms`,
      );
      try {
        await module.activate(context);
      } catch (error) {
        return { kind: "activate-failed", error };
      }
      return { kind: "activated", module };
    })();
    let cancel!: () => void;
    const cancelled = new Promise<"cancelled">((resolve) => {
      cancel = () => resolve("cancelled");
    });
    this.cancelPending.add(cancel);
    const outcome = await Promise.race([run, timedOut, cancelled]);
    raced = true;
    clearTimeout(timer);
    this.cancelPending.delete(cancel);

    if (outcome === "timeout" || outcome === "cancelled" || this.disposed) {
      // A late finish must not leave anything behind: tear down what it created
      // then, and keep the id blocked until it has.
      this.settling.add(extension.id);
      void run
        .then(async (late) => {
          if (late.kind !== "activated") return;
          try {
            await late.module.deactivate?.();
          } catch (error) {
            logError("deactivate failed", error);
          }
        })
        .finally(() => {
          cleanUp();
          this.settling.delete(extension.id);
        });
      if (outcome === "timeout") {
        return fail(timeoutMessage);
      }
      this.log.warn(
        `[omnigent-extensions] ${extension.id}: the extension host was disposed during activation; cleaning it up`,
      );
      cleanUp();
      unregisterApi();
      return "skipped";
    }
    switch (outcome.kind) {
      case "load-failed":
        return fail(`failed to load ${extension.entryUrl}`, outcome.error);
      case "no-activate":
        return fail("browser entry does not export an activate function");
      case "activate-failed":
        return fail("activate failed", outcome.error);
      case "abandoned":
        // Unreachable: `run` only reports this after the race was decided.
        cleanUp();
        unregisterApi();
        return "skipped";
    }
    this.active.set(extension.id, { module: outcome.module, context, apiHandle, unregisterApi });
    this.log.info(`[omnigent-extensions] activated ${extension.id} ${extension.version}`);
    return "activated";
  }

  async deactivate(extensionId: string): Promise<void> {
    const extension = this.active.get(extensionId);
    if (!extension) return;
    this.active.delete(extensionId);
    this.settling.add(extensionId);
    const logError = (message: string, error?: unknown) =>
      this.log.error(`[omnigent-extensions] ${extensionId}: ${message}`, error);
    try {
      await extension.module.deactivate?.();
    } catch (error) {
      logError("deactivate failed", error);
    } finally {
      disposeAll(extension.context.subscriptions, (error) => logError("dispose failed", error));
      extension.context.subscriptions.length = 0;
      extension.apiHandle.dispose();
      extension.unregisterApi();
      this.settling.delete(extensionId);
    }
  }

  /** Deactivates every active extension and cancels activations still in progress. */
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const cancel of [...this.cancelPending]) cancel();
    await Promise.all([...this.activating.values()]);
    await Promise.all([...this.active.keys()].map((id) => this.deactivate(id)));
  }
}
