import type { CSSProperties } from "react";
import { readThemeTokens, TOKEN_MODE_PROBE_ATTRIBUTE, type TokenMode } from "@/theme/tokenValues";
import { TERMINAL_TOKENS } from "@/theme/tokens/terminal";
import { TERMINAL_ANSI_NAMES, UNSET_VALUE } from "@/theme/tokens/registry";

/**
 * Props that repaint a DOM block in the terminal's scheme (the xterm's frame, the
 * chat's terminal-styled shell blocks), by pointing the surface tokens its utilities
 * read at the `terminal-*` tokens. In a mode the app isn't in, the block reads those
 * as a mode probe (`data-token-mode`), as the xterm's own theme does.
 */
export function terminalSurfaceProps(
  isDark: boolean,
  appIsDark: boolean,
): { style: CSSProperties; [TOKEN_MODE_PROBE_ATTRIBUTE]?: TokenMode } {
  const style = {
    colorScheme: isDark ? "dark" : "light",
    "--background": "var(--terminal-background)",
    "--foreground": "var(--terminal-foreground)",
    "--muted": "var(--terminal-muted)",
    "--muted-foreground": "var(--terminal-muted-foreground)",
    "--border": "var(--terminal-border)",
    "--destructive": "var(--terminal-destructive)",
    // The app theme's selection colors are tuned for the app's scheme and can
    // vanish against the other one.
    "--selection-background": "var(--terminal-selection)",
    "--selection-foreground": "var(--terminal-foreground)",
  } as CSSProperties;
  if (isDark === appIsDark) return { style };
  return { style, [TOKEN_MODE_PROBE_ATTRIBUTE]: isDark ? "dark" : "light" };
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
