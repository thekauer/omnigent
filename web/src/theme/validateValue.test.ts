import { describe, expect, it } from "vitest";

import {
  referenceCycles,
  THEME_LIMITS,
  TOKEN_CONSTRAINTS,
  validateTokenValue,
  type ValueContext,
  type ValueKind,
} from "./validate";

const KNOWN = new Set(["background", "foreground", "ui-radius-base", "ui-font-ui", "ui-font-mono"]);
const CONTEXT: ValueContext = {
  isKnownToken: (id) => KNOWN.has(id),
  fontFamily: (name) => (name === "Geist" ? "x-acme-theme-geist" : undefined),
  isSyntaxTheme: (name) => ["github-dark", "registered-1-acme"].includes(name),
};

function check(kind: ValueKind, value: unknown, constraint = {}) {
  return validateTokenValue(kind, value, CONTEXT, constraint);
}
function ok(kind: ValueKind, value: string, constraint = {}) {
  const result = check(kind, value, constraint);
  expect(result, `${kind} ${value}`).toMatchObject({ ok: true });
  return result.ok ? result.value : "";
}
function bad(kind: ValueKind, value: unknown, reason?: RegExp, constraint = {}) {
  const result = check(kind, value, constraint);
  expect(result.ok, `${kind} ${String(value)}`).toBe(false);
  if (reason && !result.ok) expect(result.reason).toMatch(reason);
}

describe("validateTokenValue", () => {
  it("rejects the dangerous constructs before parsing", () => {
    for (const value of [
      "url(https://example.com/x.png)",
      'image-set("a.png" 1x)',
      "@import 'x'",
      "expression(alert(1))",
      "attr(data-x)",
      "env(safe-area-inset-top)",
      "red !important",
      "red; color: blue",
      "red } body { color: blue",
      "<script>",
      "red /* x */",
      "\\72 ed",
      "javascript:alert(1)",
      "red\n",
      "#fff".padEnd(THEME_LIMITS.valueLength + 1, " "),
    ]) {
      bad("color", value);
    }
    bad("color", 42, /string/);
    bad("color", "", /empty/);
  });

  it("takes the colour forms, and writes them back in its own syntax", () => {
    expect(ok("color", "#ABCDEF")).toBe("#abcdef");
    expect(ok("color", "Tomato")).toBe("Tomato");
    expect(ok("color", "transparent")).toBe("transparent");
    expect(ok("color", "currentColor")).toBe("currentColor");
    expect(ok("color", "rgb(0 0 0 / 50%)")).toBe("rgb(0 0 0 / 50%)");
    expect(ok("color", "rgba(10, 20, 30, .5)")).toBe("rgba(10, 20, 30, 0.5)");
    expect(ok("color", "hsl(210deg 40% 50%)")).toBe("hsl(210deg 40% 50%)");
    expect(ok("color", "oklch(0.6 0.1 200 / 0.8)")).toBe("oklch(0.6 0.1 200 / 0.8)");
    expect(ok("color", "color(display-p3 1 0 0)")).toBe("color(display-p3 1 0 0)");
    expect(ok("color", "color-mix(in oklab, var(--background) 80%, white)")).toBe(
      "color-mix(in oklab, var(--background) 80%, white)",
    );
    expect(ok("color", "color-mix(in oklch longer hue, red, blue)")).toBe(
      "color-mix(in oklch longer hue, red, blue)",
    );
    expect(ok("color", "light-dark(#fff, #000)")).toBe("light-dark(#fff, #000)");
    expect(ok("color", "rgb(from var(--background) r g b / 50%)")).toBe(
      "rgb(from var(--background) r g b / 50%)",
    );
    expect(ok("color", "var(--foreground, #123)")).toBe("var(--foreground, #123)");
  });

  it("rejects malformed colours, foreign var() and deep color-mix()", () => {
    bad("color", "#12345", /hex/);
    bad("color", "bluish", /not a colour/);
    bad("color", "rgb(1 2)", /channels/);
    bad("color", "rgb(1px 2 3)", /unit/);
    bad("color", "var(--color-red-500)", /not a token/);
    bad("color", "var(--x-other-ext-accent)", /not a token/);
    bad("color", "var(background)", /--name/);
    bad("color", "color(nonsense 1 0 0)", /colour space/);
    bad("color", "red blue", /one colour/);
    bad("color", "color-mix(in srgb, red 150%, blue)", /outside/);
    const mix = (inner: string) => `color-mix(in srgb, ${inner}, white)`;
    expect(check("color", mix(mix(mix("red")))).ok).toBe(true);
    bad("color", mix(mix(mix(mix("red")))), /nested too deeply/);
    bad("color", "rgb(0 0 0", /unbalanced/);
    bad("color", "calc(1 + 2)", /not a colour function/);
  });

  it("takes lengths in px, rem, em and %, and calc() of them", () => {
    expect(ok("length", "0")).toBe("0");
    expect(ok("length", "6px")).toBe("6px");
    expect(ok("length", "0.5rem")).toBe("0.5rem");
    expect(ok("length", "calc(var(--ui-radius-base) * 0.5)")).toBe(
      "calc(var(--ui-radius-base) * 0.5)",
    );
    expect(ok("length", "calc(var(--spacing) * 2 + 1px)")).toBe("calc(var(--spacing) * 2 + 1px)");
    expect(ok("length", "max(4px, 1em)")).toBe("max(4px, 1em)");
    expect(ok("length", "calc(var(--ui-radius-base) * infinity)")).toBe(
      "calc(var(--ui-radius-base) * infinity)",
    );
    bad("length", "12", /unit/);
    bad("length", "10vw", /unit/);
    bad("length", "calc(1px +)", /operator/);
    bad("length", "calc(1px 2px)", /operator/);
    bad("length", "small", /number/);
  });

  it("checks numbers against their range", () => {
    expect(ok("number", "0.5", TOKEN_CONSTRAINTS["ui-elevation"])).toBe("0.5");
    bad("number", "1.5", /outside 0\.\.1/, TOKEN_CONSTRAINTS["ui-elevation"]);
    bad("number", "-1", /outside/, TOKEN_CONSTRAINTS["ui-elevation"]);
    bad("number", "50%", /unit/, TOKEN_CONSTRAINTS["ui-elevation"]);
    expect(ok("number", "600", TOKEN_CONSTRAINTS["ui-weight-strong"])).toBe("600");
    bad("number", "1200", /outside/, TOKEN_CONSTRAINTS["ui-weight-strong"]);
    bad("number", "1", /internal/, TOKEN_CONSTRAINTS["omnigent-elevation"]);
  });

  it("takes alphas, percentages, channels, durations and easings", () => {
    expect(ok("alpha", "0.2")).toBe("0.2");
    expect(ok("alpha", "40%")).toBe("40%");
    bad("alpha", "1.2", /outside/);
    bad("alpha", "140%", /outside/);
    expect(ok("percentage", "12%")).toBe("12%");
    bad("percentage", "12", /percentage/);
    expect(ok("channels", "60 40 10")).toBe("60 40 10");
    bad("channels", "300 0 0", /outside/);
    bad("channels", "1 2", /three/);
    expect(ok("duration", "150ms")).toBe("150ms");
    expect(ok("duration", "0.2s")).toBe("0.2s");
    bad("duration", "20s", /outside/);
    bad("duration", "150", /ms or s/);
    expect(ok("easing", "ease-in-out")).toBe("ease-in-out");
    expect(ok("easing", "cubic-bezier(0.2, 0, 0, 1.4)")).toBe("cubic-bezier(0.2, 0, 0, 1.4)");
    expect(ok("easing", "steps(4, jump-end)")).toBe("steps(4, jump-end)");
    bad("easing", "cubic-bezier(1.2, 0, 0, 1)", /outside/);
    bad("easing", "bouncy", /not an easing/);
  });

  it("takes only the keywords a token allows", () => {
    expect(ok("keyword", "uppercase", TOKEN_CONSTRAINTS["ui-label-transform"])).toBe("uppercase");
    bad("keyword", "shout", /one of/, TOKEN_CONSTRAINTS["ui-label-transform"]);
    expect(ok("keyword", "dashed", TOKEN_CONSTRAINTS["ui-border-style"])).toBe("dashed");
    expect(ok("keyword", "github-dark", TOKEN_CONSTRAINTS["syntax-theme-dark"])).toBe(
      "github-dark",
    );
    bad("keyword", "nonexistent", /no syntax theme/, TOKEN_CONSTRAINTS["syntax-theme-dark"]);
    bad("keyword", "two words", /one keyword/);
  });

  it("takes generic, host and the extension's own font families, quoting names", () => {
    expect(ok("font", "Geist, ui-sans-serif, system-ui")).toBe(
      '"x-acme-theme-geist", ui-sans-serif, system-ui',
    );
    expect(ok("font", "'Geist Mono Variable', monospace")).toBe('"Geist Mono Variable", monospace');
    expect(ok("font", "JetBrains Mono, var(--ui-font-mono)")).toBe(
      '"JetBrains Mono", var(--ui-font-mono)',
    );
    bad("font", "Comic Sans MS, sans-serif", /neither/);
    bad("font", '"Evil\\"Font"');
    bad("font", "var(--background)", /ui-font/);
    bad("font", "Geist,", /empty/);
  });

  it("takes shadow lists and images without url()", () => {
    expect(ok("shadow", "none")).toBe("none");
    expect(ok("shadow", "0 1px 2px rgb(0 0 0 / 0.1), inset 0 0 0 1px var(--foreground)")).toBe(
      "0 1px 2px rgb(0 0 0 / 0.1), inset 0 0 0 1px var(--foreground)",
    );
    bad("shadow", "0 1px red blue", /one colour/);
    bad("shadow", "1px red", /two lengths/);
    expect(ok("image", "linear-gradient(135deg, #fff 0%, transparent 60%)")).toBe(
      "linear-gradient(135deg, #fff 0%, transparent 60%)",
    );
    expect(ok("image", "radial-gradient(circle at top left, red, blue)")).toBe(
      "radial-gradient(circle at top left, red, blue)",
    );
    bad("image", "url(x.png)");
    bad("image", "element(#x)");
  });

  it("reports the tokens a value reads", () => {
    const result = check("color", "color-mix(in srgb, var(--background) 50%, var(--foreground))");
    expect(result).toMatchObject({ ok: true, references: ["background", "foreground"] });
  });
});

describe("referenceCycles", () => {
  it("finds every token on a cycle, self-references included", () => {
    const graph = new Map<string, string[]>([
      ["a", ["b"]],
      ["b", ["a"]],
      ["v", ["y", "x"]],
      ["x", ["y"]],
      ["y", ["v"]],
      ["self", ["self"]],
      ["reader", ["a"]],
      ["plain", []],
    ]);
    expect([...referenceCycles(graph)].sort()).toEqual(["a", "b", "self", "v", "x", "y"]);
  });
});
