// Builds the `omnigent` module an extension imports. One instance per extension,
// like VS Code's per-extension `vscode` module, so every call is attributable.
import type * as omnigent from "omnigent";
import { Disposable, EventEmitter, disposeAll, type DisposableLike } from "./base";
import { SessionHeaderItemAlignment, type SessionHeaderItemRegistry } from "./sessionHeaderItems";
import type { SessionsService } from "./sessionsService";

export const OMNIGENT_API_VERSION = "0.1.0";

/** The module namespace `import * as omnigent from "omnigent"` yields. */
export type OmnigentApi = typeof omnigent;

/**
 * Names the dev plugin re-exports from the per-extension module. Kept in sync
 * with `OMNIGENT_API_EXPORTS` in vite.omnigentExtensions.ts (a test checks it).
 */
export const OMNIGENT_API_EXPORT_NAMES = [
  "version",
  "Disposable",
  "EventEmitter",
  "SessionHeaderItemAlignment",
  "window",
  "sessions",
] as const;

export interface HostServices {
  headerItems: SessionHeaderItemRegistry;
  sessions: SessionsService;
}

export type ExtensionLogger = (message: string, error?: unknown) => void;

/** An API instance plus everything it handed out, for teardown on deactivate. */
export interface ExtensionApiHandle {
  api: OmnigentApi;
  dispose: () => void;
}

/** A disposed item that was never registered, for calls after deactivation. */
function inertSessionHeaderItem(
  extensionId: string,
  id: string | undefined,
  alignment: number | undefined,
  priority: number | undefined,
): omnigent.SessionHeaderItem {
  return {
    id: `${extensionId}.${id ?? "disposed"}`,
    alignment: (alignment === SessionHeaderItemAlignment.Right
      ? SessionHeaderItemAlignment.Right
      : SessionHeaderItemAlignment.Left) as omnigent.SessionHeaderItemAlignment,
    priority: typeof priority === "number" && Number.isFinite(priority) ? priority : undefined,
    text: "",
    tooltip: undefined,
    show: () => {},
    hide: () => {},
    dispose: () => {},
  };
}

export function createExtensionApi(
  extensionId: string,
  services: HostServices,
  logError: ExtensionLogger,
): ExtensionApiHandle {
  const resources = new Set<DisposableLike>();
  // Once disposed (deactivate, failed or timed-out activation), the instance is
  // inert: a late caller gets handles that are already disposed, nothing more.
  let disposed = false;
  const refuse = (what: string) =>
    logError(`${what} called after the extension was deactivated; ignoring it`);
  const track = <T extends DisposableLike>(resource: T): T => {
    resources.add(resource);
    return resource;
  };

  // Host events delivered to this extension: a throwing or rejecting listener is
  // logged against the extension and never reaches other listeners or the UI.
  const guard = <T>(event: omnigent.Event<T>, name: string): omnigent.Event<T> => {
    return (listener, thisArgs, disposables) => {
      if (disposed) {
        refuse(name);
        return new Disposable(() => {});
      }
      const subscription = event((data) => {
        // A host event already being delivered when the extension was torn down.
        if (disposed) return;
        try {
          const result: unknown = listener.call(thisArgs, data);
          if (result instanceof Promise) {
            result.catch((error: unknown) => logError(`${name} listener rejected`, error));
          }
        } catch (error) {
          logError(`${name} listener threw`, error);
        }
      });
      const tracked = track(
        new Disposable(() => {
          resources.delete(tracked);
          subscription.dispose();
        }),
      );
      if (Array.isArray(disposables)) disposables.push(tracked);
      return tracked;
    };
  };

  function createSessionHeaderItem(
    idOrAlignment?: string | omnigent.SessionHeaderItemAlignment,
    alignmentOrPriority?: omnigent.SessionHeaderItemAlignment | number,
    priority?: number,
  ): omnigent.SessionHeaderItem {
    const hasId = typeof idOrAlignment === "string";
    const id = hasId ? idOrAlignment : undefined;
    const alignment = hasId ? alignmentOrPriority : idOrAlignment;
    const itemPriority = hasId ? priority : alignmentOrPriority;
    if (disposed) {
      refuse("createSessionHeaderItem");
      return inertSessionHeaderItem(extensionId, id, alignment, itemPriority);
    }
    const item = services.headerItems.create(extensionId, id, alignment, itemPriority);
    const dispose = item.dispose;
    item.dispose = () => {
      resources.delete(item);
      dispose();
    };
    return track(item);
  }

  const onDidChangeActiveSession = guard(
    services.sessions.onDidChangeActiveSession,
    "onDidChangeActiveSession",
  );
  const onDidChangeUsage = guard(services.sessions.onDidChangeUsage, "onDidChangeUsage");
  const reportEmitterError = (error: unknown) => logError("EventEmitter listener threw", error);

  const api: OmnigentApi = {
    version: OMNIGENT_API_VERSION,
    Disposable,
    // Extension-created emitters report listener errors against this extension.
    EventEmitter: class<T> extends EventEmitter<T> {
      constructor() {
        super(reportEmitterError);
      }
    },
    SessionHeaderItemAlignment,
    window: Object.freeze({ createSessionHeaderItem }),
    sessions: Object.freeze({
      get activeSession() {
        return services.sessions.activeSession;
      },
      get activeSessionUsage() {
        return services.sessions.activeSessionUsage;
      },
      onDidChangeActiveSession,
      onDidChangeUsage,
    }),
  };

  return {
    api: Object.freeze(api),
    dispose: () => {
      disposed = true;
      const owned = [...resources];
      resources.clear();
      disposeAll(owned, (error) => logError("dispose failed", error));
    },
  };
}
