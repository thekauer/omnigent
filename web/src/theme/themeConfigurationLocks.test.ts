import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationRegistry } from "@/configuration/configurationRegistry";
import { ConfigurationService } from "@/configuration/configurationService";
import { SETTINGS_STORAGE_KEY } from "@/configuration/settingsDocument";
import { SettingsStore, SettingsWriteError } from "@/configuration/settingsStore";
import { builtInThemeConfiguration } from "@/builtinExtensions/builtInThemes";
import { parseConfigurationContributions } from "@/configuration/configurationContributions";
import { followThemeLocks } from "./themeConfigurationLocks";
import { ThemeService } from "./themeService";

function setup() {
  const store = new SettingsStore();
  const configuration = new ConfigurationService(new ConfigurationRegistry(), store);
  configuration.addExtension(
    "omnigent.themes",
    parseConfigurationContributions(
      "omnigent.themes",
      { configuration: builtInThemeConfiguration() },
      { builtIn: true },
    ).contributions,
  );
  const themes = new ThemeService();
  followThemeLocks(themes, configuration);
  return { themes, configuration };
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the product theme's locks in the configuration service", () => {
  it("locks a locked variant for reads and writes, over the user's choice", () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        text: '{ "omnigent.style.density": "comfortable" }',
        values: {},
      }),
    );
    const { themes, configuration } = setup();
    expect(configuration.isLocked("omnigent.style.density")).toBe(false);
    themes.setProductPolicy({ lockedVariants: { density: "compact" } });
    expect(configuration.isLocked("omnigent.style.density")).toBe(true);
    expect(configuration.getValue("omnigent.style.density")).toBe("compact");
    expect(configuration.inspect("omnigent.style.density").userValue).toBe("comfortable");
    expect(() => configuration.update("omnigent.style.density", "comfortable")).toThrow(
      SettingsWriteError,
    );
    themes.setProductPolicy(null);
    expect(configuration.getValue("omnigent.style.density")).toBe("comfortable");
  });

  it("refuses writes of a locked option or token, and locks every customization when hidden", () => {
    const { themes, configuration } = setup();
    themes.setProductPolicy({
      lockedOptions: { corners: "square" },
      lockedTokens: { primary: "#123456" },
    });
    expect(() =>
      configuration.update("omnigent.themeOptions", { "[acme.fixture]": { corners: "round" } }),
    ).toThrow(/option corners: Set by product/);
    configuration.update("omnigent.themeOptions", { "[acme.fixture]": { corners: "square" } });
    expect(() =>
      configuration.update("workbench.colorCustomizations", { "[dark]": { primary: "#000" } }),
    ).toThrow(/primary: Set by product/);
    configuration.update("workbench.colorCustomizations", { ring: "#000" });
    themes.setProductPolicy({ hideCustomizations: true });
    expect(configuration.isLocked("workbench.colorCustomizations")).toBe(true);
    expect(configuration.getValue("workbench.colorCustomizations")).toEqual({});
    expect(configuration.isLocked("omnigent.themeOptions")).toBe(true);
    expect(configuration.isLocked("omnigent.style.density")).toBe(true);
  });
});
