import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_EXTENSION_ID, fixtureThemeExtension } from "@/test/themeFixtures";

import {
  LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY,
  LEGACY_THEME_OPTIONS_STORAGE_KEY,
  LEGACY_VARIANTS_STORAGE_KEY,
  readStoredSettings,
  SETTINGS_STORAGE_KEY,
  SETTINGS_WRITE_BLOCKED,
} from "./settingsDocument";
import { checkSettings, getSettingsSchema, saveSettings } from "./settingsEditor";
import { schemaAt } from "./settingsSchema";
import { SettingsWriteError, ThemeService } from "./themeService";

const DARK = `${FIXTURE_EXTENSION_ID}/full-dark`;
const SCOPE = `[${FIXTURE_EXTENSION_ID}/fixture]`;
const style = () => document.getElementById("omnigent-theme-runtime")?.textContent ?? "";
const stored = () => readStoredSettings(localStorage.getItem(SETTINGS_STORAGE_KEY));

let service: ThemeService;
const save = (text: string) => saveSettings(text, service);
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  service = new ThemeService();
  service.addExtension(fixtureThemeExtension());
  service.markStarted();
  service.select(DARK);
});

afterEach(() => {
  service.select(null);
  document.getElementById("omnigent-theme-runtime")?.remove();
  document.documentElement.removeAttribute("data-omni-theme");
  warn.mockRestore();
});

describe("the settings document in the theme service", () => {
  it("applies options, variants and customizations from the saved text", () => {
    const text = `// mine
{
  "omnigent.themeOptions": { "${SCOPE}": { "accent": "lava" } },
  "omnigent.style.header": "solid",
  "workbench.colorCustomizations": { "foreground": "#123456" },
}
`;
    expect(save(text)).toEqual({ saved: true, diagnostics: [] });
    expect(service.getActive()?.options.find((option) => option.id === "accent")?.value).toBe(
      "lava",
    );
    expect(service.getVariants()).toMatchObject({ header: "solid", density: "compact" });
    expect(style()).toContain("--primary: #e5322d");
    expect(style()).toContain("--foreground: #123456");
    expect(service.getSettingsText()).toBe(text);
  });

  it("keeps the last good values, and the theme, while the text doesn't parse", () => {
    save('{ "omnigent.style.header": "solid" }');
    const before = style();
    const result = save('{ "omnigent.style.header": "glass", ');
    expect(result.saved).toBe(true);
    expect(result.diagnostics[0]).toMatchObject({ severity: "error" });
    expect(service.getVariants()).toMatchObject({ header: "solid" });
    expect(style()).toBe(before);
    expect(service.isSettingsTextValid()).toBe(false);
    // Nothing typed is lost; a reload reads the same.
    expect(service.getSettingsText()).toBe('{ "omnigent.style.header": "glass", ');
    expect(new ThemeService().getUserVariants()).toEqual({ header: "solid" });
    // Writes wait for the text to parse.
    expect(service.settingsWriteBlocked()).toBe(SETTINGS_WRITE_BLOCKED);
    expect(() => service.setVariant("header", "glass")).toThrow(SettingsWriteError);
    expect(() => service.setOption("accent", "lava")).toThrow(SETTINGS_WRITE_BLOCKED);
  });

  it("leaves a key with a wrong value out and applies the others", () => {
    const { diagnostics } = save(
      '{ "omnigent.style.header": "chrome", "omnigent.style.cta": "light-square", "workbench.colorCustomizations": { "foreground": "url(x)" } }',
    );
    expect(diagnostics.map((entry) => [entry.severity, entry.path?.join(" > ")])).toEqual([
      ["error", "omnigent.style.header"],
      ["error", "workbench.colorCustomizations > foreground"],
    ]);
    expect(service.getUserVariants()).toEqual({ cta: "light-square" });
    expect(style()).not.toContain("url(");
  });

  it("writes Settings' and the quick picks' choices into the text, keeping its comments", () => {
    save('// keep me\n{\n  "omnigent.style.header": "solid" // and me\n}\n');
    service.setOption("accent", "lava");
    service.setVariant("density", "comfortable");
    service.setVariant("header", null);
    const text = service.getSettingsText();
    expect(text).toContain("// keep me");
    expect(JSON.parse(text.replace(/\/\/.*$/gm, ""))).toEqual({
      "omnigent.themeOptions": { [SCOPE]: { accent: "lava" } },
      "omnigent.style.density": "comfortable",
    });
    service.setOption("accent", null);
    expect(stored().values).toEqual({ "omnigent.style.density": "comfortable" });
  });

  it("lists the registered themes' options, the variants and the tokens in its schema", () => {
    const schema = getSettingsSchema(service);
    expect(schemaAt(schema, ["omnigent.themeOptions", SCOPE, "corners"])).toMatchObject({
      enum: ["square", "soft"],
      enumDescriptions: ["Square", "Soft"],
    });
    // The theme's own value is what an unset key keeps.
    expect(schemaAt(schema, ["omnigent.style.density"])?.description).toContain("(Compact)");
    expect(schemaAt(schema, ["workbench.colorCustomizations", "primary"])).toBeDefined();
    expect(
      schemaAt(schema, ["workbench.colorCustomizations", "x-acme__fixture_2dthemes-glow"]),
    ).toBeDefined();
    expect(schemaAt(schema, ["workbench.colorCustomizations", `[${DARK}]`])).toBeDefined();
    // Without the extension, its options leave the schema.
    const bare = new ThemeService();
    expect(schemaAt(getSettingsSchema(bare), ["omnigent.themeOptions", SCOPE])?.warning).toMatch(
      /No installed theme/,
    );
  });
});

describe("product locks in the settings document", () => {
  beforeEach(() => {
    save(
      `{ "omnigent.themeOptions": { "${SCOPE}": { "accent": "orange" } }, "omnigent.style.density": "regular", "workbench.colorCustomizations": { "primary": "#111111" } }`,
    );
    service.setProductPolicy({
      lockedTokens: { primary: "#222222" },
      lockedOptions: { accent: "lava" },
      lockedVariants: { density: "comfortable" },
    });
  });

  it("never applies the document's values for locked keys", () => {
    expect(service.getVariants()).toMatchObject({ density: "comfortable" });
    expect(service.getActive()?.options.find((option) => option.id === "accent")).toMatchObject({
      value: "lava",
      locked: true,
    });
    expect(style()).toContain("--primary: #222222");
    expect(style()).not.toContain("#111111");
  });

  it("marks them 'Set by product' in the editor and refuses writes to them", () => {
    const messages = checkSettings(service.getSettingsText(), service).map((entry) => [
      entry.severity,
      entry.unnecessary,
      entry.message,
    ]);
    expect(messages).toEqual([
      ["info", true, "Set by product (Lava): this value doesn't apply."],
      ["info", true, "Set by product (Comfortable): this value doesn't apply."],
      ["info", true, "Set by product: this value doesn't apply."],
    ]);
    expect(() => service.setVariant("density", "compact")).toThrow(SettingsWriteError);
    expect(() => service.setOption("accent", "orange")).toThrow(SettingsWriteError);
    expect(schemaAt(getSettingsSchema(service), ["omnigent.style.density"])?.locked?.value).toBe(
      "comfortable",
    );
  });

  it("turns every key off under hideCustomizations", () => {
    service.setProductPolicy({ hideCustomizations: true });
    expect(service.getUserVariants()).toEqual({ density: "regular" });
    expect(service.getVariants()).toMatchObject({ density: "compact" });
    expect(style()).not.toContain("#111111");
    expect(
      checkSettings(service.getSettingsText(), service).every((entry) => entry.unnecessary),
    ).toBe(true);
  });
});

describe("migration of the pre-M10b keys", () => {
  it("reads the old keys into the document once, and removes them", () => {
    localStorage.setItem(
      LEGACY_THEME_OPTIONS_STORAGE_KEY,
      JSON.stringify({ [`${FIXTURE_EXTENSION_ID}/fixture`]: { accent: "lava" } }),
    );
    localStorage.setItem(LEGACY_VARIANTS_STORAGE_KEY, JSON.stringify({ header: "solid" }));
    localStorage.setItem(
      LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY,
      JSON.stringify({ foreground: "#123456" }),
    );
    service.reload();
    expect(service.getActive()?.options.find((option) => option.id === "accent")?.value).toBe(
      "lava",
    );
    expect(service.getVariants()).toMatchObject({ header: "solid" });
    expect(style()).toContain("--foreground: #123456");
    for (const key of [
      LEGACY_THEME_OPTIONS_STORAGE_KEY,
      LEGACY_VARIANTS_STORAGE_KEY,
      LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY,
    ]) {
      expect(localStorage.getItem(key), key).toBeNull();
    }
    expect(stored().values).toEqual({
      "omnigent.themeOptions": { [SCOPE]: { accent: "lava" } },
      "omnigent.style.header": "solid",
      "workbench.colorCustomizations": { foreground: "#123456" },
    });
  });

  it("keeps the legacy keys while the text doesn't parse, and moves them in once it does", () => {
    save('{ "omnigent.style.header": "solid" }');
    save('{ "omnigent.style.header": "glass", ');
    localStorage.setItem(LEGACY_VARIANTS_STORAGE_KEY, JSON.stringify({ density: "comfortable" }));
    expect(service.getUserVariants()).toEqual({ header: "solid", density: "comfortable" });
    expect(localStorage.getItem(LEGACY_VARIANTS_STORAGE_KEY)).not.toBeNull();
    expect(service.getSettingsText()).toBe('{ "omnigent.style.header": "glass", ');
    save('{ "omnigent.style.header": "glass" }');
    expect(service.getUserVariants()).toEqual({ header: "glass", density: "comfortable" });
    expect(localStorage.getItem(LEGACY_VARIANTS_STORAGE_KEY)).toBeNull();
    expect(stored().values).toEqual({
      "omnigent.style.header": "glass",
      "omnigent.style.density": "comfortable",
    });
  });

  it("clears the document and the old keys on reset", () => {
    save('{ "omnigent.style.header": "solid" }');
    localStorage.setItem(LEGACY_VARIANTS_STORAGE_KEY, JSON.stringify({ cta: "light-square" }));
    service.resetAppearance();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_VARIANTS_STORAGE_KEY)).toBeNull();
    expect(service.getUserVariants()).toEqual({});
  });
});

describe("a hostile stored settings document", () => {
  const deep = (depth: number, close = true) =>
    `{"x":${"[".repeat(depth)}${close ? "]".repeat(depth) : ""}}`;
  const store = (text: string, values: Record<string, unknown> = {}) =>
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, text, values }));

  it("boots, with the deep key left out and the rest applying", () => {
    store(`{ "omnigent.style.header": "solid", ${deep(3000).slice(1)}`);
    const booted = new ThemeService();
    booted.addExtension(fixtureThemeExtension());
    booted.markStarted();
    expect(() => booted.select(DARK)).not.toThrow();
    expect(booted.isSettingsTextValid()).toBe(true);
    expect(booted.getUserVariants()).toEqual({ header: "solid" });
    const problems = checkSettings(booted.getSettingsText(), booted);
    expect(problems).toContainEqual(
      expect.objectContaining({
        offset: '{ "omnigent.style.header": "solid", '.length,
        length: 3,
        severity: "error",
        message: expect.stringMatching(/^Nested too deeply/),
      }),
    );
    booted.select(null);
  });

  it("boots on the last good values when the deep text doesn't parse either", () => {
    store(deep(65_000, false), { "omnigent.style.header": "solid" });
    const booted = new ThemeService();
    booted.addExtension(fixtureThemeExtension());
    booted.markStarted();
    expect(() => booted.select(DARK)).not.toThrow();
    expect(booted.isSettingsTextValid()).toBe(false);
    expect(booted.getUserVariants()).toEqual({ header: "solid" });
    expect(checkSettings(booted.getSettingsText(), booted)[0]).toMatchObject({ severity: "error" });
    booted.select(null);
  });

  it("boots on the defaults when even the stored values are hostile", () => {
    const values = `{"omnigent.style.header":${"[".repeat(65_000)}"solid"${"]".repeat(65_000)}}`;
    localStorage.setItem(SETTINGS_STORAGE_KEY, `{"version":1,"text":"{","values":${values}}`);
    const booted = new ThemeService();
    expect(() => booted.markStarted()).not.toThrow();
    expect(booted.getUserVariants()).toEqual({});
  });
});
