// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  FIXTURE_CONTRIBUTES,
  FIXTURE_EXTENSION_ID,
  FULL_DARK_THEME,
  INVALID_THEME,
  VSCODE_DARK_THEME,
} from "@/test/themeFixtures";

import { parseThemeContributions } from "./themeContributions";
import { parseThemeFile, type ThemeFileOptions } from "./themeFile";
import { getToken } from "./tokens/registry";
import { TOKEN_CONSTRAINTS } from "./validate";

const { contributions } = parseThemeContributions(FIXTURE_EXTENSION_ID, FIXTURE_CONTRIBUTES, {
  isKnownToken: (id) => getToken(id) !== undefined,
});
const colorTokens = new Map(
  contributions.colors.flatMap((color) => [
    [color.id, color.token],
    [color.token, color.token],
  ]),
);
const OPTIONS: ThemeFileOptions = {
  uiTheme: "dark",
  context: {
    isKnownToken: (id) =>
      [...colorTokens.values()].includes(id) ||
      (getToken(id) !== undefined && !TOKEN_CONSTRAINTS[id]?.internal),
    fontFamily: (name) => contributions.fonts.find((font) => font.family === name)?.cssFamily,
  },
  extensionColors: colorTokens,
  assetUrl: (path) => (path === "brand/logo.svg" ? "/assets/brand/logo.svg" : undefined),
};

const values = (tokens: Record<string, { value: string }>) =>
  Object.fromEntries(Object.entries(tokens).map(([id, { value }]) => [id, value]));

describe("parseThemeFile", () => {
  it("reads every section of a full theme", () => {
    const parsed = parseThemeFile(FULL_DARK_THEME, OPTIONS);
    expect(parsed.issues).toEqual([]);
    expect(values(parsed.tokens)).toMatchObject({
      // The VS Code aliases...
      "code-bg": "#101820",
      "viewer-background": "#101820",
      sidebar: "#0b1016",
      ring: "#ff8800",
      // ...beaten by an Omnigent id in the same `colors`.
      background: "#0d1117",
      foreground: "#e6e1cf",
      "x-acme__fixture_2dthemes-glow": "#ff00aa",
      "terminal-background": "#0a0e14",
      "terminal-ansi-red": "#ff3333",
      "terminal-ansi-bright-green": "#c2d94c",
      "ui-radius-base": "0",
      "ui-elevation": "0.5",
      "ui-font-ui": '"x-acme__fixture_2dthemes-fixture-sans", ui-sans-serif, sans-serif',
      "ui-label-transform": "uppercase",
    });
    expect(parsed.syntax?.tokenColors).toHaveLength(3);
    expect(parsed.syntax?.colors["editor.background"]).toBe("#101820");
    expect(parsed.brand).toEqual({
      logo: "/assets/brand/logo.svg",
      favicon: "/assets/brand/logo.svg",
      appName: "Fixture Studio",
    });
    expect(parsed.variants).toEqual({ density: "compact", label: "mono-upper" });
    expect(parsed.options.map((option) => [option.id, option.default])).toEqual([
      ["accent", "orange"],
      ["corners", "square"],
    ]);
    expect(values(parsed.options[0]!.choices[1]!.tokens)).toEqual({ primary: "#e5322d" });
  });

  it("warns about the invalid theme and keeps none of its bad values", () => {
    const parsed = parseThemeFile(INVALID_THEME, OPTIONS);
    const issues = parsed.issues.join("\n");
    for (const expected of [
      /unknown key "extraKey"/,
      /colors.background: "url\(" is not allowed/,
      /colors.foreground: ";" is not allowed/,
      /colors.editor.background: invalid hex/,
      /colors: no token "not-a-token"/,
      /colors: no token "color-red-500"/,
      /terminal.background: "@" is not allowed/,
      /terminal: no slot "nope"/,
      /omnigent: unknown key "unknownSection"/,
      /omnigent.tokens.ui-elevation: 2 is outside 0..1/,
      /omnigent.tokens.ui-radius-base: "expression" is not allowed/,
      /omnigent.tokens.ui-font-ui: font family Comic Sans MS/,
      /omnigent.tokens.primary: var\(--color-red-500\) is not a token/,
      /omnigent.tokens.omnigent-elevation: internal/,
    ]) {
      expect(issues).toMatch(expected);
    }
    // Only the valid values stay; the cycle is the service's to drop (it needs the registry).
    expect(values(parsed.tokens)).toEqual({
      sidebar: "#123456",
      "sidebar-background": "#123456",
      card: "var(--popover)",
      popover: "var(--card)",
    });
  });

  it("imports a stock VS Code theme partly, through the aliases", () => {
    const parsed = parseThemeFile(VSCODE_DARK_THEME, OPTIONS);
    expect(parsed.issues).toEqual([]);
    expect(values(parsed.tokens)).toMatchObject({
      background: "#1f1f1f",
      "code-bg": "#1f1f1f",
      foreground: "#cccccc",
      primary: "#0078d4",
      "primary-foreground": "#ffffff",
      ring: "#0078d4",
      sidebar: "#181818",
      "sidebar-border": "#2b2b2b",
      "sidebar-active": "#04395e",
      "code-selection": "#264f78",
      "viewer-active-line": "#2a2d2e",
      "viewer-gutter-foreground": "#6e7681",
      "ui-scrollbar-thumb": "#79797966",
      "terminal-ansi-red": "#cd3131",
      "terminal-ansi-bright-blue": "#3b8eea",
      link: "#4daafc",
      destructive: "#f85149",
    });
    // Workbench parts Omnigent has no token for stay out, reported as a partial import.
    expect(parsed.unmapped).toEqual(
      expect.arrayContaining([
        "activityBar.background",
        "statusBar.background",
        "tab.activeBackground",
      ]),
    );
    expect(parsed.syntax?.tokenColors).toHaveLength(5);
  });

  it("scales a plain shadow alpha by the elevation guard", () => {
    const parsed = parseThemeFile(
      { omnigent: { tokens: { "ui-shadow-sm-alpha": "0.3" } } },
      OPTIONS,
    );
    expect(parsed.tokens["ui-shadow-sm-alpha"]?.value).toBe(
      "calc(0.3 * var(--omnigent-elevation))",
    );
  });

  it("rejects a theme over the size cap, and survives getters and holes", () => {
    const huge = { colors: { background: "#000" }, padding: "x".repeat(70_000) };
    expect(parseThemeFile(huge, OPTIONS).issues[0]).toMatch(/rejected/);
    const tricky = {
      get colors() {
        return { background: "#fff" };
      },
    };
    expect(parseThemeFile(tricky, OPTIONS).issues[0]).toMatch(/accessor/);
    expect(parseThemeFile("not a theme", OPTIONS).issues[0]).toMatch(/not a JSON object/);
  });

  it("keeps brand assets the extension doesn't ship out", () => {
    const parsed = parseThemeFile(
      { brand: { logo: "../outside.svg", wordmark: "https://example.com/w.svg", appName: "" } },
      OPTIONS,
    );
    expect(parsed.brand).toBeUndefined();
    expect(parsed.issues).toHaveLength(3);
  });
});
