import type { CSSProperties } from "react";
import { readThemeTokens, type TokenMode } from "@/theme/tokenValues";
import { TERMINAL_TOKENS } from "@/theme/tokens/terminal";
import { TERMINAL_ANSI_NAMES, UNSET_VALUE } from "@/theme/tokens/registry";

// Terminal colors in each scheme, shared by the xterm pane and the chat's
// terminal-styled shell blocks so both read as the same terminal. The
// backgrounds match the app's default `--card`.
const TERMINAL_COLORS = {
  light: {
    background: "#ffffff",
    foreground: "#18181b",
    muted: "#f4f4f5",
    mutedForeground: "#71717a",
    border: "#e4e4e7",
    destructive: "#c8324c",
    selection: "#0891b233",
  },
  dark: {
    background: "#0a0a0a",
    foreground: "#e4e4e7",
    muted: "#27272a",
    mutedForeground: "#a1a1aa",
    border: "#27272a",
    destructive: "#e65b77",
    selection: "#22d3ee33",
  },
} as const;

/** The terminal's background, text and selection colors in the given scheme. */
export function terminalSurfaceColors(isDark: boolean): {
  background: string;
  foreground: string;
  selection: string;
} {
  return isDark ? TERMINAL_COLORS.dark : TERMINAL_COLORS.light;
}

/**
 * Style that repaints a DOM block in the terminal's scheme by overriding the
 * theme variables its utilities read, for when the terminal theme setting
 * differs from the app's.
 */
export function terminalSurfaceStyle(isDark: boolean): CSSProperties {
  const colors = isDark ? TERMINAL_COLORS.dark : TERMINAL_COLORS.light;
  return {
    colorScheme: isDark ? "dark" : "light",
    "--background": colors.background,
    "--foreground": colors.foreground,
    "--muted": colors.muted,
    "--muted-foreground": colors.mutedForeground,
    "--border": colors.border,
    "--destructive": colors.destructive,
    // The app theme's selection colors are tuned for the app's scheme and can
    // vanish against the other one.
    "--selection-background": colors.selection,
    "--selection-foreground": colors.foreground,
  } as CSSProperties;
}

/** The terminal's colours in one mode, as the theme tokens give them; unset slots are absent. */
export interface TerminalTokenColors {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selection: string;
  /** ANSI 0 to 15; `undefined` where xterm's default applies. */
  ansi: readonly (string | undefined)[];
  /** The background tones Codex's input box is repainted with. */
  tones: { subtle: string; input: string; emphasis: string };
}

const TERMINAL_TOKEN_IDS = TERMINAL_TOKENS.map((token) => token.id);

/** A token's registry default in `mode`, with `var()` of another terminal token resolved. */
function registryDefault(id: string, mode: TokenMode): string {
  const token = TERMINAL_TOKENS.find((candidate) => candidate.id === id);
  const value =
    mode === "dark" ? (token?.default?.dark ?? token?.default?.light) : token?.default?.light;
  if (value === undefined || value === UNSET_VALUE) return "";
  const alias = /^var\(--([\w-]+)\)$/.exec(value);
  return alias ? registryDefault(alias[1], mode) : value;
}

/**
 * The terminal's colours in the given scheme, read from the `terminal-*` tokens (the
 * theme's, or the registry defaults). Where the token stylesheet isn't loaded (unit
 * tests), the registry defaults themselves.
 */
export function terminalTokenColors(isDark: boolean): TerminalTokenColors {
  const mode: TokenMode = isDark ? "dark" : "light";
  let values: Record<string, string> = readThemeTokens(TERMINAL_TOKEN_IDS, mode);
  if (!values["terminal-background"]) {
    values = Object.fromEntries(TERMINAL_TOKEN_IDS.map((id) => [id, registryDefault(id, mode)]));
  }
  const read = (id: string) => values[id] || "";
  return {
    background: read("terminal-background"),
    foreground: read("terminal-foreground"),
    cursor: read("terminal-cursor"),
    cursorAccent: read("terminal-cursor-accent"),
    selection: read("terminal-selection"),
    ansi: TERMINAL_ANSI_NAMES.map((name) => read(`terminal-ansi-${name}`) || undefined),
    tones: {
      subtle: read("terminal-tone-subtle"),
      input: read("terminal-tone-input"),
      emphasis: read("terminal-tone-emphasis"),
    },
  };
}
