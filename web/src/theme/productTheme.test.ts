// The product theme configuration (theming plan M10): its parsing and precedence, and the
// theme service applying it as the top layer over the user's settings.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerBuiltInThemes } from "@/builtinExtensions/builtInThemes";
import { FIXTURE_EXTENSION_ID, fixtureThemeExtension } from "@/test/themeFixtures";

import {
  mergeProductThemes,
  parseProductTheme,
  parseServerProductTheme,
  setProductTheme,
} from "./productTheme";
import {
  COLOR_CUSTOMIZATIONS_STORAGE_KEY,
  matchesAllowed,
  THEME_OPTIONS_STORAGE_KEY,
  themeService,
  ThemeService,
  VARIANTS_STORAGE_KEY,
} from "./themeService";

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
  service.setProductPolicy(null);
  service.select(null);
  for (const source of ["embed", "build", "server"] as const) setProductTheme(source, undefined);
  document.getElementById("omnigent-theme-runtime")?.remove();
  for (const attribute of [...document.documentElement.attributes]) {
    if (attribute.name.startsWith("data-omni"))
      document.documentElement.removeAttribute(attribute.name);
  }
  document.documentElement.removeAttribute("data-theme");
  warn.mockRestore();
});

describe("parseProductTheme", () => {
  it("keeps well-formed fields and warns about the rest", () => {
    expect(
      parseProductTheme(
        {
          default: "nord",
          allowed: ["omnigent.themes/*", "bad id!", 3],
          lockMode: "dim",
          lockedTokens: { "ui-radius-base": "0px", "bad key!": "x", primary: 3 },
          lockedOptions: { accent: "lava" },
          lockedVariants: { density: "compact", label: "loud", nope: "x" },
          hidePicker: true,
          hideCustomizations: "yes",
        },
        "test",
      ),
    ).toEqual({
      default: "nord",
      allowed: ["omnigent.themes/*"],
      lockedTokens: { "ui-radius-base": "0px" },
      lockedOptions: { accent: "lava" },
      lockedVariants: { density: "compact" },
      hidePicker: true,
    });
    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    for (const field of [
      "allowed",
      "lockMode",
      "lockedTokens.bad key!",
      "lockedTokens.primary",
      "lockedVariants.label",
      "lockedVariants.nope",
      "hideCustomizations",
    ]) {
      expect(messages).toContain(field);
    }
    expect(parseProductTheme({ default: "javascript:alert(1)" }, "test")).toEqual({});
    expect(parseProductTheme("nord", "test")).toBeUndefined();
    expect(parseProductTheme(undefined, "test")).toBeUndefined();
  });

  it("reads the server's snake_case keys", () => {
    expect(
      parseServerProductTheme({
        default: "nord",
        lock_mode: "dark",
        locked_variants: { density: "compact" },
        hide_picker: true,
        unknown_key: 1,
      }),
    ).toEqual({
      default: "nord",
      lockMode: "dark",
      lockedVariants: { density: "compact" },
      hidePicker: true,
    });
  });

  it("takes each field from the highest source that sets it", () => {
    expect(
      mergeProductThemes([
        { lockMode: "dark" },
        { default: "nord", lockMode: "light" },
        { default: "dracula", hidePicker: true },
      ]),
    ).toEqual({ lockMode: "dark", default: "nord", hidePicker: true });
    expect(mergeProductThemes([undefined, {}])).toBeNull();
  });

  it("feeds the window's theme service through one path, embed over build over server", () => {
    setProductTheme("server", { default: "dracula", hidePicker: true });
    expect(themeService.getProductPolicy()).toEqual({ default: "dracula", hidePicker: true });
    setProductTheme("build", { default: "nord" });
    setProductTheme("embed", { lockMode: "dark" });
    expect(themeService.getProductPolicy()).toEqual({
      lockMode: "dark",
      default: "nord",
      hidePicker: true,
    });
    setProductTheme("embed", undefined);
    setProductTheme("build", undefined);
    setProductTheme("server", undefined);
    expect(themeService.getProductPolicy()).toBeNull();
  });

  it("matches allowed patterns against whole ids", () => {
    expect(matchesAllowed("omnigent.themes/*", "omnigent.themes/nord-dark")).toBe(true);
    expect(matchesAllowed("omnigent.themes/*", "omnigent.themesx/nord")).toBe(false);
    expect(matchesAllowed("acme.*/dark", "acme.brand/dark")).toBe(true);
    expect(matchesAllowed("nord", "nord-dark")).toBe(false);
    expect(matchesAllowed("a.b/c", "a.b/c")).toBe(true);
  });
});

describe("the product theme in the theme service", () => {
  it("applies the default on first run and on reset, and keeps an explicit default palette", () => {
    service.setProductPolicy({ default: "nord" });
    expect(service.getChoice()).toBe("nord");
    expect(dataTheme()).toBe("nord");
    service.select("dracula");
    expect(service.getChoice()).toBe("dracula");
    service.select(null);
    expect(service.getChoice()).toBe("nord");
    // Choosing the default palette is a choice of its own under a product default.
    service.select("omni");
    expect(service.getChoice()).toBe("omni");
    service.resetAppearance();
    expect(service.getChoice()).toBe("nord");
  });

  it("stores the default as no choice and resolves it once the allowed theme loads", () => {
    // Nothing allowed is loaded yet: the default palette isn't allowed, and nothing is stored.
    service.setProductPolicy({ allowed: [DARK] });
    service.select(null);
    expect(localStorage.getItem("omnigent:ui-theme-palette")).toBeNull();
    expect(service.getChoice()).toBe(DARK);
    service.addExtension(fixtureThemeExtension());
    expect(service.getChoice()).toBe(DARK);
    expect(service.getActive()).toMatchObject({ id: DARK, available: true });
    expect(localStorage.getItem("omnigent:ui-theme-palette")).toBeNull();
    // A pattern, with its theme registered later, is taken lazily too.
    const later = new ThemeService();
    registerBuiltInThemes(later);
    later.setProductPolicy({ allowed: [`${FIXTURE_EXTENSION_ID}/*`] });
    later.select(null);
    expect(later.getChoice()).toBe("omni");
    later.addExtension(fixtureThemeExtension());
    expect(later.getChoice()).not.toBe("omni");
    expect(later.getChoice().startsWith(`${FIXTURE_EXTENSION_ID}/`)).toBe(true);
  });

  it("filters the list and select() by allowed, with patterns", () => {
    service.addExtension(fixtureThemeExtension());
    service.setProductPolicy({
      allowed: ["omnigent.themes/nord-*", `${FIXTURE_EXTENSION_ID}/full-*`],
    });
    expect(service.entries().map((entry) => entry.id)).toEqual(["nord", DARK]);
    expect(service.getChoice()).toBe("nord");
    expect(() => service.select(STOCK)).toThrow(/not allowed/);
    service.select(LIGHT);
    expect(service.getChoice()).toBe(LIGHT);
  });

  it("holds locked tokens over the theme and the user's customizations, in both modes", () => {
    service.addExtension(fixtureThemeExtension());
    service.select(DARK);
    localStorage.setItem(
      COLOR_CUSTOMIZATIONS_STORAGE_KEY,
      JSON.stringify({ primary: "#111111", "ui-row-height": "30px" }),
    );
    service.reload();
    expect(style()).toContain("--primary: #111111");
    service.setProductPolicy({
      lockedTokens: {
        primary: "#00ff00",
        "ui-row-height": "40px",
        "not-a-token": "#fff",
        background: "url(x)",
      },
    });
    expect(style()).toContain("--primary: #00ff00");
    expect(style()).not.toContain("#111111");
    expect(style()).toContain("--ui-row-height: 40px");
    expect(style()).not.toContain("url(");
    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(messages).toMatch(/--not-a-token is not a token/);
    expect(messages).toMatch(/--background: .*url/);
    // The Advanced editor says a locked token's value doesn't apply.
    expect(service.checkCustomizations('{"primary": "#222222"}')).toEqual([
      {
        key: "primary",
        message: "set by the product; this value doesn't apply",
        severity: "warning",
      },
    ]);
    // A built-in palette takes them too.
    service.select("nord");
    expect(style()).toContain("--primary: #00ff00");
  });

  it("holds locked variants and options over the user's, and refuses to change them", () => {
    service.addExtension(fixtureThemeExtension());
    service.select(DARK);
    service.setVariant("density", "comfortable");
    service.setOption("accent", "orange");
    service.setProductPolicy({
      lockedVariants: { density: "regular", cta: "accent-square" },
      lockedOptions: { accent: "lava" },
    });
    expect(service.getVariants()).toMatchObject({
      density: "regular",
      cta: "accent-square",
      label: "mono-upper",
    });
    expect(document.documentElement.getAttribute("data-omni-density")).toBeNull();
    expect(document.documentElement.getAttribute("data-omni-cta")).toBe("accent-square");
    expect(service.getActive()?.options.find((option) => option.id === "accent")).toMatchObject({
      value: "lava",
      locked: true,
    });
    expect(style()).toContain("--primary: #e5322d");
    expect(() => service.setVariant("density", "compact")).toThrow(/set by the product/);
    expect(() => service.setOption("accent", "orange")).toThrow(/set by the product/);
    // The user's choices stay stored, and apply again without the locks.
    service.setProductPolicy(null);
    expect(service.getVariants()).toMatchObject({ density: "comfortable" });
    expect(service.getActive()?.options.find((option) => option.id === "accent")?.value).toBe(
      "orange",
    );
  });

  it("leaves stored customizations, options and variants out under hideCustomizations", () => {
    service.addExtension(fixtureThemeExtension());
    service.select(DARK);
    localStorage.setItem(COLOR_CUSTOMIZATIONS_STORAGE_KEY, JSON.stringify({ primary: "#111111" }));
    localStorage.setItem(VARIANTS_STORAGE_KEY, JSON.stringify({ density: "comfortable" }));
    localStorage.setItem(
      THEME_OPTIONS_STORAGE_KEY,
      JSON.stringify({ [`${FIXTURE_EXTENSION_ID}/full`]: { accent: "lava" } }),
    );
    service.reload();
    expect(style()).toContain("--primary: #111111");
    service.setProductPolicy({ hideCustomizations: true });
    expect(style()).not.toContain("#111111");
    expect(style()).toContain("--primary: #ff6a00");
    expect(service.getVariants()).toMatchObject({ density: "compact" });
    expect(localStorage.getItem(VARIANTS_STORAGE_KEY)).not.toBeNull();
  });

  it("locks the mode over a single-mode theme's, and lists only themes of that mode", () => {
    service.addExtension(fixtureThemeExtension());
    expect(service.getForcedMode()).toBeNull();
    service.setProductPolicy({ lockMode: "light" });
    expect(service.getForcedMode()).toBe("light");
    expect(service.getModeLock()).toBe("light");
    // The stock theme is dark only: it can't show in light.
    expect(service.entries().some((entry) => entry.id === STOCK)).toBe(false);
    expect(service.entries().some((entry) => entry.members.light === LIGHT)).toBe(true);
  });
});
