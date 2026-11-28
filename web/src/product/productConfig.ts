// The product's settings and layout (layout plan L8, decision 9): `product.settings.defaults`
// and `.locked` over the configuration registry, and `product.layout` (the parts, view
// containers and views it hides, the activity bar's order, `lockViewLocations`). As the product
// theme, three sources, highest first: each mounted embed's `OmnigentAppProps.product`, the
// build's `web/product.json`, and the server's `/v1/info` `product` (server config `product:`).
// The setting maps merge per key, the highest source that sets a key winning it; each layout
// field comes from the highest source that sets it. Each key fails open: a malformed one is
// left out with a warning. A lock always holds, even with a value the web can't read.
// The settings are one policy per window (the configuration service keeps one settings document
// per origin, so the mounts' settings merge). The layout is per mount: each mounted app's policy
// is its own `product` prop over the build's and the server's, and the standalone app's is the
// build's and the server's (`workbench/productLayout.ts`).

import { SERVER_INFO_OFFLINE_FALLBACK } from "@/lib/bootCapabilities";
import { FALLBACK_SERVER_INFO, type ServerInfo } from "@/lib/capabilities";
import { getOmnigentServerIdentity } from "@/lib/host";
import {
  type ConfigurationService,
  configurationService,
  INVALID_LOCKED_VALUE,
} from "@/configuration/configurationService";
import { snapshotPlainData } from "@/theme/validate";
import {
  type ProductLayoutConfig,
  type ProductLayoutPolicy,
  standaloneProductLayout,
} from "@/workbench/productLayout";

/** `product.settings`: setting keys to values. Every field is optional. */
export interface ProductSettingsConfig {
  /** What a first run and a reset get, over the registered defaults. */
  readonly defaults?: Readonly<Record<string, unknown>>;
  /** Applied last and refused on write ("Set by product"). */
  readonly locked?: Readonly<Record<string, unknown>>;
  /** Keys locked to their defaults: their locked value couldn't be read. */
  readonly lockedInvalid?: readonly string[];
}

/** What `product.settings` and `product.layout` carry, from one source. */
export interface ProductSettingsAndLayout {
  readonly settings?: ProductSettingsConfig;
  readonly layout?: ProductLayoutConfig;
}

/**
 * The most a source's settings may take, in UTF-16 code units, counted by
 * {@link productValueCost} (each entry its key's and value's cost and 2; an invalid lock its
 * key's and 1), the locks first, then the invalid locks, then the defaults. The server caps
 * what it serves to the same budgets and limits (`omnigent/server/server_config.py`).
 */
export const PRODUCT_SETTINGS_MAX_CHARS = 131_072;
/** The most a source's layout lists may take: each id its JSON text's length and 1. */
export const PRODUCT_LAYOUT_MAX_CHARS = 131_072;
/** A setting value's deepest nesting (the value itself is level 1). */
export const PRODUCT_VALUE_MAX_DEPTH = 8;
/** The most values one setting value holds, itself included. */
export const PRODUCT_VALUE_MAX_NODES = 2_000;
/** What a number takes of the budget, whatever its text (the server's and the web's differ). */
export const PRODUCT_NUMBER_COST = 24;

const MAP_LIMIT = 500;
/**
 * The most keys locked to their default (`lockedInvalid`): locks past the map's limit, the budget
 * or readability. Far over any real product; the server keeps the same limit.
 */
export const PRODUCT_LOCKED_INVALID_LIMIT = 5_000;
const LIST_LIMIT = 200;
const SETTING_KEY = /^[A-Za-z0-9._-]{1,128}$/;
const LAYOUT_ID = /^[A-Za-z0-9._*/-]{1,200}$/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** One value's guard as it is copied: past these it is no value (the cost's limits come after). */
const VALUE_LIMITS = {
  chars: 4 * PRODUCT_SETTINGS_MAX_CHARS,
  nodes: PRODUCT_VALUE_MAX_NODES + 1,
  depth: PRODUCT_VALUE_MAX_DEPTH + 1,
} as const;

const LAYOUT_LISTS = ["hiddenParts", "hiddenContainers", "hiddenViews", "containerOrder"] as const;

/** The lists every source adds to, as removal only adds up. */
const UNION_LAYOUT_LISTS: ReadonlySet<string> = new Set([
  "hiddenParts",
  "hiddenContainers",
  "hiddenViews",
]);

/** The server's snake_case spellings, which the web's own configs don't take. */
const SNAKE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  hidden_parts: "hiddenParts",
  hidden_containers: "hiddenContainers",
  hidden_views: "hiddenViews",
  container_order: "containerOrder",
  lock_view_locations: "lockViewLocations",
  locked_invalid: "lockedInvalid",
});

/** `text` without leading and trailing ASCII whitespace, as the server strips it. */
function trimAscii(text: string): string {
  return text.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string's JSON text length, or undefined for one with a lone surrogate (no UTF-16 form). */
function stringCost(text: string): number | undefined {
  return LONE_SURROGATE.test(text) ? undefined : JSON.stringify(text).length;
}

/**
 * What a setting's value takes of {@link PRODUCT_SETTINGS_MAX_CHARS}, as the server counts it:
 * a string its JSON text, a number {@link PRODUCT_NUMBER_COST}, `true`/`null` 4, `false` 5, a
 * list or object its brackets, commas, colons and members. Undefined for a value the product
 * can't set: a lone surrogate, a non-finite number, another type, too deep or too many values.
 */
export function productValueCost(value: unknown): number | undefined {
  let nodes = 0;
  const cost = (item: unknown, depth: number): number | undefined => {
    nodes += 1;
    if (nodes > PRODUCT_VALUE_MAX_NODES || depth > PRODUCT_VALUE_MAX_DEPTH) return undefined;
    if (item === null || item === true) return 4;
    if (item === false) return 5;
    if (typeof item === "number") return Number.isFinite(item) ? PRODUCT_NUMBER_COST : undefined;
    if (typeof item === "string") return stringCost(item);
    if (Array.isArray(item)) {
      let total = 2 + Math.max(0, item.length - 1);
      for (const member of item) {
        const memberCost = cost(member, depth + 1);
        if (memberCost === undefined) return undefined;
        total += memberCost;
      }
      return total;
    }
    if (isRecord(item)) {
      const entries = Object.entries(item);
      let total = 2 + Math.max(0, entries.length - 1);
      for (const [key, member] of entries) {
        const keyCost = stringCost(key);
        const memberCost = cost(member, depth + 1);
        if (keyCost === undefined || memberCost === undefined) return undefined;
        total += keyCost + 1 + memberCost;
      }
      return total;
    }
    return undefined;
  };
  return cost(value, 1);
}

class Budget {
  private left: number;
  readonly over: string[] = [];
  constructor(max: number) {
    this.left = max;
  }
  spend(cost: number, name: string): boolean {
    if (cost > this.left) {
      this.over.push(name);
      return false;
    }
    this.left -= cost;
    return true;
  }
}

function warnOver(what: string, max: number, budget: Budget, warn: (message: string) => void) {
  if (budget.over.length === 0) return;
  const shown = budget.over.slice(0, 10).map((name) => name.slice(0, 64));
  const more = budget.over.length > 10 ? ` and ${budget.over.length - 10} more` : "";
  warn(`${what} is over the ${max}-character limit; left out: ${shown.join(", ")}${more}`);
}

/**
 * A plain object's own data properties (no getters run), or a reason it isn't one: what a
 * product hands in is read key by key, so one hostile entry spoils only itself.
 */
function ownEntries(raw: unknown): [string, unknown][] | string {
  try {
    if (!isRecord(raw)) return "must be an object";
    const prototype = Object.getPrototypeOf(raw) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return "must be a plain object";
    const entries: [string, unknown][] = [];
    for (const key of Object.keys(raw)) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (!descriptor || key === "__proto__") continue;
      // A getter isn't run: its key is kept with no readable value.
      entries.push([key, "value" in descriptor ? descriptor.value : ACCESSOR]);
    }
    return entries;
  } catch {
    return "unreadable data";
  }
}

/** A source's block: its fields, each a plain copy (undefined where it can't be copied). */
function readBlock(raw: unknown): Record<string, unknown> | string {
  const entries = ownEntries(raw);
  if (typeof entries === "string") return entries;
  return Object.fromEntries(entries);
}

/** A property that is a getter: never run, so no value. */
const ACCESSOR: unique symbol = Symbol("accessor");

/** A value copied as plain data, or undefined when it isn't (a cycle, a function, too large). */
function plainValue(value: unknown): { value: unknown } | undefined {
  if (value === ACCESSOR) return undefined;
  const snapshot = snapshotPlainData(value, VALUE_LIMITS);
  return snapshot.ok ? { value: snapshot.value } : undefined;
}

function warnSnakeCase(block: Record<string, unknown>, field: string, warn: (m: string) => void) {
  for (const [snake, camel] of Object.entries(SNAKE_KEYS)) {
    if (Object.hasOwn(block, snake)) warn(`${field}.${snake} is not a key; did you mean ${camel}?`);
  }
}

/**
 * Checks `product.settings` as a product wrote it (camelCase: an embed prop, the build's file,
 * or the server's, mapped), field by field and key by key: a malformed key is left out with a
 * warning; a locked value the web can't read keeps its key locked (`lockedInvalid`). Values are
 * checked against each setting's schema by the configuration service, as the user's are.
 */
export function parseProductSettings(
  raw: unknown,
  origin: string,
): ProductSettingsConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  const warn = (message: string) =>
    console.warn(`[configuration] product settings (${origin}): ${message}`);
  const block = readBlock(raw);
  if (typeof block === "string") {
    warn(block);
    return undefined;
  }
  warnSnakeCase(block, "settings", warn);
  const budget = new Budget(PRODUCT_SETTINGS_MAX_CHARS);
  const out: {
    defaults?: Record<string, unknown>;
    locked?: Record<string, unknown>;
    lockedInvalid?: string[];
  } = {};
  const invalid: string[] = [];
  const given = plainValue(block.lockedInvalid)?.value;
  for (const key of Array.isArray(given) ? given.slice(0, PRODUCT_LOCKED_INVALID_LIMIT) : []) {
    if (typeof key === "string" && SETTING_KEY.test(key)) invalid.push(key);
  }
  // Invalid locks never spend the budget: a lock past it still locks its key (the server agrees).
  const spendInvalid = (lockedKeys: Readonly<Record<string, unknown>>) => {
    const kept = [...new Set(invalid)].filter((key) => !Object.hasOwn(lockedKeys, key));
    if (kept.length > PRODUCT_LOCKED_INVALID_LIMIT) {
      warn(
        `locked has more than ${PRODUCT_LOCKED_INVALID_LIMIT} keys locked to their default; the rest aren't locked`,
      );
    }
    if (kept.length > 0) out.lockedInvalid = kept.slice(0, PRODUCT_LOCKED_INVALID_LIMIT);
  };
  for (const kind of ["locked", "defaults"] as const) {
    const map = block[kind];
    if (map === ACCESSOR) warn(`${kind} is a getter; left out`);
    const mapEntries = map === undefined || map === ACCESSOR ? [] : ownEntries(map);
    if (typeof mapEntries === "string") {
      warn(`${kind} ${mapEntries}`);
      if (kind === "locked") spendInvalid({});
      continue;
    }
    const entries: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let count = 0;
    for (const [key, entryValue] of mapEntries) {
      if (count >= MAP_LIMIT) {
        // A lock past the limit still locks its key, to its default; a default goes.
        if (count === MAP_LIMIT) {
          warn(
            `${kind} has more than ${MAP_LIMIT} entries${kind === "locked" ? "; the rest stay locked to their defaults" : ""}`,
          );
        }
        count += 1;
        if (kind !== "locked") break;
        if (SETTING_KEY.test(key)) invalid.push(key);
        continue;
      }
      count += 1;
      if (!SETTING_KEY.test(key)) {
        warn(`${kind}.${key.slice(0, 64)} is not a setting key`);
        continue;
      }
      const copied = plainValue(entryValue);
      const value = copied?.value;
      const cost = copied ? productValueCost(value) : undefined;
      if (cost === undefined) {
        warn(
          `${kind}.${key} has a value that can't be read${kind === "locked" ? "; it stays locked to its default" : ""}`,
        );
        if (kind === "locked") invalid.push(key);
        continue;
      }
      if (budget.spend((stringCost(key) ?? 0) + cost + 2, key)) entries[key] = value;
      // A lock that doesn't fit still locks its key, to its default.
      else if (kind === "locked") invalid.push(key);
    }
    if (Object.keys(entries).length > 0) out[kind] = entries;
    if (kind === "locked") spendInvalid(entries);
  }
  warnOver("settings", PRODUCT_SETTINGS_MAX_CHARS, budget, warn);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Checks `product.layout` as a product wrote it, field by field (see {@link parseProductSettings}). */
export function parseProductLayout(raw: unknown, origin: string): ProductLayoutConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  const warn = (message: string) => console.warn(`[layout] product layout (${origin}): ${message}`);
  const block = readBlock(raw);
  if (typeof block === "string") {
    warn(block);
    return undefined;
  }
  warnSnakeCase(block, "layout", warn);
  const budget = new Budget(PRODUCT_LAYOUT_MAX_CHARS);
  const out: { -readonly [Key in keyof ProductLayoutConfig]: ProductLayoutConfig[Key] } = {};
  for (const field of LAYOUT_LISTS) {
    if (block[field] === undefined) continue;
    const value = plainValue(block[field])?.value;
    const items: unknown[] = Array.isArray(value) ? value : [value];
    const ids = items.filter(
      (item): item is string =>
        typeof item === "string" && LAYOUT_ID.test(trimAscii(item)) && !LONE_SURROGATE.test(item),
    );
    if (ids.length !== items.length) warn(`${field} has malformed entries`);
    const kept = [...new Set(ids.map((id) => trimAscii(id)))]
      .slice(0, LIST_LIMIT)
      .filter((id) => budget.spend((stringCost(id) ?? 0) + 1, id));
    if (kept.length > 0) out[field] = kept;
  }
  if (block.lockViewLocations !== undefined) {
    // A getter reads as locked: a product that meant to keep views in place does.
    if (block.lockViewLocations === ACCESSOR) out.lockViewLocations = true;
    else if (typeof block.lockViewLocations === "boolean") {
      out.lockViewLocations = block.lockViewLocations;
    } else warn("lockViewLocations must be true or false");
  }
  warnOver("layout", PRODUCT_LAYOUT_MAX_CHARS, budget, warn);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The server's `/v1/info` `product.settings` and `.layout` (snake_case), checked like the others. */
export function parseServerProductConfig(product: unknown): ProductSettingsAndLayout {
  if (!isRecord(product)) return {};
  const camel = (block: unknown): Record<string, unknown> | undefined => {
    if (!isRecord(block)) return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(block)) {
      // The server writes unset keys as null.
      if (value !== null) out[SNAKE_KEYS[key] ?? key] = value;
    }
    return out;
  };
  const settings = parseProductSettings(camel(product.settings), "server");
  const layout = parseProductLayout(camel(product.layout), "server");
  return { ...(settings ? { settings } : {}), ...(layout ? { layout } : {}) };
}

/**
 * The sources merged, highest first: the setting maps per key (a higher source's invalid lock
 * beats a lower one's value, and the other way round). What a product removes adds up: the
 * `hidden*` lists are the union of every source's, and any source's `lockViewLocations: true`
 * locks (a higher source can't unlock). The `containerOrder` comes from the first source that
 * sets it.
 */
export function mergeProductConfigs(configs: readonly (ProductSettingsAndLayout | undefined)[]): {
  settings: ProductSettingsConfig | null;
  layout: ProductLayoutConfig | null;
} {
  const defaults: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const locked: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const lockedKeys = new Set<string>();
  const invalid = new Set<string>();
  const layout: Record<string, unknown> = {};
  for (const config of configs) {
    if (!config) continue;
    for (const [key, value] of Object.entries(config.settings?.defaults ?? {})) {
      if (!(key in defaults)) defaults[key] = value;
    }
    for (const [key, value] of Object.entries(config.settings?.locked ?? {})) {
      if (lockedKeys.has(key)) continue;
      lockedKeys.add(key);
      locked[key] = value;
    }
    for (const key of config.settings?.lockedInvalid ?? []) {
      if (lockedKeys.has(key)) continue;
      lockedKeys.add(key);
      invalid.add(key);
    }
    for (const [key, value] of Object.entries(config.layout ?? {})) {
      if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
      if (UNION_LAYOUT_LISTS.has(key) && Array.isArray(value)) {
        const listed = (layout[key] as readonly string[] | undefined) ?? [];
        layout[key] = [...new Set([...listed, ...(value as readonly string[])])];
      } else if (key === "lockViewLocations") {
        layout[key] = layout[key] === true || value === true;
      } else if (!(key in layout)) layout[key] = value;
    }
  }
  const settings: { -readonly [Key in keyof ProductSettingsConfig]: ProductSettingsConfig[Key] } =
    {};
  if (Object.keys(defaults).length > 0) settings.defaults = defaults;
  if (Object.keys(locked).length > 0) settings.locked = locked;
  if (invalid.size > 0) settings.lockedInvalid = [...invalid];
  return {
    settings: Object.keys(settings).length > 0 ? settings : null,
    layout: Object.keys(layout).length > 0 ? (layout as ProductLayoutConfig) : null,
  };
}

// --- the sources -----------------------------------------------------------------------

/** The sources the window shares: every mount's layout policy is built over them. */
export const PRODUCT_CONFIG_SOURCES = ["build", "server"] as const;
export type ProductConfigSource = (typeof PRODUCT_CONFIG_SOURCES)[number];

/** The configuration service's source name for the product's settings. */
export const PRODUCT_SETTINGS_POLICY_SOURCE = "product";

const configured = new Map<ProductConfigSource, ProductSettingsAndLayout>();
/** Each mounted `OmnigentApp`: its own configuration and the layout policy it is built into. */
interface MountedProduct {
  readonly config: ProductSettingsAndLayout | undefined;
  readonly layout: ProductLayoutPolicy;
}
const mounted = new Map<number, MountedProduct>();
let mounts = 0;
let appliedKey = "";

interface Sinks {
  configuration: ConfigurationService;
  /** The standalone app's layout policy: the build's and the server's. */
  standaloneLayout: ProductLayoutPolicy;
}

let sinks: Sinks = {
  configuration: configurationService,
  standaloneLayout: standaloneProductLayout,
};

/** Where the merged configuration goes (tests); returns the previous sinks' restore. */
export function setProductConfigSinks(next: Partial<Sinks>): () => void {
  const previous = sinks;
  sinks = { ...sinks, ...next };
  appliedKey = "";
  return () => {
    sinks = previous;
    appliedKey = "";
  };
}

function applyMerged(): void {
  const embeds = [...mounted.entries()].sort(([a], [b]) => b - a).map(([, mount]) => mount.config);
  const shared = PRODUCT_CONFIG_SOURCES.map((source) => configured.get(source));
  // Each layout is its own policy: the standalone app's, then each mount's over the shared sources.
  sinks.standaloneLayout.set(mergeProductConfigs(shared).layout);
  for (const mount of mounted.values()) {
    mount.layout.set(mergeProductConfigs([mount.config, ...shared]).layout);
  }
  const settings = mergeProductConfigs([...embeds, ...shared]).settings;
  const key = JSON.stringify(settings);
  if (key === appliedKey) return;
  appliedKey = key;
  const locked =
    settings?.locked || settings?.lockedInvalid
      ? {
          ...settings.locked,
          ...Object.fromEntries(
            (settings.lockedInvalid ?? []).map((invalidKey) => [invalidKey, INVALID_LOCKED_VALUE]),
          ),
        }
      : undefined;
  sinks.configuration.setPolicy(
    PRODUCT_SETTINGS_POLICY_SOURCE,
    settings
      ? {
          ...(settings.defaults ? { defaults: settings.defaults } : {}),
          ...(locked ? { locked } : {}),
        }
      : null,
  );
}

/** Sets one source's configuration (undefined clears it) and applies the merged one. */
export function setProductConfig(
  source: ProductConfigSource,
  config: ProductSettingsAndLayout | undefined,
  options: { apply?: boolean } = {},
): void {
  if (config && (config.settings || config.layout)) configured.set(source, config);
  else configured.delete(source);
  if (options.apply !== false) applyMerged();
}

/** Applies what the sources hold now. */
export function applyProductConfigs(): void {
  applyMerged();
}

/** The settings and layout of a product configuration (an embed prop, the build's file). */
export function parseProductConfig(raw: unknown, origin: string): ProductSettingsAndLayout {
  if (!isRecord(raw)) return {};
  const settings = parseProductSettings(raw.settings, origin);
  const layout = parseProductLayout(raw.layout, origin);
  return { ...(settings ? { settings } : {}), ...(layout ? { layout } : {}) };
}

/**
 * One mounted `OmnigentApp`'s source: its settings merge with the other mounts' (a later mount's
 * fields win), and its layout is built into `layout`, the mount's own policy.
 */
export interface EmbedProductConfigSource {
  readonly set: (
    config: ProductSettingsAndLayout | undefined,
    options?: { apply?: boolean },
  ) => void;
  /** Clears it after the current task unless it is set again first (a strict mode remount). */
  readonly release: () => void;
}

export function createEmbedProductConfigSource(
  layout: ProductLayoutPolicy,
): EmbedProductConfigSource {
  const order = mounts++;
  let releasing = false;
  return {
    set(config, options = {}) {
      releasing = false;
      const own = config && (config.settings || config.layout) ? config : undefined;
      mounted.set(order, { config: own, layout });
      if (options.apply !== false) applyMerged();
    },
    release() {
      releasing = true;
      queueMicrotask(() => {
        if (!releasing) return;
        releasing = false;
        mounted.delete(order);
        applyMerged();
      });
    },
  };
}

// The build's `web/product.json` (`{ "settings": ..., "layout": ... }`), when a build ships one.
const BUILD_FILES = import.meta.glob<unknown>("../../product.json", {
  eager: true,
  import: "default",
});

/**
 * The base of the key where the server's last product settings and layout are kept, for the next
 * load's start: `<base>@<server identity>`, so a server change (or another embed's server) never
 * reads them. A server with no identity (an embedder's `fetcher` and no `serverIdentity`) is kept
 * under `<base>@unidentified:<origin>`: its servers aren't told apart, so a failed probe still
 * keeps the last-known policy, and such embedders should set `serverIdentity`.
 *
 * The unkeyed entry of earlier builds has no known owner. It is read only for the same-origin
 * server (a wrong owner's locks fail closed, which is acceptable), and removed only when that
 * server answers.
 */
export const LAST_SERVER_PRODUCT_CONFIG_STORAGE_KEY = "omnigent:ui-product-config-server";

/** The unkeyed entry's key for the same-origin server, which is the only one that reads it. */
function sameOriginLegacyKey(): string {
  return `${LAST_SERVER_PRODUCT_CONFIG_STORAGE_KEY}@${window.location.origin}`;
}

/** The key the server the app talks to keeps its last-known configuration under. */
export function lastServerProductConfigKey(): string {
  const identity = getOmnigentServerIdentity();
  if (identity !== null) return `${LAST_SERVER_PRODUCT_CONFIG_STORAGE_KEY}@${identity}`;
  return `${LAST_SERVER_PRODUCT_CONFIG_STORAGE_KEY}@unidentified:${window.location.origin}`;
}

/** The build's file and the server's last-known configuration, before the server answers. */
export function applyBootProductConfigs(options: { apply?: boolean } = {}): void {
  const file = Object.values(BUILD_FILES)[0];
  if (file !== undefined) {
    setProductConfig("build", parseProductConfig(file, "product.json"), { apply: false });
  }
  applyLastServerProductConfig({ apply: false });
  if (options.apply !== false) applyMerged();
}

function applyLastServerProductConfig(options: { apply?: boolean } = {}): void {
  if (configured.has("server")) return;
  let last: unknown;
  const key = lastServerProductConfigKey();
  try {
    let text = window.localStorage.getItem(key);
    // The unkeyed entry of earlier builds still applies to the same-origin server until that
    // server answers, so an upgrade never starts without its locks.
    if (
      text === null &&
      key === `${LAST_SERVER_PRODUCT_CONFIG_STORAGE_KEY}@${window.location.origin}`
    ) {
      text = window.localStorage.getItem(LAST_SERVER_PRODUCT_CONFIG_STORAGE_KEY);
    }
    last =
      text !== null && text.length <= 4 * PRODUCT_SETTINGS_MAX_CHARS ? JSON.parse(text) : undefined;
  } catch {
    last = undefined;
  }
  setProductConfig("server", parseProductConfig(last, "server, last known"), options);
}

/**
 * Takes the server's `/v1/info` product settings and layout as the lowest source, kept for the
 * next load. A failed probe (the fallback info) says nothing new: the policy this server last
 * gave, kept under its key, holds, so a network error never lifts the locks it set (a server
 * never seen before has none to keep).
 */
export function applyServerProductConfig(info: ServerInfo): void {
  if (info === FALLBACK_SERVER_INFO || info === SERVER_INFO_OFFLINE_FALLBACK) {
    applyLastServerProductConfig();
    return;
  }
  const config = parseServerProductConfig(info.product);
  const key = lastServerProductConfigKey();
  try {
    if (config.settings || config.layout) {
      window.localStorage.setItem(key, JSON.stringify(config));
    } else window.localStorage.removeItem(key);
    // The unkeyed entry is the same-origin server's only by assumption: its answer replaces it.
    if (key === sameOriginLegacyKey()) {
      window.localStorage.removeItem(LAST_SERVER_PRODUCT_CONFIG_STORAGE_KEY);
    }
  } catch {
    // Storage errors only lose the next start's server policy.
  }
  setProductConfig("server", config);
}

/** For tests: forgets every source. */
export function resetProductConfigsForTests(): void {
  configured.clear();
  mounted.clear();
  appliedKey = "";
}
