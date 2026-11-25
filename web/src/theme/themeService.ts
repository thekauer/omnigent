// The window's colour themes (theming plan M6): the themes, colours and fonts extensions
// contribute, the user's choice, and the one runtime stylesheet that applies them.
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
  readThemeChoice,
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
import type {
  ColorContribution,
  FontContribution,
  ThemeContribution,
  ThemeContributions,
  UiTheme,
} from "./themeContributions";
import { parseThemeFile, type ParsedTheme, type ThemeTokens } from "./themeFile";
import { getToken, TOKENS } from "./tokens/registry";
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
// Host asset paths only: what the dev plugin serves, or a bundled asset of the app.
const HOST_ASSET_URL = /^\/[A-Za-z0-9@._~/+-]{1,512}$/;

const BUNDLED_SYNTAX_THEMES = new Set(bundledThemesInfo.map((theme) => theme.id));

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
  private choice: string | null = null;
  private loading = 0;
  private started = false;
  private active: ActiveTheme | null = null;
  private forcedMode: UiTheme | null = null;
  private appliedCss = "";
  private appliedKey = "";
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
  select(id: string | null): void {
    if (id !== null && !isContributedThemeId(id) && !isThemeSelection(id)) {
      throw new TypeError(`no theme ${JSON.stringify(String(id).slice(0, 80))}`);
    }
    if (id === null || isThemeSelection(id)) {
      const palette = id ?? DEFAULT_PALETTE;
      writeThemePalette(palette);
      applyThemePalette(palette);
    } else {
      writeContributedThemeChoice(id);
      applyThemePalette(DEFAULT_PALETTE);
    }
    this.choice = id;
    this.refresh();
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
    const cache = this.readCache();
    if (!cache || cache.id !== choice) return;
    const css = buildThemeCss([cache.blocks], themeSelectors(getThemeScopeSelector()));
    this.writeStyle(css);
    this.appliedKey = cache.key;
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
    };
  }

  private currentChoice(): string | null {
    this.choice ??= typeof window === "undefined" ? null : readThemeChoice();
    return this.choice;
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
    const colors = new Set(
      [...this.extensions.values()].flatMap((entry) =>
        entry.contributions.colors.map((color) => color.token),
      ),
    );
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
        return asset?.kind === "asset" && HOST_ASSET_URL.test(asset.url) ? asset.url : undefined;
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

  private storedOptions(key: string): Record<string, unknown> {
    const stored = readJson(THEME_OPTIONS_STORAGE_KEY);
    return isRecord(stored) && isRecord(stored[key]) ? stored[key] : {};
  }

  /** The colour customizations for `themeId`: global ones, then the `[themeId]` ones. */
  private customizations(themeId: string, context: ValueContext): ThemeTokens {
    const tokens = nullMap<{ value: string; references: readonly string[] }>();
    const snapshot = snapshotPlainData(readJson(COLOR_CUSTOMIZATIONS_STORAGE_KEY) ?? null, {
      chars: 65_536,
      nodes: 5000,
      depth: 4,
    });
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
      const parsed = member && this.parseMember(member, extension);
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
      if (asset?.kind !== "asset" || !HOST_ASSET_URL.test(asset.url)) {
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
      variants: primary?.parsed.variants ?? nullMap<string>(),
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
    const layers: ThemeBlocks[] = [defaults];
    if (resolution) layers.push(resolution.blocks);
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
      this.writeCache(resolution, contributed!);
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
            variants: nullMap<string>(),
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
      if (!HOST_ASSET_URL.test(font.url) || !/^[a-z0-9-]{1,160}$/.test(font.family)) continue;
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
    if (this.appliedKey === resolution.key) return;
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
      window.localStorage.setItem(THEME_CACHE_STORAGE_KEY, text);
    } catch {
      // A full storage only loses the first-paint cache.
    }
  }

  private emit(): void {
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
  const context: ValueContext = {
    isKnownToken: (token) => getToken(token) !== undefined || /^x-[a-z0-9-]{1,160}$/.test(token),
    fontFamily: (name) => (/^x-[a-z0-9-]{1,160}$/.test(name) ? name : undefined),
  };
  const checkTokens = (values: unknown): Record<string, string> | undefined => {
    if (values === undefined) return undefined;
    if (!isRecord(values)) return undefined;
    const out = nullMap<string>();
    for (const [token, value] of Object.entries(values)) {
      const kind =
        getToken(token)?.kind ?? (/^x-[a-z0-9-]{1,160}$/.test(token) ? "color" : undefined);
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
        /^[a-z0-9-]{1,160}$/.test(font.family) &&
        typeof font.url === "string" &&
        HOST_ASSET_URL.test(font.url)
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
      typeof value === "string" && HOST_ASSET_URL.test(value) ? value : undefined;
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

/** The mode the chosen theme forces (a single-mode theme), live; null otherwise. */
export function useThemeForcedMode(): UiTheme | null {
  return useSyncExternalStore(
    subscribe,
    () => themeService.getForcedMode(),
    () => null,
  );
}
