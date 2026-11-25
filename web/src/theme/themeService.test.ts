import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBrandOverride } from "@/lib/branding";
import { setEmbedRoot, setEmbedScopeRoot } from "@/lib/host";
import { isRegisteredSyntaxTheme } from "@/lib/syntaxTheme";
import { FIXTURE_CONTRIBUTES, FIXTURE_EXTENSION_ID, fixtureFiles } from "@/test/themeFixtures";

import { parseThemeContributions } from "./themeContributions";
import {
  checkCache,
  COLOR_CUSTOMIZATIONS_STORAGE_KEY,
  THEME_CACHE_STORAGE_KEY,
  THEME_OPTIONS_STORAGE_KEY,
  ThemeService,
  type ThemeExtension,
} from "./themeService";
import { getToken } from "./tokens/registry";

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
const LIGHT = `${FIXTURE_EXTENSION_ID}/full-light`;
const INVALID = `${FIXTURE_EXTENSION_ID}/invalid`;
const STOCK = `${FIXTURE_EXTENSION_ID}/vscode-dark`;

const style = () => document.getElementById("omnigent-theme-runtime")?.textContent ?? "";
/** The declarations of the runtime block for a mode ("light", "dark" or a probe). */
function block(mode: "light" | "dark" | "probe-light" | "probe-dark"): Record<string, string> {
  const marker = {
    light: "):not(.dark) {",
    dark: ").dark {",
    "probe-light": '[data-token-mode="light"] {',
    "probe-dark": '[data-token-mode="dark"] {',
  }[mode];
  const values: Record<string, string> = {};
  for (const rule of style().split("\n}\n")) {
    if (!rule.includes(marker)) continue;
    for (const [, id, value] of rule.matchAll(/--([\w-]+): ([^;]+);/g)) values[id!] = value!;
  }
  return values;
}

let service: ThemeService;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  service = new ThemeService();
});

afterEach(() => {
  service.select(null);
  document.getElementById("omnigent-theme-runtime")?.remove();
  document.documentElement.removeAttribute("data-omni-theme");
  document.documentElement.removeAttribute("data-theme");
  setEmbedScopeRoot(null);
  setEmbedRoot(null);
  warn.mockRestore();
});

describe("ThemeService", () => {
  it("lists the contributed themes and writes only the extension's colours by default", () => {
    service.addExtension(FIXTURE);
    service.markStarted();
    expect(
      service.list().map((theme) => [theme.id, theme.uiTheme, theme.family, theme.available]),
    ).toEqual([
      [DARK, "dark", "fixture", true],
      [LIGHT, "light", "fixture", true],
      [INVALID, "dark", undefined, true],
      [STOCK, "dark", undefined, true],
    ]);
    expect(service.getActive()).toBeNull();
    expect(block("light")).toEqual({ "x-acme-fixture-themes-glow": "#ffcc00" });
    expect(block("dark")).toEqual({
      "x-acme-fixture-themes-glow": "color-mix(in srgb, var(--primary) 40%, transparent)",
    });
    expect(document.documentElement.getAttribute("data-omni-theme")).toBe("");
  });

  it("applies a family by mode, with its options, brand and syntax theme", () => {
    service.addExtension(FIXTURE);
    service.markStarted();
    service.select(DARK);
    const active = service.getActive()!;
    expect(active).toMatchObject({
      id: DARK,
      family: "fixture",
      forcedMode: undefined,
      available: true,
    });
    expect(active.options.map((option) => [option.id, option.value])).toEqual([
      ["accent", "orange"],
      ["corners", "square"],
    ]);
    expect(active.variants).toEqual({ density: "compact", label: "mono-upper" });
    expect(service.getForcedMode()).toBeNull();
    expect(document.documentElement.getAttribute("data-omni-theme")).toBe(DARK);
    expect(localStorage.getItem("omnigent:ui-theme-palette")).toBe(JSON.stringify(DARK));
    const dark = block("dark");
    expect(dark).toMatchObject({
      background: "#0d1117",
      "code-bg": "#101820",
      primary: "#ff6a00",
      "ui-radius-base": "0",
      "ui-font-ui": '"x-acme-fixture-themes-fixture-sans", ui-sans-serif, sans-serif',
      "x-acme-fixture-themes-glow": "#ff00aa",
      "terminal-background": "#0a0e14",
    });
    expect(dark["syntax-theme-dark"]).toMatch(/^x-[0-9a-f]{8}-full-dark$/);
    expect(isRegisteredSyntaxTheme(dark["syntax-theme-dark"]!)).toBe(true);
    expect(block("light")).toMatchObject({ background: "#ffffff", primary: "#d35400" });
    // The per-mode terminal tokens again on the dark probe.
    expect(block("probe-dark")).toEqual({
      "terminal-background": "#0a0e14",
      "terminal-foreground": "#b3b1ad",
      "terminal-ansi-red": "#ff3333",
      "terminal-ansi-bright-green": "#c2d94c",
    });
    // Themes set tokens only, never Tailwind's colours.
    expect(style()).not.toMatch(/--color-/);
    const { result } = renderHook(() => useBrandOverride());
    expect(result.current).toEqual({
      appName: "Fixture Studio",
      logos: {
        main: "/__omnigent/extension-assets/acme.fixture-themes/0/brand/logo.svg",
        loading: "/__omnigent/extension-assets/acme.fixture-themes/0/brand/logo.svg",
        favicon: "/__omnigent/extension-assets/acme.fixture-themes/0/brand/logo.svg",
      },
    });
  });

  it("switches options and stores them per family", () => {
    service.addExtension(FIXTURE);
    service.markStarted();
    service.select(DARK);
    service.setOption("accent", "lava");
    service.setOption("corners", "soft");
    expect(block("dark")).toMatchObject({ primary: "#e5322d", "ui-radius-base": "6px" });
    expect(block("light")).toMatchObject({ primary: "#c0392b" });
    expect(JSON.parse(localStorage.getItem(THEME_OPTIONS_STORAGE_KEY)!)).toEqual({
      "acme.fixture-themes/fixture": { accent: "lava", corners: "soft" },
    });
    service.select(LIGHT);
    expect(service.getActive()?.options[0]?.value).toBe("lava");
    service.setOption("accent", null);
    expect(block("light")).toMatchObject({ primary: "#d35400" });
    expect(() => service.setOption("accent", "neon")).toThrow(/no choice/);
  });

  it("forces the mode of a single-mode theme and imports a VS Code theme through the aliases", () => {
    service.addExtension(FIXTURE);
    service.markStarted();
    service.select(STOCK);
    expect(service.getForcedMode()).toBe("dark");
    expect(block("dark")).toMatchObject({
      background: "#1f1f1f",
      primary: "#0078d4",
      sidebar: "#181818",
    });
    expect(block("light")).toEqual({ "x-acme-fixture-themes-glow": "#ffcc00" });
    // The terminal keeps the theme in its other mode too.
    expect(block("probe-light")).toEqual(block("probe-dark"));
  });

  it("leaves the invalid theme's bad values and its reference cycle out, with warnings", () => {
    service.addExtension(FIXTURE);
    service.markStarted();
    service.select(INVALID);
    expect(block("dark")).toEqual({
      "x-acme-fixture-themes-glow": "color-mix(in srgb, var(--primary) 40%, transparent)",
      sidebar: "#123456",
      "sidebar-background": "#123456",
    });
    expect(style()).not.toMatch(/url\(|expression|@import|Comic/);
    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(messages).toMatch(/invalid: \d+ problem/);
    expect(messages).toMatch(/--card is on a reference cycle/);
    expect(messages).toMatch(/--popover is on a reference cycle/);
  });

  it("paints the cached theme first, then falls back to the default when its extension is missing", () => {
    service.addExtension(FIXTURE);
    service.markStarted();
    service.select(DARK);
    const live = { light: block("light"), dark: block("dark") };
    expect(localStorage.getItem(THEME_CACHE_STORAGE_KEY)).toContain(`"id":"${DARK}"`);
    document.getElementById("omnigent-theme-runtime")?.remove();

    // A reload: the extension isn't registered yet.
    const reloaded = new ThemeService();
    const loading = reloaded.beginLoading();
    reloaded.applyCached();
    expect(reloaded.getActive()).toMatchObject({ id: DARK, fromCache: true });
    // The cache holds the theme's values; the extension's colour defaults come with it.
    const { "x-acme-fixture-themes-glow": _default, ...cachedLight } = live.light;
    const cachedDark = live.dark;
    expect(block("light")).toEqual(cachedLight);
    expect(block("dark")).toEqual(cachedDark);
    reloaded.markStarted();
    // Still loading: the cached values stay.
    expect(block("dark")).toEqual(cachedDark);
    loading();
    // Settled without the extension: the default, the choice kept, shown as unavailable.
    expect(style()).toBe("");
    expect(reloaded.getActive()).toMatchObject({
      id: DARK,
      available: false,
      label: "Fixture Dark",
    });
    expect(reloaded.list()).toEqual([expect.objectContaining({ id: DARK, available: false })]);
    expect(localStorage.getItem("omnigent:ui-theme-palette")).toBe(JSON.stringify(DARK));
    expect(isRegisteredSyntaxTheme(live.dark["syntax-theme-dark"]!)).toBe(false);
    // The extension comes back: the theme applies again.
    reloaded.addExtension(FIXTURE);
    expect(block("dark")).toEqual(live.dark);
    expect(reloaded.getActive()).toMatchObject({ available: true, fromCache: false });
  });

  it("checks the cache again before using it", () => {
    const tampered = {
      version: 1,
      id: DARK,
      key: "k",
      label: "x",
      uiTheme: "dark",
      blocks: {
        dark: {
          background: "url(https://example.com/x)",
          foreground: "#fff",
          "color-red-500": "#000",
        },
        probes: {},
      },
      fonts: [{ family: "x-a", url: "https://example.com/font.woff2" }],
      brand: { appName: "x", logos: { main: "https://example.com/logo.svg", favicon: "/ok.svg" } },
      syntax: [{ name: "bad name!", type: "dark", tokenColors: [] }],
    };
    expect(checkCache(tampered)).toMatchObject({
      blocks: { dark: { foreground: "#fff" } },
      fonts: [],
      brand: { appName: "x", logos: { favicon: "/ok.svg" } },
      syntax: [],
    });
    expect(Object.keys(checkCache(tampered)!.blocks.dark!)).toEqual(["foreground"]);
    expect(checkCache({ ...tampered, id: "not an id" })).toBeUndefined();
    expect(checkCache({ ...tampered, version: 2 })).toBeUndefined();
  });

  it("applies colour customizations over the theme, globally and per theme", () => {
    localStorage.setItem(
      COLOR_CUSTOMIZATIONS_STORAGE_KEY,
      JSON.stringify({
        background: "#222222",
        foreground: "url(x)",
        [`[${DARK}]`]: { "ui-radius-base": "12px" },
        [`[${LIGHT}]`]: { "ui-radius-base": "2px" },
      }),
    );
    service.addExtension(FIXTURE);
    service.markStarted();
    service.select(DARK);
    expect(block("dark")).toMatchObject({ background: "#222222", "ui-radius-base": "12px" });
    expect(block("dark").foreground).toBe("#e6e1cf");
    expect(block("light")).toMatchObject({ background: "#222222", "ui-radius-base": "12px" });
  });

  it("scopes the stylesheet to the embed and stamps both of its theme roots", () => {
    const scope = document.createElement("div");
    scope.className = "omnigent-app";
    const inner = document.createElement("div");
    scope.append(inner);
    document.body.append(scope);
    setEmbedScopeRoot(scope);
    setEmbedRoot(inner);
    service.addExtension(FIXTURE);
    service.markStarted();
    service.select(DARK);
    expect(scope.getAttribute("data-omni-theme")).toBe(DARK);
    expect(inner.getAttribute("data-omni-theme")).toBe(DARK);
    expect(document.documentElement.hasAttribute("data-omni-theme")).toBe(false);
    for (const rule of style().split("\n}\n").filter(Boolean)) {
      expect(rule.trim().startsWith(".omnigent-app"), rule).toBe(true);
    }
    scope.remove();
  });

  it("falls back when the extension is removed, and takes built-in palettes and null", () => {
    const remove = service.addExtension(FIXTURE);
    service.markStarted();
    service.select(DARK);
    remove();
    expect(service.getActive()).toMatchObject({ id: DARK, available: false });
    expect(style()).toBe("");
    expect(document.documentElement.hasAttribute("data-omni-theme")).toBe(false);
    const { result } = renderHook(() => useBrandOverride());
    expect(result.current).toBeNull();
    act(() => service.select("nord"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("nord");
    expect(service.getActive()).toBeNull();
    service.select(null);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(() => service.select("../evil")).toThrow(/no theme/);
  });

  it("tells listeners after each change", () => {
    const listener = vi.fn();
    service.onDidChange(listener);
    service.addExtension(FIXTURE);
    service.markStarted();
    service.select(DARK);
    expect(listener).toHaveBeenCalled();
  });
});
