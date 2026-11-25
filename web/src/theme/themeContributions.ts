// An extension's theme contributions (theming plan, "Theme contribution API"):
// `contributes.themes`, `contributes.colors` and `contributes.fonts`, read into checked
// plain data. Problems are warnings, never failures, as in VS Code: the rest loads.
// Pure, shared by the page (`vscodeExtensions/contributions.ts`) and the dev plugin.

import { THEME_LIMITS, validateTokenValue, type ValueContext } from "./validate.ts";

export type UiTheme = "light" | "dark";

export interface ThemeContribution {
  /** The id as the manifest writes it. */
  readonly id: string;
  /** `<extensionId>/<id>`. */
  readonly fullId: string;
  readonly label: string;
  readonly uiTheme: UiTheme;
  /** The theme file, normalized ({@link normalizeExtensionPath}). */
  readonly path: string;
  /** Pairs a light and a dark member, which switch with the mode. */
  readonly family: string | undefined;
  /** A line the picker and Settings show under the label. */
  readonly description?: string;
  /** The family's name in the picker (the members' labels otherwise). */
  readonly familyLabel?: string;
}

export interface ColorContribution {
  readonly id: string;
  /** The CSS variable name without `--`: `x-<publisher>-<name>-<id>`. */
  readonly token: string;
  readonly description: string;
  /** Checked defaults (host syntax). A mode without one is unset there. */
  readonly defaults: { readonly light?: string; readonly dark?: string };
}

export interface FontContribution {
  /** The family as the extension's themes name it. */
  readonly family: string;
  /** The namespaced family the host loads it as: `x-<publisher>-<name>-<family>`. */
  readonly cssFamily: string;
  /** The `.woff2` file, normalized. */
  readonly src: string;
  readonly weight: string | undefined;
  readonly style: "normal" | "italic" | "oblique" | undefined;
}

export interface ThemeContributions {
  readonly themes: readonly ThemeContribution[];
  readonly colors: readonly ColorContribution[];
  readonly fonts: readonly FontContribution[];
}

export const EMPTY_THEME_CONTRIBUTIONS: ThemeContributions = Object.freeze({
  themes: Object.freeze([]),
  colors: Object.freeze([]),
  fonts: Object.freeze([]),
});

/** Caps on the theme contributions of one extension. */
export const THEME_CONTRIBUTION_LIMITS = {
  themes: THEME_LIMITS.themesPerExtension,
  colors: 200,
  fonts: 16,
  /** Bytes of one font file. */
  fontBytes: 2 * 1024 * 1024,
  /** Bytes of one brand image. */
  brandBytes: 512 * 1024,
} as const;

const THEME_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const FAMILY_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const COLOR_ID = /^[a-z][a-z0-9-]{0,47}$/;
const FONT_FAMILY = /^[A-Za-z0-9 _-]{1,64}$/;
const FONT_WEIGHT = /^(?:normal|bold|[1-9]\d{0,2}|1000)(?: (?:[1-9]\d{0,2}|1000))?$/;
const MAX_LABEL_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 300;

/** VS Code's `uiTheme` values, as the light or dark mode they are. */
const UI_THEMES: Readonly<Record<string, UiTheme>> = {
  light: "light",
  dark: "dark",
  vs: "light",
  "vs-dark": "dark",
  "hc-light": "light",
  "hc-black": "dark",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A file path inside an extension, as a manifest or theme writes it (`./themes/a.json`),
 * normalized to `themes/a.json`; undefined when it could leave the folder or is malformed
 * (absolute, `..`, a backslash, a scheme, empty segments, odd characters).
 */
export function normalizeExtensionPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return undefined;
  const path = value.startsWith("./") ? value.slice(2) : value;
  if (!/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(path)) return undefined;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return path;
}

/**
 * The `x-<encoded id>` prefix of an extension's CSS names. The encoding is injective and
 * has no `-`, so the first `-` after it ends the prefix: `a`-`z` and `0`-`9` stay, `.`
 * becomes `__`, any other character `_` and two hex digits (`-` is `_2d`, `A` is `_41`), or
 * `_u` and six past U+00FF.
 * `acme.theme-fixture` is `x-acme__theme_2dfixture`.
 */
export function extensionCssPrefix(extensionId: string): string {
  const encoded = [...extensionId]
    .map((char) => {
      if (/[a-z0-9]/.test(char)) return char;
      if (char === ".") return "__";
      const code = char.codePointAt(0)!;
      const hex = code.toString(16);
      return code < 0x100 ? `_${hex.padStart(2, "0")}` : `_u${hex.padStart(6, "0")}`;
    })
    .join("");
  return `x-${encoded}`;
}

/** The namespaced family an extension's font loads as. */
export function namespacedFontFamily(extensionId: string, family: string): string {
  return `${extensionCssPrefix(extensionId)}-${family.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`;
}

// Control, format (bidi, zero-width) and separator characters, which a shown label must not carry.
// eslint-disable-next-line no-control-regex
const HIDDEN_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]/gu;

/** A label as the host shows it: control, format and separator characters removed, capped. */
export function labelOf(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(HIDDEN_CHARACTERS, "").trim();
  return clean !== "" ? [...clean].slice(0, max).join("").trim() : undefined;
}

/**
 * Reads `contributes.themes`, `.colors` and `.fonts`. `context` checks the colours'
 * defaults (they may read registry tokens, and the extension's other colours).
 */
export function parseThemeContributions(
  extensionId: string,
  contributes: Record<string, unknown>,
  context: Pick<ValueContext, "isKnownToken">,
): { contributions: ThemeContributions; warnings: string[] } {
  const warnings: string[] = [];
  const list = (key: "themes" | "colors" | "fonts", max: number): unknown[] => {
    const raw = contributes[key];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      warnings.push(`"contributes.${key}" must be an array`);
      return [];
    }
    if (raw.length > max)
      warnings.push(`contributes.${key}: more than ${max}; the rest is ignored`);
    return raw.slice(0, max);
  };

  const fonts: FontContribution[] = [];
  list("fonts", THEME_CONTRIBUTION_LIMITS.fonts).forEach((entry: unknown, index) => {
    const where = `contributes.fonts[${index}]`;
    if (!isRecord(entry)) return void warnings.push(`${where} must be an object`);
    const { family, src, weight, style } = entry;
    if (typeof family !== "string" || !FONT_FAMILY.test(family)) {
      return void warnings.push(`${where}: "family" must match ${FONT_FAMILY.source}`);
    }
    const path = normalizeExtensionPath(src);
    if (path === undefined || !path.endsWith(".woff2")) {
      return void warnings.push(`${where}: "src" must be a .woff2 file inside the extension`);
    }
    const weightText = weight === undefined ? undefined : String(weight);
    if (weightText !== undefined && !FONT_WEIGHT.test(weightText)) {
      return void warnings.push(`${where}: invalid "weight" ${JSON.stringify(weight)}`);
    }
    if (style !== undefined && style !== "normal" && style !== "italic" && style !== "oblique") {
      return void warnings.push(`${where}: "style" must be normal, italic or oblique`);
    }
    fonts.push({
      family,
      cssFamily: namespacedFontFamily(extensionId, family),
      src: path,
      weight: weightText,
      style,
    });
  });

  const prefix = extensionCssPrefix(extensionId);
  const rawColors = list("colors", THEME_CONTRIBUTION_LIMITS.colors);
  const ownTokens = new Set(
    rawColors.flatMap((entry) =>
      isRecord(entry) && typeof entry.id === "string" && COLOR_ID.test(entry.id)
        ? [`${prefix}-${entry.id}`]
        : [],
    ),
  );
  const colorContext: ValueContext = {
    isKnownToken: (id) => ownTokens.has(id) || context.isKnownToken(id),
  };
  const colors: ColorContribution[] = [];
  rawColors.forEach((entry: unknown, index) => {
    const where = `contributes.colors[${index}]`;
    if (!isRecord(entry)) return void warnings.push(`${where} must be an object`);
    const { id, description, defaults } = entry;
    if (typeof id !== "string" || !COLOR_ID.test(id)) {
      return void warnings.push(`${where}: "id" must match ${COLOR_ID.source}`);
    }
    if (colors.some((color) => color.id === id)) {
      return void warnings.push(`${where}: duplicate colour id ${id}`);
    }
    const checked: { light?: string; dark?: string } = {};
    if (defaults !== undefined && !isRecord(defaults)) {
      warnings.push(`${where}: "defaults" must be an object of light and dark`);
    } else if (isRecord(defaults)) {
      for (const mode of ["light", "dark"] as const) {
        if (defaults[mode] === undefined) continue;
        const result = validateTokenValue("color", defaults[mode], colorContext);
        if (result.ok) checked[mode] = result.value;
        else warnings.push(`${where}: defaults.${mode} ${result.reason}; left unset`);
      }
    }
    colors.push({
      id,
      token: `${prefix}-${id}`,
      description: labelOf(description, MAX_DESCRIPTION_LENGTH) ?? "",
      defaults: checked,
    });
  });

  const themes: ThemeContribution[] = [];
  list("themes", THEME_CONTRIBUTION_LIMITS.themes).forEach((entry: unknown, index) => {
    const where = `contributes.themes[${index}]`;
    if (!isRecord(entry)) return void warnings.push(`${where} must be an object`);
    const { id, label, uiTheme, path, family, description, familyLabel } = entry;
    if (typeof id !== "string" || !THEME_ID.test(id)) {
      return void warnings.push(`${where}: "id" must match ${THEME_ID.source}`);
    }
    if (themes.some((theme) => theme.id === id)) {
      return void warnings.push(`${where}: duplicate theme id ${id}`);
    }
    const mode = typeof uiTheme === "string" ? UI_THEMES[uiTheme] : undefined;
    if (mode === undefined) return void warnings.push(`${where}: "uiTheme" must be light or dark`);
    const file = normalizeExtensionPath(path);
    if (file === undefined || !file.endsWith(".json")) {
      return void warnings.push(`${where}: "path" must be a .json file inside the extension`);
    }
    let familyId: string | undefined;
    if (family !== undefined) {
      if (typeof family !== "string" || !FAMILY_ID.test(family)) {
        warnings.push(`${where}: "family" must match ${FAMILY_ID.source}; ignoring it`);
      } else if (themes.some((theme) => theme.family === family && theme.uiTheme === mode)) {
        warnings.push(`${where}: family ${family} already has a ${mode} member; ignoring it`);
      } else {
        familyId = family;
      }
    }
    themes.push({
      id,
      fullId: `${extensionId}/${id}`,
      label: labelOf(label, MAX_LABEL_LENGTH) ?? id,
      uiTheme: mode,
      path: file,
      family: familyId,
      ...(labelOf(description, MAX_DESCRIPTION_LENGTH)
        ? { description: labelOf(description, MAX_DESCRIPTION_LENGTH) }
        : {}),
      ...(familyId && labelOf(familyLabel, MAX_LABEL_LENGTH)
        ? { familyLabel: labelOf(familyLabel, MAX_LABEL_LENGTH) }
        : {}),
    });
  });

  return {
    contributions: Object.freeze({
      themes: Object.freeze(themes),
      colors: Object.freeze(colors),
      fonts: Object.freeze(fonts),
    }),
    warnings,
  };
}
