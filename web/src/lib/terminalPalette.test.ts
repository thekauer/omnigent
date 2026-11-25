import { describe, expect, it } from "vitest";

import { getToken } from "@/theme/tokens/registry";
import { TOKEN_MODE_PROBE_ATTRIBUTE } from "@/theme/tokenValues";

import { terminalSurfaceProps } from "./terminalPalette";

// The frame's colours before they were tokens: the defaults must stay these.
const FORMER = {
  light: {
    "--background": "#ffffff",
    "--foreground": "#18181b",
    "--muted": "#f4f4f5",
    "--muted-foreground": "#71717a",
    "--border": "#e4e4e7",
    "--destructive": "#c8324c",
    "--selection-background": "#0891b233",
    "--selection-foreground": "#18181b",
  },
  dark: {
    "--background": "#0a0a0a",
    "--foreground": "#e4e4e7",
    "--muted": "#27272a",
    "--muted-foreground": "#a1a1aa",
    "--border": "#27272a",
    "--destructive": "#e65b77",
    "--selection-background": "#22d3ee33",
    "--selection-foreground": "#e4e4e7",
  },
};

describe("terminalSurfaceProps", () => {
  it("reads the terminal tokens, whose defaults are the former frame colours", () => {
    for (const mode of ["light", "dark"] as const) {
      const { style } = terminalSurfaceProps(mode === "dark", mode === "dark");
      expect(style.colorScheme).toBe(mode);
      for (const [property, former] of Object.entries(FORMER[mode])) {
        const value = (style as Record<string, string>)[property];
        const id = /^var\(--([\w-]+)\)$/.exec(value)?.[1] ?? "";
        expect(id, property).toMatch(/^terminal-/);
        const token = getToken(id);
        expect(token?.perMode, id).toBe(true);
        expect(mode === "dark" ? token?.default?.dark : token?.default?.light, id).toBe(former);
      }
    }
  });

  it("reads them as a mode probe only in the mode the app isn't in", () => {
    expect(terminalSurfaceProps(true, true)).not.toHaveProperty(TOKEN_MODE_PROBE_ATTRIBUTE);
    expect(terminalSurfaceProps(true, false)[TOKEN_MODE_PROBE_ATTRIBUTE]).toBe("dark");
    expect(terminalSurfaceProps(false, true)[TOKEN_MODE_PROBE_ATTRIBUTE]).toBe("light");
  });
});
