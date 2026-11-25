import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "postcss";
import { describe, expect, it } from "vitest";

import { PALETTES, themePalettes } from "@/lib/themePalette";

import legacy from "./legacyIndexCss.fixture.json";
import {
  DEFAULT_TOKENS,
  PALETTE_TOKEN_CSS_NAMES,
  PALETTE_TOKENS,
  TOKENS,
  getToken,
  isDerivedValue,
} from "./registry";

const WEB_ROOT = resolve(__dirname, "../../..");

/** Collapses whitespace, as a CSS custom property value reads whatever its formatting. */
function normalize(value: string | undefined): string | undefined {
  return value?.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
}

/** Custom properties of a stylesheet's first top-level `:root` and `.dark` rules. */
function rootBlocks(css: string): Record<":root" | ".dark", Record<string, string>> {
  const blocks = { ":root": {}, ".dark": {} } as Record<":root" | ".dark", Record<string, string>>;
  const seen = new Set<string>();
  parse(css).each((node) => {
    if (node.type !== "rule" || !(node.selector in blocks) || seen.has(node.selector)) return;
    seen.add(node.selector);
    node.each((declaration) => {
      if (declaration.type === "decl" && declaration.prop.startsWith("--")) {
        blocks[node.selector as ":root" | ".dark"][declaration.prop.slice(2)] = declaration.value;
      }
    });
  });
  return blocks;
}

// Tokens still hand-written in index.css: non-colour groups the registry takes over later.
const STILL_IN_INDEX_CSS = {
  ":root": [
    "desktop-ui-font-size",
    "icon-size-default",
    "icon-container-default",
    "omnigent-header-height",
    "omnigent-safe-top",
    "omnigent-safe-bottom",
    "omnigent-safe-left",
    "omnigent-safe-right",
    "omnigent-native-top-bar",
    "omnigent-native-bottom-bar",
    "omnigent-top-bar-visible",
    "omnigent-bottom-bar-visible",
    "omnigent-android-switcher-margin",
    "omnigent-android-switcher-height",
    "omnigent-inset-top",
    "omnigent-inset-bottom",
    "ease-otto",
    "duration-otto-fast",
  ],
  ".dark": ["menu-surface-backdrop-filter"],
};

// Legacy tokens the registry now derives from the shape and elevation scales. The
// browser token dump (my-extensions verify harness) checks they compute to the same
// values; `composer-shadow`'s dark value comes from its dark alpha.
const RESTATED = {
  ":root": ["radius", "radius-otto-button", "radius-otto-sm", "radius-otto-md", "composer-shadow"],
  ".dark": ["composer-shadow"],
};

/** The declarations of the generated stylesheet's rule with exactly this selector. */
function generatedRule(selector: string): Record<string, string> {
  const css = readFileSync(resolve(WEB_ROOT, "src/themeTokens.generated.css"), "utf8");
  const found: Record<string, string> = {};
  parse(css).each((node) => {
    if (node.type !== "rule" || node.selector.replace(/\s+/g, " ") !== selector) return;
    node.each((declaration) => {
      if (declaration.type === "decl") found[declaration.prop.slice(2)] = declaration.value;
    });
  });
  return found;
}

describe("theme token registry", () => {
  it("has unique ids", () => {
    const ids = TOKENS.map((token) => token.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every token either a palette key or defaults", () => {
    for (const token of TOKENS) {
      expect(Boolean(token.palette) !== Boolean(token.default), token.id).toBe(true);
      expect(token.description, token.id).not.toBe("");
      expect(getToken(token.id)).toBe(token);
    }
  });

  it("sets every palette token in every palette and mode", () => {
    expect(PALETTES.map((palette) => palette.id)).toEqual([...themePalettes]);
    for (const palette of PALETTES) {
      for (const mode of ["light", "dark"] as const) {
        const values = palette.tokens[mode] as Record<string, string>;
        expect(Object.keys(values).sort(), `${palette.id} ${mode}`).toEqual(
          PALETTE_TOKENS.map((token) => token.palette).sort(),
        );
        for (const token of PALETTE_TOKENS) {
          expect(values[token.palette], `${palette.id} ${mode} ${token.id}`).toMatch(/\S/);
        }
      }
    }
  });

  it("maps palette keys onto their CSS names", () => {
    expect(Object.entries(PALETTE_TOKEN_CSS_NAMES)).toEqual(
      PALETTE_TOKENS.map((token) => [token.palette, token.id]),
    );
  });

  it("keeps the defaults index.css had before the registry", () => {
    for (const selector of [":root", ".dark"] as const) {
      const mode = selector === ":root" ? "light" : "dark";
      const legacyIds = new Set([...Object.keys(legacy[":root"]), ...Object.keys(legacy[".dark"])]);
      const moved = DEFAULT_TOKENS.filter(
        (token) =>
          token.default?.[mode] !== undefined &&
          legacyIds.has(token.id) &&
          !RESTATED[selector].includes(token.id),
      );
      const expected = Object.fromEntries(
        Object.entries(legacy[selector]).filter(
          ([id]) => !STILL_IN_INDEX_CSS[selector].includes(id) && !RESTATED[selector].includes(id),
        ),
      );
      expect(
        Object.fromEntries(moved.map((token) => [token.id, normalize(token.default?.[mode])])),
        selector,
      ).toEqual(Object.fromEntries(Object.entries(expected).map(([id, v]) => [id, normalize(v)])));
    }
  });

  it("leaves no registered token hand-written in index.css", () => {
    const blocks = rootBlocks(readFileSync(resolve(WEB_ROOT, "src/index.css"), "utf8"));
    for (const selector of [":root", ".dark"] as const) {
      expect(Object.keys(blocks[selector]).sort(), selector).toEqual(
        [...STILL_IN_INDEX_CSS[selector]].sort(),
      );
    }
  });

  it("derives the restated legacy tokens from the scales", () => {
    for (const id of RESTATED[":root"]) {
      expect(isDerivedValue(getToken(id)?.default?.light ?? ""), id).toBe(true);
    }
  });

  it("adds only shape, typography and elevation tokens beside the legacy ones", () => {
    const legacyIds = new Set([...Object.keys(legacy[":root"]), ...Object.keys(legacy[".dark"])]);
    const added = DEFAULT_TOKENS.filter((token) => !legacyIds.has(token.id));
    expect(new Set(added.map((token) => token.group))).toEqual(
      new Set(["shape", "typography", "elevation"]),
    );
    expect(
      added.every((token) => token.id.startsWith("ui-")),
      "added ids",
    ).toBe(true);
  });

  it("registers every token with a syntax as an inherited property", () => {
    const css = readFileSync(resolve(WEB_ROOT, "src/themeTokens.generated.css"), "utf8");
    const registered = new Map<string, string>();
    parse(css).walkAtRules("property", (rule) => {
      rule.walkDecls("syntax", (declaration) => {
        registered.set(rule.params.slice(2), declaration.value.replace(/"/g, ""));
      });
    });
    const expected = DEFAULT_TOKENS.filter((token) => token.syntax);
    expect(expected.map((token) => token.id)).toEqual(
      expect.arrayContaining(["ui-radius-sm", "ui-elevation", "ui-shadow-xs-alpha"]),
    );
    expect(Object.fromEntries(registered)).toEqual(
      Object.fromEntries(expected.map((token) => [token.id, token.syntax])),
    );
  });

  it("re-emits derived tokens on the theme roots, light formulas included on dark ones", () => {
    const dark = generatedRule(":root.dark, :root > .dark");
    const light = generatedRule(":root:not(.dark)[data-theme], :root > :not(.dark)[data-theme]");
    // A light-only derived token: a dark inner root must resolve it against its own values.
    expect(getToken("ui-radius-sm")?.default?.dark).toBeUndefined();
    expect(normalize(dark["ui-radius-sm"])).toBe("calc(var(--ui-radius-base) * 0.5)");
    expect(normalize(light["ui-radius-sm"])).toBe("calc(var(--ui-radius-base) * 0.5)");
    // A token with its own dark formula gets that one on dark roots.
    expect(normalize(dark["composer-header-bg"])).toBe(
      normalize(getToken("composer-header-bg")?.default?.dark),
    );
    // Literal defaults are not re-emitted.
    expect(dark["ui-radius-base"]).toBeUndefined();
    expect(dark["destructive"]).toBeUndefined();
  });

  it("marks values that reference other tokens as derived", () => {
    expect(isDerivedValue("var(--background)")).toBe(true);
    expect(isDerivedValue("color-mix(in srgb, var( --card) 95%, white)")).toBe(true);
    expect(isDerivedValue("#fff")).toBe(false);
  });

  it("has the generated stylesheet up to date", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ["--experimental-strip-types", "scripts/generate-theme-tokens.mjs", "--check"],
        { cwd: WEB_ROOT, stdio: "pipe" },
      ),
    ).not.toThrow();
  });
});
