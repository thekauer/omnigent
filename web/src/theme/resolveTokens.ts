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

/**
 * The values of `layers` (lowest first) over the registry defaults in `mode`: per token
 * the highest layer's value that is on no `var()` cycle (CSS makes a cycle invalid) and,
 * for a length, number, duration or percentage, whose interval lies in the token's
 * absolute range and the calc() cap. Intervals are computed from what each token read
 * resolves to (dependencies first); a default reads the same way and is trusted.
 */
export function resolveTokenLayers(
  layers: readonly TokenLayer[],
  mode: UiTheme,
  kindOf: (id: string) => ValueKind | undefined = (id) => getToken(id)?.kind,
): ResolvedLayers {
  const candidates = new Map<string, Candidate[]>();
  for (let layer = layers.length - 1; layer >= 0; layer -= 1) {
    for (const [token, entry] of Object.entries(layers[layer]!)) {
      const list = candidates.get(token) ?? [];
      list.push({ value: entry.value, references: entry.references, layer });
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
  const drop = (token: string, candidate: Candidate, reason: string) => {
    dropped.add(candidate);
    rejected.push({ token, value: candidate.value, layer: candidate.layer, reason });
  };
  const top = (token: string) => candidates.get(token)?.find((entry) => !dropped.has(entry));
  const dropCycles = (chosen: ReadonlyMap<string, Candidate>): boolean => {
    const graph = new Map<string, readonly string[]>();
    for (const token of TOKENS) graph.set(token.id, references(registryDefault(token.id, mode)));
    for (const [token, entry] of chosen) graph.set(token, entry.references);
    let found = false;
    for (const token of referenceCycles(graph)) {
      const entry = chosen.get(token);
      if (!entry) continue;
      drop(token, entry, "is on a reference cycle");
      found = true;
    }
    return found;
  };
  // Each pass drops what fails; a fallback may close a new cycle, which the next pass drops.
  for (;;) {
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
          continue;
        }
        if (result.ok) {
          chosen.set(token, entry);
          interval = result.interval;
          decided = true;
          break;
        }
        drop(token, entry, `is out of range in ${mode}: ${result.reason}`);
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
