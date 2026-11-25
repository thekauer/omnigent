// The plugin read API's view of the colour theme (theming plan M8): what
// `window.activeColorTheme`, `onDidChangeActiveColorTheme`, `getThemeToken` and
// `ThemeColor` read. Plain strings and numbers only, so a Worker host can carry them.

import { getThemeRoots } from "@/lib/host";
import { useThemeModePreviewStore } from "@/store/themeModePreview";
import { readThemeTokens, subscribeThemeTokens } from "./tokenValues";
import { type ThemeService, themeService } from "./themeService";
import { TOKEN_CONSTRAINTS, validateTokenValue } from "./validate";
import { getToken } from "./tokens/registry";

/** As `vscode.ColorThemeKind`. Omnigent's themes are Light or Dark for now. */
export const ColorThemeKind = Object.freeze({
  Light: 1,
  Dark: 2,
  HighContrast: 3,
  HighContrastLight: 4,
} as const);
export type ColorThemeKindValue = (typeof ColorThemeKind)[keyof typeof ColorThemeKind];

/** The colour theme on screen, as `window.activeColorTheme` reports it. */
export interface ColorThemeInfo {
  /** The member theme on screen: `<extension id>/<theme id>`. */
  readonly id: string;
  readonly label: string;
  readonly kind: ColorThemeKindValue;
  /** The style variants that apply (the theme's, the user's over them). */
  readonly variants: Readonly<Record<string, string>>;
}

/** A theme colour by id, as `vscode.ThemeColor`: a registry token or the caller's own colour. */
export class ThemeColor {
  readonly id: string;
  constructor(id: string) {
    this.id = String(id);
    Object.freeze(this);
  }
}

/** How long a mode preview's end takes to reach the roots' class (one React render). */
const MODE_SETTLE_MS = 100;

function innermostRoot(): HTMLElement | null {
  const roots = getThemeRoots();
  return roots[roots.length - 1] ?? null;
}

function sameInfo(a: ColorThemeInfo, b: ColorThemeInfo): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The window's colour theme for extensions. The change event fires after a committed
 * change is applied (a chosen theme, an option, a variant, the mode): never for a
 * picker's preview of a theme or a mode, nor when a preview ends where it began.
 */
export class ColorThemes {
  private readonly themes: ThemeService;
  private readonly listeners = new Set<(theme: ColorThemeInfo) => void>();
  private stop: (() => void) | null = null;
  private last: ColorThemeInfo | null = null;
  private readonly warned = new Set<string>();

  constructor(themes: ThemeService) {
    this.themes = themes;
  }

  /** The theme on screen now (a preview's, while one shows). */
  get active(): ColorThemeInfo {
    const root = innermostRoot();
    const dark = root ? root.classList.contains("dark") : false;
    const applied = this.themes.appliedTheme(dark ? "dark" : "light");
    return Object.freeze({
      id: applied.id,
      label: applied.label,
      kind: dark ? ColorThemeKind.Dark : ColorThemeKind.Light,
      variants: Object.freeze({ ...this.themes.getVariants() }) as Readonly<Record<string, string>>,
    });
  }

  /** Calls `listener` after each committed change of {@link active}; returns the removal. */
  onDidChange(listener: (theme: ColorThemeInfo) => void): () => void {
    this.listeners.add(listener);
    if (!this.stop) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stop?.();
        this.stop = null;
        this.last = null;
      }
    };
  }

  /**
   * A token's value on the innermost theme root (getComputedStyle), as a string; `""`
   * when unset. Undefined, with a warning, for an id that is neither a registry token
   * nor one of `extensionId`'s own colours.
   */
  getToken(extensionId: string, id: unknown): string | undefined {
    const token = this.themes.colorToken(extensionId, id);
    if (token === undefined) {
      this.warnOnce(extensionId, id, "getThemeToken");
      return undefined;
    }
    return readThemeTokens([token])[token];
  }

  /**
   * The CSS a colour value becomes for `extensionId`: a {@link ThemeColor} as
   * `var(--token)`, or a colour string that passes the theme validator (registry `var()`s
   * only). Undefined, with a warning, for anything else.
   */
  cssColor(extensionId: string, value: unknown, where: string): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (value instanceof ThemeColor) {
      const token = this.themes.colorToken(extensionId, value.id);
      if (token !== undefined) return `var(--${token})`;
      this.warnOnce(extensionId, value.id, where);
      return undefined;
    }
    const checked = validateTokenValue("color", value, {
      isKnownToken: (token) => getToken(token) !== undefined && !TOKEN_CONSTRAINTS[token]?.internal,
    });
    if (checked.ok) return checked.value;
    this.warnOnce(extensionId, value, where);
    return undefined;
  }

  private warnOnce(extensionId: string, id: unknown, where: string): void {
    const text = typeof id === "string" ? id.slice(0, 80) : typeof id;
    const key = `${extensionId}:${where}:${text}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(
      `[omnigent-extensions] ${extensionId}: ${where}: ${JSON.stringify(text)} is not a theme colour (a registry token or this extension's own colour); ignoring it`,
    );
  }

  private start(): void {
    this.last = this.active;
    let settling: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      // A preview (of a theme or of a mode) is not a change; its end, back where it
      // began, compares equal to the last committed state.
      if (settling !== undefined || this.themes.isPreviewing()) return;
      if (useThemeModePreviewStore.getState().mode !== null) return;
      const next = this.active;
      if (this.last && sameInfo(this.last, next)) return;
      this.last = next;
      for (const listener of [...this.listeners]) listener(next);
    };
    const stopService = this.themes.onDidChange(check);
    // The mode is the roots' `.dark` class, which next-themes sets.
    const stopTokens = subscribeThemeTokens(check);
    // A mode preview ended: the class settles once React rendered; read it then.
    const stopModePreview = useThemeModePreviewStore.subscribe((state, previous) => {
      if (state.mode !== null || previous.mode === null) return;
      clearTimeout(settling);
      settling = setTimeout(() => {
        settling = undefined;
        check();
      }, MODE_SETTLE_MS);
    });
    this.stop = () => {
      clearTimeout(settling);
      stopService();
      stopTokens();
      stopModePreview();
    };
  }
}

/** The window's colour theme for extensions. */
export const colorThemes = new ColorThemes(themeService);
