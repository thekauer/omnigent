// Resolve-time range checks of the token values a theme layers over the registry (theming
// plan, "Validation"): the values a theme, its options, the variants, the user's
// customizations and the product write, checked once every token they read is known.

import type { UiTheme } from "./themeContributions";
import { getToken, TOKENS } from "./tokens/registry";
import {
  cycleComponents,
  INTERVAL_KINDS,
  type Interval,
  measureTokenValue,
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

/**
 * The tokens on a shortest cycle from `from` back to itself in `graph`, through tokens
 * `within` allows; empty when there is none.
 */
function shortestCycle(
  graph: ReadonlyMap<string, readonly string[]>,
  from: string,
  within: (id: string) => boolean,
): string[] {
  const parent = new Map<string, string>();
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]!;
    for (const next of graph.get(id) ?? []) {
      if (next === from) {
        const path = [id];
        while (path[0] !== from) path.unshift(parent.get(path[0]!)!);
        return path;
      }
      if (parent.has(next) || !within(next)) continue;
      parent.set(next, id);
      queue.push(next);
    }
  }
  return [];
}

/** Thrown through the measuring of a value that reads itself through a fallback. */
class CycleSignal extends Error {}

interface Candidate extends LayerValue {
  readonly token: string;
  readonly layer: number;
}

export interface ResolveOptions {
  /**
   * The index of the product's layer (`lockedTokens`). Its tokens never fall back to a
   * lower layer: the values that push a lock out of range or close a cycle with it are
   * left out instead, and a lock takes the registry default only when it fails with
   * every other layer's value in its dependency closure left out (the product's own
   * values are broken).
   */
  readonly locked?: number;
  readonly kindOf?: (id: string) => ValueKind | undefined;
}

/** One resolve with a given set of values left out up front. */
interface Run {
  readonly chosen: ReadonlyMap<string, Candidate>;
  readonly dropped: ReadonlySet<Candidate>;
  readonly rejected: readonly RejectedToken[];
  /** The locks that failed, and how. Empty when every lock not given up on applies. */
  readonly broken: ReadonlyMap<string, "range" | "cycle">;
  /** For a lock on a cycle of chosen values: the other layers' values on it. */
  readonly cycleMates: ReadonlyMap<string, readonly Candidate[]>;
  /** Each failed lock's own rejection reason. */
  readonly lockReasons: ReadonlyMap<string, string>;
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
      const candidate: Candidate = {
        token,
        value: entry.value,
        references: entry.references,
        layer,
      };
      if (layer === lockedLayer) locks.set(token, candidate);
      const list = candidates.get(token) ?? [];
      list.push(candidate);
      candidates.set(token, list);
    }
  }
  const defaultReads = new Map<string, readonly string[]>();
  for (const token of TOKENS)
    defaultReads.set(token.id, references(registryDefault(token.id, mode)));
  const readsByDefault = (token: string): readonly string[] =>
    defaultReads.get(token) ?? references(registryDefault(token, mode));
  const absolute = (token: string): Interval | undefined => {
    const kind = kindOf(token);
    if (!kind || !INTERVAL_KINDS.has(kind)) return undefined;
    const [lo, hi] = tokenRange(token, kind);
    return { lo, hi, vars: true, infinite: false };
  };
  const isLock = (entry: Candidate) => entry.layer === lockedLayer;

  /**
   * Resolves with the `forced` values left out (each with its reason) and the `failed`
   * locks at their defaults. Values that fail on their own are left out as they are met;
   * a lock that fails is reported in {@link Run.broken}, not repaired.
   */
  const run = (
    forced: ReadonlyMap<Candidate, string>,
    failed: ReadonlyMap<string, string>,
  ): Run => {
    const dropped = new Set<Candidate>();
    const rejected: RejectedToken[] = [];
    const broken = new Map<string, "range" | "cycle">();
    const cycleMates = new Map<string, Candidate[]>();
    const lockReasons = new Map<string, string>();
    const drop = (candidate: Candidate, reason: string) => {
      dropped.add(candidate);
      rejected.push({
        token: candidate.token,
        value: candidate.value,
        layer: candidate.layer,
        reason,
      });
    };
    for (const [token, reason] of failed) drop(locks.get(token)!, reason);
    for (const [candidate, reason] of forced) drop(candidate, reason);
    const top = (token: string) => candidates.get(token)?.find((entry) => !dropped.has(entry));
    /** Drops the values on a cycle among `chosen`; reports a cycle through a lock. */
    const checkCycles = (chosen: ReadonlyMap<string, Candidate>): boolean => {
      const graph = new Map(defaultReads);
      for (const [token, entry] of chosen) graph.set(token, entry.references);
      const components = new Map<number, Candidate[]>();
      for (const [token, component] of cycleComponents(graph)) {
        const entry = chosen.get(token);
        if (!entry) continue;
        const members = components.get(component) ?? [];
        members.push(entry);
        components.set(component, members);
      }
      for (const members of components.values()) {
        const free = members.filter((entry) => !isLock(entry));
        const locked = members.filter(isLock);
        if (locked.length === 0) {
          for (const entry of free) drop(entry, "is on a reference cycle");
          continue;
        }
        const component = new Set(members.map((entry) => entry.token));
        for (const lock of locked) {
          broken.set(lock.token, "cycle");
          // The values on its shortest cycle, so a long one is cut once, not everywhere.
          const path = shortestCycle(
            graph,
            lock.token,
            (id) => component.has(id) || !chosen.has(id),
          );
          const onPath = path.flatMap((id) => {
            const entry = chosen.get(id);
            return entry && !isLock(entry) ? [entry] : [];
          });
          cycleMates.set(lock.token, onPath.length > 0 ? onPath : free);
          lockReasons.set(lock.token, "is on a reference cycle");
        }
      }
      return components.size > 0;
    };
    const result = (chosen: Map<string, Candidate>): Run => ({
      chosen,
      dropped,
      rejected,
      broken,
      cycleMates,
      lockReasons,
    });
    // Each pass drops what fails; a fallback may close a new cycle, which the next pass drops.
    for (;;) {
      const initial = new Map<string, Candidate>();
      for (const token of candidates.keys()) {
        const entry = top(token);
        if (entry) initial.set(token, entry);
      }
      if (checkCycles(initial)) {
        if (broken.size > 0) return result(initial);
        continue;
      }
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
      const fail = (entry: Candidate, why: "range" | "cycle", reason: string) => {
        drop(entry, reason);
        if (!isLock(entry)) return;
        broken.set(entry.token, why);
        lockReasons.set(entry.token, reason);
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
          let measured: ReturnType<typeof measureTokenValue>;
          try {
            measured = measureTokenValue(token, kind, entry.value, bound);
          } catch (error) {
            if (!(error instanceof CycleSignal)) throw error;
            fail(entry, "cycle", "is on a reference cycle");
            continue;
          }
          if (measured.ok) {
            chosen.set(token, entry);
            interval = measured.interval;
            decided = true;
            break;
          }
          fail(entry, "range", `is out of range in ${mode}: ${measured.reason}`);
        }
        if (!decided && kind && INTERVAL_KINDS.has(kind)) {
          const fallback = registryDefault(token, mode);
          const measured =
            fallback === undefined
              ? undefined
              : measureTokenValue(token, kind, fallback, bound, false);
          interval = measured?.ok ? measured.interval : absolute(token);
        }
        memo.set(token, interval);
        return interval;
      };
      for (const token of candidates.keys()) bound(token);
      if (broken.size > 0) return result(chosen);
      if (checkCycles(chosen)) {
        if (broken.size > 0) return result(chosen);
        continue;
      }
      return result(chosen);
    }
  };

  /**
   * The values to leave out for a broken lock: the other values on its cycle; else the
   * values it reads through what applies now; else any other layer's value in its full
   * dependency closure (every layer's value of each token it may read, and the defaults),
   * those that apply first. Of these, the highest layer's. None: the lock fails on its own.
   */
  const blame = (
    token: string,
    attempt: Run,
    forced: ReadonlyMap<Candidate, string>,
  ): readonly Candidate[] => {
    const highest = (found: readonly Candidate[]) => {
      const layer = Math.max(...found.map((entry) => entry.layer));
      return found.filter((entry) => entry.layer === layer);
    };
    const mates = attempt.cycleMates.get(token) ?? [];
    if (mates.length > 0) return highest(mates);
    const lock = locks.get(token)!;
    const applied: Candidate[] = [];
    const seen = new Set<string>();
    const walk = (refs: readonly string[]) => {
      for (const ref of refs) {
        if (seen.has(ref)) continue;
        seen.add(ref);
        const entry = candidates.get(ref)?.find((candidate) => !attempt.dropped.has(candidate));
        if (entry && !isLock(entry)) applied.push(entry);
        walk(entry ? entry.references : readsByDefault(ref));
      }
    };
    walk(lock.references);
    if (applied.length > 0) return highest(applied);
    const live: Candidate[] = [];
    const left: Candidate[] = [];
    const closure = new Set<string>();
    const stack = [...lock.references];
    while (stack.length > 0) {
      const ref = stack.pop()!;
      if (closure.has(ref)) continue;
      closure.add(ref);
      stack.push(...readsByDefault(ref));
      for (const entry of candidates.get(ref) ?? []) {
        stack.push(...entry.references);
        if (isLock(entry) || forced.has(entry)) continue;
        (attempt.dropped.has(entry) ? left : live).push(entry);
      }
    }
    if (live.length > 0) return highest(live);
    return left.length > 0 ? highest(left) : [];
  };

  const forced = new Map<Candidate, string>();
  const failed = new Map<string, string>();
  let attempt = run(forced, failed);
  while (attempt.broken.size > 0) {
    for (const [token, why] of attempt.broken) {
      const culprits = blame(token, attempt, forced);
      if (culprits.length === 0) {
        failed.set(token, attempt.lockReasons.get(token) ?? "is on a reference cycle");
        continue;
      }
      for (const entry of culprits) {
        forced.set(
          entry,
          why === "range"
            ? `pushes the product's --${token} out of range in ${mode}`
            : `closes a reference cycle with the product's --${token}`,
        );
      }
    }
    attempt = run(forced, failed);
  }
  /** Who reads each token in `attempt`, kept for the attempt it was built from. */
  let readers: { of: Run; map: Map<string, string[]> } | undefined;
  const readersOf = (): Map<string, string[]> => {
    if (readers?.of === attempt) return readers.map;
    const map = new Map<string, string[]>();
    const ids = new Set([...defaultReads.keys(), ...candidates.keys()]);
    for (const id of ids) {
      for (const ref of attempt.chosen.get(id)?.references ?? readsByDefault(id)) {
        const list = map.get(ref) ?? [];
        list.push(id);
        map.set(ref, list);
      }
    }
    readers = { of: attempt, map };
    return map;
  };
  /** Whether `entry` back would close a cycle through a lock with what applies now. */
  const closesLockCycle = (entry: Candidate): boolean => {
    // Under a higher layer's value that applies, it would not apply either.
    if ((attempt.chosen.get(entry.token)?.layer ?? -1) > entry.layer) return false;
    const ahead = new Set<string>();
    const stack = [...entry.references];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (ahead.has(id)) continue;
      ahead.add(id);
      if (id !== entry.token) {
        stack.push(...(attempt.chosen.get(id)?.references ?? readsByDefault(id)));
      }
    }
    if (!ahead.has(entry.token)) return false;
    // A lock both read from the value and reading it is on the cycle it closes.
    const map = readersOf();
    const behind = new Set<string>();
    stack.push(entry.token);
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (behind.has(id)) continue;
      behind.add(id);
      stack.push(...(map.get(id) ?? []));
    }
    for (const id of ahead) {
      const chosen = attempt.chosen.get(id);
      if (chosen && isLock(chosen) && behind.has(id)) return true;
    }
    return false;
  };
  /**
   * Puts back what of `group` the locks hold without: all of it at once if they do, else
   * each half in turn, down to single values. A value that would close a cycle through a
   * lock with what applies now stays out without a run.
   */
  const restore = (group: readonly Candidate[]): void => {
    const hopeful = group.filter((entry) => !closesLockCycle(entry));
    if (hopeful.length === 0) return;
    const reasons = hopeful.map((entry) => forced.get(entry)!);
    for (const entry of hopeful) forced.delete(entry);
    const trial = run(forced, failed);
    if (trial.broken.size === 0) {
      attempt = trial;
      return;
    }
    hopeful.forEach((entry, index) => forced.set(entry, reasons[index]!));
    if (hopeful.length === 1) return;
    const half = Math.ceil(hopeful.length / 2);
    restore(hopeful.slice(0, half));
    restore(hopeful.slice(half));
  };
  // Put back each value left out for a lock that the locks hold without, the highest
  // layer's (the user's) first, so only what has to go goes.
  if (forced.size > 0) restore([...forced.keys()].sort((a, b) => b.layer - a.layer));
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  // In the order the layers first name each token, as a merge of them would.
  for (const layer of layers) {
    for (const token of Object.keys(layer)) {
      const entry = attempt.chosen.get(token);
      if (entry && !(token in values)) values[token] = entry.value;
    }
  }
  return { values, rejected: attempt.rejected };
}
