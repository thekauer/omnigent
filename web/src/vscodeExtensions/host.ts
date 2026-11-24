// In-page extension host: loads each extension's browser entry, calls its
// `activate(context)` and, on teardown, `deactivate()` plus its subscriptions.
import type * as omnigent from "omnigent";
import { disposeAll } from "./base";
import { createExtensionApi, type ExtensionApiHandle, type HostServices } from "./api";
import { registerExtensionApi } from "./apiRegistry";
import { BUILT_IN_RAIL_TABS } from "@/shell/railTabs";
import { parseContributions } from "./contributions";
import {
  createWorkspaceState,
  type ExtensionStateStore,
  sessionExtensionStateStore,
} from "./memento";

/** One extension as the dev plugin describes it (plain data). */
export interface ExtensionDescription {
  readonly id: string;
  readonly version: string;
  readonly activationEvents: readonly string[];
  /** URL the browser entry is imported from, or where a built-in's module lives. */
  readonly entryUrl: string;
  /** Loads the entry instead of importing `entryUrl` (built-in extensions). */
  readonly load?: () => Promise<unknown>;
  /**
   * Ships with the app: no load timeout (the module is part of the bundle), a
   * generous activation timeout, and views that show an error state if it fails.
   */
  readonly builtIn?: boolean;
  /** The manifest's `contributes`, unchecked. */
  readonly contributes?: unknown;
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
/** The activation budget of a built-in extension, which core UI depends on. */
export const BUILT_IN_ACTIVATION_TIMEOUT_MS = 60_000;

export interface ExtensionHostOptions {
  services: HostServices;
  importModule?: (url: string) => Promise<unknown>;
  /** Resolves once the page has finished starting; gates `onStartupFinished`. */
  whenStartupFinished?: () => Promise<void>;
  console?: Pick<Console, "error" | "warn" | "info">;
  /** Where `context.workspaceState` keeps each extension's per-session values. */
  extensionState?: ExtensionStateStore;
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
  /** Removes each extension's contributed views, commands and menus. */
  private readonly contributed = new Map<string, () => void>();
  private readonly extensionState: ExtensionStateStore;
  private disposed = false;

  constructor(options: ExtensionHostOptions) {
    this.services = options.services;
    this.importModule = options.importModule ?? ((url) => import(/* @vite-ignore */ url));
    this.whenStartupFinished = options.whenStartupFinished ?? defaultWhenStartupFinished;
    this.log = options.console ?? console;
    this.activationTimeoutMs = options.activationTimeoutMs ?? ACTIVATION_TIMEOUT_MS;
    this.loadTimeoutMs = options.loadTimeoutMs ?? LOAD_TIMEOUT_MS;
    this.extensionState = options.extensionState ?? sessionExtensionStateStore;
  }

  /** Registers what the manifest contributes, once per id, before the extension activates. */
  private contribute(extension: ExtensionDescription): void {
    if (this.contributed.has(extension.id) || this.disposed) return;
    const { contributions, warnings } = parseContributions(extension.id, extension.contributes, {
      builtIn: extension.builtIn === true,
      builtInTabs: BUILT_IN_RAIL_TABS,
    });
    for (const warning of warnings) {
      this.log.warn(`[omnigent-extensions] ${extension.id}: ${warning}`);
    }
    const removeViews = this.services.views.addExtension(extension.id, contributions, {
      builtIn: extension.builtIn === true,
    });
    const removeKeybindings = this.services.keybindings?.add(
      extension.id,
      contributions.keybindings,
    );
    this.contributed.set(extension.id, () => {
      removeKeybindings?.();
      removeViews();
    });
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
        this.contribute(extension);
        this.services.views.extensionSettled(extension.id);
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
    this.contribute(extension);
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
    const activation = this.doActivate(extension, activateAfter).then((result) => {
      this.activating.delete(extension.id);
      // Its views stop showing "Loading" whether it activated or not; a failure shows.
      this.services.views.extensionSettled(
        extension.id,
        result === "failed" ? "activation failed" : undefined,
      );
      return result;
    });
    this.activating.set(extension.id, activation);
    return activation;
  }

  private async doActivate(
    extension: ExtensionDescription,
    activateAfter: Promise<unknown> | undefined,
  ): Promise<ActivationResult> {
    const logError = (message: string, error?: unknown) =>
      this.log.error(`[omnigent-extensions] ${extension.id}: ${message}`, error);
    const apiHandle = createExtensionApi(extension.id, this.services, logError, {
      builtIn: extension.builtIn === true,
    });
    // Registered before the import: the entry's `import "omnigent"` looks it up.
    const unregisterApi = registerExtensionApi(extension.id, apiHandle.api);
    const context: omnigent.ExtensionContext = Object.freeze({
      subscriptions: [],
      extension: Object.freeze({ id: extension.id, version: extension.version }),
      workspaceState: createWorkspaceState(
        extension.id,
        this.extensionState,
        // The workspace on screen (a grid cell's, say), else the chat session.
        () => this.services.workspace.activeSessionId ?? this.services.sessions.activeSession?.id,
      ),
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
    // A built-in's module is in the bundle: loading it cannot hang on the network.
    if (!extension.builtIn) {
      armTimeout(
        this.loadTimeoutMs,
        `failed to load ${extension.entryUrl}: timed out after ${this.loadTimeoutMs}ms`,
      );
    }
    const activationTimeoutMs = extension.builtIn
      ? Math.max(this.activationTimeoutMs, BUILT_IN_ACTIVATION_TIMEOUT_MS)
      : this.activationTimeoutMs;
    const run: Promise<LoadOutcome> = (async () => {
      let module: ExtensionModule;
      try {
        module = (await (extension.load
          ? extension.load()
          : this.importModule(extension.entryUrl))) as ExtensionModule;
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
      armTimeout(activationTimeoutMs, `activate timed out after ${activationTimeoutMs}ms`);
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
    for (const remove of this.contributed.values()) remove();
    this.contributed.clear();
  }
}
