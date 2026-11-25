// A contributed theme's JSON file (theming plan, "Theme JSON"): `colors` (Omnigent token
// ids, the extension's colours and the VS Code aliases), `tokenColors`, `terminal`,
// `brand` and `omnigent.{tokens,variants,options}`, read into checked values. Unset keys
// fall back to the registry; unknown keys and bad values warn and are left out.
// Pure, shared by the page (`themeService.ts`) and the dev plugin.

import { getToken, TOKENS } from "./tokens/registry.ts";
import { TERMINAL_ANSI_NAMES } from "./tokens/terminal.ts";
import { VSCODE_COLOR_ALIAS_MAP, VSCODE_COLOR_ALIAS_ORDER } from "./vscodeColorAliases.ts";
import { normalizeExtensionPath, type UiTheme } from "./themeContributions.ts";
import {
  nullMap,
  snapshotPlainData,
  THEME_LIMITS,
  TOKEN_CONSTRAINTS,
  validateTokenValue,
  type PlainData,
  type ValueContext,
  type ValueKind,
} from "./validate.ts";

/** A checked token value: the host's own text, and the tokens it reads. */
export interface ThemeValue {
  readonly value: string;
  readonly references: readonly string[];
}

/** Token id to checked value (no prototype). */
export type ThemeTokens = Record<string, ThemeValue>;

export interface ThemeOptionChoice {
  readonly id: string;
  readonly label: string;
  readonly tokens: ThemeTokens;
}

export interface ThemeOption {
  readonly id: string;
  readonly label: string;
  /** A choice id; the first choice when the file names none or an unknown one. */
  readonly default: string;
  readonly choices: readonly ThemeOptionChoice[];
}

/** A brand section: asset URLs (resolved by the caller) and an app name. */
export interface ThemeBrand {
  readonly appName?: string;
  readonly logo?: string;
  readonly wordmark?: string;
  readonly favicon?: string;
}

/** The syntax theme a file's `tokenColors` make (checked again by registerSyntaxTheme). */
export interface ThemeSyntax {
  readonly colors: Record<string, string>;
  readonly tokenColors: readonly PlainData[];
}

export interface ParsedTheme {
  /** Layer 2: aliases, then `colors` ids, then `terminal`, then `omnigent.tokens`. */
  readonly tokens: ThemeTokens;
  readonly syntax: ThemeSyntax | undefined;
  readonly brand: ThemeBrand | undefined;
  readonly options: readonly ThemeOption[];
  /** Stored only until the variants ship (theming plan M9). */
  readonly variants: Readonly<Record<string, string>>;
  /** VS Code colour ids that have no Omnigent token (a partial import). */
  readonly unmapped: readonly string[];
  readonly issues: readonly string[];
}

export interface ThemeFileOptions {
  readonly uiTheme: UiTheme;
  /**
   * What values may reference and the fonts they may name; `isKnownToken` must also know
   * the extension's colours.
   */
  readonly context: ValueContext;
  /** The extension's colour tokens by the ids a theme may write (`<id>` and the token). */
  readonly extensionColors: ReadonlyMap<string, string>;
  /** A brand asset's URL, or undefined when the extension doesn't ship it as one. */
  readonly assetUrl?: (path: string) => string | undefined;
}

/** Caps on a theme file's structure (beyond {@link THEME_LIMITS}). */
export const THEME_FILE_LIMITS = {
  options: 16,
  choices: 16,
  variants: 32,
  appName: 64,
} as const;

const KNOWN_KEYS = new Set([
  "$schema",
  "name",
  "type",
  "colors",
  "tokenColors",
  "terminal",
  "brand",
  "omnigent",
  // VS Code keys that carry nothing for Omnigent: accepted without a warning.
  "semanticHighlighting",
  "semanticTokenColors",
]);
const OMNIGENT_KEYS = new Set(["tokens", "variants", "options"]);
const BRAND_KEYS = ["logo", "wordmark", "favicon", "appName"] as const;
const OPTION_ID = /^[a-z][a-zA-Z0-9-]{0,31}$/;
const VARIANT_VALUE = /^[a-z][a-zA-Z0-9-]{0,31}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

// Alpha tokens whose default scales by the elevation guard: a theme's plain alpha is
// scaled the same way, so `ui-elevation: 0` still removes its shadows.
const ELEVATION_SCALED = new Set(
  TOKENS.filter(
    (token) => token.kind === "alpha" && /--omnigent-elevation/.test(token.default?.light ?? ""),
  ).map((token) => token.id),
);

/** The terminal slot a `terminal` key names (`ansiBrightRed`, `bright-red`, `cursorAccent`). */
function terminalToken(key: string): string | undefined {
  const kebab = key
    .replace(/^ansi(?=[A-Z])/, "")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase();
  if (TERMINAL_ANSI_NAMES.includes(kebab)) return `terminal-ansi-${kebab}`;
  const token = getToken(`terminal-${kebab}`);
  return token?.group === "terminal" ? token.id : undefined;
}

function isRecord(value: unknown): value is Record<string, PlainData> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quoted(text: string): string {
  return JSON.stringify(text.slice(0, 64));
}

/**
 * Reads a theme file. Never throws: everything wrong is an issue, and the rest applies.
 *
 * @param raw The parsed JSON (copied once before anything checks it).
 */
export function parseThemeFile(raw: unknown, options: ThemeFileOptions): ParsedTheme {
  const issues: string[] = [];
  const tokens = nullMap<ThemeValue>();
  const empty: ParsedTheme = {
    tokens,
    syntax: undefined,
    brand: undefined,
    options: [],
    variants: nullMap<string>(),
    unmapped: [],
    issues,
  };
  const snapshot = snapshotPlainData(raw, {
    chars: THEME_LIMITS.jsonBytes,
    nodes: 20_000,
    depth: 12,
  });
  if (!snapshot.ok) {
    issues.push(`theme rejected: ${snapshot.reason}`);
    return empty;
  }
  const theme = snapshot.value;
  if (!isRecord(theme)) {
    issues.push("theme rejected: not a JSON object");
    return empty;
  }
  if (JSON.stringify(theme).length > THEME_LIMITS.jsonBytes) {
    issues.push(`theme rejected: more than ${THEME_LIMITS.jsonBytes} bytes of JSON`);
    return empty;
  }
  for (const key of Object.keys(theme)) {
    if (!KNOWN_KEYS.has(key)) issues.push(`unknown key ${quoted(key)}; ignoring it`);
  }

  const kindOf = (id: string): ValueKind | undefined => {
    if ([...options.extensionColors.values()].includes(id)) return "color";
    return getToken(id)?.kind;
  };
  let count = 0;
  /** Checks one value for a token; undefined (with an issue) when it fails. */
  const check = (id: string, value: PlainData, where: string): ThemeValue | undefined => {
    const kind = kindOf(id);
    if (kind === undefined) {
      issues.push(`${where}: no token ${quoted(id)}; ignoring it`);
      return undefined;
    }
    const result = validateTokenValue(kind, value, options.context, TOKEN_CONSTRAINTS[id]);
    if (!result.ok) {
      issues.push(`${where}: ${result.reason}; ignoring it`);
      return undefined;
    }
    const scaled =
      ELEVATION_SCALED.has(id) && /^[\d.]+%?$/.test(result.value)
        ? `calc(${result.value} * var(--omnigent-elevation))`
        : result.value;
    return { value: scaled, references: result.references };
  };
  const set = (target: ThemeTokens, id: string, value: ThemeValue) => {
    if (!(id in target)) count += 1;
    if (count > THEME_LIMITS.tokens) {
      if (count === THEME_LIMITS.tokens + 1) {
        issues.push(`more than ${THEME_LIMITS.tokens} tokens; the rest is ignored`);
      }
      return;
    }
    target[id] = value;
  };
  /** A token id as `colors` or `omnigent.tokens` may write it. */
  const tokenId = (key: string): string | undefined => {
    const extension = options.extensionColors.get(key);
    if (extension) return extension;
    if (key.startsWith("color-")) return undefined;
    return getToken(key) ? key : undefined;
  };

  // colors: aliases in table order first, then Omnigent ids, which beat every alias.
  const unmapped: string[] = [];
  const syntaxColors = nullMap<string>();
  if (theme.colors !== undefined && !isRecord(theme.colors)) issues.push("colors: not an object");
  if (isRecord(theme.colors)) {
    const entries = Object.entries(theme.colors);
    const aliases = entries
      .filter(([key]) => VSCODE_COLOR_ALIAS_MAP.has(key))
      .sort(([a], [b]) => VSCODE_COLOR_ALIAS_ORDER.get(a)! - VSCODE_COLOR_ALIAS_ORDER.get(b)!);
    for (const [key, value] of aliases) {
      if (typeof value === "string") syntaxColors[key] = value;
      for (const id of VSCODE_COLOR_ALIAS_MAP.get(key)!) {
        const checked = check(id, value, `colors.${key}`);
        if (checked) set(tokens, id, checked);
      }
    }
    for (const [key, value] of entries) {
      if (VSCODE_COLOR_ALIAS_MAP.has(key)) continue;
      const id = tokenId(key);
      if (id === undefined) {
        // A VS Code id (dotted) without an Omnigent token: the syntax theme may still use it.
        if (/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/.test(key)) {
          unmapped.push(key);
          if (typeof value === "string") syntaxColors[key] = value;
        } else {
          issues.push(`colors: no token ${quoted(key)}; ignoring it`);
        }
        continue;
      }
      const kind = kindOf(id);
      if (kind !== "color" && kind !== "image") {
        issues.push(`colors.${key}: not a colour token; set it in omnigent.tokens`);
        continue;
      }
      const checked = check(id, value, `colors.${key}`);
      if (checked) set(tokens, id, checked);
    }
  }

  if (theme.terminal !== undefined) {
    if (!isRecord(theme.terminal)) issues.push("terminal: not an object");
    else {
      for (const [key, value] of Object.entries(theme.terminal)) {
        const id = terminalToken(key);
        if (!id) {
          issues.push(`terminal: no slot ${quoted(key)}; ignoring it`);
          continue;
        }
        const checked = check(id, value, `terminal.${key}`);
        if (checked) set(tokens, id, checked);
      }
    }
  }

  let syntax: ThemeSyntax | undefined;
  if (theme.tokenColors !== undefined) {
    if (!Array.isArray(theme.tokenColors)) issues.push("tokenColors: not an array");
    else syntax = { colors: syntaxColors, tokenColors: theme.tokenColors };
  }

  let brand: ThemeBrand | undefined;
  if (theme.brand !== undefined) {
    if (!isRecord(theme.brand)) issues.push("brand: not an object");
    else {
      const section: { -readonly [K in keyof ThemeBrand]: string } = {};
      for (const key of Object.keys(theme.brand)) {
        if (!(BRAND_KEYS as readonly string[]).includes(key)) {
          issues.push(`brand: unknown key ${quoted(key)}; ignoring it`);
        }
      }
      for (const key of ["logo", "wordmark", "favicon"] as const) {
        const value = theme.brand[key];
        if (value === undefined) continue;
        const path = normalizeExtensionPath(value);
        const url = path === undefined ? undefined : options.assetUrl?.(path);
        if (url === undefined) {
          issues.push(`brand.${key}: ${quoted(String(value))} is not a shipped brand image`);
        } else {
          section[key] = url;
        }
      }
      const name = theme.brand.appName;
      if (name !== undefined) {
        const clean =
          typeof name === "string"
            ? [...name.replace(CONTROL_CHARACTERS, "").trim()]
                .slice(0, THEME_FILE_LIMITS.appName)
                .join("")
            : "";
        if (clean) section.appName = clean;
        else issues.push("brand.appName: not a non-empty string");
      }
      if (Object.keys(section).length > 0) brand = section;
    }
  }

  const variants = nullMap<string>();
  const themeOptions: ThemeOption[] = [];
  /** `omnigent.tokens` or an option choice's tokens, into `target`. */
  const readTokens = (source: PlainData | undefined, where: string, target: ThemeTokens) => {
    if (source === undefined) return;
    if (!isRecord(source)) {
      issues.push(`${where}: not an object`);
      return;
    }
    for (const [key, value] of Object.entries(source)) {
      if (key.startsWith("color-")) {
        issues.push(`${where}: ${quoted(key)} is Tailwind's variable, not a token; ignoring it`);
        continue;
      }
      const id = tokenId(key) ?? key;
      const checked = check(id, value, `${where}.${key}`);
      if (checked) set(target, id, checked);
    }
  };
  if (theme.omnigent !== undefined) {
    const section = theme.omnigent;
    if (!isRecord(section)) issues.push("omnigent: not an object");
    else {
      for (const key of Object.keys(section)) {
        if (!OMNIGENT_KEYS.has(key)) issues.push(`omnigent: unknown key ${quoted(key)}`);
      }
      readTokens(section.tokens, "omnigent.tokens", tokens);
      if (section.variants !== undefined) {
        if (!isRecord(section.variants)) issues.push("omnigent.variants: not an object");
        else {
          for (const [key, value] of Object.entries(section.variants).slice(
            0,
            THEME_FILE_LIMITS.variants,
          )) {
            if (!OPTION_ID.test(key) || typeof value !== "string" || !VARIANT_VALUE.test(value)) {
              issues.push(`omnigent.variants.${key.slice(0, 32)}: not a variant name and value`);
            } else variants[key] = value;
          }
        }
      }
      if (section.options !== undefined) {
        if (!Array.isArray(section.options)) issues.push("omnigent.options: not an array");
        else {
          section.options.slice(0, THEME_FILE_LIMITS.options).forEach((entry, index) => {
            const where = `omnigent.options[${index}]`;
            if (!isRecord(entry) || typeof entry.id !== "string" || !OPTION_ID.test(entry.id)) {
              issues.push(`${where}: needs an "id" matching ${OPTION_ID.source}`);
              return;
            }
            if (themeOptions.some((option) => option.id === entry.id)) {
              issues.push(`${where}: duplicate option ${entry.id}`);
              return;
            }
            if (!isRecord(entry.choices)) {
              issues.push(`${where}: "choices" must be an object`);
              return;
            }
            const choices: ThemeOptionChoice[] = [];
            for (const [choiceId, choice] of Object.entries(entry.choices).slice(
              0,
              THEME_FILE_LIMITS.choices,
            )) {
              if (!OPTION_ID.test(choiceId) || !isRecord(choice)) {
                issues.push(`${where}.choices.${choiceId.slice(0, 32)}: malformed`);
                continue;
              }
              const choiceTokens = nullMap<ThemeValue>();
              readTokens(choice.tokens, `${where}.choices.${choiceId}.tokens`, choiceTokens);
              const label =
                typeof choice.label === "string" && choice.label.trim()
                  ? choice.label.trim().slice(0, 80)
                  : choiceId;
              choices.push({ id: choiceId, label, tokens: choiceTokens });
            }
            if (choices.length === 0) {
              issues.push(`${where}: no valid choices`);
              return;
            }
            const fallback = choices[0]!.id;
            const named = typeof entry.default === "string" ? entry.default : undefined;
            if (named !== undefined && !choices.some((choice) => choice.id === named)) {
              issues.push(`${where}: default ${quoted(named)} is not a choice; using ${fallback}`);
            }
            themeOptions.push({
              id: entry.id,
              label:
                typeof entry.label === "string" && entry.label.trim()
                  ? entry.label.trim().slice(0, 80)
                  : entry.id,
              default: named && choices.some((choice) => choice.id === named) ? named : fallback,
              choices,
            });
          });
        }
      }
    }
  }

  return { tokens, syntax, brand, options: themeOptions, variants, unmapped, issues };
}
