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
  /** The chosen theme's option choices, by option id (none for a built-in palette). */
  readonly options: Readonly<Record<string, string>>;
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

/**
 * The id of a {@link ThemeColor}, or of a plain object shaped like one (`{ id: string }`
 * and nothing else), as a Worker's structured clone delivers it; undefined otherwise.
 */
export function themeColorIdOf(value: unknown): string | undefined {
  if (value instanceof ThemeColor) return value.id;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "id") return undefined;
  const id = (value as { id: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

/** How long a mode preview's end takes to reach the roots' class (one React render). */
const MODE_SETTLE_MS = 100;

function innermostRoot(): HTMLElement | null {
  const roots = getThemeRoots();
  return roots[roots.length - 1] ?? null;
}

interface Snapshot {
  readonly info: ColorThemeInfo;
  /** The service's applied key: an option's or a customization's new values change it. */
  readonly key: string;
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return a.key === b.key && JSON.stringify(a.info) === JSON.stringify(b.info);
}

/**
 * The window's colour theme for extensions: always the committed theme and mode, never a
 * picker's preview. The change event fires after a committed change is applied (a chosen
 * theme, an option, a variant, a customization, the mode): never for a preview of a theme
 * or a mode, nor when a preview ends where it began.
 */
export class ColorThemes {
  private readonly themes: ThemeService;
  private readonly listeners = new Set<(theme: ColorThemeInfo) => void>();
  private stop: (() => void) | null = null;
  private last: Snapshot | null = null;
  private readonly warned = new Set<string>();
  /** The mode on screen when a mode preview began, until its end has settled. */
  private committedDark: boolean | undefined = undefined;
  private settling: ReturnType<typeof setTimeout> | undefined;
  private readonly settled = new Set<() => void>();

  constructor(themes: ThemeService) {
    this.themes = themes;
    // Before React renders a mode preview, the roots still show the committed mode.
    useThemeModePreviewStore.subscribe((state, previous) => {
      if (state.mode !== null && previous.mode === null) {
        clearTimeout(this.settling);
        this.settling = undefined;
        this.committedDark ??= this.rootIsDark();
      } else if (state.mode === null && previous.mode !== null) {
        // The preview's end reaches the roots' class once React rendered; read it then.
        clearTimeout(this.settling);
        this.settling = setTimeout(() => {
          this.settling = undefined;
          this.committedDark = undefined;
          for (const listener of [...this.settled]) listener();
        }, MODE_SETTLE_MS);
      }
    });
  }

  /**
   * The committed theme: the chosen theme in the committed mode, its option choices and
   * variants. A picker's preview of a theme or a mode is never reflected.
   */
  get active(): ColorThemeInfo {
    return this.snapshot().info;
  }

  private rootIsDark(): boolean {
    const root = innermostRoot();
    return root ? root.classList.contains("dark") : false;
  }

  private snapshot(): Snapshot {
    const dark = this.committedDark ?? this.rootIsDark();
    const applied = this.themes.appliedTheme(dark ? "dark" : "light");
    const state = this.themes.committedState();
    const info: ColorThemeInfo = Object.freeze({
      id: applied.id,
      label: applied.label,
      kind: dark ? ColorThemeKind.Dark : ColorThemeKind.Light,
      options: Object.freeze({ ...state.options }),
      variants: Object.freeze({ ...state.variants }),
    });
    return { info, key: state.key };
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
   * The CSS a colour value becomes for `extensionId`: a {@link ThemeColor} (or any plain
   * `{ id }` object, as a Worker host's structured clone of one carries it) as
   * `var(--token)`, or a colour string that passes the theme validator (registry `var()`s
   * only). Undefined, with a warning, for anything else.
   */
  cssColor(extensionId: string, value: unknown, where: string): string | undefined {
    if (value === undefined || value === null) return undefined;
    const themeColorId = themeColorIdOf(value);
    if (themeColorId !== undefined) {
      const token = this.themes.colorToken(extensionId, themeColorId);
      if (token !== undefined) return `var(--${token})`;
      this.warnOnce(extensionId, themeColorId, where);
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
    this.last = this.snapshot();
    const check = () => {
      // A preview (of a theme or of a mode) is not a change; its end, back where it
      // began, compares equal to the last committed state.
      if (this.committedDark !== undefined || this.themes.isPreviewing()) return;
      if (useThemeModePreviewStore.getState().mode !== null) return;
      const next = this.snapshot();
      if (this.last && sameSnapshot(this.last, next)) return;
      this.last = next;
      for (const listener of [...this.listeners]) listener(next.info);
    };
    const stopService = this.themes.onDidChange(check);
    // The mode is the roots' `.dark` class, which next-themes sets.
    const stopTokens = subscribeThemeTokens(check);
    this.settled.add(check);
    this.stop = () => {
      stopService();
      stopTokens();
      this.settled.delete(check);
    };
  }
}

/** The window's colour theme for extensions. */
export const colorThemes = new ColorThemes(themeService);
