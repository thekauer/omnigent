// The style variants (theming plan M9): resolved from the theme and the user, written as
// `data-omni-<name>` on the theme roots, their tokens layered between the theme's options
// and the colour customizations, and nothing at all at the defaults.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerBuiltInThemes } from "@/builtinExtensions/builtInThemes";
import { setEmbedRoot, setEmbedScopeRoot } from "@/lib/host";
import { FIXTURE_CONTRIBUTES, FIXTURE_EXTENSION_ID, fixtureFiles } from "@/test/themeFixtures";

import { parseThemeContributions } from "./themeContributions";

import { THEME_CACHE_STORAGE_KEY, ThemeService, type ThemeExtension } from "./themeService";
import { getToken } from "./tokens/registry";
import {
  defaultVariant,
  resolveVariants,
  VARIANT_LABELS,
  VARIANT_NAMES,
  VARIANT_TOKENS,
  VARIANTS,
  variantAttribute,
  variantTokens,
} from "./variants";

const { contributions } = parseThemeContributions(FIXTURE_EXTENSION_ID, FIXTURE_CONTRIBUTES, {
  isKnownToken: (id) => getToken(id) !== undefined,
});
const FIXTURE: ThemeExtension = {
  id: FIXTURE_EXTENSION_ID,
  version: "1.0.0",
  contributions,
  files: fixtureFiles(),
};
const DARK = `${FIXTURE_EXTENSION_ID}/full-dark`;
const root = document.documentElement;
const style = () => document.getElementById("omnigent-theme-runtime")?.textContent ?? "";
/** The last value the runtime stylesheet's dark block gives `token`. */
function darkValue(token: string): string | undefined {
  const dark = style()
    .split("\n}\n")
    .filter((rule) => rule.includes(").dark {"))
    .join("\n");
  return [...dark.matchAll(new RegExp(`--${token}: ([^;]+);`, "g"))].at(-1)?.[1];
}
const omniAttributes = (element: Element) =>
  element
    .getAttributeNames()
    .filter((name) => name.startsWith("data-omni-") && name !== "data-omni-theme");

let service: ThemeService;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  service = new ThemeService();
  root.classList.add("dark");
});

afterEach(() => {
  service.select(null);
  document.getElementById("omnigent-theme-runtime")?.remove();
  for (const name of root.getAttributeNames()) {
    if (name.startsWith("data-omni-") || name === "data-theme") root.removeAttribute(name);
  }
  root.classList.remove("dark");
  setEmbedScopeRoot(null);
  setEmbedRoot(null);
  warn.mockRestore();
});

describe("variant definitions", () => {
  it("names every value, starts with today's look and maps to kebab-case attributes", () => {
    for (const name of VARIANT_NAMES) {
      expect(Object.keys(VARIANT_LABELS[name].values)).toEqual([...VARIANTS[name]]);
      expect(VARIANT_LABELS[name].description.length).toBeGreaterThan(0);
      expect(defaultVariant(name)).toBe(VARIANTS[name][0]);
      // A default value sets no tokens: the stock look needs none.
      expect(
        (VARIANT_TOKENS[name] as Record<string, unknown> | undefined)?.[defaultVariant(name)],
      ).toBeUndefined();
    }
    expect(variantAttribute("density")).toBe("data-omni-density");
    expect(variantAttribute("workingIndicator")).toBe("data-omni-working-indicator");
    expect(variantAttribute("panelTabs")).toBe("data-omni-panel-tabs");
  });

  it("sets only registry tokens, the theme's under the user's choice", () => {
    for (const values of Object.values(VARIANT_TOKENS)) {
      for (const tokens of Object.values(values ?? {})) {
        for (const id of Object.keys(tokens ?? {})) expect(getToken(id), id).toBeDefined();
      }
    }
    expect(resolveVariants({ density: "compact" }, { density: "comfortable" })).toEqual({
      density: "comfortable",
    });
    expect(variantTokens({ density: "compact" })["ui-row-height"]).toBe("24px");
    expect(variantTokens({})).toEqual({});
  });
});

describe("applying variants", () => {
  it("sets nothing for a built-in theme at the defaults, and applies a user choice", () => {
    registerBuiltInThemes(service);
    service.markStarted();
    expect(omniAttributes(root)).toEqual([]);
    expect(style()).toBe("");
    service.setVariant("density", "comfortable");
    service.setVariant("label", "bracketed");
    expect(root.getAttribute("data-omni-density")).toBe("comfortable");
    expect(root.getAttribute("data-omni-label")).toBe("bracketed");
    expect(darkValue("ui-row-height")).toBe("34px");
    expect(darkValue("ui-font-label")).toBe("var(--ui-font-mono)");
    // A value back at its default sets nothing again.
    service.setVariant("density", "regular");
    service.setVariant("label", null);
    expect(omniAttributes(root)).toEqual([]);
    expect(style()).toBe("");
  });

  it("applies the theme's variants, the user's over them, under the customizations", () => {
    service.addExtension(FIXTURE);
    service.markStarted();
    service.select(DARK);
    // The fixture declares density compact and mono uppercase labels.
    expect(root.getAttribute("data-omni-density")).toBe("compact");
    expect(root.getAttribute("data-omni-label")).toBe("mono-upper");
    // Above the theme's own 34px rows.
    expect(darkValue("ui-row-height")).toBe("24px");
    service.setVariant("density", "comfortable");
    expect(root.getAttribute("data-omni-density")).toBe("comfortable");
    expect(darkValue("ui-row-height")).toBe("34px");
    // "Regular" is the theme's own density: no variant tokens, the theme's rows.
    service.setVariant("density", "regular");
    expect(root.hasAttribute("data-omni-density")).toBe(false);
    expect(darkValue("ui-row-height")).toBe("34px");
    service.setVariant("density", null);
    service.setCustomizations(JSON.stringify({ "ui-row-height": "30px" }));
    expect(darkValue("ui-row-height")).toBe("30px");
  });

  it("follows a picker's preview, and writes the theme's variants into the cache", () => {
    registerBuiltInThemes(service);
    service.addExtension(FIXTURE);
    service.markStarted();
    service.preview(DARK);
    expect(root.getAttribute("data-omni-density")).toBe("compact");
    service.preview(undefined);
    expect(root.hasAttribute("data-omni-density")).toBe(false);
    service.select(DARK);
    const cache = JSON.parse(localStorage.getItem(THEME_CACHE_STORAGE_KEY)!);
    expect(cache.variants).toEqual({ density: "compact", label: "mono-upper" });
    // A reload before the extension loads stamps the cached variants at first paint.
    for (const name of omniAttributes(root)) root.removeAttribute(name);
    const reloaded = new ThemeService();
    reloaded.beginLoading();
    reloaded.applyCached();
    expect(root.getAttribute("data-omni-density")).toBe("compact");
    expect(reloaded.getActive()?.variants).toEqual({ density: "compact", label: "mono-upper" });
  });

  it("stamps both of the embed's theme roots", () => {
    const scope = document.createElement("div");
    const inner = document.createElement("div");
    scope.className = "omnigent-app";
    scope.appendChild(inner);
    document.body.appendChild(scope);
    setEmbedScopeRoot(scope);
    setEmbedRoot(inner);
    try {
      service.setVariant("sheet", "floating");
      expect(scope.getAttribute("data-omni-sheet")).toBe("floating");
      expect(inner.getAttribute("data-omni-sheet")).toBe("floating");
    } finally {
      service.setVariant("sheet", null);
      scope.remove();
    }
  });
});

describe("variants.css", () => {
  const variantsCss = readFileSync(resolve(__dirname, "variants.css"), "utf8");

  it("styles only under a variant attribute, or the classes only variant markup uses", () => {
    const selectors = [
      ...variantsCss
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/@[a-z-]+[^{]*\{/g, "{")
        .matchAll(/([^{};]+)\{/g),
    ]
      .map((match) => match[1]!.trim())
      .filter((selector) => !/^(from|to|\d|@)|^\d+%/.test(selector) && selector !== "");
    expect(selectors.length).toBeGreaterThan(40);
    for (const selector of selectors) {
      for (const part of selector.split(/,(?![^(]*\))/)) {
        const text = part.trim();
        if (/^(0%|50%|80%|100%|40%)$/.test(text) || text.startsWith("(")) continue;
        expect(
          /\[data-omni-[a-z-]+/.test(text) || /^\.ui-working-(pulse|dots|verb)\b/.test(text),
          text,
        ).toBe(true);
      }
    }
  });

  it("keeps the label brackets out of the accessibility tree", () => {
    expect(variantsCss).toContain('content: "[" / "";');
    expect(variantsCss).toContain('content: "]" / "";');
  });

  it("names its keyframes with Omnigent's prefix, since they are document-global", () => {
    const names = [...variantsCss.matchAll(/@keyframes ([\w-]+)/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^omnigent-/);
    for (const [, name] of variantsCss.matchAll(/animation: ([\w-]+) /g)) {
      expect(names).toContain(name);
    }
  });

  it("insets the floating sheet only from md up, and on all sides with the sidebar collapsed", () => {
    expect(variantsCss).toMatch(
      /@media \(width >= 73\.8125rem\) \{\s*\[data-omni-sheet="floating"\] \[data-slot="main-area"\] \{\s*margin: var\(--ui-sheet-gap-top\)/,
    );
    expect(variantsCss).toContain(
      '[data-omni-sheet="floating"] .app-shell:not([data-sidebar-open]) [data-slot="main-area"]',
    );
  });

  it("stills the working indicator's motion under reduced motion", () => {
    expect(variantsCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.ui-working-pulse,\s*\.ui-working-dots > span \{\s*animation: none;/,
    );
  });
});
