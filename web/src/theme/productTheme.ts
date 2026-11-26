// The product's theme configuration (theming plan M10): which themes a product offers, its
// default, and what it locks. One path feeds the theme service, from three sources, highest
// first: the embed's `OmnigentAppProps.product.theme`, the build's `web/product.json`, and
// the server's `/v1/info` `product.theme` (server config `product: theme:`). Each field
// comes from the highest source that sets it.

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

const LIMITS = { chars: 131_072, nodes: 4000, depth: 4 } as const;
const MAX_ALLOWED = 100;
const MAX_LOCKED_TOKENS = 1000;
const ALLOWED_PATTERN = /^[A-Za-z0-9._/*-]{1,200}$/;
const OPTION_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const TOKEN_ID = /^[A-Za-z0-9-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringMap(
  raw: unknown,
  field: string,
  keyPattern: RegExp,
  limit: number,
  warn: (message: string) => void,
): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    warn(`${field} must be an object`);
    return undefined;
  }
  const out = Object.create(null) as Record<string, string>;
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!keyPattern.test(key) || typeof value !== "string" || value.length > 256) {
      warn(`${field}.${key.slice(0, 64)} is malformed`);
      continue;
    }
    if (++count > limit) {
      warn(`${field} has more than ${limit} entries`);
      break;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Checks a product theme configuration as a product wrote it (an embed prop, a build file
 * or the server's), warning about and leaving out what is malformed. Token values are
 * checked by the theme service against the registry, as a theme's are.
 */
export function parseProductTheme(raw: unknown, origin: string): ProductThemeConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  const warn = (message: string) => console.warn(`[theme] product theme (${origin}): ${message}`);
  const snapshot = snapshotPlainData(raw, LIMITS);
  if (!snapshot.ok) {
    warn(snapshot.reason);
    return undefined;
  }
  const value = snapshot.value;
  if (!isRecord(value)) {
    warn("must be an object");
    return undefined;
  }
  const out: { -readonly [Key in keyof ProductThemeConfig]: ProductThemeConfig[Key] } = {};
  if (value.default !== undefined) {
    if (isThemeSelection(value.default) || isContributedThemeId(value.default)) {
      out.default = value.default;
    } else warn("default is not a theme id");
  }
  if (value.allowed !== undefined) {
    if (Array.isArray(value.allowed)) {
      const allowed = value.allowed.filter(
        (entry): entry is string => typeof entry === "string" && ALLOWED_PATTERN.test(entry),
      );
      if (allowed.length !== value.allowed.length) warn("allowed has malformed entries");
      out.allowed = [...new Set(allowed)].slice(0, MAX_ALLOWED);
    } else warn("allowed must be a list");
  }
  if (value.lockMode !== undefined) {
    if (value.lockMode === "light" || value.lockMode === "dark") out.lockMode = value.lockMode;
    else warn('lockMode is "light" or "dark"');
  }
  const tokens = stringMap(value.lockedTokens, "lockedTokens", TOKEN_ID, MAX_LOCKED_TOKENS, warn);
  if (tokens) out.lockedTokens = tokens;
  const options = stringMap(value.lockedOptions, "lockedOptions", OPTION_ID, 100, warn);
  if (options) out.lockedOptions = options;
  if (value.lockedVariants !== undefined) {
    const variants = checkVariants(value.lockedVariants) as Record<string, string>;
    const given = isRecord(value.lockedVariants) ? Object.keys(value.lockedVariants) : [];
    for (const name of given) {
      if (!(name in variants)) {
        warn(
          `lockedVariants.${name.slice(0, 64)} ${isVariantName(name) ? "has no such value" : "is not a variant"}`,
        );
      }
    }
    out.lockedVariants = variants;
  }
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

/** Each field from the first configuration that sets it (highest precedence first). */
export function mergeProductThemes(
  configs: readonly (ProductThemeConfig | undefined)[],
): ProductThemeConfig | null {
  const merged: Record<string, unknown> = {};
  for (const config of configs) {
    if (!config) continue;
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined && !(key in merged)) merged[key] = value;
    }
  }
  return Object.keys(merged).length > 0 ? (merged as ProductThemeConfig) : null;
}

const configured = new Map<ProductThemeSource, ProductThemeConfig>();
let appliedKey = "null";

/**
 * Sets one source's configuration (undefined clears it) and gives the theme service the
 * merged one, the single path into `themeService.setProductPolicy`. With `apply: false`
 * it only records the source, for the next call that applies.
 */
export function setProductTheme(
  source: ProductThemeSource,
  config: ProductThemeConfig | undefined,
  options: { apply?: boolean } = {},
): void {
  if (config) configured.set(source, config);
  else configured.delete(source);
  if (options.apply === false) return;
  const merged = mergeProductThemes(PRODUCT_THEME_SOURCES.map((entry) => configured.get(entry)));
  const key = JSON.stringify(merged);
  if (key === appliedKey) return;
  appliedKey = key;
  themeService.setProductPolicy(merged);
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

/** Takes the server's `/v1/info` product theme as the lowest source (a failed probe has none). */
export function applyServerProductTheme(info: ServerInfo): void {
  setProductTheme("server", parseServerProductTheme(info.product?.theme));
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
