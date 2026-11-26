// The product's theme configuration (theming plan M10): which themes a product offers, its
// default, and what it locks. One path feeds the theme service, from three sources, highest
// first: the embed's `OmnigentAppProps.product.theme`, the build's `web/product.json`, and
// the server's `/v1/info` `product.theme` (server config `product: theme:`). Each field
// comes from the highest source that sets it; the locked maps merge per key.

import type { ServerInfo } from "@/lib/capabilities";
import { isContributedThemeId, isThemeSelection } from "@/lib/themePalette";
import type { UiTheme } from "./themeContributions";
import { themeService } from "./themeService";
import { snapshotPlainData } from "./validate";
import { checkVariants, isVariantName } from "./variants";

/** A product's theme configuration. Every field is optional. */
export interface ProductThemeConfig {
  /** The theme chosen on first run and on reset: a built-in palette's or a theme's id. */
  readonly default?: string;
  /**
   * The themes the picker and Settings offer and `select()` takes: list ids, member ids or
   * patterns where `*` matches anything (`"omnigent.themes/*"`, `"acme.brand/*"`).
   */
  readonly allowed?: readonly string[];
  /** The mode the app stays in, over the user's mode setting and any theme's. */
  readonly lockMode?: UiTheme;
  /** Token values applied last, over the theme and the user's customizations. */
  readonly lockedTokens?: Readonly<Record<string, string>>;
  /** Theme option choices by option id (`accent: "lava"`), for any theme that has the option. */
  readonly lockedOptions?: Readonly<Record<string, string>>;
  /** Style variants by name, over the theme's and the user's. */
  readonly lockedVariants?: Readonly<Record<string, string>>;
  /** No theme picker (the command and Settings' row). */
  readonly hidePicker?: boolean;
  /** No theme options, style variants or Advanced customizations in Settings; stored ones don't apply. */
  readonly hideCustomizations?: boolean;
}

/** What `OmnigentAppProps.product` and `web/product.json` carry. */
export interface ProductConfig {
  readonly theme?: ProductThemeConfig;
}

/** Where a product theme configuration comes from, highest precedence first. */
export const PRODUCT_THEME_SOURCES = ["embed", "build", "server"] as const;
export type ProductThemeSource = (typeof PRODUCT_THEME_SOURCES)[number];

/**
 * The most a product theme configuration's content may take, in UTF-16 code units, counted
 * by {@link productThemeCost}: the default, the allowed ids and the locked maps' keys and
 * values as JSON strings, two more per map entry and one more per allowed id. The server
 * caps what it serves to the same budget (`PRODUCT_THEME_MAX_CHARS` in
 * `omnigent/server/server_config.py`); a source over it keeps what fits, field by field.
 */
export const PRODUCT_THEME_MAX_CHARS = 131_072;
/** A field's own guard against absurd input, before the budget: over it, that field goes. */
const FIELD_LIMITS = { chars: 4 * PRODUCT_THEME_MAX_CHARS, nodes: 4000, depth: 3 } as const;
const MAX_ALLOWED = 100;
const MAX_LOCKED_TOKENS = 1000;
const ALLOWED_PATTERN = /^[A-Za-z0-9._/*-]{1,200}$/;
const OPTION_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const TOKEN_ID = /^[A-Za-z0-9-]{1,128}$/;
const FIELDS = [
  "default",
  "allowed",
  "lockMode",
  "lockedVariants",
  "lockedOptions",
  "lockedTokens",
  "hidePicker",
  "hideCustomizations",
] as const satisfies readonly (keyof ProductThemeConfig)[];

/** What a string takes of {@link PRODUCT_THEME_MAX_CHARS}: its JSON text's length. */
export function productThemeCost(text: string): number {
  return JSON.stringify(text).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The budget a configuration's content spends from, in the order its fields are read. */
class Budget {
  private left = PRODUCT_THEME_MAX_CHARS;
  spend(cost: number): boolean {
    if (cost > this.left) return false;
    this.left -= cost;
    return true;
  }
}

function overBudget(field: string, names: readonly string[], warn: (message: string) => void) {
  if (names.length === 0) return;
  const shown = names.slice(0, 10).map((name) => name.slice(0, 64));
  const more = names.length > shown.length ? ` and ${names.length - shown.length} more` : "";
  warn(
    `${field} is over the ${PRODUCT_THEME_MAX_CHARS}-character limit; left out: ${shown.join(", ")}${more}`,
  );
}

function stringMap(
  raw: unknown,
  field: string,
  keyPattern: RegExp,
  limit: number,
  budget: Budget,
  warn: (message: string) => void,
): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    warn(`${field} must be an object`);
    return undefined;
  }
  const out = Object.create(null) as Record<string, string>;
  const over: string[] = [];
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!keyPattern.test(key) || typeof value !== "string" || value.length > 256) {
      warn(`${field}.${key.slice(0, 64)} is malformed`);
      continue;
    }
    if (count + 1 > limit) {
      warn(`${field} has more than ${limit} entries`);
      break;
    }
    if (!budget.spend(productThemeCost(key) + productThemeCost(value) + 2)) {
      over.push(key);
      continue;
    }
    count += 1;
    out[key] = value;
  }
  overBudget(field, over, warn);
  // A map left with nothing (empty, or every entry malformed) is no opinion.
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The known fields of a configuration, each copied as plain data on its own: one a
 * hostile or oversized field spoils is left out alone. A string when it isn't an object.
 */
function readFields(
  raw: unknown,
  warn: (message: string) => void,
): Partial<Record<(typeof FIELDS)[number], unknown>> | string {
  const out: Partial<Record<(typeof FIELDS)[number], unknown>> = {};
  try {
    if (!isRecord(raw)) return "must be an object";
    const prototype = Object.getPrototypeOf(raw) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return "must be a plain object";
    for (const field of FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, field);
      if (!descriptor || descriptor.value === undefined) continue;
      if (!("value" in descriptor)) {
        warn(`${field} is an accessor`);
        continue;
      }
      const snapshot = snapshotPlainData(descriptor.value, FIELD_LIMITS);
      if (snapshot.ok) out[field] = snapshot.value;
      else warn(`${field}: ${snapshot.reason}; left out`);
    }
  } catch {
    return "unreadable data";
  }
  return out;
}

/**
 * Checks a product theme configuration as a product wrote it (an embed prop, a build file
 * or the server's), warning about and leaving out what is malformed, field by field: one
 * bad or oversized field never costs the others. Token values are checked by the theme
 * service against the registry, as a theme's are. An empty or all-malformed list or map
 * is no opinion: it is left out, so a lower source's applies.
 */
export function parseProductTheme(raw: unknown, origin: string): ProductThemeConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  const warn = (message: string) => console.warn(`[theme] product theme (${origin}): ${message}`);
  const value = readFields(raw, warn);
  if (typeof value === "string") {
    warn(value);
    return undefined;
  }
  const budget = new Budget();
  const out: { -readonly [Key in keyof ProductThemeConfig]: ProductThemeConfig[Key] } = {};
  if (value.default !== undefined) {
    if (
      (isThemeSelection(value.default) || isContributedThemeId(value.default)) &&
      budget.spend(productThemeCost(value.default))
    ) {
      out.default = value.default;
    } else warn("default is not a theme id");
  }
  if (value.allowed !== undefined) {
    if (Array.isArray(value.allowed)) {
      const allowed = value.allowed.filter(
        (entry): entry is string => typeof entry === "string" && ALLOWED_PATTERN.test(entry),
      );
      if (allowed.length !== value.allowed.length) warn("allowed has malformed entries");
      const unique = [...new Set(allowed)].slice(0, MAX_ALLOWED);
      const kept = unique.filter((entry) => budget.spend(productThemeCost(entry) + 1));
      overBudget(
        "allowed",
        unique.filter((entry) => !kept.includes(entry)),
        warn,
      );
      // Nothing well-formed left: no restriction (fails open), not "allow nothing".
      if (kept.length > 0) out.allowed = kept;
      else warn("allowed has no well-formed entry; every theme is allowed");
    } else warn("allowed must be a list");
  }
  if (value.lockMode !== undefined) {
    if (value.lockMode === "light" || value.lockMode === "dark") out.lockMode = value.lockMode;
    else warn('lockMode is "light" or "dark"');
  }
  if (value.lockedVariants !== undefined) {
    const variants = checkVariants(value.lockedVariants) as Record<string, string>;
    const given = isRecord(value.lockedVariants) ? Object.keys(value.lockedVariants) : [];
    if (!isRecord(value.lockedVariants)) warn("lockedVariants must be an object");
    for (const name of given) {
      if (!(name in variants)) {
        warn(
          `lockedVariants.${name.slice(0, 64)} ${isVariantName(name) ? "has no such value" : "is not a variant"}`,
        );
      }
    }
    const kept = Object.create(null) as Record<string, string>;
    const over: string[] = [];
    for (const [name, choice] of Object.entries(variants)) {
      if (budget.spend(productThemeCost(name) + productThemeCost(choice) + 2)) kept[name] = choice;
      else over.push(name);
    }
    overBudget("lockedVariants", over, warn);
    if (Object.keys(kept).length > 0) out.lockedVariants = kept;
  }
  const options = stringMap(value.lockedOptions, "lockedOptions", OPTION_ID, 100, budget, warn);
  if (options) out.lockedOptions = options;
  const tokens = stringMap(
    value.lockedTokens,
    "lockedTokens",
    TOKEN_ID,
    MAX_LOCKED_TOKENS,
    budget,
    warn,
  );
  if (tokens) out.lockedTokens = tokens;
  for (const key of ["hidePicker", "hideCustomizations"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] === "boolean") out[key] = value[key];
    else warn(`${key} must be true or false`);
  }
  return out;
}

const SERVER_KEYS: Readonly<Record<string, keyof ProductThemeConfig>> = {
  default: "default",
  allowed: "allowed",
  lock_mode: "lockMode",
  locked_tokens: "lockedTokens",
  locked_options: "lockedOptions",
  locked_variants: "lockedVariants",
  hide_picker: "hidePicker",
  hide_customizations: "hideCustomizations",
};

/** The server's `/v1/info` `product.theme` (snake_case keys), checked like the others. */
export function parseServerProductTheme(raw: unknown): ProductThemeConfig | undefined {
  if (!isRecord(raw)) return undefined;
  const camel: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const name = SERVER_KEYS[key];
    // The server writes unset keys as null.
    if (name && value !== null) camel[name] = value;
  }
  return parseProductTheme(camel, "server");
}

const LOCK_MAPS = new Set<string>(["lockedTokens", "lockedOptions", "lockedVariants"]);

/**
 * Each field from the first configuration that sets it (highest precedence first); the
 * locked maps merge per key, the highest source that locks a key winning it. An empty map
 * or list is no opinion.
 */
export function mergeProductThemes(
  configs: readonly (ProductThemeConfig | undefined)[],
): ProductThemeConfig | null {
  const merged: Record<string, unknown> = {};
  for (const config of configs) {
    if (!config) continue;
    for (const [key, value] of Object.entries(config)) {
      if (value === undefined) continue;
      if (LOCK_MAPS.has(key) && isRecord(value)) {
        const into = (merged[key] ??= Object.create(null)) as Record<string, unknown>;
        for (const [name, entry] of Object.entries(value)) if (!(name in into)) into[name] = entry;
        continue;
      }
      if (Array.isArray(value) && value.length === 0) continue;
      if (!(key in merged)) merged[key] = value;
    }
  }
  const out = Object.fromEntries(
    Object.entries(merged).filter(
      ([key, value]) => !(LOCK_MAPS.has(key) && isRecord(value) && Object.keys(value).length === 0),
    ),
  );
  return Object.keys(out).length > 0 ? (out as ProductThemeConfig) : null;
}

const configured = new Map<ProductThemeSource, ProductThemeConfig>();
/** Each mounted `OmnigentApp`'s configuration, by mount order. */
const mounted = new Map<number, ProductThemeConfig>();
let mounts = 0;
let appliedKey = "null";

/** The merged configuration, given to the theme service when it changed. */
function applyMerged(): void {
  // A later mount's over an earlier's, all of them over a render's not yet mounted.
  const embeds = [...mounted.entries()].sort(([a], [b]) => b - a).map(([, config]) => config);
  const merged = mergeProductThemes([
    ...embeds,
    ...PRODUCT_THEME_SOURCES.map((entry) => configured.get(entry)),
  ]);
  const key = JSON.stringify(merged);
  if (key === appliedKey) return;
  appliedKey = key;
  themeService.setProductPolicy(merged);
}

/**
 * Sets one source's configuration (undefined clears it) and gives the theme service the
 * merged one, the single path into `themeService.setProductPolicy`. With `apply: false`
 * it only records the source, for the next call that applies. `"embed"` is a render's
 * configuration before its app mounts; a mounted app has its own source
 * ({@link createEmbedProductThemeSource}).
 */
export function setProductTheme(
  source: ProductThemeSource,
  config: ProductThemeConfig | undefined,
  options: { apply?: boolean } = {},
): void {
  if (config) configured.set(source, config);
  else configured.delete(source);
  if (options.apply === false) return;
  applyMerged();
}

/** One mounted `OmnigentApp`'s product theme source. */
export interface EmbedProductThemeSource {
  /** Sets this mount's configuration (undefined clears it). */
  readonly set: (config: ProductThemeConfig | undefined, options?: { apply?: boolean }) => void;
  /**
   * Clears it after the current task unless it is set again first: an unmount clears it,
   * a remount in the same commit (React's strict mode) changes nothing.
   */
  readonly release: () => void;
}

/**
 * A source for one mounted `OmnigentApp`, over the build's and the server's: two mounts
 * each keep their own, the later mount's fields and locks winning over the earlier's.
 */
export function createEmbedProductThemeSource(): EmbedProductThemeSource {
  const order = mounts++;
  let releasing = false;
  return {
    set(config, options = {}) {
      releasing = false;
      if (config) mounted.set(order, config);
      else mounted.delete(order);
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

/** The merged configuration the theme service has (for tests and diagnostics). */
export function getProductTheme(): ProductThemeConfig | null {
  return themeService.getProductPolicy();
}

// The build's `web/product.json` (`{ "theme": { ... } }`), when a product build ships one.
const BUILD_FILES = import.meta.glob<unknown>("../../product.json", {
  eager: true,
  import: "default",
});

/** Where the server's last product theme is kept, for the first paint of the next load. */
export const LAST_SERVER_PRODUCT_THEME_STORAGE_KEY = "omnigent:ui-product-theme-server";

/**
 * Takes the server's `/v1/info` product theme as the lowest source (a failed probe has
 * none), and keeps it for the next load's first paint.
 */
export function applyServerProductTheme(info: ServerInfo): void {
  const config = parseServerProductTheme(info.product?.theme);
  try {
    if (config && Object.keys(config).length > 0) {
      window.localStorage.setItem(LAST_SERVER_PRODUCT_THEME_STORAGE_KEY, JSON.stringify(config));
    } else window.localStorage.removeItem(LAST_SERVER_PRODUCT_THEME_STORAGE_KEY);
  } catch {
    // Storage errors only lose the next first paint's server policy.
  }
  setProductTheme("server", config);
}

/** Reads the build's product file into its source; call once, before the theme first applies. */
export function applyBuildProductTheme(options: { apply?: boolean } = {}): void {
  const file = Object.values(BUILD_FILES)[0];
  if (file === undefined) return;
  setProductTheme(
    "build",
    parseProductTheme(isRecord(file) ? file.theme : undefined, "product.json"),
    options,
  );
}

/**
 * The sources known before the server answers: the build's file and the server's last
 * product theme (checked again; the server's answer replaces it). Call once, before the
 * theme first applies, so the first paint (and its cache) holds the product's policy.
 */
export function applyBootProductThemes(options: { apply?: boolean } = {}): void {
  applyBuildProductTheme({ apply: false });
  let last: unknown;
  try {
    const text = window.localStorage.getItem(LAST_SERVER_PRODUCT_THEME_STORAGE_KEY);
    last =
      text !== null && text.length <= 4 * PRODUCT_THEME_MAX_CHARS ? JSON.parse(text) : undefined;
  } catch {
    last = undefined;
  }
  if (!configured.has("server")) {
    setProductTheme("server", parseProductTheme(last, "server, last known"), { apply: false });
  }
  if (options.apply !== false) applyMerged();
}

/** Gives the theme service the configurations recorded so far (an embed's, before its mount). */
export function applyProductThemes(): void {
  applyMerged();
}
