// The theme list the picker and Settings share (theming plan M7), with the built-in themes
// as the omnigent.themes extension contributes them: grouping, families, swatches, the
// unavailable entry, previews, the product policy, variants and colour customizations.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builtInExtensions } from "@/builtinExtensions";
import { builtInThemeId, registerBuiltInThemes } from "@/builtinExtensions/builtInThemes";
import { ExtensionHost } from "@/vscodeExtensions/host";
import { hostServices } from "@/vscodeExtensions/testServices";
import { PALETTES } from "@/lib/themePalette";
import { FIXTURE_EXTENSION_ID, fixtureThemeExtension } from "@/test/themeFixtures";

import {
  THEME_CACHE_STORAGE_KEY,
  themeService,
  ThemeService,
  useThemeVariants,
} from "./themeService";
import {
  LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY,
  LEGACY_VARIANTS_STORAGE_KEY,
  readStoredSettings,
  SETTINGS_STORAGE_KEY,
} from "./settingsDocument";

const DARK = `${FIXTURE_EXTENSION_ID}/full-dark`;
const LIGHT = `${FIXTURE_EXTENSION_ID}/full-light`;
const STOCK = `${FIXTURE_EXTENSION_ID}/vscode-dark`;

const style = () => document.getElementById("omnigent-theme-runtime")?.textContent ?? "";
const dataTheme = () => document.documentElement.getAttribute("data-theme");

let service: ThemeService;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  service = new ThemeService();
  registerBuiltInThemes(service);
});

afterEach(() => {
  service.select(null);
  document.getElementById("omnigent-theme-runtime")?.remove();
  document.documentElement.removeAttribute("data-omni-theme");
  document.documentElement.removeAttribute("data-theme");
  warn.mockRestore();
});

describe("the theme list", () => {
  it("lists the built-in themes first, as the palettes, with their own swatches", () => {
    const entries = service.entries();
    expect(entries.map((entry) => entry.id)).toEqual([
      ...PALETTES.map((palette) => palette.id),
      "custom",
    ]);
    for (const palette of PALETTES) {
      const entry = entries.find((candidate) => candidate.id === palette.id)!;
      expect(entry).toMatchObject({
        label: palette.label,
        description: palette.blurb,
        builtIn: true,
        groupLabel: "Omnigent",
        forcedMode: undefined,
        available: true,
        custom: false,
        members: {
          light: builtInThemeId(palette.id, "light"),
          dark: builtInThemeId(palette.id, "dark"),
        },
      });
      expect(entry.swatches).toEqual({ light: palette.light, dark: palette.dark });
    }
    expect(entries.at(-1)).toMatchObject({ id: "custom", label: "Custom", custom: true });
    // The built-in theme files carry valid colours only: nothing warned.
    expect(warn).not.toHaveBeenCalled();
  });

  it("groups an extension's themes under its name, a family as one entry", () => {
    service.addExtension(fixtureThemeExtension());
    const contributed = service.entries().filter((entry) => !entry.builtIn);
    expect(contributed.map((entry) => [entry.id, entry.label, entry.forcedMode])).toEqual([
      [DARK, "Fixture Light / Fixture Dark", undefined],
      [`${FIXTURE_EXTENSION_ID}/invalid`, "Fixture Invalid", "dark"],
      [STOCK, "Stock Dark (VS Code)", "dark"],
    ]);
    expect(new Set(contributed.map((entry) => entry.groupLabel))).toEqual(
      new Set(["Fixture themes"]),
    );
    expect(contributed[0]!.members).toEqual({ dark: DARK, light: LIGHT });
  });

  it("resolves a contributed theme's swatches from its colours and option choices", () => {
    service.addExtension(fixtureThemeExtension());
    const family = service.entries().find((entry) => entry.id === DARK)!;
    expect(family.swatches.dark).toMatchObject({
      bg: "#0d1117",
      accent: "#ff6a00",
      text: "#e6e1cf",
    });
    expect(family.swatches.light).toMatchObject({ bg: "#ffffff", accent: "#d35400" });
    // A stored option choice is what the swatch shows.
    service.select(DARK);
    service.setOption("accent", "lava");
    expect(service.entries().find((entry) => entry.id === DARK)!.swatches.dark?.accent).toBe(
      "#e5322d",
    );
  });

  it("names the chosen family member, whichever it is", () => {
    service.addExtension(fixtureThemeExtension());
    service.select(LIGHT);
    expect(service.getChoice()).toBe(LIGHT);
    expect(service.entries().filter((entry) => !entry.builtIn)[0]!.id).toBe(LIGHT);
  });

  it("lists a chosen theme whose extension is missing as unavailable, from its cache", () => {
    const remove = service.addExtension(fixtureThemeExtension());
    service.markStarted();
    service.select(DARK);
    remove();
    const missing = service.entries().find((entry) => entry.id === DARK)!;
    expect(missing).toMatchObject({
      label: "Fixture Dark",
      available: false,
      builtIn: false,
      groupLabel: FIXTURE_EXTENSION_ID,
    });
    // The default applies meanwhile, so the chip shows the default's colours.
    const fallback = service.entries().find((entry) => entry.id === "omni")!;
    expect(missing.swatches).toEqual(fallback.swatches);
    expect(missing.swatches.dark?.bg).not.toBe("#0d1117");
    expect(service.getChoice()).toBe(DARK);
  });

  it("keeps only what the product allows; a stored choice outside it yields to the default", () => {
    service.addExtension(fixtureThemeExtension());
    service.select("nord");
    service.setProductPolicy({ allowed: ["omni", STOCK] });
    expect(service.entries().map((entry) => entry.id)).toEqual(["omni", STOCK]);
    expect(service.getChoice()).toBe("omni");
    // Patterns match entry and member ids.
    service.setProductPolicy({ allowed: ["omnigent.themes/nord-*"] });
    expect(service.entries().map((entry) => entry.id)).toEqual(["nord"]);
    expect(service.getChoice()).toBe("nord");
    service.setProductPolicy({ hidePicker: true });
    expect(service.getProductPolicy()).toEqual({ hidePicker: true });
    service.setProductPolicy(null);
    expect(service.entries()).toHaveLength(PALETTES.length + 1 + 3);
  });
});

describe("the omnigent.themes built-in", () => {
  it("contributes the built-in themes through the extension host, as any extension does", async () => {
    const fresh = new ThemeService();
    const host = new ExtensionHost({
      services: hostServices({ themes: fresh }),
      console: { error: () => {}, warn: () => {}, info: () => {} },
    });
    const themes = builtInExtensions().find((extension) => extension.id === "omnigent.themes")!;
    expect(themes).toMatchObject({ builtIn: true, displayName: "Omnigent" });
    await host.start([themes]);
    expect(fresh.entries().map((entry) => entry.id)).toEqual(
      service.entries().map((entry) => entry.id),
    );
    expect(fresh.list()).toHaveLength((PALETTES.length + 1) * 2);
    await host.dispose();
    expect(fresh.entries()).toEqual([]);
  });
});

describe("built-in theme ids", () => {
  it("select a built-in theme by its palette id or its theme id, stored as before", () => {
    service.select(builtInThemeId("nord", "dark"));
    expect(service.getChoice()).toBe("nord");
    expect(localStorage.getItem("omnigent:ui-theme-palette")).toBe(JSON.stringify("nord"));
    expect(dataTheme()).toBe("nord");
    // The precompiled palette, not a runtime stylesheet.
    expect(style()).toBe("");
    localStorage.setItem("omnigent:ui-theme-palette", JSON.stringify("gruvbox"));
    service.reload();
    expect(service.getChoice()).toBe("gruvbox");
    expect(dataTheme()).toBe("gruvbox");
  });
});

describe("previews", () => {
  it("show a theme without storing it, and revert to the chosen one", () => {
    service.addExtension(fixtureThemeExtension());
    service.markStarted();
    service.select("dracula");
    service.preview(STOCK);
    expect(style()).toContain("#1f1f1f");
    expect(dataTheme()).toBeNull();
    expect(service.getForcedMode()).toBe("dark");
    expect(service.getChoice()).toBe("dracula");
    expect(localStorage.getItem(THEME_CACHE_STORAGE_KEY)).toBeNull();
    service.preview("github");
    expect(dataTheme()).toBe("github");
    expect(style()).not.toContain("#1f1f1f");
    service.preview(undefined);
    expect(dataTheme()).toBe("dracula");
    expect(service.getForcedMode()).toBeNull();
    expect(localStorage.getItem("omnigent:ui-theme-palette")).toBe(JSON.stringify("dracula"));
    // Choosing ends a preview.
    service.preview(STOCK);
    service.select(DARK);
    expect(service.getChoice()).toBe(DARK);
    expect(style()).toContain("#0d1117");
  });
});

describe("style variants", () => {
  it("store the user's choices over the theme's, Theme default removing one", () => {
    service.addExtension(fixtureThemeExtension());
    service.markStarted();
    service.select(DARK);
    expect(service.getVariants()).toEqual({ density: "compact", label: "mono-upper" });
    service.setVariant("density", "comfortable");
    service.setVariant("cta", "light-square");
    expect(readStoredSettings(localStorage.getItem(SETTINGS_STORAGE_KEY)).values).toEqual({
      "omnigent.style.density": "comfortable",
      "omnigent.style.cta": "light-square",
    });
    expect(service.getVariants()).toEqual({
      density: "comfortable",
      label: "mono-upper",
      cta: "light-square",
    });
    expect(service.getActive()?.variants).toMatchObject({ density: "comfortable" });
    service.setVariant("density", null);
    expect(service.getVariants().density).toBe("compact");
    // A built-in palette has no variants of its own: the user's apply alone.
    service.select("nord");
    expect(service.getVariants()).toEqual({ cta: "light-square" });
    expect(() => service.setVariant("density", "huge")).toThrow(TypeError);
    expect(() => service.setVariant("nope", "x")).toThrow(TypeError);
  });
});

describe("useThemeVariants", () => {
  it("follows the stored choices", () => {
    const { result } = renderHook(() => useThemeVariants());
    expect(result.current).toEqual({});
    act(() => themeService.setVariant("header", "solid"));
    expect(result.current).toEqual({ header: "solid" });
    act(() => themeService.setVariant("header", null));
    expect(result.current).toEqual({});
  });
});

describe("colour customizations", () => {
  it("check JSON with a problem per key, and store it only when it checks out", () => {
    expect(service.checkCustomizations("{")[0]).toMatchObject({ key: "" });
    expect(service.checkCustomizations("[]")).toEqual([
      { key: "", message: "must be a JSON object" },
    ]);
    const problems = service.checkCustomizations(
      JSON.stringify({
        background: "url(x)",
        "not-a-token": "#fff",
        "[nord]": { primary: "inherit", "[x]": {} },
        "[bad": {},
        "omnigent-elevation": "1",
      }),
    );
    expect(problems.map((problem) => problem.key)).toEqual([
      "background",
      "not-a-token",
      "[nord].primary",
      "[nord].[x]",
      "[bad",
      "omnigent-elevation",
    ]);
    expect(service.setCustomizations('{"background": "url(x)"}')).toHaveLength(1);
    expect(localStorage.getItem(LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY)).toBeNull();
  });

  it("apply over a built-in palette too, globally and for its id", () => {
    service.select("nord");
    expect(
      service.setCustomizations(
        JSON.stringify({ primary: "#123456", "[nord]": { "ui-radius-base": "2px" } }),
      ),
    ).toEqual([]);
    expect(style()).toContain("--primary: #123456;");
    expect(style()).toContain("--ui-radius-base: 2px;");
    service.select("github");
    expect(style()).toContain("--primary: #123456;");
    expect(style()).not.toContain("--ui-radius-base");
    expect(service.getCustomizationsText()).toContain('"[nord]"');
    service.setCustomizations("{}");
    expect(style()).toBe("");
    expect(localStorage.getItem(LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY)).toBeNull();
  });

  it("are cleared with the options and variants by the appearance reset", () => {
    service.addExtension(fixtureThemeExtension());
    service.select(DARK);
    service.setOption("accent", "lava");
    service.setVariant("density", "compact");
    service.setCustomizations('{"primary": "#123456"}');
    service.resetAppearance();
    expect(service.getChoice()).toBe("omni");
    for (const key of [
      "omnigent:ui-theme-options",
      LEGACY_VARIANTS_STORAGE_KEY,
      LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY,
      "omnigent:ui-theme-palette",
    ]) {
      expect(localStorage.getItem(key), key).toBeNull();
    }
  });
});

describe("the theme list's family labels", () => {
  it("takes the family label from whichever member declares it", () => {
    const base = fixtureThemeExtension();
    const themes = base.contributions.themes.map((theme) =>
      theme.uiTheme === "light" && theme.family
        ? { ...theme, familyLabel: "Fixture Family" }
        : theme,
    );
    const familyService = new ThemeService();
    familyService.addExtension({ ...base, contributions: { ...base.contributions, themes } });
    expect(familyService.entries().find((entry) => entry.members.dark === DARK)?.label).toBe(
      "Fixture Family",
    );
  });
});
