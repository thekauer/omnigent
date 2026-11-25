// The runtime theme stylesheet's text (`<style id="omnigent-theme-runtime">`): resolved
// token values per mode, written by the host from checked values only. Pure.
//
// Specificity: the generated token blocks reach (0,3,0) (`:root:not(.dark)[data-theme]`,
// and `.omnigent-app .dark[data-theme="x"]` in the embed), so a runtime block at plain
// `:root`/`.dark` would lose in dark mode and whenever a palette is selected. Every
// runtime block matches the theme roots through `:is([data-omni-theme], #<id>)`, whose
// specificity is the ID's (1,0,0): above every generated block by construction, not by
// stylesheet order, in every mode and palette, standalone and embedded. The id matches
// no element; `data-omni-theme` is stamped on the theme roots by the theme service.

import type { TokenMode } from "./tokenValues.ts";

export const THEME_ROOT_ATTRIBUTE = "data-omni-theme";
/** The id that lends the runtime selectors their specificity (never on an element). */
export const THEME_SPECIFICITY_ID = "omnigent-theme-runtime-root";
/** The runtime stylesheet's element id. */
export const THEME_STYLE_ID = "omnigent-theme-runtime";

const ROOT = `:is([${THEME_ROOT_ATTRIBUTE}], #${THEME_SPECIFICITY_ID})`;

/** Where each block of the runtime stylesheet goes. */
export interface ThemeSelectors {
  /** The theme roots in light mode (and the embed's scope root in either mode). */
  readonly light: string;
  /** The theme roots in dark mode. */
  readonly dark: string;
  /** The `[data-token-mode]` probes of a mode, inside a theme root. */
  readonly probe: (mode: TokenMode) => string;
}

/**
 * The runtime selectors: standalone on the document root (`:root`); embedded, on the
 * embed's scope root (`scope`, `.omnigent-app`) and its direct child, the inner root,
 * never the host page or an element deeper in the app.
 */
export function themeSelectors(scope: string | null): ThemeSelectors {
  // Anchored to the roots themselves: an element elsewhere that carries the attribute or
  // the id (injected markup) matches none of these.
  if (scope === null) {
    return {
      light: `:root${ROOT}:not(.dark)`,
      dark: `:root${ROOT}.dark`,
      probe: (mode) => `:root${ROOT} [data-token-mode="${mode}"]`,
    };
  }
  const scoped = (suffix: string) => `${scope}${ROOT}${suffix}, ${scope} > ${ROOT}${suffix}`;
  return {
    light: scoped(":not(.dark)"),
    dark: scoped(".dark"),
    probe: (mode) => `${scope}${ROOT} [data-token-mode="${mode}"]`,
  };
}

/** Token id to value, per mode, and the per-mode tokens again for the probes. */
export interface ThemeBlocks {
  readonly light?: Readonly<Record<string, string>>;
  readonly dark?: Readonly<Record<string, string>>;
  readonly probes?: {
    readonly light?: Readonly<Record<string, string>>;
    readonly dark?: Readonly<Record<string, string>>;
  };
}

/** `CSS.escape` for a custom property name (ids are already `[a-z0-9-]`; this is a guard). */
export function escapeIdent(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, (char) => `\\${char.codePointAt(0)!.toString(16)} `);
}

function rule(selector: string, values: Readonly<Record<string, string>> | undefined): string {
  const entries = Object.entries(values ?? {});
  if (entries.length === 0) return "";
  const body = entries.map(([id, value]) => `  --${escapeIdent(id)}: ${value};`).join("\n");
  return `${selector} {\n${body}\n}\n`;
}

/** The stylesheet text for `blocks`, in the given order of layers. */
export function buildThemeCss(layers: readonly ThemeBlocks[], selectors: ThemeSelectors): string {
  return layers
    .flatMap((blocks) => [
      rule(selectors.light, blocks.light),
      rule(selectors.dark, blocks.dark),
      rule(selectors.probe("light"), blocks.probes?.light),
      rule(selectors.probe("dark"), blocks.probes?.dark),
    ])
    .filter(Boolean)
    .join("\n");
}
