// `ExtensionContext.workspaceState`: VS Code's Memento, scoped to the chat
// session on screen rather than a workspace folder. Reads and writes are
// synchronous against the per-session store; `update` resolves once stored.
import type * as omnigent from "omnigent";
import { readExtensionState, writeExtensionState } from "@/lib/sessionWorkspaceState";
import { toPlainJson } from "./commands";

export interface ExtensionStateStore {
  read: (sessionId: string, extensionId: string) => Readonly<Record<string, unknown>>;
  /** Throws when the bucket does not fit the caps or cannot be stored. */
  write: (sessionId: string, extensionId: string, bucket: Record<string, unknown>) => void;
}

export const sessionExtensionStateStore: ExtensionStateStore = {
  read: readExtensionState,
  write: writeExtensionState,
};

function copy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** A memento bound to whichever chat session `activeSessionId` returns at each call. */
export function createWorkspaceState(
  extensionId: string,
  store: ExtensionStateStore,
  activeSessionId: () => string | undefined,
): omnigent.Memento {
  const bucket = (): Readonly<Record<string, unknown>> => {
    const sessionId = activeSessionId();
    return sessionId === undefined ? {} : store.read(sessionId, extensionId);
  };
  function get<T>(key: string, defaultValue?: T): T | undefined {
    const values = bucket();
    return Object.hasOwn(values, key) ? copy(values[key] as T) : defaultValue;
  }
  return Object.freeze({
    keys: () => Object.freeze(Object.keys(bucket())),
    get: get as omnigent.Memento["get"],
    update: (key: string, value: unknown): Promise<void> => {
      try {
        if (typeof key !== "string" || key === "") {
          throw new TypeError("workspaceState keys must be non-empty strings");
        }
        const sessionId = activeSessionId();
        if (sessionId === undefined) {
          throw new Error("workspaceState: no chat session is open");
        }
        const plain = toPlainJson(value, "a workspaceState value");
        const next = Object.fromEntries(
          Object.entries(store.read(sessionId, extensionId)).filter(([name]) => name !== key),
        );
        if (plain !== undefined) next[key] = plain;
        store.write(sessionId, extensionId, next);
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
}
