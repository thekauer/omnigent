import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBrandOverride } from "@/lib/branding";
import { setEmbedRoot, setEmbedScopeRoot } from "@/lib/host";
import { isRegisteredSyntaxTheme } from "@/lib/syntaxTheme";
import { FIXTURE_CONTRIBUTES, FIXTURE_EXTENSION_ID, fixtureFiles } from "@/test/themeFixtures";

import { registerBuiltInThemes } from "@/builtinExtensions/builtInThemes";

import { parseThemeContributions } from "./themeContributions";
import {
  checkCache,
  THEME_CACHE_STORAGE_KEY,
  ThemeService,
  type ThemeExtension,
} from "./themeService";
import { readStoredSettings, SETTINGS_STORAGE_KEY } from "@/configuration/settingsDocument";
import { LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY } from "@/theme/themeSettingKeys";
import { getToken } from "./tokens/registry";

function storedValues() {
  return readStoredSettings(localStorage.getItem(SETTINGS_STORAGE_KEY)).values;
}

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
    expect(block("light")).toEqual({ "x-acme__fixture_2dthemes-glow": "#ffcc00" });
    expect(block("dark")).toEqual({
      "x-acme__fixture_2dthemes-glow": "color-mix(in srgb, var(--primary) 40%, transparent)",
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
      "ui-font-ui": '"x-acme__fixture_2dthemes-fixture-sans", ui-sans-serif, sans-serif',
      "x-acme__fixture_2dthemes-glow": "#ff00aa",
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
    expect(storedValues()).toEqual({
      "omnigent.themeOptions": {
        "[acme.fixture-themes/fixture]": { accent: "lava", corners: "soft" },
      },
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
    expect(block("light")).toEqual({ "x-acme__fixture_2dthemes-glow": "#ffcc00" });
    // The terminal keeps the theme in its other mode too.
    expect(block("probe-light")).toEqual(block("probe-dark"));
  });

  it("leaves the invalid theme's bad values and its reference cycle out, with warnings", () => {
    service.addExtension(FIXTURE);
    service.markStarted();
    service.select(INVALID);
    expect(block("dark")).toEqual({
      "x-acme__fixture_2dthemes-glow": "color-mix(in srgb, var(--primary) 40%, transparent)",
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
    const { "x-acme__fixture_2dthemes-glow": _default, ...cachedLight } = live.light;
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
      brand: {
        appName: "x",
        logos: { main: "https://example.com/logo.svg", favicon: "/assets/ok.svg" },
      },
      syntax: [{ name: "bad name!", type: "dark", tokenColors: [] }],
    };
    expect(checkCache(tampered)).toMatchObject({
      blocks: { dark: { foreground: "#fff" } },
      fonts: [],
      brand: { appName: "x", logos: { favicon: "/assets/ok.svg" } },
      syntax: [],
    });
    expect(Object.keys(checkCache(tampered)!.blocks.dark!)).toEqual(["foreground"]);
    expect(checkCache({ ...tampered, id: "not an id" })).toBeUndefined();
    // Labels the picker and Settings show lose bidi and zero-width characters.
    expect(
      checkCache({ ...tampered, label: "Fix\u202eture\u200b", familyLabel: "Fam\u2066ily" }),
    ).toMatchObject({ label: "Fixture", familyLabel: "Family" });
    expect(checkCache({ ...tampered, version: 2 })).toBeUndefined();
  });

  it("applies colour customizations over the theme: global, the family's, the member's on screen", () => {
    localStorage.setItem(
      LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY,
      JSON.stringify({
        background: "#222222",
        foreground: "url(x)",
        [`[${DARK}]`]: { "ui-radius-base": "12px" },
        [`[${LIGHT}]`]: { "ui-radius-base": "2px" },
        [`[${FIXTURE_EXTENSION_ID}/fixture]`]: { "ui-radius-base": "6px", primary: "#010203" },
      }),
    );
    service.addExtension(FIXTURE);
    service.markStarted();
    service.select(DARK);
    // Each member's key holds in its own mode, over the family's key.
    expect(block("dark")).toMatchObject({
      background: "#222222",
      "ui-radius-base": "12px",
      primary: "#010203",
    });
    expect(block("dark").foreground).toBe("#e6e1cf");
    expect(block("light")).toMatchObject({
      background: "#222222",
      "ui-radius-base": "2px",
      primary: "#010203",
    });
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

describe("ThemeService: per-theme customization keys, product policy, applied theme (M7 follow-ups)", () => {
  it("keys a built-in palette by its palette id, its family and the member on screen", () => {
    registerBuiltInThemes(service);
    service.markStarted();
    localStorage.setItem(
      LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY,
      JSON.stringify({
        "[nord]": { background: "#000001" },
        "[omnigent.themes/nord]": { primary: "#000002" },
        "[omnigent.themes/nord-dark]": { background: "#000003" },
        "[omnigent.themes/nord-light]": { "ui-radius-base": "3px" },
      }),
    );
    service.select("nord");
    expect(block("dark")).toMatchObject({ background: "#000003", primary: "#000002" });
    expect(block("dark")["ui-radius-base"]).toBeUndefined();
    expect(block("light")).toMatchObject({
      background: "#000001",
      primary: "#000002",
      "ui-radius-base": "3px",
    });
    // The member id selects the same entry.
    service.select("omnigent.themes/nord-dark");
    expect(service.getChoice()).toBe("nord");
  });

  it("checks theme scopes: unknown ids are errors, a missing extension's a warning", () => {
    registerBuiltInThemes(service);
    service.addExtension(FIXTURE);
    service.markStarted();
    const problems = (value: Record<string, unknown>) =>
      service.checkCustomizations(JSON.stringify(value));
    expect(
      problems({
        "[nord]": {},
        "[omnigent.themes/nord-dark]": {},
        "[omnigent.themes/nord]": {},
        [`[${DARK}]`]: {},
        [`[${FIXTURE_EXTENSION_ID}/fixture]`]: {},
      }),
    ).toEqual([]);
    expect(problems({ "[nrod]": {} })).toEqual([{ key: "[nrod]", message: "no theme nrod" }]);
    expect(problems({ "[omnigent.themes/nrod-dark]": {} })[0]?.message).toMatch(/has no theme/);
    expect(problems({ [`[${FIXTURE_EXTENSION_ID}/nope]`]: {} })[0]?.severity).toBeUndefined();
    const missing = problems({ "[acme.gone/dark]": { background: "#000" } });
    expect(missing).toEqual([
      expect.objectContaining({ key: "[acme.gone/dark]", severity: "warning" }),
    ]);
    // A warning doesn't stop the store; an error does.
    expect(service.setCustomizations('{"[acme.gone/dark]": {}}')).toHaveLength(1);
    const stored = { "workbench.colorCustomizations": { "[acme.gone/dark]": {} } };
    expect(storedValues()).toEqual(stored);
    service.setCustomizations('{"[nrod]": {}}');
    expect(storedValues()).toEqual(stored);
    expect(service.checkCustomizations(" ".repeat(70_000))[0]?.message).toMatch(/longer than/);
  });

  it("enforces the product's allowed themes on select and preview", () => {
    registerBuiltInThemes(service);
    service.addExtension(FIXTURE);
    service.markStarted();
    service.setProductPolicy({ allowed: [DARK, "nord"] });
    expect(() => service.select("dracula")).toThrow(/not allowed/);
    expect(() => service.preview("dracula")).toThrow(/not allowed/);
    service.select("omnigent.themes/nord-light");
    expect(service.getChoice()).toBe("nord");
    // A family is allowed by any of its members.
    service.select(LIGHT);
    expect(service.getChoice()).toBe(LIGHT);
    // The default palette isn't allowed: "the default" is the first allowed theme.
    service.preview(null);
    expect(document.documentElement.getAttribute("data-theme")).toBe("nord");
    service.preview(undefined);
    service.select(null);
    expect(service.getChoice()).toBe("nord");
    service.setProductPolicy({ allowed: ["omni", "nord"] });
    service.select(null);
    expect(service.getChoice()).toBe("omni");
    service.setProductPolicy(null);
  });

  it("reports the theme that applies per mode, the default's for a missing extension", () => {
    registerBuiltInThemes(service);
    const remove = service.addExtension(FIXTURE);
    service.markStarted();
    expect(service.appliedTheme("dark").id).toBe("omnigent.themes/omni-dark");
    service.select(DARK);
    expect(service.appliedTheme("light")).toEqual({ id: LIGHT, label: expect.any(String) });
    expect(service.appliedTheme("dark").id).toBe(DARK);
    remove();
    expect(service.appliedTheme("dark").id).toBe("omnigent.themes/omni-dark");
  });
});

describe("ThemeService: extension fonts", () => {
  const ID = "acme.font-themes";
  const assets = `/__omnigent/extension-assets/${ID}/0`;
  const theme = (font?: string) => ({
    type: "dark",
    colors: { background: "#101010" },
    ...(font ? { omnigent: { tokens: { "ui-font-ui": `${font}, sans-serif` } } } : {}),
  });
  const extension = (): ThemeExtension => ({
    id: ID,
    version: "1.0.0",
    contributions: parseThemeContributions(
      ID,
      {
        themes: [
          { id: "one", label: "One", uiTheme: "dark", path: "./themes/one.json" },
          { id: "two", label: "Two", uiTheme: "dark", path: "./themes/two.json" },
          { id: "plain", label: "Plain", uiTheme: "dark", path: "./themes/plain.json" },
        ],
        fonts: [
          { family: "One Sans", src: "./fonts/one.woff2" },
          { family: "Two Sans", src: "./fonts/two.woff2" },
        ],
      },
      { isKnownToken: (id) => getToken(id) !== undefined },
    ).contributions,
    files: {
      "themes/one.json": { kind: "json", data: theme("One Sans") },
      "themes/two.json": { kind: "json", data: theme("Two Sans") },
      "themes/plain.json": { kind: "json", data: theme() },
      "fonts/one.woff2": { kind: "asset", url: `${assets}/fonts/one.woff2`, type: "font/woff2" },
      "fonts/two.woff2": { kind: "asset", url: `${assets}/fonts/two.woff2`, type: "font/woff2" },
    },
  });

  const loaded: string[] = [];
  const faces = new Set<{ family: string }>();
  class FakeFontFace {
    readonly family: string;
    constructor(family: string) {
      this.family = family;
    }
    load() {
      loaded.push(this.family);
      return Promise.resolve(this);
    }
  }

  beforeEach(() => {
    loaded.length = 0;
    faces.clear();
    vi.stubGlobal("FontFace", FakeFontFace);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        add: (face: { family: string }) => faces.add(face),
        delete: (face: { family: string }) => faces.delete(face),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (document as { fonts?: unknown }).fonts;
  });

  const families = () => [...faces].map((face) => face.family).sort();

  it("loads only the families the chosen theme's values name, and the new ones on a change", () => {
    service.addExtension(extension());
    service.markStarted();
    service.select(`${ID}/one`);
    expect(loaded).toEqual([families()[0]]);
    expect(families()).toHaveLength(1);
    expect(families()[0]).toMatch(/one-sans$/);
    service.select(`${ID}/two`);
    expect(families()).toHaveLength(1);
    expect(families()[0]).toMatch(/two-sans$/);
    expect(loaded).toHaveLength(2);
    expect(loaded[1]).toMatch(/two-sans$/);
    service.select(`${ID}/plain`);
    expect(families()).toEqual([]);
    expect(loaded).toHaveLength(2);
  });

  it("loads a family a colour customization names", () => {
    service.addExtension(extension());
    service.markStarted();
    service.select(`${ID}/plain`);
    expect(loaded).toEqual([]);
    expect(service.setCustomizations('{ "ui-font-ui": "Two Sans, sans-serif" }')).toEqual([]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatch(/two-sans$/);
  });
});
