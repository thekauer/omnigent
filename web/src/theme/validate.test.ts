import { describe, expect, it } from "vitest";

import {
  isHexColor,
  isSyntaxFontStyle,
  sanitizeSyntaxTheme,
  snapshotPlainData,
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

describe("snapshotPlainData", () => {
  const LIMITS = { chars: 1000, nodes: 100, depth: 8 };

  it("reads each field once and never calls a getter", () => {
    let reads = 0;
    const tricky = {
      get foreground() {
        reads += 1;
        return reads === 1 ? "#fff" : "red;}body{x:url(https://example.com)";
      },
    };
    expect(snapshotPlainData(tricky, LIMITS)).toEqual({
      ok: false,
      reason: "$.foreground: an accessor",
    });
    expect(reads).toBe(0);
    const proxyReads: string[] = [];
    const proxy = new Proxy(
      { a: "#fff" },
      {
        getOwnPropertyDescriptor(target, key) {
          proxyReads.push(String(key));
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    const copied = snapshotPlainData(proxy, LIMITS);
    expect(copied).toMatchObject({ ok: true, value: { a: "#fff" } });
    expect(proxyReads).toEqual(["a"]);
  });

  it("rejects holes, cycles, symbols, class instances and non-finite numbers", () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(snapshotPlainData([1, , 3], LIMITS)).toEqual({ ok: false, reason: "$[1]: a hole" });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(snapshotPlainData(cyclic, LIMITS).ok).toBe(false);
    expect(snapshotPlainData({ [Symbol("x")]: 1 }, LIMITS).ok).toBe(false);
    expect(snapshotPlainData(new Date(0), LIMITS).ok).toBe(false);
    expect(snapshotPlainData({ n: Number.NaN }, LIMITS).ok).toBe(false);
    // A repeated (not cyclic) reference is fine.
    const shared = { a: 1 };
    expect(snapshotPlainData([shared, shared], LIMITS).ok).toBe(true);
  });

  it("keeps __proto__ a plain key in a prototype-free copy", () => {
    const parsed = JSON.parse('{"__proto__": {"polluted": "#fff"}, "a": "#000"}') as unknown;
    const copied = snapshotPlainData(parsed, LIMITS);
    expect(copied.ok).toBe(true);
    const value = (copied as { value: Record<string, unknown> }).value;
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.keys(value)).toEqual(["__proto__", "a"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("fails as a whole past the size caps", () => {
    expect(snapshotPlainData("x".repeat(1001), LIMITS).ok).toBe(false);
    expect(
      snapshotPlainData(
        Array.from({ length: 101 }, () => 0),
        LIMITS,
      ).ok,
    ).toBe(false);
    let deep: unknown = 0;
    for (let index = 0; index < 9; index += 1) deep = [deep];
    expect(snapshotPlainData(deep, LIMITS).ok).toBe(false);
  });
});

describe("sanitizeSyntaxTheme's input handling", () => {
  it("checks a copy, so a getter can't swap a value after the check", () => {
    let reads = 0;
    const settings = {
      get foreground() {
        reads += 1;
        return "#fff";
      },
    };
    const { tokenColors, issues } = sanitizeSyntaxTheme({}, [{ scope: "keyword", settings }]);
    expect(reads).toBe(0);
    expect(tokenColors).toEqual([]);
    expect(issues[0]).toMatch(/accessor/);
  });

  it("rejects sparse rule lists and caps the total size", () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [{ settings: { foreground: "#fff" } }, , { settings: { foreground: "#000" } }];
    expect(sanitizeSyntaxTheme({}, sparse).issues[0]).toMatch(/hole/);
    const huge = { "editor.background": "#".padEnd(SYNTAX_THEME_LIMITS.chars + 1, "f") };
    const result = sanitizeSyntaxTheme(huge, []);
    expect(result.colors).toEqual({});
    expect(result.issues[0]).toMatch(/characters/);
  });

  it("returns prototype-free colour maps", () => {
    const { colors } = sanitizeSyntaxTheme(
      JSON.parse('{"__proto__": "#fff", "editor.background": "#000"}'),
      [],
    );
    expect(Object.getPrototypeOf(colors)).toBeNull();
    expect(colors["editor.background"]).toBe("#000");
  });
});
