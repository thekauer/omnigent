import { createHighlighter } from "shiki";
import { afterEach, describe, expect, it } from "vitest";

import {
  ensureSyntaxThemes,
  registerSyntaxTheme,
  shikiThemeName,
  shikiThemeNames,
  SYNTAX_THEME_NAMES,
  syntaxThemeInput,
  syntaxThemeKey,
  syntaxThemeNames,
  type SyntaxThemeDefinition,
} from "./syntaxTheme";

// A theme as a VS Code colour theme's `tokenColors` gives it.
const FIXTURE: SyntaxThemeDefinition = {
  name: "fixture-dark",
  type: "dark",
  colors: { "editor.background": "#101820", "editor.foreground": "#e0e0e0" },
  tokenColors: [
    { scope: ["keyword", "storage.type"], settings: { foreground: "#ff00aa" } },
    { scope: "string", settings: { foreground: "#00ff66", fontStyle: "italic" } },
  ],
};

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.documentElement.removeAttribute("style");
});

describe("syntax theme names", () => {
  it("defaults to the GitHub pair and reads the tokens", () => {
    expect(syntaxThemeNames()).toEqual(SYNTAX_THEME_NAMES);
    document.documentElement.style.setProperty("--syntax-theme-dark", "nord");
    document.documentElement.style.setProperty("--syntax-theme-light", '"min-light"');
    expect(syntaxThemeNames()).toEqual({ light: "min-light", dark: "nord" });
  });
});

describe("registerSyntaxTheme", () => {
  it("gives each registration its own Shiki name and unregisters", () => {
    const first = registerSyntaxTheme(FIXTURE);
    const firstName = shikiThemeName("fixture-dark");
    expect(firstName).not.toBe("fixture-dark");
    // Monaco's defineTheme takes letters, digits and dashes only.
    expect(firstName).toMatch(/^[a-z0-9-]+$/i);
    const second = registerSyntaxTheme(FIXTURE);
    cleanups.push(second);
    expect(shikiThemeName("fixture-dark")).not.toBe(firstName);
    // A stale unregister leaves the newer registration.
    first();
    expect(syntaxThemeInput("fixture-dark")).toMatchObject({ type: "dark" });
    second();
    expect(syntaxThemeInput("fixture-dark")).toBe("fixture-dark");
    expect(syntaxThemeKey(SYNTAX_THEME_NAMES)).toBe("github-light|github-dark");
  });

  it("colours code from the theme's tokenColors through Shiki", async () => {
    cleanups.push(registerSyntaxTheme(FIXTURE));
    const names = { light: "github-light", dark: "fixture-dark" };
    const highlighter = await createHighlighter({ themes: ["github-light"], langs: ["python"] });
    try {
      expect(await ensureSyntaxThemes(highlighter, names)).toBe(true);
      expect(await ensureSyntaxThemes(highlighter, names)).toBe(false);
      const { tokens } = highlighter.codeToTokens('def f():\n    return "x"', {
        lang: "python",
        theme: shikiThemeNames(names).dark,
      });
      const colors = Object.fromEntries(
        tokens.flat().map((token) => [token.content.trim(), token.color?.toLowerCase()]),
      );
      expect(colors.def).toBe("#ff00aa");
      expect(colors.return).toBe("#ff00aa");
      expect(colors['"x"'] ?? colors.x).toBe("#00ff66");
    } finally {
      highlighter.dispose();
    }
  });
});
