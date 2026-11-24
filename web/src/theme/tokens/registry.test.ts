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
    "ui-shadow-neutral-rgb",
    "ui-shadow-warm-rgb",
    "onboarding-modal-shadow",
    "composer-shadow",
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
    "radius",
    "radius-otto-button",
    "radius-otto-sm",
    "radius-otto-md",
    "ease-otto",
    "duration-otto-fast",
  ],
  ".dark": [
    "menu-surface-backdrop-filter",
    "ui-shadow-neutral-rgb",
    "ui-shadow-warm-rgb",
    "onboarding-modal-shadow",
    "composer-shadow",
  ],
};

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
      const moved = DEFAULT_TOKENS.filter((token) => token.default?.[mode] !== undefined);
      const expected = Object.fromEntries(
        Object.entries(legacy[selector]).filter(
          ([id]) => !STILL_IN_INDEX_CSS[selector].includes(id),
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
