// The product theme configuration (theming plan M10): its parsing and precedence, and the
// theme service applying it as the top layer over the user's settings.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerBuiltInThemes } from "@/builtinExtensions/builtInThemes";
import { SERVER_INFO_OFFLINE_FALLBACK } from "@/lib/bootCapabilities";
import { FALLBACK_SERVER_INFO } from "@/lib/capabilities";
import { FIXTURE_EXTENSION_ID, fixtureThemeExtension } from "@/test/themeFixtures";

import {
  applyBootProductThemes,
  applyServerProductTheme,
  LAST_SERVER_PRODUCT_THEME_STORAGE_KEY,
  mergeProductThemes,
  PRODUCT_THEME_MAX_CHARS,
  parseProductTheme,
  parseServerProductTheme,
  setProductTheme,
} from "./productTheme";
import { matchesAllowed, themeService, ThemeService } from "./themeService";
import {
  LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY,
  LEGACY_THEME_OPTIONS_STORAGE_KEY,
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

  it("merges the locks per key, the higher source winning each, and takes empty as no opinion", () => {
    expect(
      mergeProductThemes([
        { lockedTokens: { primary: "#000000" }, allowed: [] },
        { lockedTokens: { primary: "#111111", ring: "#222222" }, lockedVariants: {} },
        { lockedVariants: { density: "compact" }, allowed: ["nord"] },
      ]),
    ).toEqual({
      lockedTokens: { primary: "#000000", ring: "#222222" },
      lockedVariants: { density: "compact" },
      allowed: ["nord"],
    });
    // An embed's empty or all-malformed locks never hide the server's.
    const server = parseServerProductTheme({
      locked_tokens: { primary: "#ff0000" },
      locked_variants: { density: "compact" },
    });
    const embed = parseProductTheme(
      { lockedTokens: {}, lockedVariants: { density: "nope", bogus: "x" } },
      "embed",
    );
    expect(embed).toEqual({});
    expect(mergeProductThemes([embed, server])).toEqual({
      lockedTokens: { primary: "#ff0000" },
      lockedVariants: { density: "compact" },
    });
  });

  it("fails open on an allowed list with no well-formed entry", () => {
    expect(parseServerProductTheme({ allowed: ["bad id!", 3, "  "] })).toEqual({});
    expect(parseProductTheme({ allowed: [] }, "test")).toEqual({});
    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(messages).toMatch(/every theme is allowed/);
  });

  it("keeps what fits a configuration over the size limit, field by field", () => {
    // The server's own caps allow about 384 KB of tokens; the rest of the policy holds.
    const lockedTokens: Record<string, string> = {};
    for (let index = 0; index < 1000; index += 1) {
      lockedTokens[`ui-tok-${index}`] = "x".repeat(250);
    }
    const parsed = parseServerProductTheme({
      hide_picker: true,
      hide_customizations: true,
      allowed: ["omnigent.themes/nord"],
      lock_mode: "dark",
      locked_variants: { density: "compact" },
      locked_tokens: lockedTokens,
    })!;
    expect(parsed).toMatchObject({
      hidePicker: true,
      hideCustomizations: true,
      allowed: ["omnigent.themes/nord"],
      lockMode: "dark",
      lockedVariants: { density: "compact" },
    });
    const kept = Object.keys(parsed.lockedTokens ?? {});
    expect(kept.length).toBeGreaterThan(400);
    expect(kept.length).toBeLessThan(1000);
    expect(kept[0]).toBe("ui-tok-0");
    const size = Object.entries(parsed.lockedTokens!).reduce(
      (sum, [key, value]) => sum + JSON.stringify(key).length + JSON.stringify(value).length + 2,
      JSON.stringify("omnigent.themes/nord").length + 1 + JSON.stringify("density").length + 11,
    );
    expect(size).toBeLessThanOrEqual(PRODUCT_THEME_MAX_CHARS);
    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(messages).toMatch(/lockedTokens is over the 131072-character limit; left out: ui-tok-/);
    // A field that can't be read as data goes alone.
    const hostile = { hidePicker: true, lockedTokens: {} as Record<string, string> };
    Object.defineProperty(hostile.lockedTokens, "primary", { get: () => "#000", enumerable: true });
    expect(parseProductTheme(hostile, "test")).toEqual({ hidePicker: true });
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
      LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY,
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

  for (const which of ["a built-in palette", "a contributed theme"] as const) {
    it(`keeps a lock when the user attacks what it reads, under ${which}`, () => {
      if (which === "a contributed theme") {
        service.addExtension(fixtureThemeExtension());
        service.select(DARK);
      }
      const save = (values: Record<string, string>) =>
        service.saveSettingsText(JSON.stringify({ "workbench.colorCustomizations": values }));
      // Out of range: the user's row line would push the locked row height past 400px.
      service.setProductPolicy({
        lockedTokens: { "ui-row-height": "calc(var(--ui-row-line) + 8px)" },
      });
      save({ "ui-row-line": "400px", "ui-row-height": "10px" });
      expect(style()).not.toMatch(/--ui-row-height: 10px/);
      expect(style()).not.toMatch(/--ui-row-line: 400px/);
      expect(style()).toContain("--ui-row-height: calc(var(--ui-row-line) + 8px)");
      expect(
        service.checkCustomizations('{"ui-row-line": "400px", "ui-row-height": "10px"}'),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "ui-row-height", severity: "warning" }),
          {
            key: "ui-row-line",
            message: expect.stringMatching(/pushes the product's --ui-row-height out of range/),
          },
        ]),
      );
      // A cycle: the user's ring reads the locked primary, which reads the ring.
      service.setProductPolicy({ lockedTokens: { primary: "var(--ring)" } });
      save({ ring: "var(--primary)", primary: "#123456" });
      expect(style()).not.toContain("#123456");
      expect(style()).not.toMatch(/--ring: var\(--primary\)/);
      expect(style()).toContain("--primary: var(--ring)");
      expect(service.checkCustomizations('{"ring": "var(--primary)"}')).toEqual([
        { key: "ring", message: "closes a reference cycle with the product's --primary" },
      ]);
    });
  }

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
    localStorage.setItem(
      LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY,
      JSON.stringify({ primary: "#111111" }),
    );
    localStorage.setItem(LEGACY_VARIANTS_STORAGE_KEY, JSON.stringify({ density: "comfortable" }));
    localStorage.setItem(
      LEGACY_THEME_OPTIONS_STORAGE_KEY,
      JSON.stringify({ [`${FIXTURE_EXTENSION_ID}/full`]: { accent: "lava" } }),
    );
    service.reload();
    expect(style()).toContain("--primary: #111111");
    service.setProductPolicy({ hideCustomizations: true });
    expect(style()).not.toContain("#111111");
    expect(style()).toContain("--primary: #ff6a00");
    expect(service.getVariants()).toMatchObject({ density: "compact" });
    // Kept (migrated into the settings document), only not applied.
    expect(localStorage.getItem(LEGACY_VARIANTS_STORAGE_KEY)).toBeNull();
    expect(readStoredSettings(localStorage.getItem(SETTINGS_STORAGE_KEY)).values).toMatchObject({
      "omnigent.style.density": "comfortable",
    });
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

  it("repairs or retires a first-paint cache written under another policy", () => {
    service.addExtension(fixtureThemeExtension());
    service.select(DARK);
    service.setCustomizations(JSON.stringify({ primary: "#111111" }));
    expect(localStorage.getItem("omnigent:ui-theme-cache")).toContain("#111111");
    const firstPaint = (policy: Parameters<ThemeService["setProductPolicy"]>[0]) => {
      document.getElementById("omnigent-theme-runtime")?.remove();
      const fresh = new ThemeService();
      fresh.setProductPolicy(policy);
      fresh.applyCached();
      const css = style();
      fresh.setProductPolicy(null);
      return { css, fromCache: fresh.getActive()?.fromCache === true };
    };
    // The same policy: the cache as written.
    expect(firstPaint(null)).toMatchObject({ fromCache: true });
    expect(firstPaint(null).css).toContain("--primary: #111111");
    // A lock since: the cache, with the lock over it.
    const locked = firstPaint({ lockedTokens: { primary: "#00ff00" } });
    expect(locked.fromCache).toBe(true);
    expect(locked.css).toContain("--primary: #00ff00");
    expect(locked.css).not.toContain("#111111");
    // Customizations hidden since: the cache can't be repaired, and isn't used.
    const hidden = firstPaint({ hideCustomizations: true, lockedTokens: { primary: "#00ff00" } });
    expect(hidden.fromCache).toBe(false);
    expect(hidden.css).not.toContain("#111111");
    // A policy that arrives while the extension loads repairs the painted cache too.
    document.getElementById("omnigent-theme-runtime")?.remove();
    const loading = new ThemeService();
    loading.beginLoading();
    loading.applyCached();
    expect(style()).toContain("#111111");
    loading.setProductPolicy({ hideCustomizations: true });
    expect(style()).not.toContain("#111111");
    loading.setProductPolicy(null);
  });

  it("keeps the server's last product theme for the next load's first paint", () => {
    applyServerProductTheme({ product: { theme: { hide_customizations: true } } } as never);
    expect(localStorage.getItem(LAST_SERVER_PRODUCT_THEME_STORAGE_KEY)).toContain(
      "hideCustomizations",
    );
    setProductTheme("server", undefined);
    expect(themeService.getProductPolicy()).toBeNull();
    // The next load: before the server answers, its last policy holds.
    applyBootProductThemes();
    expect(themeService.getProductPolicy()).toEqual({ hideCustomizations: true });
    // A failed probe says nothing: the last-known policy holds, in memory and stored.
    applyServerProductTheme(FALLBACK_SERVER_INFO);
    expect(themeService.getProductPolicy()).toEqual({ hideCustomizations: true });
    expect(localStorage.getItem(LAST_SERVER_PRODUCT_THEME_STORAGE_KEY)).toContain(
      "hideCustomizations",
    );
    // So does a failed probe on a load with no server source yet (a reload offline).
    setProductTheme("server", undefined);
    applyServerProductTheme(FALLBACK_SERVER_INFO);
    expect(themeService.getProductPolicy()).toEqual({ hideCustomizations: true });
    applyServerProductTheme(SERVER_INFO_OFFLINE_FALLBACK);
    expect(themeService.getProductPolicy()).toEqual({ hideCustomizations: true });
    // A server that answers with none clears it.
    applyServerProductTheme({ ...FALLBACK_SERVER_INFO, product: null });
    expect(localStorage.getItem(LAST_SERVER_PRODUCT_THEME_STORAGE_KEY)).toBeNull();
    expect(themeService.getProductPolicy()).toBeNull();
    // Whatever another writer put there is checked again.
    localStorage.setItem(
      LAST_SERVER_PRODUCT_THEME_STORAGE_KEY,
      '{"lockMode":"dim","hidePicker":1}',
    );
    setProductTheme("server", undefined);
    applyBootProductThemes();
    expect(themeService.getProductPolicy()).toBeNull();
  });
});
