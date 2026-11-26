// Resolve-time range checks of the token values a theme layers over the registry (theming
// plan, "Validation"): the values a theme, its options, the variants, the user's
// customizations and the product write, checked once every token they read is known.

import type { UiTheme } from "./themeContributions";
import { getToken, TOKENS } from "./tokens/registry";
import {
  INTERVAL_KINDS,
  type Interval,
  measureTokenValue,
  referenceCycles,
  tokenRange,
  type ValueKind,
} from "./validate";

/** A checked value and the tokens it reads (a theme file's or a host layer's). */
export interface LayerValue {
  readonly value: string;
  readonly references: readonly string[];
}

/** One layer of token values; later layers win. */
export type TokenLayer = Readonly<Record<string, LayerValue>>;

/** A layer's value left out, and why. */
export interface RejectedToken {
  readonly token: string;
  readonly value: string;
  /** The index of its layer in the list passed in. */
  readonly layer: number;
  /** Why, as a predicate: "is on a reference cycle", "is out of range in dark: ...". */
  readonly reason: string;
}

export interface ResolvedLayers {
  /** Each token's value from the highest layer that passed. */
  readonly values: Record<string, string>;
  readonly rejected: readonly RejectedToken[];
}

/** The registry default of `id` in `mode` (dark falls back to light), if any. */
export function registryDefault(id: string, mode: UiTheme): string | undefined {
  const token = getToken(id);
  return mode === "dark" ? (token?.default?.dark ?? token?.default?.light) : token?.default?.light;
}

function references(value: string | undefined): string[] {
  return [...(value ?? "").matchAll(/var\(\s*--([A-Za-z0-9-]+)/g)].map((match) => match[1]!);
}

/** Thrown through the measuring of a value that reads itself through a fallback. */
class CycleSignal extends Error {}

interface Candidate extends LayerValue {
  readonly layer: number;
}

export interface ResolveOptions {
  /**
   * The index of the product's layer (`lockedTokens`). Its tokens never fall back to a
   * lower layer: a value that pushes a lock out of range or closes a cycle with it is
   * left out instead, and a lock that still fails takes the registry default.
   */
  readonly locked?: number;
  readonly kindOf?: (id: string) => ValueKind | undefined;
}

/** Whether `to` is reachable from `from` in `graph`. */
function reaches(graph: ReadonlyMap<string, readonly string[]>, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next === to) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(graph.get(next) ?? []));
  }
  return false;
}

/**
 * The values of `layers` (lowest first) over the registry defaults in `mode`: per token
 * the highest layer's value that is on no `var()` cycle (CSS makes a cycle invalid) and,
 * for a length, number, duration or percentage, whose interval lies in the token's
 * absolute range and the calc() cap. Intervals are computed from what each token read
 * resolves to (dependencies first); a default reads the same way and is trusted.
 * A token of the `locked` layer takes that layer's value or its default, never a lower
 * layer's ({@link ResolveOptions.locked}).
 */
export function resolveTokenLayers(
  layers: readonly TokenLayer[],
  mode: UiTheme,
  options: ResolveOptions = {},
): ResolvedLayers {
  const kindOf = options.kindOf ?? ((id: string) => getToken(id)?.kind);
  const lockedLayer = options.locked;
  const candidates = new Map<string, Candidate[]>();
  const locks = new Map<string, Candidate>();
  for (let layer = layers.length - 1; layer >= 0; layer -= 1) {
    for (const [token, entry] of Object.entries(layers[layer]!)) {
      // A locked token's lower values never apply.
      if (locks.has(token)) continue;
      const candidate: Candidate = { value: entry.value, references: entry.references, layer };
      if (layer === lockedLayer) locks.set(token, candidate);
      const list = candidates.get(token) ?? [];
      list.push(candidate);
      candidates.set(token, list);
    }
  }
  const absolute = (token: string): Interval | undefined => {
    const kind = kindOf(token);
    if (!kind || !INTERVAL_KINDS.has(kind)) return undefined;
    const [lo, hi] = tokenRange(token, kind);
    return { lo, hi, vars: true, infinite: false };
  };
  const rejected: RejectedToken[] = [];
  const dropped = new Set<Candidate>();
  /** Locks that failed on their own (a cycle among locks and defaults): their default applies. */
  const failedLocks = new Set<string>();
  /** Why each lock now dropped failed: what a value it reads is blamed for. */
  const brokenLocks = new Map<string, "range" | "cycle">();
  const drop = (token: string, candidate: Candidate, reason: string) => {
    dropped.add(candidate);
    rejected.push({ token, value: candidate.value, layer: candidate.layer, reason });
  };
  const top = (token: string) => candidates.get(token)?.find((entry) => !dropped.has(entry));
  const isLock = (entry: Candidate) => entry.layer === lockedLayer;
  const dropCycles = (chosen: ReadonlyMap<string, Candidate>): boolean => {
    const graph = new Map<string, readonly string[]>();
    for (const token of TOKENS) graph.set(token.id, references(registryDefault(token.id, mode)));
    for (const [token, entry] of chosen) graph.set(token, entry.references);
    const onCycle = [...referenceCycles(graph)].flatMap((token) => {
      const entry = chosen.get(token);
      return entry ? [{ token, entry }] : [];
    });
    // A cycle through a lock drops the other values on it, never the lock.
    const free = onCycle.filter(({ entry }) => !isLock(entry));
    const locked = onCycle.filter(({ entry }) => isLock(entry)).map(({ token }) => token);
    for (const { token, entry } of free) {
      const lock = locked.find((id) => reaches(graph, token, id) && reaches(graph, id, token));
      drop(
        token,
        entry,
        lock ? `closes a reference cycle with the product's --${lock}` : "is on a reference cycle",
      );
    }
    if (free.length > 0) return true;
    // Only locks (and defaults) are left on a cycle: those locks take their defaults.
    for (const { token, entry } of onCycle) {
      drop(token, entry, "is on a reference cycle");
      failedLocks.add(token);
    }
    return onCycle.length > 0;
  };
  /**
   * Blames the values a broken lock reads (its dependency closure, through what applies
   * now) and drops those of the highest layer among them, so the lock applies again; a
   * lock that reads nothing to blame keeps failing and takes its default.
   */
  const blame = (token: string, why: "range" | "cycle"): void => {
    const lock = locks.get(token)!;
    const found: { token: string; entry: Candidate }[] = [];
    const seen = new Set<string>();
    const visit = (refs: readonly string[]) => {
      for (const ref of refs) {
        if (seen.has(ref)) continue;
        seen.add(ref);
        const entry = top(ref);
        if (entry && !isLock(entry)) found.push({ token: ref, entry });
        visit(entry ? entry.references : references(registryDefault(ref, mode)));
      }
    };
    visit(lock.references);
    if (found.length === 0) {
      failedLocks.add(token);
      return;
    }
    const highest = Math.max(...found.map(({ entry }) => entry.layer));
    for (const { token: ref, entry } of found) {
      if (entry.layer !== highest) continue;
      drop(
        ref,
        entry,
        why === "range"
          ? `pushes the product's --${token} out of range in ${mode}`
          : `closes a reference cycle with the product's --${token}`,
      );
    }
    // The lock applies again: its rejection goes.
    dropped.delete(lock);
    const index = rejected.findLastIndex(
      (entry) => entry.token === token && entry.layer === lock.layer,
    );
    if (index >= 0) rejected.splice(index, 1);
  };
  // Each pass drops what fails; a fallback may close a new cycle, which the next pass drops.
  for (;;) {
    brokenLocks.clear();
    const initial = new Map<string, Candidate>();
    for (const token of candidates.keys()) {
      const entry = top(token);
      if (entry) initial.set(token, entry);
    }
    if (dropCycles(initial)) continue;
    const chosen = new Map<string, Candidate>();
    const memo = new Map<string, Interval | undefined>();
    const visiting = new Set<string>();
    const bound = (token: string): Interval | undefined => {
      if (memo.has(token)) return memo.get(token);
      // A fallback (a lower layer's value or a default) closed a cycle: the nearest
      // candidate being measured on it is dropped (CSS would make the cycle invalid).
      if (visiting.has(token)) throw new CycleSignal();
      visiting.add(token);
      try {
        return decide(token);
      } finally {
        visiting.delete(token);
      }
    };
    const decide = (token: string): Interval | undefined => {
      const kind = kindOf(token);
      let interval: Interval | undefined;
      let decided = false;
      for (const entry of candidates.get(token) ?? []) {
        if (dropped.has(entry)) continue;
        if (!kind || !INTERVAL_KINDS.has(kind)) {
          chosen.set(token, entry);
          decided = true;
          break;
        }
        let result: ReturnType<typeof measureTokenValue>;
        try {
          result = measureTokenValue(token, kind, entry.value, bound);
        } catch (error) {
          if (!(error instanceof CycleSignal)) throw error;
          drop(token, entry, "is on a reference cycle");
          if (isLock(entry)) brokenLocks.set(token, "cycle");
          continue;
        }
        if (result.ok) {
          chosen.set(token, entry);
          interval = result.interval;
          decided = true;
          break;
        }
        drop(token, entry, `is out of range in ${mode}: ${result.reason}`);
        if (isLock(entry)) brokenLocks.set(token, "range");
      }
      if (!decided && kind && INTERVAL_KINDS.has(kind)) {
        const fallback = registryDefault(token, mode);
        const result =
          fallback === undefined
            ? undefined
            : measureTokenValue(token, kind, fallback, bound, false);
        interval = result?.ok ? result.interval : absolute(token);
      }
      memo.set(token, interval);
      return interval;
    };
    for (const token of candidates.keys()) bound(token);
    const broken = [...brokenLocks].filter(([token]) => !failedLocks.has(token));
    if (broken.length > 0) {
      for (const [token, why] of broken) blame(token, why);
      continue;
    }
    if (dropCycles(chosen)) continue;
    const values: Record<string, string> = Object.create(null) as Record<string, string>;
    // In the order the layers first name each token, as a merge of them would.
    for (const layer of layers) {
      for (const token of Object.keys(layer)) {
        const entry = chosen.get(token);
        if (entry && !(token in values)) values[token] = entry.value;
      }
    }
    return { values, rejected };
  }
}
