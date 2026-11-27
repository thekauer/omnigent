// The workbench's own context keys (layout plan L3): what the shell knows that `when` clauses
// of views, containers and menus read, such as whether the session on screen has a workspace
// or a server feature is on. The shell writes them; the extension runtime mirrors them into
// its context key service, and the shell's own gating reads them through the same clauses.
// Plain data; no React.

import type { ContextKeyValue } from "@/vscodeExtensions/contextKeys";
import type { WhenClause } from "@/vscodeExtensions/when";

/** The workbench keys the shell keeps. */
export const WorkbenchContextKeys = Object.freeze({
  /** The session on screen has an on-disk workspace (its Files, Changes, Pull Requests). */
  sessionHasWorkspace: "omnigent.session.hasWorkspace",
  /** The session on screen has a Tasks page (native tasks, or a session journal). */
  sessionHasTasks: "omnigent.session.hasTasks",
  /** `omnigent.serverFeature.<name>`: a server feature flag is on. */
  serverFeaturePrefix: "omnigent.serverFeature.",
});

export type WorkbenchContextValues = Readonly<Record<string, ContextKeyValue>>;

type Listener = (keys: readonly string[]) => void;

export class WorkbenchContext {
  private values: WorkbenchContextValues = Object.freeze({});
  private readonly listeners = new Set<Listener>();

  get(key: string): ContextKeyValue | undefined {
    return Object.hasOwn(this.values, key) ? this.values[key] : undefined;
  }

  snapshot(): WorkbenchContextValues {
    return this.values;
  }

  /** Sets the keys in `patch` (`undefined` removes one); listeners hear the changed keys. */
  update(patch: Readonly<Record<string, ContextKeyValue | undefined>>): void {
    const changed = Object.entries(patch)
      .filter(([key, value]) => this.get(key) !== value)
      .map(([key]) => key);
    if (changed.length === 0) return;
    const next = new Map(Object.entries(this.values));
    for (const key of changed) {
      const value = patch[key];
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    this.values = Object.freeze(Object.fromEntries(next));
    for (const listener of [...this.listeners]) {
      try {
        listener(changed);
      } catch (error) {
        console.error("[layout] a workbench context listener failed", error);
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** The window's workbench context keys. */
export const workbenchContext = new WorkbenchContext();

/** Whether `when` holds (an absent clause always does) under `values` over `fallback`. */
export function whenHolds(
  when: WhenClause | undefined,
  values: WorkbenchContextValues,
  fallback: (key: string) => unknown = () => undefined,
): boolean {
  if (!when) return true;
  return when.evaluate((key) => (Object.hasOwn(values, key) ? values[key] : fallback(key)));
}

/** The server feature flags as `omnigent.serverFeature.<name>` keys (only the ones on). */
export function serverFeatureKeys(
  features: Readonly<Record<string, unknown>> | undefined,
): Record<string, true> {
  const keys: Record<string, true> = {};
  for (const [name, enabled] of Object.entries(features ?? {})) {
    if (enabled === true && /^[A-Za-z0-9_.-]{1,96}$/.test(name)) {
      keys[`${WorkbenchContextKeys.serverFeaturePrefix}${name}`] = true;
    }
  }
  return keys;
}
