// Terminal tokens: the xterm theme (components/blocks/TerminalSession.ts terminalTheme)
// and the background tones Codex's input box is repainted with (CodexTerminalPalette.ts).
//
// The terminal follows its own light or dark setting, so these are read per mode
// (`perMode`). A slot without a value in a mode is left out of xterm's theme, so xterm's
// own default colour applies, as before these tokens.

import { defineTokens, type TokenInput, UNSET_VALUE } from "./types.ts";

function terminal(id: string, description: string, light?: string, dark?: string): TokenInput {
  const value: { light?: string; dark?: string } = {};
  if (light !== undefined) value.light = light;
  if (dark !== undefined) value.dark = dark;
  // Set in light only: unset in dark too, rather than inheriting the light colour.
  else if (light !== undefined) value.dark = UNSET_VALUE;
  return { id, description, default: value, perMode: true };
}

// raw-colors-data: the terminal's default colours
const ANSI = [
  ["black", "#18181b", "#09090b"],
  ["red"],
  ["green"],
  ["yellow"],
  ["blue"],
  ["magenta"],
  ["cyan"],
  // CLIs that assume a dark terminal paint primary text with ANSI white and bright
  // white: on the light background those are dark tones, or the text would vanish.
  ["white", "#3f3f46"],
  ["bright-black", "#e4e4e7", "#71717a"],
  ["bright-red"],
  ["bright-green"],
  ["bright-yellow"],
  ["bright-blue"],
  ["bright-magenta"],
  ["bright-cyan"],
  ["bright-white", "#18181b"],
] as const;

export const TERMINAL_TOKENS = defineTokens("terminal", [
  terminal(
    "terminal-background",
    "Terminal background, the default card colour.",
    "#ffffff",
    "#0a0a0a",
  ),
  terminal("terminal-foreground", "Terminal text.", "#18181b", "#e4e4e7"),
  terminal("terminal-cursor", "Terminal cursor.", "#0891b2", "#22d3ee"),
  terminal(
    "terminal-cursor-accent",
    "The character under a block cursor; the terminal background by default.",
    "var(--terminal-background)",
    "var(--terminal-background)",
  ),
  terminal("terminal-selection", "Terminal selection, under the text.", "#0891b233", "#22d3ee33"),
  // The frame around the xterm and the chat's terminal-styled shell blocks, which
  // repaint the app's surface tokens with these (lib/terminalPalette.ts).
  terminal(
    "terminal-muted",
    "Muted surfaces around the terminal (its tab row).",
    "#f4f4f5",
    "#27272a",
  ),
  terminal(
    "terminal-muted-foreground",
    "Secondary text around the terminal.",
    "#71717a",
    "#a1a1aa",
  ),
  terminal("terminal-border", "Borders around the terminal.", "#e4e4e7", "#27272a"),
  terminal("terminal-destructive", "Errors around the terminal.", "#c8324c", "#e65b77"),
  ...ANSI.map(([name, light, dark]) =>
    terminal(
      `terminal-ansi-${name}`,
      `ANSI ${name.replace("-", " ")}. Unset where xterm's default applies.`,
      light,
      dark,
    ),
  ),
  terminal(
    "terminal-tone-subtle",
    "Background tone for a CLI's subtle panels (Codex sessions).",
    "#fafafa",
    "#1f2123",
  ),
  terminal(
    "terminal-tone-input",
    "Background tone for a CLI's input box (Codex sessions).",
    "#f4f4f4",
    "#2f3132",
  ),
  terminal(
    "terminal-tone-emphasis",
    "Background tone for a CLI's emphasized rows (Codex sessions).",
    "#e0e0e0",
    "#464849",
  ),
]);
// raw-colors-data-end

/** The ANSI slot names, in palette order (0 to 15). */
export const TERMINAL_ANSI_NAMES: readonly string[] = ANSI.map(([name]) => name);
