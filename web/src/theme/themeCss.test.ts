// The runtime theme stylesheet beats every generated token block in every mode and
// palette, standalone and in the embed's scoped stylesheet, by specificity alone.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

import { scopeCss } from "../../vite.embed.config";
import { buildThemeCss, escapeIdent, themeSelectors } from "./themeCss";

type Specificity = [number, number, number];

/** Selectors Level 4 specificity, for the selector shapes the token blocks use. */
function specificity(selector: string): Specificity {
  const total: Specificity = [0, 0, 0];
  const add = (value: Specificity) => value.forEach((part, index) => (total[index] += part));
  let rest = selector.trim();
  while (rest) {
    let match: RegExpMatchArray | null;
    if ((match = rest.match(/^:(is|not|has)\(/))) {
      // The argument list's most specific selector counts.
      let depth = 1;
      let index = match[0].length;
      while (depth > 0) {
        if (rest[index] === "(") depth += 1;
        if (rest[index] === ")") depth -= 1;
        index += 1;
      }
      const inner = rest.slice(match[0].length, index - 1);
      const parts = splitList(inner).map(specificity);
      add(parts.reduce((best, part) => (compare(part, best) > 0 ? part : best), [0, 0, 0]));
      rest = rest.slice(index);
    } else if (rest.startsWith(":where(")) {
      rest = rest.slice(rest.indexOf(")") + 1);
    } else if ((match = rest.match(/^#[\w-]+/))) {
      add([1, 0, 0]);
      rest = rest.slice(match[0].length);
    } else if ((match = rest.match(/^(\.[\w-]+|\[[^\]]+\]|:[\w-]+)/))) {
      add([0, 1, 0]);
      rest = rest.slice(match[0].length);
    } else if ((match = rest.match(/^[a-z][\w-]*/i))) {
      add([0, 0, 1]);
      rest = rest.slice(match[0].length);
    } else {
      rest = rest.slice(1);
    }
  }
  return total;
}

function splitList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function compare(a: Specificity, b: Specificity): number {
  for (let index = 0; index < 3; index += 1)
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  return 0;
}

/** Every selector of a rule that declares a custom property. */
function tokenSelectors(css: string): string[] {
  const selectors: string[] = [];
  parse(css).walkRules((rule: Rule) => {
    if (rule.nodes.some((node) => node.type === "decl" && node.prop.startsWith("--"))) {
      selectors.push(...splitList(rule.selector));
    }
  });
  return selectors;
}

const GENERATED = readFileSync(resolve(__dirname, "../themeTokens.generated.css"), "utf8");

describe("the runtime theme stylesheet's selectors", () => {
  it("beat every generated token block standalone", () => {
    const selectors = themeSelectors(null);
    const ours = [
      ...splitList(selectors.light),
      ...splitList(selectors.dark),
      selectors.probe("light"),
      selectors.probe("dark"),
    ].map(specificity);
    const weakest = ours.reduce((low, value) => (compare(value, low) < 0 ? value : low));
    const generated = tokenSelectors(GENERATED);
    expect(generated.length).toBeGreaterThan(20);
    for (const selector of generated) {
      expect(compare(weakest, specificity(selector)), selector).toBeGreaterThan(0);
    }
    // The strongest generated blocks, for the record: palette-stamped light roots.
    expect(specificity(':root:not(.dark)[data-theme="nord"]')).toEqual([0, 3, 0]);
    expect(weakest).toEqual([1, 2, 0]);
  });

  it("beat every generated token block in the embed's scoped stylesheet", () => {
    const selectors = themeSelectors(".omnigent-app");
    const ours = [
      ...splitList(selectors.light),
      ...splitList(selectors.dark),
      selectors.probe("dark"),
    ];
    for (const selector of ours) expect(selector.startsWith(".omnigent-app")).toBe(true);
    const weakest = ours
      .map(specificity)
      .reduce((low, value) => (compare(value, low) < 0 ? value : low));
    for (const selector of tokenSelectors(scopeCss(GENERATED))) {
      expect(compare(weakest, specificity(selector)), selector).toBeGreaterThan(0);
    }
  });

  it("match only the theme roots and their probes", () => {
    document.body.innerHTML =
      '<div id="host" class="dark"><div class="omnigent-app" data-omnigent-scope="n" data-omni-theme="t"><div class="dark" data-omnigent-inner data-omni-theme="t"><div data-token-mode="light"></div></div></div><div class="omnigent-app" data-omnigent-scope="guess" data-omni-theme="t"><div class="dark" data-omnigent-inner data-omni-theme="t"></div></div></div>';
    const embed = themeSelectors('.omnigent-app[data-omnigent-scope="n"]');
    const matches = (selector: string) =>
      [...document.querySelectorAll(selector)].map(
        (element) => element.className || element.getAttribute("data-token-mode"),
      );
    expect(matches(embed.light)).toEqual(["omnigent-app"]);
    expect(matches(embed.dark)).toEqual(["dark"]);
    expect(matches(embed.probe("light"))).toEqual(["light"]);
    const standalone = themeSelectors(null);
    document.documentElement.setAttribute("data-omni-theme", "t");
    expect(document.documentElement.matches(standalone.light)).toBe(true);
    document.documentElement.classList.add("dark");
    expect(document.documentElement.matches(standalone.dark)).toBe(true);
    document.documentElement.removeAttribute("data-omni-theme");
    expect(document.documentElement.matches(standalone.dark)).toBe(false);
    document.documentElement.classList.remove("dark");
  });
});

describe("buildThemeCss", () => {
  it("writes the layers in order, per mode and probe, and nothing for empty blocks", () => {
    const css = buildThemeCss(
      [
        { light: { "x-a-b-glow": "#fff" }, dark: {} },
        {
          dark: { background: "#000", "terminal-background": "#111" },
          probes: { light: { "terminal-background": "#111" } },
        },
      ],
      themeSelectors(null),
    );
    expect(css).toBe(
      [
        ":root:is([data-omni-theme], #omnigent-theme-runtime-root):not(.dark) {\n  --x-a-b-glow: #fff;\n}\n",
        ":root:is([data-omni-theme], #omnigent-theme-runtime-root).dark {\n  --background: #000;\n  --terminal-background: #111;\n}\n",
        ':root:is([data-omni-theme], #omnigent-theme-runtime-root) [data-token-mode="light"] {\n  --terminal-background: #111;\n}\n',
      ].join("\n"),
    );
    expect(buildThemeCss([{}], themeSelectors(null))).toBe("");
    expect(escapeIdent("a;b}")).toBe("a\\3b b\\7d ");
  });
});
