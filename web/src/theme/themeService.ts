// The window's colour themes (theming plan M6, M7): the themes, colours and fonts extensions
// contribute (the built-in palettes too, as the omnigent.themes extension), the user's
// choice, the list the picker and Settings show, previews, and the one runtime stylesheet
// that applies them (a built-in palette applies its precompiled `data-theme` CSS instead).
//
// Layers, low to high: the registry defaults (the generated stylesheet), the theme's
// colours and `omnigent.tokens`, its option choices, its variants (stored only until
// M9), the user's Appearance settings (inline on the style root, so above any
// stylesheet), the colour customizations, and product locks (M10). Themes set tokens
// only, never Tailwind's `--color-*` variables.

import { useSyncExternalStore } from "react";
import { bundledThemesInfo } from "shiki/themes";
import { setBrandOverride, type BrandOverride } from "@/lib/branding";
import { getThemeRoots, getThemeScopeSelector, subscribeThemeRoots } from "@/lib/host";
import { isRegisteredSyntaxTheme, registerSyntaxTheme } from "@/lib/syntaxTheme";
import {
  applyThemePalette,
  DEFAULT_PALETTE,
  isContributedThemeId,
  isThemeSelection,
  PALETTE_TOKEN_CSS_NAMES,
  PALETTES,
  type PaletteSwatch,
  readThemeChoice,
  type ThemeSelection,
  writeContributedThemeChoice,
  writeThemePalette,
} from "@/lib/themePalette";
import type { ExtensionFile } from "@/vscodeExtensions/host";
import {
  buildThemeCss,
  THEME_ROOT_ATTRIBUTE,
  THEME_STYLE_ID,
  themeSelectors,
  type ThemeBlocks,
} from "./themeCss";
import {
  extensionCssPrefix,
  type ColorContribution,
  type FontContribution,
  type ThemeContribution,
  type ThemeContributions,
  type UiTheme,
} from "./themeContributions";
import { parseThemeFile, SWATCH_KEYS, type ParsedTheme, type ThemeTokens } from "./themeFile";
import { getToken, TOKENS } from "./tokens/registry";
import {
  checkVariants,
  isVariantName,
  isVariantValue,
  resolveVariants,
  type VariantValues,
} from "./variants";
import {
  nullMap,
  type PlainData,
  referenceCycles,
  snapshotPlainData,
  SYNTAX_THEME_NAME,
  TOKEN_CONSTRAINTS,
  validateTokenValue,
  type ValueContext,
} from "./validate";

export const THEME_OPTIONS_STORAGE_KEY = "omnigent:ui-theme-options";
export const VARIANTS_STORAGE_KEY = "omnigent:ui-variants";
export const COLOR_CUSTOMIZATIONS_STORAGE_KEY = "omnigent:ui-color-customizations";
export const THEME_CACHE_STORAGE_KEY = "omnigent:ui-theme-cache";

/** A syntax theme a theme's `tokenColors` make, as registered (and cached). */
export interface TokenSyntaxTheme {
  readonly name: string;
  readonly type: UiTheme;
  readonly colors: Readonly<Record<string, string>>;
  readonly tokenColors: readonly PlainData[];
}

/** What an extension's description gives the theme service. */
export interface ThemeExtension {
  readonly id: string;
  readonly version: string;
  /** The manifest's `displayName`: the picker's group label. */
  readonly label?: string;
  /** Ships with the app: its themes may name a precompiled palette (`omnigent.palette`). */
  readonly builtIn?: boolean;
  readonly contributions: ThemeContributions;
  /** Theme files as data and assets as URLs, by normalized path. */
  readonly files: Readonly<Record<string, ExtensionFile>>;
}

/** Where the extension host hands contributed themes, colours and fonts. */
export interface ThemeContributionSink {
  addExtension: (extension: ThemeExtension) => () => void;
}

/** One theme as {@link ThemeService.list} shows it. */
export interface ThemeInfo {
  readonly id: string;
  readonly label: string;
  readonly uiTheme: UiTheme;
  readonly family: string | undefined;
  readonly extensionId: string;
  /** False for a chosen theme whose extension isn't installed: the default applies. */
  readonly available: boolean;
  readonly description?: string;
}

/** One entry of the theme list the picker and Settings share ({@link ThemeService.entries}). */
export interface ThemeListEntry {
  /** What {@link ThemeService.select} takes: a built-in palette's id, else a theme's id. */
  readonly id: string;
  readonly label: string;
  readonly description: string | undefined;
  /** The contributing extension; built-ins first, then by label. */
  readonly extensionId: string;
  readonly groupLabel: string;
  readonly builtIn: boolean;
  /** The member themes (a family's two, or one), by mode. */
  readonly members: Readonly<Partial<Record<UiTheme, string>>>;
  /** The one mode a single-mode theme forces; undefined for a family. */
  readonly forcedMode: UiTheme | undefined;
  /** False for a chosen theme whose extension isn't installed. */
  readonly available: boolean;
  /** Custom: its swatches are the user's colours (`lib/customTheme.ts`). */
  readonly custom: boolean;
  /** Preview colours per mode: the theme's `omnigent.swatch` over its resolved colours. */
  readonly swatches: Readonly<Partial<Record<UiTheme, PaletteSwatch>>>;
}

/**
 * What a product allows (theming plan M10 fills it from `OmnigentAppProps.product.theme`):
 * the themes the list offers (by entry or member id) and whether the picker shows at all.
 */
export interface ThemeProductPolicy {
  readonly allowed?: readonly string[];
  readonly hidePicker?: boolean;
}

/** A colour customizations problem, for Settings' inline errors. */
export interface CustomizationProblem {
  /** `background`, or `[acme.x/dark].primary`; empty for the whole value. */
  readonly key: string;
  readonly message: string;
}

export interface ActiveThemeOption {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly choices: readonly { readonly id: string; readonly label: string }[];
}

/** The chosen theme, as {@link ThemeService.getActive} reports it. */
export interface ActiveTheme extends ThemeInfo {
  /** The mode a single-mode theme forces; undefined for a family, which follows the mode. */
  readonly forcedMode: UiTheme | undefined;
  readonly options: readonly ActiveThemeOption[];
  readonly variants: Readonly<Record<string, string>>;
  /** Whether the values on screen came from the first-paint cache (extension not loaded yet). */
  readonly fromCache: boolean;
}

// The first-paint cache: the last applied values, keyed by the theme, its extension's
// version and a hash of everything that went into them. Checked again before use.
interface ThemeCache {
  readonly version: 1;
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly uiTheme: UiTheme;
  readonly family?: string;
  readonly forcedMode?: UiTheme;
  readonly blocks: ThemeBlocks;
  readonly fonts: readonly CachedFont[];
  readonly brand?: BrandOverride;
  readonly syntax?: readonly TokenSyntaxTheme[];
}

interface CachedFont {
  readonly family: string;
  readonly url: string;
  readonly weight?: string;
  readonly style?: string;
}

const CACHE_LIMIT = 256 * 1024;
const EXTENSION_ASSETS_PREFIX = "/__omnigent/extension-assets/";
const ASSET_PATH_REST = /^[A-Za-z0-9@._~/+-]{1,480}$/;

/**
 * The path of the app's own bundled assets: `BASE_URL` + `assets/`. A relative base (the
 * production build's `./`) is the directory this chunk was emitted to, which is that
 * `assets/` directory under wherever the app is served.
 */
function bundleAssetsPrefix(): string | undefined {
  const base = import.meta.env.BASE_URL ?? "/";
  if (base.startsWith("/")) return `${base.endsWith("/") ? base : `${base}/`}assets/`;
  try {
    const here = new URL(".", import.meta.url);
    if (typeof location === "undefined" || here.origin !== location.origin) return undefined;
    return here.pathname.endsWith("/assets/") ? here.pathname : undefined;
  } catch {
    return undefined;
  }
}

const BUNDLE_ASSETS_PREFIX = bundleAssetsPrefix();

/** Whether `path` lies under the dev plugin's assets or the bundle's own `assets/`, exactly. */
function isHostAssetPath(path: string): boolean {
  return [EXTENSION_ASSETS_PREFIX, BUNDLE_ASSETS_PREFIX].some(
    (prefix) =>
      prefix !== undefined &&
      path.startsWith(prefix) &&
      ASSET_PATH_REST.test(path.slice(prefix.length)),
  );
}

/**
 * Whether `url` is one of this origin's theme assets: a path (or this origin's absolute
 * URL) under exactly the dev plugin's `/__omnigent/extension-assets/` or the bundle's
 * `BASE_URL` + `assets/`, that the URL parser leaves as written. Protocol-relative URLs,
 * other origins, other `/assets/` directories (backend routes among them), backslashes,
 * `.` and `..` segments, empty segments, queries and fragments fail.
 */
export function isHostAssetUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 1024 || typeof location === "undefined") {
    return false;
  }
  if (/^[\\/]{2}/.test(url) || url.includes("\\")) return false;
  let resolved: URL;
  try {
    resolved = new URL(url, location.href);
  } catch {
    return false;
  }
  if (resolved.origin !== location.origin) return false;
  const path = url.startsWith("/")
    ? url
    : url.startsWith(`${location.origin}/`)
      ? url.slice(location.origin.length)
      : undefined;
  if (path === undefined || resolved.pathname !== path || resolved.search || resolved.hash) {
    return false;
  }
  if (path.includes("//") || path.split("/").some((part) => part === "." || part === "..")) {
    return false;
  }
  return isHostAssetPath(path);
}

const BUNDLED_SYNTAX_THEMES = new Set(bundledThemesInfo.map((theme) => theme.id));
const CUSTOMIZATION_LIMITS = { chars: 65_536, nodes: 5000, depth: 4 } as const;

/** Whether `id` is the entry's id or one of its members'. */
function entryHas(entry: ThemeListEntry, id: string): boolean {
  return entry.id === id || Object.values(entry.members).includes(id);
}

const SWATCH_TOKENS: Readonly<Record<keyof PaletteSwatch, readonly string[]>> = {
  bg: ["background"],
  card: ["card-solid", "card", "background"],
  accent: ["primary", "brand-accent"],
  border: ["border"],
  text: ["foreground"],
};

/** The default palette's value of a palette token, by CSS name, per mode. */
const DEFAULT_PALETTE_VALUES: Readonly<Record<UiTheme, ReadonlyMap<string, string>>> = (() => {
  const palette = PALETTES.find((entry) => entry.id === DEFAULT_PALETTE) ?? PALETTES[0]!;
  const byMode = (mode: UiTheme) =>
    new Map(
      Object.entries(palette.tokens[mode]).map(([key, value]) => [
        (PALETTE_TOKEN_CSS_NAMES as Readonly<Record<string, string>>)[key]!,
        value,
      ]),
    );
  return { light: byMode("light"), dark: byMode("dark") };
})();

/**
 * A theme member's swatch: its `omnigent.swatch`, else its colours (a `var()` of a token
 * resolved through the theme, then the default palette), else the default palette's.
 */
function themeSwatch(
  parsed: ParsedTheme,
  mode: UiTheme,
  options: ThemeTokens = nullMap(),
): PaletteSwatch {
  const tokens: ThemeTokens = { ...parsed.tokens, ...options };
  const lookup = (id: string): string | undefined =>
    tokens[id]?.value ?? DEFAULT_PALETTE_VALUES[mode].get(id);
  const resolve = (value: string | undefined, depth = 0): string | undefined => {
    const reference = value === undefined ? undefined : /^var\(--([a-z0-9-]+)\)$/.exec(value);
    if (!reference || depth > 4) return value;
    return resolve(lookup(reference[1]!), depth + 1) ?? value;
  };
  const swatch = {} as Record<keyof PaletteSwatch, string>;
  for (const key of SWATCH_KEYS) {
    const own = parsed.swatch?.[key];
    const fromTokens = SWATCH_TOKENS[key]
      .map((id) => tokens[id]?.value)
      .find((value) => value !== undefined);
    swatch[key] =
      own ?? resolve(fromTokens) ?? resolve(lookup(SWATCH_TOKENS[key][0]!)) ?? "transparent";
  }
  return swatch;
}

/** A cached theme's swatches, from its cached blocks (an unavailable theme's chip). */
function cachedSwatches(cache: ThemeCache): Partial<Record<UiTheme, PaletteSwatch>> {
  const out: Partial<Record<UiTheme, PaletteSwatch>> = {};
  for (const mode of ["light", "dark"] as const) {
    const values = cache.blocks[mode];
    if (!values) continue;
    const tokens = nullMap<{ value: string; references: readonly string[] }>();
    for (const [id, value] of Object.entries(values)) tokens[id] = { value, references: [] };
    out[mode] = themeSwatch({ tokens, swatch: undefined } as unknown as ParsedTheme, mode);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or access errors keep the in-memory state.
  }
}

/** FNV-1a over a string, as a short hex key. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const PER_MODE_TOKENS = new Set(TOKENS.filter((token) => token.perMode).map((token) => token.id));

/** The registry default's references in a mode, for the cycle check. */
function defaultReferences(id: string, mode: UiTheme): string[] {
  const token = getToken(id);
  const value =
    mode === "dark" ? (token?.default?.dark ?? token?.default?.light) : token?.default?.light;
  return [...(value ?? "").matchAll(/var\(\s*--([A-Za-z0-9-]+)/g)].map((match) => match[1]!);
}

interface ResolvedMember {
  readonly theme: ThemeContribution;
  readonly parsed: ParsedTheme;
  readonly syntaxName: string | undefined;
}

interface Resolution {
  readonly theme: ThemeContribution;
  readonly extension: ThemeExtension;
  readonly members: Partial<Record<UiTheme, ResolvedMember>>;
  readonly forcedMode: UiTheme | undefined;
  readonly options: readonly ActiveThemeOption[];
  readonly variants: Readonly<Record<string, string>>;
  readonly blocks: ThemeBlocks;
  readonly fonts: readonly CachedFont[];
  readonly brand: BrandOverride | undefined;
  readonly syntax: readonly TokenSyntaxTheme[];
  readonly key: string;
}

/** The window's theme service; one per page ({@link themeService}). */
export class ThemeService implements ThemeContributionSink {
  private readonly extensions = new Map<string, ThemeExtension>();
  private readonly registrations = new Map<string, symbol>();
  private readonly listeners = new Set<() => void>();
  private readonly warned = new Set<string>();
  /** A picker's live preview (undefined: none); null previews the default. */
  private previewing: string | null | undefined = undefined;
  private policy: ThemeProductPolicy | null = null;
  private version = 0;
  private readonly parsed = new Map<
    string,
    { file: ExtensionFile; member: ResolvedMember | undefined }
  >();
  private loading = 0;
  private started = false;
  private active: ActiveTheme | null = null;
  private forcedMode: UiTheme | null = null;
  private appliedCss = "";
  private appliedKey = "";
  /** Whether this page wrote (or checked) the cache for {@link appliedKey}. */
  private cacheWritten = false;
  private unregisterSyntax: (() => void)[] = [];
  private fontFaces: FontFace[] = [];
  private fontKey = "";
  private brandKey = "";
  private stopWatchingRoots: (() => void) | null = null;

  /** Registers an extension's themes, colours and fonts; returns their removal. */
  addExtension(extension: ThemeExtension): () => void {
    const { themes, colors, fonts } = extension.contributions;
    if (themes.length === 0 && colors.length === 0 && fonts.length === 0) return () => {};
    const registration = Symbol(extension.id);
    this.registrations.set(extension.id, registration);
    this.extensions.set(extension.id, extension);
    this.refresh();
    return () => {
      if (this.registrations.get(extension.id) !== registration) return;
      this.registrations.delete(extension.id);
      this.extensions.delete(extension.id);
      this.refresh();
    };
  }

  /** Replaces an extension's files (a dev-server edit) and applies them. */
  updateFiles(extensionId: string, files: Readonly<Record<string, ExtensionFile>>): void {
    const extension = this.extensions.get(extensionId);
    if (!extension) return;
    this.extensions.set(extensionId, { ...extension, files });
    this.refresh();
  }

  /**
   * Marks the extensions that load later (the dev loader's): until every such load is
   * done, a chosen theme that isn't registered keeps its cached values.
   */
  beginLoading(): () => void {
    this.loading += 1;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.loading -= 1;
      this.refresh();
    };
  }

  /** The built-in extensions contributed: from now on a missing theme is unavailable. */
  markStarted(): void {
    if (this.started) return;
    this.started = true;
    this.refresh();
  }

  /** Every contributed theme, and the chosen one when its extension is missing. */
  list(): ThemeInfo[] {
    const themes = [...this.extensions.values()].flatMap((extension) =>
      extension.contributions.themes.map((theme) => this.info(theme, extension.id, true)),
    );
    const choice = this.currentChoice();
    if (choice && isContributedThemeId(choice) && !themes.some((theme) => theme.id === choice)) {
      const cached = this.readCache();
      themes.push({
        id: choice,
        label: cached?.id === choice ? cached.label : choice,
        uiTheme: cached?.id === choice ? cached.uiTheme : "dark",
        family: cached?.id === choice ? cached.family : undefined,
        extensionId: choice.slice(0, choice.indexOf("/")),
        available: false,
      });
    }
    return themes;
  }

  /** The chosen contributed theme (available or not), or null for a built-in palette. */
  getActive(): ActiveTheme | null {
    return this.active;
  }

  /**
   * Chooses a theme: a contributed theme's id, a built-in palette's id, or null for the
   * default. The choice is kept even while its extension is missing.
   */
  select(requested: string | null): void {
    if (requested !== null && !isContributedThemeId(requested) && !isThemeSelection(requested)) {
      throw new TypeError(`no theme ${JSON.stringify(String(requested).slice(0, 80))}`);
    }
    const id = requested === null ? null : this.selectionId(requested);
    this.previewing = undefined;
    if (id === null || isThemeSelection(id)) {
      const palette = id ?? DEFAULT_PALETTE;
      writeThemePalette(palette);
      applyThemePalette(palette);
    } else {
      writeContributedThemeChoice(id);
      applyThemePalette(DEFAULT_PALETTE);
    }
    this.refresh();
  }

  /**
   * Shows a theme without choosing it (a picker's live preview): `id` as {@link select}
   * takes it, or undefined to show the chosen one again. Nothing is stored.
   */
  preview(id: string | null | undefined): void {
    if (id === undefined) {
      if (this.previewing === undefined) return;
      this.previewing = undefined;
    } else {
      if (id !== null && !isContributedThemeId(id) && !isThemeSelection(id)) {
        throw new TypeError(`no theme ${JSON.stringify(String(id).slice(0, 80))}`);
      }
      this.previewing = id === null ? DEFAULT_PALETTE : this.selectionId(id);
    }
    this.refresh();
  }

  /** The chosen theme, as {@link ThemeListEntry.id} names it (the default palette's id when none). */
  getChoice(): string {
    return this.committedChoice() ?? DEFAULT_PALETTE;
  }

  /** Reads the choice again after something else stored it (a settings import, a reset). */
  reload(): void {
    this.previewing = undefined;
    this.refresh();
  }

  /** The product's restrictions (M10), or null for none. */
  setProductPolicy(policy: ThemeProductPolicy | null): void {
    this.policy = policy;
    this.emit();
  }

  getProductPolicy(): ThemeProductPolicy | null {
    return this.policy;
  }

  /** A counter that changes with every change, for `useSyncExternalStore` readers. */
  getVersion(): number {
    return this.version;
  }

  /**
   * The theme list the picker and Settings show: the built-in themes first, then each
   * extension's, families as one entry, the chosen theme listed (as unavailable) when its
   * extension is missing, and only what the product allows (the chosen one always).
   */
  entries(): ThemeListEntry[] {
    const choice = this.getChoice();
    const extensions = [...this.extensions.values()]
      .filter((extension) => extension.contributions.themes.length > 0)
      .sort((a, b) =>
        a.builtIn !== b.builtIn
          ? a.builtIn
            ? -1
            : 1
          : (a.label ?? a.id).localeCompare(b.label ?? b.id),
      );
    const entries: ThemeListEntry[] = [];
    for (const extension of extensions) {
      const seen = new Set<string>();
      for (const theme of extension.contributions.themes) {
        const key = theme.family ? `family:${theme.family}` : theme.fullId;
        if (seen.has(key)) continue;
        seen.add(key);
        const memberThemes = theme.family
          ? extension.contributions.themes.filter((entry) => entry.family === theme.family)
          : [theme];
        const members: Partial<Record<UiTheme, string>> = {};
        const swatches: Partial<Record<UiTheme, PaletteSwatch>> = {};
        let palette: ThemeSelection | undefined;
        for (const member of memberThemes) {
          members[member.uiTheme] = member.fullId;
          const parsed = this.member(member, extension)?.parsed;
          if (!parsed) continue;
          swatches[member.uiTheme] = themeSwatch(
            parsed,
            member.uiTheme,
            this.optionTokens(parsed, {
              id: member.fullId,
              family: member.family,
              extensionId: extension.id,
            }),
          );
          if (extension.builtIn && parsed.palette && isThemeSelection(parsed.palette)) {
            palette = parsed.palette;
          }
        }
        const modes = Object.keys(members) as UiTheme[];
        const labels = [members.light, members.dark]
          .map((id) => memberThemes.find((member) => member.fullId === id)?.label)
          .filter((label): label is string => label !== undefined);
        const ids = Object.values(members);
        entries.push({
          id: palette ?? (ids.includes(choice) ? choice : memberThemes[0]!.fullId),
          label: theme.familyLabel ?? [...new Set(labels)].join(" / "),
          description: memberThemes.find((member) => member.description)?.description,
          extensionId: extension.id,
          groupLabel: extension.label ?? extension.id,
          builtIn: extension.builtIn === true,
          members,
          forcedMode: modes.length === 1 ? modes[0] : undefined,
          available: true,
          custom: palette === "custom",
          swatches,
        });
      }
    }
    if (isContributedThemeId(choice) && !entries.some((entry) => entryHas(entry, choice))) {
      const cached = this.readCache();
      const known = cached?.id === choice ? cached : undefined;
      const extensionId = choice.slice(0, choice.indexOf("/"));
      const uiTheme = known?.uiTheme ?? "dark";
      entries.push({
        id: choice,
        label: known?.label ?? choice,
        description: undefined,
        extensionId,
        groupLabel: extensionId,
        builtIn: false,
        members: { [uiTheme]: choice },
        forcedMode: known?.forcedMode,
        available: false,
        custom: false,
        swatches: known ? cachedSwatches(known) : {},
      });
    }
    const allowed = this.policy?.allowed;
    if (!allowed) return entries;
    return entries.filter(
      (entry) =>
        entryHas(entry, choice) || allowed.some((id) => entry.id === id || entryHas(entry, id)),
    );
  }

  /** The user's style variant choices (`omnigent:ui-variants`), "Theme default" left out. */
  getUserVariants(): VariantValues {
    return checkVariants(readJson(VARIANTS_STORAGE_KEY));
  }

  /** The variants that apply: the chosen theme's, with the user's over them (M9 applies them). */
  getVariants(): VariantValues {
    return resolveVariants(this.themeVariants(), this.getUserVariants());
  }

  /** Stores a style variant choice; null is "Theme default". */
  setVariant(name: string, value: string | null): void {
    if (!isVariantName(name)) throw new TypeError(`no variant ${JSON.stringify(name)}`);
    if (value !== null && !isVariantValue(name, value)) {
      throw new TypeError(`variant ${name} has no value ${JSON.stringify(value)}`);
    }
    const next: Record<string, string> = Object.fromEntries(
      Object.entries(this.getUserVariants()).filter(([key]) => key !== name),
    );
    if (value !== null) next[name] = value;
    writeJson(VARIANTS_STORAGE_KEY, Object.keys(next).length > 0 ? next : undefined);
    this.refresh();
  }

  /** The stored colour customizations, as JSON text (an empty object when none). */
  getCustomizationsText(): string {
    const stored = readJson(COLOR_CUSTOMIZATIONS_STORAGE_KEY);
    return JSON.stringify(isRecord(stored) ? stored : {}, null, 2);
  }

  /**
   * Checks colour customizations as Settings' editor writes them (JSON: token ids to
   * values, and `[<theme id>]` objects of the same), without storing them.
   */
  checkCustomizations(text: string): CustomizationProblem[] {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      return [{ key: "", message: error instanceof SyntaxError ? error.message : "not JSON" }];
    }
    const snapshot = snapshotPlainData(raw, CUSTOMIZATION_LIMITS);
    if (!snapshot.ok) return [{ key: "", message: snapshot.reason }];
    if (!isRecord(snapshot.value)) return [{ key: "", message: "must be a JSON object" }];
    const problems: CustomizationProblem[] = [];
    const context = this.valueContext(this.find(this.getChoice())?.extension, []);
    const check = (record: Record<string, unknown>, scope: string) => {
      for (const [id, value] of Object.entries(record)) {
        const key = `${scope}${id}`;
        if (id.startsWith("[")) {
          if (scope) problems.push({ key, message: "theme scopes don't nest" });
          else if (!/^\[[^[\]]{1,200}\]$/.test(id))
            problems.push({ key, message: "a theme scope is [<theme id>]" });
          else if (!isRecord(value)) problems.push({ key, message: "must be an object of tokens" });
          else check(value, `${id}.`);
          continue;
        }
        const kind = getToken(id)?.kind ?? (context.isKnownToken(id) ? "color" : undefined);
        if (!kind || TOKEN_CONSTRAINTS[id]?.internal) {
          problems.push({ key, message: "no such token" });
          continue;
        }
        const result = validateTokenValue(kind, value, context, TOKEN_CONSTRAINTS[id]);
        if (!result.ok) problems.push({ key, message: result.reason });
      }
    };
    check(snapshot.value, "");
    return problems;
  }

  /** Stores colour customizations when they check out; returns the problems otherwise. */
  setCustomizations(text: string): CustomizationProblem[] {
    const problems = this.checkCustomizations(text);
    if (problems.length > 0) return problems;
    const value = JSON.parse(text) as Record<string, unknown>;
    writeJson(COLOR_CUSTOMIZATIONS_STORAGE_KEY, Object.keys(value).length > 0 ? value : undefined);
    this.refresh();
    return [];
  }

  /** Settings' reset: the default theme, and no options, variants or customizations. */
  resetAppearance(): void {
    writeJson(THEME_OPTIONS_STORAGE_KEY, undefined);
    writeJson(VARIANTS_STORAGE_KEY, undefined);
    writeJson(COLOR_CUSTOMIZATIONS_STORAGE_KEY, undefined);
    this.select(null);
  }

  /** Sets an option of the chosen theme (null: the theme's default choice). */
  setOption(optionId: string, choiceId: string | null): void {
    const active = this.active;
    if (!active) throw new Error("no contributed theme is chosen");
    const option = active.options.find((entry) => entry.id === optionId);
    if (!option) throw new TypeError(`the theme has no option ${JSON.stringify(optionId)}`);
    if (choiceId !== null && !option.choices.some((choice) => choice.id === choiceId)) {
      throw new TypeError(`option ${optionId} has no choice ${JSON.stringify(choiceId)}`);
    }
    const stored = isRecord(readJson(THEME_OPTIONS_STORAGE_KEY))
      ? (readJson(THEME_OPTIONS_STORAGE_KEY) as Record<string, unknown>)
      : {};
    const key = this.optionsKey(active);
    const previous = isRecord(stored[key]) ? (stored[key] as Record<string, unknown>) : {};
    const current = Object.fromEntries(
      [...Object.entries(previous).filter(([id]) => id !== optionId)].concat(
        choiceId === null ? [] : [[optionId, choiceId]],
      ),
    );
    const next = Object.fromEntries(
      Object.entries({ ...stored, [key]: current }).filter(
        ([, value]) => !isRecord(value) || Object.keys(value).length > 0,
      ),
    );
    writeJson(THEME_OPTIONS_STORAGE_KEY, Object.keys(next).length > 0 ? next : undefined);
    this.refresh();
  }

  /** Calls `listener` after each change of the list or the applied theme. */
  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The mode the chosen theme forces, if any (next-themes' `forcedTheme`). */
  getForcedMode(): UiTheme | null {
    return this.forcedMode;
  }

  /**
   * Applies the cached values of the chosen theme before first paint, so a reload shows
   * the theme before its extension loads. The live values replace them once it registers.
   */
  applyCached(): void {
    const choice = this.currentChoice();
    if (!choice || !isContributedThemeId(choice)) return;
    // Settled, or registered already: the live values (or the default) are what applies.
    if ((this.started && this.loading === 0) || this.find(choice)) {
      this.refresh();
      return;
    }
    const cache = this.readCache();
    if (!cache || cache.id !== choice) return;
    const css = buildThemeCss([cache.blocks], themeSelectors(getThemeScopeSelector()));
    this.writeStyle(css);
    this.appliedKey = cache.key;
    this.cacheWritten = false;
    this.stamp(choice);
    this.forcedMode = cache.forcedMode ?? null;
    this.applyFonts(cache.fonts);
    this.applyBrand(cache.brand);
    this.applySyntax(cache.syntax ?? []);
    this.active = {
      id: cache.id,
      label: cache.label,
      uiTheme: cache.uiTheme,
      family: cache.family,
      extensionId: cache.id.slice(0, cache.id.indexOf("/")),
      available: true,
      forcedMode: cache.forcedMode,
      options: [],
      variants: nullMap<string>(),
      fromCache: true,
    };
    this.watchRoots();
    this.emit();
  }

  private info(theme: ThemeContribution, extensionId: string, available: boolean): ThemeInfo {
    return {
      id: theme.fullId,
      label: theme.label,
      uiTheme: theme.uiTheme,
      family: theme.family,
      extensionId,
      available,
      ...(theme.description ? { description: theme.description } : {}),
    };
  }

  /**
   * The stored choice, a built-in palette theme's id read as its palette's. Read from
   * storage each time, so an import or another writer of the key is what applies.
   */
  private committedChoice(): string | null {
    const stored = typeof window === "undefined" ? null : readThemeChoice();
    return stored === null ? null : this.selectionId(stored);
  }

  /** What shows: the preview, else the stored choice. */
  private currentChoice(): string | null {
    return this.previewing !== undefined ? this.previewing : this.committedChoice();
  }

  /** `id` as the list names it: a built-in palette theme's id becomes its palette's. */
  private selectionId(id: string): string {
    if (!isContributedThemeId(id)) return id;
    const found = this.find(id);
    if (!found?.extension.builtIn) return id;
    const palette = this.member(found.theme, found.extension)?.parsed.palette;
    return palette && isThemeSelection(palette) ? palette : id;
  }

  /** A member's parsed file, parsed once per file object. */
  private member(theme: ThemeContribution, extension: ThemeExtension): ResolvedMember | undefined {
    const key = `${theme.fullId}@${extension.version}`;
    const file = extension.files[theme.path];
    const cached = this.parsed.get(key);
    if (cached && file && cached.file === file) return cached.member;
    const member = this.parseMember(theme, extension);
    if (file) this.parsed.set(key, { file, member });
    return member;
  }

  /** The chosen contributed theme's own variants (none for a palette or a missing theme). */
  private themeVariants(): Readonly<Record<string, string>> {
    const choice = this.currentChoice();
    if (!choice || !isContributedThemeId(choice)) return {};
    const found = this.find(choice);
    if (!found) return {};
    return this.member(found.theme, found.extension)?.parsed.variants ?? {};
  }

  private optionsKey(theme: { id: string; family: string | undefined; extensionId: string }) {
    return theme.family ? `${theme.extensionId}/${theme.family}` : theme.id;
  }

  private find(id: string): { theme: ThemeContribution; extension: ThemeExtension } | undefined {
    const extension = this.extensions.get(id.slice(0, id.indexOf("/")));
    const theme = extension?.contributions.themes.find((entry) => entry.fullId === id);
    return extension && theme ? { theme, extension } : undefined;
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[theme] ${message}`);
  }

  private valueContext(extension: ThemeExtension | undefined, syntaxNames: string[]): ValueContext {
    // A theme reads the registry and its own extension's colours, never another's.
    const colors = new Set((extension?.contributions.colors ?? []).map((color) => color.token));
    const own = new Map<string, FontContribution>(
      (extension?.contributions.fonts ?? []).map((font) => [font.family, font]),
    );
    return {
      isKnownToken: (id) =>
        colors.has(id) || (getToken(id) !== undefined && !TOKEN_CONSTRAINTS[id]?.internal),
      fontFamily: (name) => own.get(name)?.cssFamily,
      isSyntaxTheme: (name) =>
        BUNDLED_SYNTAX_THEMES.has(name) ||
        isRegisteredSyntaxTheme(name) ||
        syntaxNames.includes(name),
    };
  }

  private parseMember(
    theme: ThemeContribution,
    extension: ThemeExtension,
  ): ResolvedMember | undefined {
    const file = extension.files[theme.path];
    if (!file || file.kind !== "json") {
      this.warnOnce(
        `${theme.fullId}@${extension.version}:file`,
        `${theme.fullId}: ${theme.path} is not shipped`,
      );
      return undefined;
    }
    // A name the syntax theme registers under: a keyword unique to the theme.
    const syntaxName = `x-${hashText(theme.fullId)}-${theme.id.replace(/[^a-z0-9-]/g, "-")}`.slice(
      0,
      64,
    );
    const extensionColors = new Map<string, string>(
      extension.contributions.colors.flatMap((color: ColorContribution) => [
        [color.id, color.token],
        [color.token, color.token],
      ]),
    );
    const parsed = parseThemeFile(file.data, {
      uiTheme: theme.uiTheme,
      context: this.valueContext(extension, SYNTAX_THEME_NAME.test(syntaxName) ? [syntaxName] : []),
      extensionColors,
      assetUrl: (path) => {
        const asset = extension.files[path];
        return asset?.kind === "asset" && isHostAssetUrl(asset.url) ? asset.url : undefined;
      },
    });
    if (parsed.issues.length > 0) {
      this.warnOnce(
        `${theme.fullId}@${extension.version}#${hashText(JSON.stringify(file.data) ?? "")}`,
        `${theme.fullId}: ${parsed.issues.length} problem(s), left out: ${parsed.issues.slice(0, 20).join("; ")}`,
      );
    }
    return { theme, parsed, syntaxName: parsed.syntax ? syntaxName : undefined };
  }

  /** The tokens of a member's option choices: the stored ones, else each option's default. */
  private optionTokens(
    parsed: ParsedTheme,
    theme: { id: string; family: string | undefined; extensionId: string },
  ): ThemeTokens {
    const stored = this.storedOptions(this.optionsKey(theme));
    const out = nullMap<{ value: string; references: readonly string[] }>();
    for (const option of parsed.options) {
      const wanted = typeof stored[option.id] === "string" ? stored[option.id] : option.default;
      const choice =
        option.choices.find((entry) => entry.id === wanted) ??
        option.choices.find((entry) => entry.id === option.default);
      if (choice) Object.assign(out, choice.tokens);
    }
    return out;
  }

  private storedOptions(key: string): Record<string, unknown> {
    const stored = readJson(THEME_OPTIONS_STORAGE_KEY);
    return isRecord(stored) && isRecord(stored[key]) ? stored[key] : {};
  }

  /** The colour customizations for `themeId`: global ones, then the `[themeId]` ones. */
  private customizations(themeId: string, context: ValueContext): ThemeTokens {
    const tokens = nullMap<{ value: string; references: readonly string[] }>();
    const snapshot = snapshotPlainData(
      readJson(COLOR_CUSTOMIZATIONS_STORAGE_KEY) ?? null,
      CUSTOMIZATION_LIMITS,
    );
    if (!snapshot.ok || !isRecord(snapshot.value)) return tokens;
    const read = (record: Record<string, unknown>) => {
      for (const [id, value] of Object.entries(record)) {
        if (id.startsWith("[")) continue;
        const kind = getToken(id)?.kind ?? (context.isKnownToken(id) ? "color" : undefined);
        if (!kind) continue;
        const result = validateTokenValue(kind, value, context, TOKEN_CONSTRAINTS[id]);
        if (result.ok) tokens[id] = { value: result.value, references: result.references };
      }
    };
    read(snapshot.value);
    const scoped = snapshot.value[`[${themeId}]`];
    if (isRecord(scoped)) read(scoped);
    return tokens;
  }

  private resolve(id: string): Resolution | undefined {
    const found = this.find(id);
    if (!found) return undefined;
    const { theme, extension } = found;
    const memberThemes: Partial<Record<UiTheme, ThemeContribution>> = theme.family
      ? Object.fromEntries(
          extension.contributions.themes
            .filter((entry) => entry.family === theme.family)
            .map((entry) => [entry.uiTheme, entry]),
        )
      : { [theme.uiTheme]: theme };
    const members: Partial<Record<UiTheme, ResolvedMember>> = {};
    for (const mode of ["light", "dark"] as const) {
      const member = memberThemes[mode];
      const parsed = member && this.member(member, extension);
      if (parsed) members[mode] = parsed;
    }
    // A family with one member forces it, like a single theme.
    const modes = Object.keys(members) as UiTheme[];
    const forcedMode = modes.length === 1 ? modes[0] : undefined;
    const optionsKey = this.optionsKey({ id, family: theme.family, extensionId: extension.id });
    const storedOptions = this.storedOptions(optionsKey);
    const primary = members[theme.uiTheme] ?? members[modes[0]!];
    const options: ActiveThemeOption[] = (primary?.parsed.options ?? []).map((option) => {
      const stored = storedOptions[option.id];
      const value =
        typeof stored === "string" && option.choices.some((choice) => choice.id === stored)
          ? stored
          : option.default;
      return {
        id: option.id,
        label: option.label,
        value,
        choices: option.choices.map((choice) => ({ id: choice.id, label: choice.label })),
      };
    });
    const context = this.valueContext(extension, []);
    const custom = this.customizations(id, context);
    const blocks: { light?: Record<string, string>; dark?: Record<string, string> } = {};
    const probes: { light?: Record<string, string>; dark?: Record<string, string> } = {};
    const syntax: TokenSyntaxTheme[] = [];
    for (const mode of modes) {
      const member = members[mode]!;
      const layered = nullMap<{ value: string; references: readonly string[] }>();
      const layers: ThemeTokens[] = [member.parsed.tokens];
      for (const option of options) {
        const definition = member.parsed.options.find((entry) => entry.id === option.id);
        const choice = definition?.choices.find((entry) => entry.id === option.value);
        if (choice) layers.push(choice.tokens);
      }
      layers.push(custom);
      for (const layer of layers) Object.assign(layered, layer);
      if (member.syntaxName && member.parsed.syntax) {
        syntax.push({
          name: member.syntaxName,
          type: mode,
          colors: member.parsed.syntax.colors,
          tokenColors: member.parsed.syntax.tokenColors,
        });
        const token = `syntax-theme-${mode}`;
        if (!(token in member.parsed.tokens)) {
          layered[token] = { value: member.syntaxName, references: [] };
        }
      }
      // Reference cycles: the theme's values over the registry's defaults.
      const graph = new Map<string, readonly string[]>();
      for (const token of TOKENS) graph.set(token.id, defaultReferences(token.id, mode));
      for (const [token, value] of Object.entries(layered)) graph.set(token, value.references);
      const cycles = referenceCycles(graph);
      const values = nullMap<string>();
      for (const [token, value] of Object.entries(layered)) {
        if (cycles.has(token)) {
          this.warnOnce(
            `${id}:cycle:${token}`,
            `${id}: --${token} is on a reference cycle; left out`,
          );
          continue;
        }
        values[token] = value.value;
      }
      blocks[mode] = values;
      const probe = nullMap<string>();
      for (const [token, value] of Object.entries(values)) {
        if (PER_MODE_TOKENS.has(token)) probe[token] = value;
      }
      if (Object.keys(probe).length > 0) probes[mode] = probe;
    }
    // A single-mode theme's values hold in its mode only; its forced mode keeps the
    // root there, and the other mode's probe gets them too (the terminal follows the theme).
    if (forcedMode) {
      const other = forcedMode === "dark" ? "light" : "dark";
      if (probes[forcedMode]) probes[other] = probes[forcedMode];
    }
    const fonts: CachedFont[] = extension.contributions.fonts.flatMap((font) => {
      const asset = extension.files[font.src];
      if (asset?.kind !== "asset" || !isHostAssetUrl(asset.url)) {
        this.warnOnce(
          `${extension.id}:font:${font.src}`,
          `${extension.id}: font ${font.src} is not shipped`,
        );
        return [];
      }
      return [
        {
          family: font.cssFamily,
          url: asset.url,
          ...(font.weight ? { weight: font.weight } : {}),
          ...(font.style ? { style: font.style } : {}),
        },
      ];
    });
    const brandSection = primary?.parsed.brand;
    const brand: BrandOverride | undefined = brandSection
      ? {
          ...(brandSection.appName ? { appName: brandSection.appName } : {}),
          logos: {
            ...(brandSection.wordmark || brandSection.logo
              ? { main: brandSection.wordmark ?? brandSection.logo }
              : {}),
            ...(brandSection.logo ? { loading: brandSection.logo } : {}),
            ...(brandSection.favicon ? { favicon: brandSection.favicon } : {}),
          },
        }
      : undefined;
    const themeBlocks: ThemeBlocks = { ...blocks, probes };
    const key = `${extension.id}@${extension.version}#${hashText(
      JSON.stringify([themeBlocks, fonts, brand, syntax, forcedMode]),
    )}`;
    return {
      theme,
      extension,
      members,
      forcedMode,
      options,
      variants: resolveVariants(primary?.parsed.variants ?? {}, this.getUserVariants()) as Readonly<
        Record<string, string>
      >,
      blocks: themeBlocks,
      fonts,
      brand,
      syntax,
      key,
    };
  }

  /** The extensions' colour defaults: always present, below any theme. */
  private colorDefaults(): ThemeBlocks {
    const light = nullMap<string>();
    const dark = nullMap<string>();
    for (const extension of this.extensions.values()) {
      for (const color of extension.contributions.colors) {
        if (color.defaults.light !== undefined) light[color.token] = color.defaults.light;
        if (color.defaults.dark !== undefined) dark[color.token] = color.defaults.dark;
      }
    }
    return { light, dark };
  }

  private refresh(): void {
    if (typeof document === "undefined") return;
    const choice = this.currentChoice();
    const contributed = choice !== null && isContributedThemeId(choice) ? choice : null;
    const resolution = contributed ? this.resolve(contributed) : undefined;
    const settled = this.started && this.loading === 0;
    const defaults = this.colorDefaults();
    const selectors = themeSelectors(getThemeScopeSelector());
    if (contributed && !resolution && !settled && this.active?.fromCache) {
      // Still loading: keep the cached values, with the colours known so far under them.
      return;
    }
    // A built-in palette is its precompiled CSS (`data-theme`), under any customizations.
    applyThemePalette(choice !== null && isThemeSelection(choice) ? choice : DEFAULT_PALETTE);
    const layers: ThemeBlocks[] = [defaults];
    if (resolution) layers.push(resolution.blocks);
    else if (choice === null || isThemeSelection(choice)) {
      const custom = this.customizations(
        choice ?? DEFAULT_PALETTE,
        this.valueContext(undefined, []),
      );
      const values = nullMap<string>();
      for (const [token, value] of Object.entries(custom)) values[token] = value.value;
      if (Object.keys(values).length > 0) layers.push({ light: values, dark: values });
    }
    const css = buildThemeCss(layers, selectors);
    this.writeStyle(css);
    this.stamp(css ? (contributed ?? "") : null);
    if (resolution) {
      this.applySyntax(resolution.syntax);
      this.applyFonts(resolution.fonts);
      this.applyBrand(resolution.brand);
      this.forcedMode = resolution.forcedMode ?? null;
      this.active = {
        ...this.info(resolution.theme, resolution.extension.id, true),
        forcedMode: resolution.forcedMode,
        options: resolution.options,
        variants: resolution.variants,
        fromCache: false,
      };
      if (this.previewing === undefined) this.writeCache(resolution, contributed!);
    } else {
      this.applySyntax([]);
      this.applyFonts([]);
      this.applyBrand(undefined);
      this.forcedMode = null;
      this.active = contributed
        ? {
            ...(this.list().find((theme) => theme.id === contributed) ?? {
              id: contributed,
              label: contributed,
              uiTheme: "dark" as const,
              family: undefined,
              extensionId: contributed.slice(0, contributed.indexOf("/")),
            }),
            available: false,
            forcedMode: undefined,
            options: [],
            variants: this.getUserVariants() as Readonly<Record<string, string>>,
            fromCache: false,
          }
        : null;
      if (contributed)
        this.warnOnce(
          `missing:${contributed}`,
          `${contributed} is not installed; using the default theme`,
        );
    }
    this.watchRoots();
    this.emit();
  }

  private writeStyle(css: string): void {
    let style = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
    if (!css) {
      style?.remove();
      this.appliedCss = "";
      return;
    }
    if (style && this.appliedCss === css) return;
    if (!style) {
      style = document.createElement("style");
      style.id = THEME_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = css;
    this.appliedCss = css;
  }

  private stamp(value: string | null): void {
    for (const root of getThemeRoots()) {
      if (value === null) root.removeAttribute(THEME_ROOT_ATTRIBUTE);
      else if (root.getAttribute(THEME_ROOT_ATTRIBUTE) !== value) {
        root.setAttribute(THEME_ROOT_ATTRIBUTE, value);
      }
    }
  }

  private watchRoots(): void {
    if (this.stopWatchingRoots) return;
    this.stopWatchingRoots = subscribeThemeRoots(() => {
      // The embed (re)mounted: its scope selector and roots changed.
      this.appliedCss = "";
      this.refresh();
    });
  }

  private applySyntax(themes: readonly TokenSyntaxTheme[]): void {
    const previous = this.unregisterSyntax;
    this.unregisterSyntax = themes.flatMap((theme) => {
      try {
        return [
          registerSyntaxTheme({
            name: theme.name,
            type: theme.type,
            colors: theme.colors,
            tokenColors: theme.tokenColors as never,
          }),
        ];
      } catch (error) {
        console.warn(`[theme] syntax theme ${theme.name}:`, error);
        return [];
      }
    });
    for (const unregister of previous) unregister();
  }

  private applyFonts(fonts: readonly CachedFont[]): void {
    const key = JSON.stringify(fonts);
    if (key === this.fontKey) return;
    this.fontKey = key;
    const fontSet = typeof document !== "undefined" ? document.fonts : undefined;
    for (const face of this.fontFaces) fontSet?.delete(face);
    this.fontFaces = [];
    if (!fontSet || typeof FontFace === "undefined") return;
    for (const font of fonts) {
      if (!isHostAssetUrl(font.url) || !/^x-[a-z0-9_-]{1,200}$/.test(font.family)) continue;
      const face = new FontFace(font.family, `url(${JSON.stringify(font.url)}) format("woff2")`, {
        display: "swap",
        ...(font.weight ? { weight: font.weight } : {}),
        ...(font.style ? { style: font.style } : {}),
      });
      fontSet.add(face);
      this.fontFaces.push(face);
      face.load().catch((error: unknown) => {
        console.warn(`[theme] font ${font.family} failed to load`, error);
      });
    }
  }

  private applyBrand(brand: BrandOverride | undefined): void {
    const key = JSON.stringify(brand ?? null);
    if (key === this.brandKey) return;
    this.brandKey = key;
    setBrandOverride(brand ?? null);
  }

  private readCache(): ThemeCache | undefined {
    const snapshot = snapshotPlainData(readJson(THEME_CACHE_STORAGE_KEY) ?? null, {
      chars: CACHE_LIMIT,
      nodes: 50_000,
      depth: 10,
    });
    if (!snapshot.ok) return undefined;
    return checkCache(snapshot.value);
  }

  private writeCache(resolution: Resolution, id: string): void {
    // Compared by content, not by key: a forged cache may carry the live key.
    if (this.appliedKey === resolution.key && this.cacheWritten) return;
    this.appliedKey = resolution.key;
    const cache: ThemeCache = {
      version: 1,
      id,
      key: resolution.key,
      label: resolution.theme.label,
      uiTheme: resolution.theme.uiTheme,
      ...(resolution.theme.family ? { family: resolution.theme.family } : {}),
      ...(resolution.forcedMode ? { forcedMode: resolution.forcedMode } : {}),
      blocks: resolution.blocks,
      fonts: resolution.fonts,
      ...(resolution.brand ? { brand: resolution.brand } : {}),
      syntax: resolution.syntax,
    };
    let text = JSON.stringify(cache);
    if (text.length > CACHE_LIMIT) text = JSON.stringify({ ...cache, syntax: [] });
    if (text.length > CACHE_LIMIT) return;
    try {
      if (window.localStorage.getItem(THEME_CACHE_STORAGE_KEY) !== text) {
        window.localStorage.setItem(THEME_CACHE_STORAGE_KEY, text);
      }
      this.cacheWritten = true;
    } catch {
      // A full storage only loses the first-paint cache.
    }
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

/**
 * The cache as stored, checked again as if a theme wrote it (an imported settings file
 * or another tab may have put anything there): token values through the validator,
 * asset URLs as host paths, names as keywords. Undefined when malformed.
 */
export function checkCache(raw: unknown): ThemeCache | undefined {
  if (!isRecord(raw) || raw.version !== 1) return undefined;
  const { id, key, label, uiTheme, family, forcedMode, blocks, fonts, brand, syntax } = raw;
  if (!isContributedThemeId(id) || typeof key !== "string" || key.length > 300) return undefined;
  if (typeof label !== "string" || (uiTheme !== "light" && uiTheme !== "dark")) return undefined;
  if (forcedMode !== undefined && forcedMode !== "light" && forcedMode !== "dark") return undefined;
  if (family !== undefined && (typeof family !== "string" || !/^[a-z0-9-]{1,64}$/.test(family))) {
    return undefined;
  }
  // Only the chosen theme's own extension names: `x-<its prefix>-...`.
  const ownName = new RegExp(
    `^${extensionCssPrefix(id.slice(0, id.indexOf("/")))}-[a-z0-9_-]{1,160}$`,
  );
  const context: ValueContext = {
    isKnownToken: (token) => getToken(token) !== undefined || ownName.test(token),
    fontFamily: (name) => (ownName.test(name) ? name : undefined),
  };
  const checkTokens = (values: unknown): Record<string, string> | undefined => {
    if (values === undefined) return undefined;
    if (!isRecord(values)) return undefined;
    const out = nullMap<string>();
    for (const [token, value] of Object.entries(values)) {
      const kind = getToken(token)?.kind ?? (ownName.test(token) ? "color" : undefined);
      if (!kind) continue;
      const result = validateTokenValue(kind, value, context, TOKEN_CONSTRAINTS[token]);
      if (result.ok) out[token] = result.value;
    }
    return out;
  };
  if (!isRecord(blocks)) return undefined;
  const probes = isRecord(blocks.probes) ? blocks.probes : {};
  const checkedBlocks: ThemeBlocks = {
    ...(blocks.light !== undefined ? { light: checkTokens(blocks.light) } : {}),
    ...(blocks.dark !== undefined ? { dark: checkTokens(blocks.dark) } : {}),
    probes: { light: checkTokens(probes.light), dark: checkTokens(probes.dark) },
  };
  const checkedFonts: CachedFont[] = Array.isArray(fonts)
    ? fonts.flatMap((font) =>
        isRecord(font) &&
        typeof font.family === "string" &&
        ownName.test(font.family) &&
        typeof font.url === "string" &&
        isHostAssetUrl(font.url)
          ? [
              {
                family: font.family,
                url: font.url,
                ...(typeof font.weight === "string" && /^[a-z0-9 ]{1,16}$/.test(font.weight)
                  ? { weight: font.weight }
                  : {}),
                ...(font.style === "italic" || font.style === "normal" || font.style === "oblique"
                  ? { style: font.style }
                  : {}),
              },
            ]
          : [],
      )
    : [];
  let checkedBrand: BrandOverride | undefined;
  if (isRecord(brand)) {
    const logos = isRecord(brand.logos) ? brand.logos : {};
    const url = (value: unknown) =>
      typeof value === "string" && isHostAssetUrl(value) ? value : undefined;
    const main = url(logos.main);
    const loading = url(logos.loading);
    const favicon = url(logos.favicon);
    checkedBrand = {
      ...(typeof brand.appName === "string" ? { appName: brand.appName } : {}),
      logos: {
        ...(main ? { main } : {}),
        ...(loading ? { loading } : {}),
        ...(favicon ? { favicon } : {}),
      },
    };
  }
  const checkedSyntax: TokenSyntaxTheme[] = Array.isArray(syntax)
    ? syntax.flatMap((entry) =>
        isRecord(entry) &&
        typeof entry.name === "string" &&
        SYNTAX_THEME_NAME.test(entry.name) &&
        (entry.type === "light" || entry.type === "dark") &&
        Array.isArray(entry.tokenColors)
          ? [
              {
                name: entry.name,
                type: entry.type,
                colors: isRecord(entry.colors) ? (entry.colors as Record<string, string>) : {},
                tokenColors: entry.tokenColors as never,
              },
            ]
          : [],
      )
    : [];
  return {
    version: 1,
    id,
    key,
    label: label.slice(0, 80),
    uiTheme,
    ...(family ? { family } : {}),
    ...(forcedMode ? { forcedMode } : {}),
    blocks: checkedBlocks,
    fonts: checkedFonts,
    ...(checkedBrand ? { brand: checkedBrand } : {}),
    syntax: checkedSyntax,
  };
}

/** The window's theme service. */
export const themeService = new ThemeService();

function subscribe(listener: () => void): () => void {
  return themeService.onDidChange(listener);
}

/** The style variants that apply (the theme's, the user's over them), live. */
export function useThemeVariants(): VariantValues {
  const version = useSyncExternalStore(
    subscribe,
    () => themeService.getVersion(),
    () => 0,
  );
  return variantsAt(version);
}

// One resolution per service version: a stable snapshot for React.
let variantsVersion = -1;
let variantsSnapshot: VariantValues = {};
function variantsAt(version: number): VariantValues {
  if (version !== variantsVersion) {
    variantsVersion = version;
    variantsSnapshot = themeService.getVariants();
  }
  return variantsSnapshot;
}

/** Whether the product hides the theme picker (its theme policy), live. */
export function useThemePickerHidden(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => themeService.getProductPolicy()?.hidePicker === true,
    () => false,
  );
}

/** The mode the chosen theme forces (a single-mode theme), live; null otherwise. */
export function useThemeForcedMode(): UiTheme | null {
  return useSyncExternalStore(
    subscribe,
    () => themeService.getForcedMode(),
    () => null,
  );
}
