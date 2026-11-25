import { describe, expect, it } from "vitest";

import {
  isHexColor,
  isSyntaxFontStyle,
  sanitizeSyntaxTheme,
  SYNTAX_THEME_LIMITS,
} from "./validate";

describe("isHexColor", () => {
  it("takes the four hex forms only", () => {
    for (const value of ["#abc", "#abcd", "#a1b2c3", "#A1B2C3D4"]) {
      expect(isHexColor(value), value).toBe(true);
    }
    for (const value of [
      "abc",
      "#ab",
      "#abcde",
      "#abcdefg",
      "red",
      "rgb(0 0 0)",
      "#fff; background: url(https://example.com/x)",
      "#fff\n",
      " #fff",
      "var(--x)",
      12,
      null,
    ]) {
      expect(isHexColor(value), String(value)).toBe(false);
    }
  });
});

describe("isSyntaxFontStyle", () => {
  it("takes the keywords, combined by spaces, and the empty reset", () => {
    for (const value of ["", "italic", "bold underline", "italic bold underline strikethrough"]) {
      expect(isSyntaxFontStyle(value), value).toBe(true);
    }
    for (const value of [
      "oblique",
      "italic italic",
      "italic;color:red",
      "bold,italic",
      "italic\nbold",
      "bold }",
      42,
    ]) {
      expect(isSyntaxFontStyle(value), String(value)).toBe(false);
    }
  });
});

describe("sanitizeSyntaxTheme", () => {
  it("drops every value that could inject CSS, and keeps the rest", () => {
    const { colors, tokenColors, issues } = sanitizeSyntaxTheme(
      {
        "editor.background": "#101820",
        "editor.foreground": "red;--diffs-bg:url(https://example.com/x)",
        "gitDecoration.addedResourceForeground": "#0f0; position: fixed",
        "bad id;": "#000",
      },
      [
        { scope: "keyword", settings: { foreground: "#ff00aa", fontStyle: "italic bold" } },
        { scope: "string", settings: { foreground: "#0f0;background-image:url(x)" } },
        { scope: ["comment", "x;y"], settings: { foreground: "#888" } },
        { scope: "number", settings: { fontStyle: "italic; color: red" } },
        { scope: "constant", settings: { background: "#123", foreground: "expression(alert(1))" } },
        { settings: { foreground: "#abcdef" } },
        { scope: "nothing" },
        "not a rule",
      ],
    );
    expect(colors).toEqual({ "editor.background": "#101820" });
    expect(tokenColors).toEqual([
      { scope: "keyword", settings: { foreground: "#ff00aa", fontStyle: "italic bold" } },
      { scope: "constant", settings: { background: "#123" } },
      { settings: { foreground: "#abcdef" } },
    ]);
    expect(issues).toHaveLength(9);
  });

  it("caps the sizes", () => {
    const rules = Array.from({ length: SYNTAX_THEME_LIMITS.rules + 5 }, () => ({
      scope: "keyword",
      settings: { foreground: "#fff" },
    }));
    const colors = Object.fromEntries(
      Array.from({ length: SYNTAX_THEME_LIMITS.colors + 1 }, (_, index) => [`c.x${index}`, "#000"]),
    );
    const result = sanitizeSyntaxTheme(colors, rules);
    expect(result.tokenColors).toHaveLength(SYNTAX_THEME_LIMITS.rules);
    expect(Object.keys(result.colors)).toHaveLength(SYNTAX_THEME_LIMITS.colors);
    const tooManyScopes = sanitizeSyntaxTheme(undefined, [
      {
        scope: Array(SYNTAX_THEME_LIMITS.scopesPerRule + 1).fill("a"),
        settings: { foreground: "#fff" },
      },
      { scope: "a".repeat(SYNTAX_THEME_LIMITS.scopeLength + 1), settings: { foreground: "#fff" } },
    ]);
    expect(tooManyScopes.tokenColors).toEqual([]);
  });

  it("reports a missing or malformed rule list", () => {
    expect(sanitizeSyntaxTheme("x", undefined).issues).toEqual([
      "colors: not an object",
      "tokenColors: not an array",
    ]);
  });
});
