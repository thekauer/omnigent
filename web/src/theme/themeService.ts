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
  clearThemeChoice,
  readThemeChoice,
  type ThemeSelection,
  writeStoredThemeChoice,
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
  labelOf,
  type ColorContribution,
  type FontContribution,
  type ThemeContribution,
  type ThemeContributions,
  type UiTheme,
} from "./themeContributions";
import { parseThemeFile, SWATCH_KEYS, type ParsedTheme, type ThemeTokens } from "./themeFile";
import type { ProductThemeConfig } from "./productTheme";
import { type RejectedToken, resolveTokenLayers } from "./resolveTokens";
import { getToken, TOKENS } from "./tokens/registry";
import {
  checkVariants,
  defaultVariant,
  isVariantName,
  isVariantValue,
  resolveVariants,
  VARIANT_NAMES,
  variantAttribute,
  variantTokens,
  type VariantValues,
} from "./variants";
import {
  nullMap,
  type PlainData,
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
 * What a product sets ({@link setProductTheme} merges its sources into it): see
 * {@link ProductThemeConfig}. `allowed` binds the list, {@link ThemeService.select} and
 * {@link ThemeService.preview} (by entry id, member id or `*` pattern; the chosen one stays
 * listed, but a stored choice outside it doesn't apply). `default` is what a first run and a
 * reset choose. The locks are the top layer of every theme's resolution.
 */
export type ThemeProductPolicy = ProductThemeConfig;

/** A colour customizations problem, for Settings' inline errors. */
export interface CustomizationProblem {
  /** `background`, or `[acme.x/dark].primary`; empty for the whole value. */
  readonly key: string;
  readonly message: string;
  /** A warning is shown but doesn't stop the customizations from being stored. */
  readonly severity?: "warning";
}

/** The theme on screen, as the plugin read API reports it. */
export interface AppliedTheme {
  /** The member theme on screen (`omnigent.themes/<palette>-<mode>` for a built-in). */
  readonly id: string;
  readonly label: string;
}

export interface ActiveThemeOption {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** Set by the product's `lockedOptions`: shown, not changeable. */
  readonly locked?: boolean;
  readonly choices: readonly { readonly id: string; readonly label: string }[];
}

/** What is applied for the chosen theme, previews aside ({@link ThemeService.committedState}). */
export interface CommittedThemeState {
  /** The chosen theme's option choices, by option id (none for a built-in palette). */
  readonly options: Readonly<Record<string, string>>;
  readonly variants: Readonly<Record<string, string>>;
  /** Changes with anything applied: the choice and a hash of the theme CSS written. */
  readonly key: string;
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
  readonly familyLabel?: string;
  readonly forcedMode?: UiTheme;
  readonly blocks: ThemeBlocks;
  readonly fonts: readonly CachedFont[];
  readonly brand?: BrandOverride;
  readonly syntax?: readonly TokenSyntaxTheme[];
  /** The theme's own variants (the user's apply over them from storage). */
  readonly variants?: Readonly<Record<string, string>>;
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
/** Whether an `allowed` entry takes `id`: the same id, or a pattern whose `*` matches anything. */
export function matchesAllowed(pattern: string, id: string): boolean {
  if (!pattern.includes("*")) return pattern === id;
  const parts = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&"));
  return new RegExp(`^${parts.join(".*")}$`).test(id);
}

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
  /** The theme's own variants, before the user's. */
  readonly themeVariants: Readonly<Record<string, string>>;
  readonly blocks: ThemeBlocks;
  readonly fonts: readonly CachedFont[];
  readonly brand: BrandOverride | undefined;
  readonly syntax: readonly TokenSyntaxTheme[];
  readonly key: string;
  /** The colour customizations left out at resolve time (out of range, or on a cycle). */
  readonly customizationRejections: readonly CustomizationRejection[];
}

/** A customization the resolve-time check left out, in one mode. */
interface CustomizationRejection {
  readonly token: string;
  readonly mode: UiTheme;
  readonly reason: string;
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
  /** The product's checked `lockedTokens`: the top layer. */
  private lockedTokens: ThemeTokens = nullMap();
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
  private committed: CommittedThemeState = Object.freeze({
    options: Object.freeze(nullMap<string>()),
    variants: Object.freeze(nullMap<string>()),
    key: "",
  });

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
        label: cached?.id === choice ? (cached.familyLabel ?? cached.label) : choice,
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
   * default ({@link defaultSelection}: the first allowed theme when the product's
   * `allowed` leaves the default palette out). The choice is kept even while its
   * extension is missing.
   */
  select(requested: string | null): void {
    if (requested !== null && !isContributedThemeId(requested) && !isThemeSelection(requested)) {
      throw new TypeError(`no theme ${JSON.stringify(String(requested).slice(0, 80))}`);
    }
    const id = requested === null ? null : this.selectionId(requested);
    if (id !== null && !this.isAllowed(id)) {
      throw new TypeError(`theme ${JSON.stringify(id.slice(0, 80))} is not allowed here`);
    }
    this.previewing = undefined;
    // The default is stored as no choice and resolved when read, so a product default
    // whose extension loads later still applies once it does.
    if (id === null) clearThemeChoice();
    else if (isThemeSelection(id)) {
      if (id === DEFAULT_PALETTE && this.policy?.default !== undefined) writeStoredThemeChoice(id);
      else writeThemePalette(id);
    } else writeContributedThemeChoice(id);
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
      const next =
        id === null ? (this.defaultSelection() ?? DEFAULT_PALETTE) : this.selectionId(id);
      if (!this.isAllowed(next)) {
        throw new TypeError(`theme ${JSON.stringify(next.slice(0, 80))} is not allowed here`);
      }
      this.previewing = next;
    }
    this.refresh();
  }

  /** The chosen theme, as {@link ThemeListEntry.id} names it (the default palette's id when none). */
  getChoice(): string {
    return this.committedChoice() ?? DEFAULT_PALETTE;
  }

  /** Whether a picker's preview shows instead of the chosen theme. */
  isPreviewing(): boolean {
    return this.previewing !== undefined;
  }

  /**
   * The theme that applies in `mode` for the chosen theme (previews aside): a family's
   * member for that mode, a built-in palette's member theme, and the default's when the
   * chosen theme's extension is missing (the default is what shows).
   */
  appliedTheme(mode: UiTheme): AppliedTheme {
    const choice = this.getChoice();
    if (isContributedThemeId(choice)) {
      const found = this.find(choice);
      if (found) {
        const { theme, extension } = found;
        const member = theme.family
          ? (extension.contributions.themes.find(
              (entry) => entry.family === theme.family && entry.uiTheme === mode,
            ) ?? theme)
          : theme;
        return { id: member.fullId, label: member.label };
      }
    }
    const palette = isThemeSelection(choice) ? choice : DEFAULT_PALETTE;
    const builtIn = this.builtInMember(palette, mode);
    if (builtIn) return { id: builtIn.theme.fullId, label: builtIn.theme.label };
    return { id: palette, label: palette };
  }

  /**
   * The chosen theme's option choices, variants and applied key as last applied outside a
   * preview: what the plugin read API reports and compares.
   */
  committedState(): CommittedThemeState {
    return this.committed;
  }

  /** Reads the choice again after something else stored it (a settings import, a reset). */
  reload(): void {
    this.previewing = undefined;
    this.refresh();
  }

  /**
   * The product's configuration (M10), or null for none: what {@link setProductTheme}
   * merges. Its locked tokens are checked against the registry as a theme's are.
   */
  setProductPolicy(policy: ThemeProductPolicy | null): void {
    this.policy = policy;
    this.lockedTokens = nullMap();
    const context = this.valueContext(undefined, []);
    for (const [id, value] of Object.entries(policy?.lockedTokens ?? {})) {
      const kind = getToken(id)?.kind;
      if (!kind || TOKEN_CONSTRAINTS[id]?.internal) {
        this.warnOnce(`product:token:${id}`, `product theme: --${id} is not a token; left out`);
        continue;
      }
      const result = validateTokenValue(kind, value, context, TOKEN_CONSTRAINTS[id]);
      if (!result.ok) {
        this.warnOnce(
          `product:token:${id}:${hashText(value)}`,
          `product theme: --${id}: ${result.reason}; left out`,
        );
        continue;
      }
      this.lockedTokens[id] = { value: result.value, references: result.references };
    }
    this.refresh();
    this.emit();
  }

  /** The mode the product locks the app in, or null. */
  getModeLock(): UiTheme | null {
    return this.policy?.lockMode ?? null;
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
    const lockMode = this.policy?.lockMode;
    // Under a mode lock, a single-mode theme of the other mode can't show: left out.
    return this.allEntries(choice).filter(
      (entry) =>
        entryHas(entry, choice) ||
        (this.permitsEntry(entry) &&
          (lockMode === undefined ||
            entry.forcedMode === undefined ||
            entry.forcedMode === lockMode)),
    );
  }

  /**
   * What "the default" selects, read lazily: the product's `default` (when `allowed` takes
   * it), else null (the default palette) when it is allowed or nothing is restricted, else
   * the first allowed entry, else the first allowed theme id named in full (shown from the
   * cache, or unavailable, until its extension loads).
   */
  private defaultSelection(): string | null {
    const policy = this.policy;
    if (!policy) return null;
    if (policy.default !== undefined) {
      const id = this.selectionId(policy.default);
      if (this.permits(id)) return id === DEFAULT_PALETTE ? null : id;
      this.warnOnce(`product:default:${id}`, `product theme: default ${id} is not allowed`);
    }
    const allowed = policy.allowed;
    if (!allowed || this.permits(DEFAULT_PALETTE)) return null;
    const entry = this.allEntries("").find(
      (candidate) => candidate.available && this.permitsEntry(candidate),
    );
    if (entry) return entry.id;
    return allowed.find((id) => !id.includes("*") && isContributedThemeId(id)) ?? null;
  }

  /** Whether the product allows `id` (a list id): its entry, or one of its members, is allowed. */
  private isAllowed(id: string): boolean {
    return id === this.getChoice() || this.permits(id);
  }

  /** Whether `allowed` takes `id` (by itself, a pattern, or through its list entry). */
  private permits(id: string): boolean {
    const allowed = this.policy?.allowed;
    if (!allowed || allowed.some((pattern) => matchesAllowed(pattern, id))) return true;
    const entry = this.allEntries("").find((candidate) => entryHas(candidate, id));
    return entry !== undefined && this.permitsEntry(entry);
  }

  /** Whether `allowed` takes a list entry: its id or one of its members. */
  private permitsEntry(entry: ThemeListEntry): boolean {
    const allowed = this.policy?.allowed;
    if (!allowed) return true;
    const ids = [entry.id, ...Object.values(entry.members)];
    return allowed.some((pattern) => ids.some((id) => id && matchesAllowed(pattern, id)));
  }

  /** {@link entries}, before the product's `allowed`. */
  private allEntries(choice: string): ThemeListEntry[] {
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
          label:
            memberThemes.find((member) => member.familyLabel)?.familyLabel ??
            [...new Set(labels)].join(" / "),
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
      // The default applies meanwhile: its colours show, with an Unavailable marker.
      const fallback = entries.find((entry) => entry.id === DEFAULT_PALETTE);
      entries.push({
        id: choice,
        label: known?.familyLabel ?? known?.label ?? choice,
        description: undefined,
        extensionId,
        groupLabel: extensionId,
        builtIn: false,
        members: { [uiTheme]: choice },
        forcedMode: known?.forcedMode,
        available: false,
        custom: false,
        swatches: fallback?.swatches ?? {},
      });
    }
    return entries;
  }

  /** The variants the theme on screen sets itself ("Theme default"), before the user's. */
  getThemeVariants(): VariantValues {
    return checkVariants(this.themeVariants());
  }

  /** The user's style variant choices (`omnigent:ui-variants`), "Theme default" left out. */
  getUserVariants(): VariantValues {
    return checkVariants(readJson(VARIANTS_STORAGE_KEY));
  }

  /** The variants that apply: the chosen theme's, the user's over them, the product's over both. */
  getVariants(): VariantValues {
    return this.layerVariants(this.themeVariants());
  }

  /** The variants the product locks (`lockedVariants`). */
  getLockedVariants(): VariantValues {
    return checkVariants(this.policy?.lockedVariants);
  }

  /** `theme`'s variants with the user's over them (unless the product hides them) and the locks over all. */
  private layerVariants(theme: unknown): VariantValues {
    const user = this.policy?.hideCustomizations ? {} : this.getUserVariants();
    return resolveVariants(resolveVariants(theme, user), this.getLockedVariants());
  }

  /** Stores a style variant choice; null is "Theme default". */
  setVariant(name: string, value: string | null): void {
    if (!isVariantName(name)) throw new TypeError(`no variant ${JSON.stringify(name)}`);
    if (name in this.getLockedVariants())
      throw new TypeError(`variant ${name} is set by the product`);
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
    if (text.length > CUSTOMIZATION_LIMITS.chars) {
      return [{ key: "", message: `longer than ${CUSTOMIZATION_LIMITS.chars} characters` }];
    }
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
          else {
            const unknown = this.scopeProblem(id.slice(1, -1));
            if (unknown) problems.push({ key, ...unknown });
            check(value, `${id}.`);
          }
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
    const locked = this.lockedTokens;
    for (const key of customizationKeys(snapshot.value)) {
      const token = key.slice(key.lastIndexOf(".") + 1);
      if (token in locked && !problems.some((problem) => problem.key === key)) {
        problems.push({
          key,
          message: "set by the product; this value doesn't apply",
          severity: "warning",
        });
      }
    }
    if (problems.some((problem) => problem.severity !== "warning")) return problems;
    // The resolve-time check, as applying them would run it.
    for (const rejection of this.customizationRejections(snapshot.value)) {
      const key =
        customizationKeys(snapshot.value)
          .filter((entry) => entry === rejection.token || entry.endsWith(`].${rejection.token}`))
          .pop() ?? rejection.token;
      if (problems.some((problem) => problem.key === key)) continue;
      problems.push({ key, message: rejection.reason.replace(/^is /, "") });
    }
    return problems;
  }

  /** The customizations in `draft` the resolve-time check would leave out, for the choice on screen. */
  private customizationRejections(draft: unknown): CustomizationRejection[] {
    const choice = this.getChoice();
    if (isContributedThemeId(choice))
      return this.resolve(choice, draft)?.customizationRejections.slice() ?? [];
    const context = this.valueContext(undefined, []);
    const variants = hostTokens(variantTokens(this.getVariants()));
    const out: CustomizationRejection[] = [];
    for (const mode of ["light", "dark"] as const) {
      const custom = this.customizations(this.customizationScopes(choice, mode), context, draft);
      const { rejected } = this.resolveLayers(
        choice,
        [variants, custom, this.lockedTokens],
        mode,
        true,
      );
      for (const entry of rejected) if (entry.layer === 1) out.push({ ...entry, mode });
    }
    return out;
  }

  /**
   * Why `[<id>]` names no theme, or undefined when it does: a theme's id (a family's
   * member or a single theme), a family's `<extension id>/<family>`, or a built-in
   * palette's id. A theme of an extension that isn't installed is a warning: it is kept,
   * and applies once the extension is.
   */
  private scopeProblem(id: string): Omit<CustomizationProblem, "key"> | undefined {
    if (isThemeSelection(id)) return undefined;
    const slash = id.indexOf("/");
    const extension = slash > 0 ? this.extensions.get(id.slice(0, slash)) : undefined;
    if (!extension) {
      return isContributedThemeId(id)
        ? { message: `no theme ${id} is installed; kept for when it is`, severity: "warning" }
        : { message: `no theme ${id}` };
    }
    const local = id.slice(slash + 1);
    const known = extension.contributions.themes.some(
      (theme) => theme.fullId === id || theme.family === local,
    );
    return known
      ? undefined
      : { message: `${extension.label ?? extension.id} has no theme ${local}` };
  }

  /** Stores colour customizations unless they have errors; returns every problem found. */
  setCustomizations(text: string): CustomizationProblem[] {
    const problems = this.checkCustomizations(text);
    if (problems.some((problem) => problem.severity !== "warning")) return problems;
    const value = JSON.parse(text) as Record<string, unknown>;
    writeJson(COLOR_CUSTOMIZATIONS_STORAGE_KEY, Object.keys(value).length > 0 ? value : undefined);
    this.refresh();
    return problems;
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
    if (option.locked) throw new TypeError(`option ${optionId} is set by the product`);
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

  /**
   * The CSS variable (without `--`) a colour id names for `extensionId`: a registry
   * token that themes may set, or one of that extension's own `contributes.colors` (by
   * its id, or `<extension id>.<id>`). Undefined for anything else: another extension's
   * colours and internal tokens included.
   */
  colorToken(extensionId: string, id: unknown): string | undefined {
    if (typeof id !== "string" || id.length > 200) return undefined;
    if (getToken(id) !== undefined && !TOKEN_CONSTRAINTS[id]?.internal) return id;
    const own = this.extensions.get(extensionId)?.contributions.colors ?? [];
    return own.find((color) => color.fullId === id || color.id === id)?.token;
  }

  /** The mode that holds whatever the mode setting says: the product's lock, else the chosen theme's. */
  getForcedMode(): UiTheme | null {
    return this.policy?.lockMode ?? this.forcedMode;
  }

  /**
   * Applies the cached values of the chosen theme before first paint, so a reload shows
   * the theme before its extension loads. The live values replace them once it registers.
   */
  applyCached(): void {
    const choice = this.currentChoice();
    // A built-in palette (the product's default too) applies at once, with its layers.
    if (!choice || !isContributedThemeId(choice)) {
      this.refresh();
      return;
    }
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
    const cachedVariants = this.layerVariants(cache.variants ?? {});
    this.stampVariants(cachedVariants as Readonly<Record<string, string>>);
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
      variants: cachedVariants as Readonly<Record<string, string>>,
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
    const id = stored === null ? null : this.selectionId(stored);
    // A choice the product doesn't allow stays stored, but its default applies instead.
    if (id !== null && this.permits(id)) return id;
    return this.defaultSelection();
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

  /** The built-in theme that applies `palette` in `mode` (its file names the palette). */
  private builtInMember(
    palette: string,
    mode: UiTheme,
  ): { theme: ThemeContribution; extension: ThemeExtension } | undefined {
    for (const extension of this.extensions.values()) {
      if (!extension.builtIn) continue;
      for (const theme of extension.contributions.themes) {
        if (theme.uiTheme !== mode) continue;
        if (this.member(theme, extension)?.parsed.palette === palette) return { theme, extension };
      }
    }
    return undefined;
  }

  /**
   * The `[<id>]` scopes of the colour customizations that apply to `choice` in `mode`,
   * lowest first: a family's `<extension id>/<family>`, then the member on screen in that
   * mode (so `[acme.x/paper]` holds in light mode only). A built-in palette also takes its
   * palette id, as before themes were extensions, below its family's.
   */
  private customizationScopes(choice: string, mode: UiTheme): string[] {
    if (isThemeSelection(choice)) {
      const member = this.builtInMember(choice, mode);
      if (!member) return [choice];
      const family = member.theme.family ? [`${member.extension.id}/${member.theme.family}`] : [];
      return [...new Set([choice, ...family, member.theme.fullId])];
    }
    const found = this.find(choice);
    if (!found) return [choice];
    const { theme, extension } = found;
    if (!theme.family) return [theme.fullId];
    const member =
      extension.contributions.themes.find(
        (entry) => entry.family === theme.family && entry.uiTheme === mode,
      ) ?? theme;
    return [...new Set([`${extension.id}/${theme.family}`, member.fullId])];
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
        [color.fullId, color.token],
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

  /** The colour customizations: global ones, then those of each `[scope]` in order. */
  private customizations(
    scopes: readonly string[],
    context: ValueContext,
    draft?: unknown,
  ): ThemeTokens {
    const tokens = nullMap<{ value: string; references: readonly string[] }>();
    // Under the product's `hideCustomizations` the user can't see them: they don't apply.
    if (this.policy?.hideCustomizations) return tokens;
    const snapshot = snapshotPlainData(
      draft ?? readJson(COLOR_CUSTOMIZATIONS_STORAGE_KEY) ?? null,
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
    for (const scope of scopes) {
      const scoped = snapshot.value[`[${scope}]`];
      if (isRecord(scoped)) read(scoped);
    }
    return tokens;
  }

  /**
   * The chosen theme's values. `draft`: colour customizations to resolve instead of the
   * stored ones, quietly (the Advanced editor's check).
   */
  private resolve(id: string, draft?: unknown): Resolution | undefined {
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
    const storedOptions = this.policy?.hideCustomizations ? {} : this.storedOptions(optionsKey);
    const lockedOptions = this.policy?.lockedOptions ?? {};
    const primary = members[theme.uiTheme] ?? members[modes[0]!];
    const options: ActiveThemeOption[] = (primary?.parsed.options ?? []).map((option) => {
      const has = (wanted: unknown) => option.choices.some((choice) => choice.id === wanted);
      const lock = Object.hasOwn(lockedOptions, option.id) ? lockedOptions[option.id] : undefined;
      if (lock !== undefined && !has(lock)) {
        this.warnOnce(
          `product:option:${id}:${option.id}`,
          `product theme: ${id} has no ${option.id} choice ${JSON.stringify(lock)}`,
        );
      }
      const stored = storedOptions[option.id];
      const locked = lock !== undefined && has(lock);
      const value = locked ? lock : has(stored) ? (stored as string) : option.default;
      return {
        id: option.id,
        label: option.label,
        value,
        ...(locked ? { locked } : {}),
        choices: option.choices.map((choice) => ({ id: choice.id, label: choice.label })),
      };
    });
    const variants = this.layerVariants(primary?.parsed.variants ?? {});
    const variantLayer = hostTokens(variantTokens(variants));
    const context = this.valueContext(extension, []);
    const blocks: { light?: Record<string, string>; dark?: Record<string, string> } = {};
    const probes: { light?: Record<string, string>; dark?: Record<string, string> } = {};
    const syntax: TokenSyntaxTheme[] = [];
    const customizationRejections: CustomizationRejection[] = [];
    for (const mode of modes) {
      const member = members[mode]!;
      const layers: ThemeTokens[] = [member.parsed.tokens];
      if (member.syntaxName && member.parsed.syntax) {
        syntax.push({
          name: member.syntaxName,
          type: mode,
          colors: member.parsed.syntax.colors,
          tokenColors: member.parsed.syntax.tokenColors,
        });
        const token = `syntax-theme-${mode}`;
        if (!(token in member.parsed.tokens)) {
          layers.push({ [token]: { value: member.syntaxName, references: [] } });
        }
      }
      for (const option of options) {
        const definition = member.parsed.options.find((entry) => entry.id === option.id);
        const choice = definition?.choices.find((entry) => entry.id === option.value);
        if (choice) layers.push(choice.tokens);
      }
      layers.push(variantLayer);
      const customizationLayer = layers.length;
      layers.push(this.customizations(this.customizationScopes(id, mode), context, draft));
      layers.push(this.lockedTokens);
      const { values, rejected } = this.resolveLayers(id, layers, mode, draft !== undefined);
      for (const entry of rejected) {
        if (entry.layer === customizationLayer) customizationRejections.push({ ...entry, mode });
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
      variants: variants as Readonly<Record<string, string>>,
      themeVariants: checkVariants(primary?.parsed.variants ?? {}) as Readonly<
        Record<string, string>
      >,
      blocks: themeBlocks,
      fonts,
      brand,
      syntax,
      key,
      customizationRejections,
    };
  }

  /** {@link resolveTokenLayers}, warning once about each value it leaves out. */
  private resolveLayers(
    id: string,
    layers: readonly ThemeTokens[],
    mode: UiTheme,
    quiet = false,
  ): { values: Record<string, string>; rejected: readonly RejectedToken[] } {
    const { values, rejected } = resolveTokenLayers(layers, mode);
    for (const entry of quiet ? [] : rejected) {
      this.warnOnce(
        `${id}:${mode}:${entry.token}:${entry.layer}:${hashText(entry.value)}`,
        `${id}: --${entry.token} ${entry.reason}; left out`,
      );
    }
    return { values, rejected };
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
    else {
      // A built-in palette, or the default while a chosen theme's extension is missing
      // (whose customizations wait for it): the variants, customizations and locks.
      const context = this.valueContext(undefined, []);
      const block: { light?: Record<string, string>; dark?: Record<string, string> } = {};
      const variants = hostTokens(variantTokens(this.getVariants()));
      const palette = choice !== null && isThemeSelection(choice) ? choice : DEFAULT_PALETTE;
      for (const mode of ["light", "dark"] as const) {
        const custom = contributed
          ? nullMap<{ value: string; references: readonly string[] }>()
          : this.customizations(this.customizationScopes(palette, mode), context);
        const { values } = this.resolveLayers(palette, [variants, custom, this.lockedTokens], mode);
        if (Object.keys(values).length > 0) block[mode] = values;
      }
      if (block.light || block.dark) layers.push(block);
    }
    const css = buildThemeCss(layers, selectors);
    this.writeStyle(css);
    this.stamp(css ? (contributed ?? "") : null);
    this.stampVariants(resolution ? resolution.variants : this.getVariants());
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
            variants: this.getVariants() as Readonly<Record<string, string>>,
            fromCache: false,
          }
        : null;
      if (contributed)
        this.warnOnce(
          `missing:${contributed}`,
          `${contributed} is not installed; using the default theme`,
        );
    }
    if (this.previewing === undefined) this.recordCommitted(choice, css, resolution);
    this.watchRoots();
    this.emit();
  }

  private recordCommitted(
    choice: string | null,
    css: string,
    resolution: Resolution | undefined,
  ): void {
    const options = nullMap<string>();
    for (const option of resolution?.options ?? []) options[option.id] = option.value;
    const variants = nullMap<string>();
    Object.assign(
      variants,
      resolution ? resolution.variants : (this.active?.variants ?? this.getVariants()),
    );
    this.committed = Object.freeze({
      options: Object.freeze(options),
      variants: Object.freeze(variants),
      key: `${choice ?? DEFAULT_PALETTE}#${hashText(css)}`,
    });
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

  /** `data-omni-<name>` on the theme roots for each variant not at its default. */
  private stampVariants(variants: Readonly<Record<string, string>>): void {
    for (const root of getThemeRoots()) {
      for (const name of VARIANT_NAMES) {
        const attribute = variantAttribute(name);
        const value = variants[name];
        if (value === undefined || value === defaultVariant(name)) {
          root.removeAttribute(attribute);
        } else if (root.getAttribute(attribute) !== value) {
          root.setAttribute(attribute, value);
        }
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
    const familyLabel = resolution.theme.family
      ? resolution.extension.contributions.themes.find(
          (theme) => theme.family === resolution.theme.family && theme.familyLabel,
        )?.familyLabel
      : undefined;
    const cache: ThemeCache = {
      version: 1,
      id,
      key: resolution.key,
      label: resolution.theme.label,
      uiTheme: resolution.theme.uiTheme,
      ...(resolution.theme.family ? { family: resolution.theme.family } : {}),
      ...(familyLabel ? { familyLabel } : {}),
      ...(resolution.forcedMode ? { forcedMode: resolution.forcedMode } : {}),
      blocks: resolution.blocks,
      fonts: resolution.fonts,
      ...(resolution.brand ? { brand: resolution.brand } : {}),
      syntax: resolution.syntax,
      ...(Object.keys(resolution.themeVariants).length > 0
        ? { variants: resolution.themeVariants }
        : {}),
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
  const { variants } = raw;
  const { id, key, label, uiTheme, family, familyLabel, forcedMode, blocks, fonts, brand, syntax } =
    raw;
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
  // The same resolve-time pass as a live theme's: ranges and cycles over the defaults.
  const checkBlock = (values: unknown, mode: UiTheme): Record<string, string> | undefined => {
    const checked = checkTokens(values);
    if (!checked) return undefined;
    const layer = nullMap<{ value: string; references: readonly string[] }>();
    for (const [token, value] of Object.entries(checked)) {
      layer[token] = { value, references: valueReferences(value) };
    }
    const out = nullMap<string>();
    Object.assign(out, resolveTokenLayers([layer], mode).values);
    return out;
  };
  const checkedBlocks: ThemeBlocks = {
    ...(blocks.light !== undefined ? { light: checkBlock(blocks.light, "light") } : {}),
    ...(blocks.dark !== undefined ? { dark: checkBlock(blocks.dark, "dark") } : {}),
    probes: { light: checkBlock(probes.light, "light"), dark: checkBlock(probes.dark, "dark") },
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
  // Shown in the picker and Settings: no bidi or zero-width characters.
  const shownLabel = labelOf(label, 80) ?? id;
  const shownFamilyLabel = labelOf(familyLabel, 80);
  return {
    version: 1,
    id,
    key,
    label: shownLabel,
    uiTheme,
    ...(family ? { family } : {}),
    ...(shownFamilyLabel ? { familyLabel: shownFamilyLabel } : {}),
    ...(forcedMode ? { forcedMode } : {}),
    blocks: checkedBlocks,
    fonts: checkedFonts,
    ...(checkedBrand ? { brand: checkedBrand } : {}),
    syntax: checkedSyntax,
    ...(Object.keys(checkVariants(variants)).length > 0
      ? { variants: checkVariants(variants) as Readonly<Record<string, string>> }
      : {}),
  };
}

/** Host token values (a variant's) as a theme layer, with the tokens each reads. */
function hostTokens(values: Readonly<Record<string, string>>): ThemeTokens {
  const out = nullMap<{ value: string; references: readonly string[] }>();
  for (const [token, value] of Object.entries(values)) {
    out[token] = { value, references: valueReferences(value) };
  }
  return out;
}

/** The keys of colour customizations in order: `id`, and `[scope].id` for scoped ones. */
function customizationKeys(record: unknown): string[] {
  if (!isRecord(record)) return [];
  return Object.entries(record).flatMap(([key, value]) =>
    key.startsWith("[")
      ? isRecord(value)
        ? Object.keys(value).map((id) => `${key}.${id}`)
        : []
      : [key],
  );
}

/** The tokens a value the host wrote reads. */
function valueReferences(value: string): string[] {
  return [...value.matchAll(/var\(\s*--([A-Za-z0-9-]+)/g)].map((match) => match[1]!);
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

/** Whether the product hides the theme options and Advanced customizations, live. */
export function useThemeCustomizationsHidden(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => themeService.getProductPolicy()?.hideCustomizations === true,
    () => false,
  );
}

/** The mode the product locks (`lockMode`), live; null otherwise. */
export function useThemeModeLock(): UiTheme | null {
  return useSyncExternalStore(
    subscribe,
    () => themeService.getModeLock(),
    () => null,
  );
}

/** The variants the product locks, live (a stable snapshot per service version). */
export function useLockedThemeVariants(): VariantValues {
  const version = useSyncExternalStore(
    subscribe,
    () => themeService.getVersion(),
    () => 0,
  );
  return lockedVariantsAt(version);
}

let lockedVariantsVersion = -1;
let lockedVariantsSnapshot: VariantValues = {};
function lockedVariantsAt(version: number): VariantValues {
  if (version !== lockedVariantsVersion) {
    lockedVariantsVersion = version;
    lockedVariantsSnapshot = themeService.getLockedVariants();
  }
  return lockedVariantsSnapshot;
}

/** The mode that holds whatever the mode setting says (the product's lock, else a single-mode theme's), live. */
export function useThemeForcedMode(): UiTheme | null {
  return useSyncExternalStore(
    subscribe,
    () => themeService.getForcedMode(),
    () => null,
  );
}
