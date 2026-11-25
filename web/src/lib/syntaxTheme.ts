// The syntax themes code surfaces highlight with: Shiki in chat and the viewers, Monaco
// (through @shikijs/monaco) and diffs. The `syntax-theme-light`/`-dark` tokens name
// them, a bundled Shiki theme or one registered here from a theme's `tokenColors`.

import { useSyncExternalStore } from "react";
import type { BundledTheme, ThemeRegistration } from "shiki";
import { readThemeTokens, subscribeThemeTokens } from "@/theme/tokenValues";

export type SyntaxThemeMode = "light" | "dark";

/** A light and a dark Shiki theme name, the pair a highlight colours with. */
export type SyntaxThemeNames = Readonly<Record<SyntaxThemeMode, string>>;

/** The default pair, the GitHub themes, as the tokens default to. */
export const SYNTAX_THEME_NAMES = {
  light: "github-light",
  dark: "github-dark",
} as const satisfies SyntaxThemeNames;

/** One TextMate rule of a colour theme's `tokenColors`. */
export interface SyntaxTokenColor {
  name?: string;
  scope?: string | string[];
  settings: { foreground?: string; background?: string; fontStyle?: string };
}

/** A syntax theme as a VS Code colour theme carries it. */
export interface SyntaxThemeDefinition {
  /** The name the `syntax-theme-*` tokens use for it. */
  name: string;
  type: SyntaxThemeMode;
  /** Workbench colours; Shiki reads `editor.background` and `editor.foreground`. */
  colors?: Readonly<Record<string, string>>;
  tokenColors: readonly SyntaxTokenColor[];
}

// Registered themes by token name. Each registration gets its own Shiki name, so a
// re-registered theme never hits a highlighter's (or a diff's) cache of the old one.
// Monaco takes only letters, digits and dashes in a theme name.
function registeredThemeName(name: string, registration: number): string {
  return `registered-${registration}-${name.replace(/[^a-z0-9-]/gi, "-")}`;
}

const registered = new Map<string, ThemeRegistration>();
let revision = 0;
const listeners = new Set<() => void>();

function notifyRegistry(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

/**
 * Registers a syntax theme from TextMate rules under `definition.name`, for the
 * `syntax-theme-*` tokens to name. Every highlighter loads it on its next highlight.
 *
 * @returns Unregisters it (if not replaced since).
 */
export function registerSyntaxTheme(definition: SyntaxThemeDefinition): () => void {
  const theme: ThemeRegistration = {
    name: registeredThemeName(definition.name, revision + 1),
    displayName: definition.name,
    type: definition.type,
    colors: { ...definition.colors },
    tokenColors: definition.tokenColors.map((rule) => ({
      ...rule,
      settings: { ...rule.settings },
    })),
  };
  registered.set(definition.name, theme);
  notifyRegistry();
  return () => {
    if (registered.get(definition.name) !== theme) return;
    registered.delete(definition.name);
    notifyRegistry();
  };
}

/** A token's value as a theme name: a keyword, or a quoted string. */
function themeName(value: string, fallback: string): string {
  const name = value.replace(/^(["'])(.*)\1$/, "$2").trim();
  return name || fallback;
}

/** The theme names the `syntax-theme-*` tokens give, the defaults where they're unset. */
export function syntaxThemeNames(): SyntaxThemeNames {
  const tokens = readThemeTokens(["syntax-theme-light", "syntax-theme-dark"]);
  return {
    light: themeName(tokens["syntax-theme-light"], SYNTAX_THEME_NAMES.light),
    dark: themeName(tokens["syntax-theme-dark"], SYNTAX_THEME_NAMES.dark),
  };
}

/**
 * A theme name as Shiki takes it: the registered theme, or the bundled theme's name. A
 * name that is neither fails to load where it's used; the theme contribution API
 * checks names against Shiki's bundled themes before they reach the tokens.
 */
export function syntaxThemeInput(name: string): BundledTheme | ThemeRegistration {
  return registered.get(name) ?? (name as BundledTheme);
}

/** The name a highlighter knows the theme by (a registered theme's own Shiki name). */
export function shikiThemeName(name: string): string {
  return registered.get(name)?.name ?? name;
}

/** The pair as Shiki names, for `codeToTokens({ themes })`, diffs and Monaco. */
export function shikiThemeNames(names: SyntaxThemeNames): SyntaxThemeNames {
  return { light: shikiThemeName(names.light), dark: shikiThemeName(names.dark) };
}

/** The registered themes of a pair. */
export function registeredSyntaxThemes(names: SyntaxThemeNames): ThemeRegistration[] {
  return [...new Set([names.light, names.dark])].flatMap((name) => registered.get(name) ?? []);
}

interface ThemeLoader {
  getLoadedThemes: () => string[];
  loadTheme: (...themes: (BundledTheme | ThemeRegistration)[]) => Promise<void>;
}

/**
 * Loads the pair into `highlighter` where it lacks them: a registered theme from its
 * rules, a bundled one by name.
 *
 * @returns Whether it loaded any.
 */
export async function ensureSyntaxThemes(
  highlighter: ThemeLoader,
  names: SyntaxThemeNames,
): Promise<boolean> {
  const loaded = new Set(highlighter.getLoadedThemes());
  const missing = [...new Set([names.light, names.dark])]
    .filter((name) => !loaded.has(shikiThemeName(name)))
    .map(syntaxThemeInput);
  if (missing.length > 0) await highlighter.loadTheme(...missing);
  return missing.length > 0;
}

// The pair as last read. While anything subscribes, it is re-read only after a change
// notice, so a render does not force a style recalculation.
let snapshot: SyntaxThemeNames = SYNTAX_THEME_NAMES;
let stale = true;
let subscribers = 0;

/** Calls `listener` when the tokens or the registered themes may have changed the pair. */
export function subscribeSyntaxThemes(listener: () => void): () => void {
  const onChange = () => {
    stale = true;
    listener();
  };
  subscribers += 1;
  listeners.add(onChange);
  const unsubscribe = subscribeThemeTokens(onChange);
  return () => {
    subscribers -= 1;
    listeners.delete(onChange);
    unsubscribe();
  };
}

let snapshotKey = syntaxThemeKey(SYNTAX_THEME_NAMES);

// A new object whenever a name, or the registered theme behind one, changes.
function readSnapshot(): SyntaxThemeNames {
  if (!stale && subscribers > 0) return snapshot;
  const names = syntaxThemeNames();
  const key = syntaxThemeKey(names);
  if (key !== snapshotKey) {
    snapshot = names;
    snapshotKey = key;
  }
  stale = false;
  return snapshot;
}

/** A key that changes whenever the pair or a registered theme in it may render differently. */
export function syntaxThemeKey(names: SyntaxThemeNames): string {
  return `${shikiThemeName(names.light)}|${shikiThemeName(names.dark)}`;
}

/** The current pair, live as the tokens or the registered themes change. */
export function useSyntaxThemeNames(): SyntaxThemeNames {
  return useSyncExternalStore(subscribeSyntaxThemes, readSnapshot, () => SYNTAX_THEME_NAMES);
}
