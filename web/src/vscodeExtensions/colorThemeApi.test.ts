// The plugin read API (theming plan M8): window.activeColorTheme, onDidChangeActiveColorTheme,
// getThemeToken and ThemeColor in SessionHeaderItem.color.
import type * as omnigent from "omnigent";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerBuiltInThemes } from "@/builtinExtensions/builtInThemes";
import { setThemeModePreview } from "@/store/themeModePreview";
import { FIXTURE_EXTENSION_ID, fixtureThemeExtension } from "@/test/themeFixtures";
import { ColorThemeKind, ColorThemes, ThemeColor } from "@/theme/colorThemes";
import { ThemeService } from "@/theme/themeService";
import { createExtensionApi, OMNIGENT_API_EXPORT_NAMES } from "./api";
import { SessionHeaderItemRegistry } from "./sessionHeaderItems";
import { hostServices } from "./testServices";

const DARK = `${FIXTURE_EXTENSION_ID}/full-dark`;
const LIGHT = `${FIXTURE_EXTENSION_ID}/full-light`;

let service: ThemeService;
let warn: ReturnType<typeof vi.spyOn>;
let removals: (() => void)[];

function setup(extensionId = FIXTURE_EXTENSION_ID) {
  const colors = new ColorThemes(service);
  const headerItems = new SessionHeaderItemRegistry();
  const logError = vi.fn();
  const handle = createExtensionApi(
    extensionId,
    hostServices({ colorThemes: colors, headerItems, themes: service }),
    logError,
  );
  return { api: handle.api, handle, headerItems, logError };
}

beforeEach(() => {
  localStorage.clear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  service = new ThemeService();
  removals = [registerBuiltInThemes(service), service.addExtension(fixtureThemeExtension())];
  service.markStarted();
  document.documentElement.classList.add("dark");
});

afterEach(() => {
  service.select(null);
  for (const remove of removals) remove();
  document.getElementById("omnigent-theme-runtime")?.remove();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-omni-theme");
  document.documentElement.removeAttribute("data-theme");
  setThemeModePreview(null);
  warn.mockRestore();
});

describe("window.activeColorTheme", () => {
  it("names the built-in theme on screen, with VS Code's kinds", () => {
    const { api } = setup();
    expect(OMNIGENT_API_EXPORT_NAMES).toEqual(
      expect.arrayContaining(["ThemeColor", "ColorThemeKind"]),
    );
    expect(api.ColorThemeKind).toEqual({
      Light: 1,
      Dark: 2,
      HighContrast: 3,
      HighContrastLight: 4,
    });
    expect(api.window.activeColorTheme).toEqual({
      id: "omnigent.themes/omni-dark",
      label: expect.any(String),
      kind: ColorThemeKind.Dark,
      options: {},
      variants: {},
    });
    service.select("nord");
    document.documentElement.classList.remove("dark");
    expect(api.window.activeColorTheme).toMatchObject({
      id: "omnigent.themes/nord-light",
      kind: ColorThemeKind.Light,
    });
  });

  it("names a family's member for the mode on screen, as plain data", () => {
    const { api } = setup();
    service.select(DARK);
    const theme = api.window.activeColorTheme;
    expect(theme).toMatchObject({ id: DARK, label: "Fixture Dark", kind: ColorThemeKind.Dark });
    expect(structuredClone(theme)).toEqual(theme);
    expect(Object.isFrozen(theme)).toBe(true);
    document.documentElement.classList.remove("dark");
    expect(api.window.activeColorTheme).toMatchObject({ id: LIGHT, kind: ColorThemeKind.Light });
  });
  it("reports the committed theme, options and mode, never a preview", async () => {
    const { api } = setup();
    service.select(DARK);
    expect(api.window.activeColorTheme).toMatchObject({
      id: DARK,
      options: { accent: "orange", corners: "square" },
      variants: { density: "compact", label: "mono-upper" },
    });
    service.preview("nord");
    expect(api.window.activeColorTheme).toMatchObject({
      id: DARK,
      variants: { density: "compact" },
    });
    service.preview(undefined);
    // A mode preview: the roots switch, the committed mode stays what it reports.
    setThemeModePreview("light");
    document.documentElement.classList.remove("dark");
    expect(api.window.activeColorTheme).toMatchObject({ id: DARK, kind: ColorThemeKind.Dark });
    setThemeModePreview(null);
    document.documentElement.classList.add("dark");
    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });
    expect(api.window.activeColorTheme).toMatchObject({ id: DARK, kind: ColorThemeKind.Dark });
  });
});

describe("window.onDidChangeActiveColorTheme", () => {
  it("fires for an option, a variant and a customization change", () => {
    const { api } = setup();
    service.select(DARK);
    const seen: omnigent.ColorTheme[] = [];
    api.window.onDidChangeActiveColorTheme((theme) => seen.push(theme));
    service.setOption("accent", "lava");
    expect(seen.map((theme) => theme.options)).toEqual([{ accent: "lava", corners: "square" }]);
    service.setOption("accent", "lava");
    expect(seen).toHaveLength(1);
    service.setVariant("density", "comfortable");
    expect(seen[1]?.variants).toMatchObject({ density: "comfortable" });
    service.setCustomizations(JSON.stringify({ primary: "#123456" }));
    expect(seen).toHaveLength(3);
    expect(seen[2]).toEqual(seen[1]);
    // A preview of another option's theme doesn't fire.
    service.preview("nord");
    service.preview(undefined);
    expect(seen).toHaveLength(3);
  });

  it("fires after a committed change is applied, never for a preview", async () => {
    const { api } = setup();
    const seen: omnigent.ColorTheme[] = [];
    const styles: string[] = [];
    const subscription = api.window.onDidChangeActiveColorTheme((theme) => {
      seen.push(theme);
      // Applied before it fires: the token reads the new theme.
      styles.push(api.window.getThemeToken("background") ?? "");
    });
    service.preview(DARK);
    service.preview("nord");
    service.preview(undefined);
    expect(seen).toEqual([]);
    service.select(DARK);
    expect(seen.map((theme) => theme.id)).toEqual([DARK]);
    expect(document.getElementById("omnigent-theme-runtime")?.textContent).toContain(
      "--background:",
    );
    // A preview of the committed theme's mode doesn't fire, nor its end where it began.
    setThemeModePreview("light");
    document.documentElement.classList.remove("dark");
    await Promise.resolve();
    setThemeModePreview(null);
    document.documentElement.classList.add("dark");
    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });
    expect(seen).toHaveLength(1);
    // A committed mode change does.
    document.documentElement.classList.remove("dark");
    await vi.waitFor(() => expect(seen.map((theme) => theme.id)).toEqual([DARK, LIGHT]));
    subscription.dispose();
    service.select("nord");
    expect(seen).toHaveLength(2);
    expect(styles).toHaveLength(2);
  });

  it("logs a throwing listener against the extension and stops at deactivation", () => {
    const { api, handle, logError } = setup();
    const listener = vi.fn(() => {
      throw new Error("boom");
    });
    api.window.onDidChangeActiveColorTheme(listener);
    act(() => service.select(DARK));
    expect(logError).toHaveBeenCalledWith(
      "onDidChangeActiveColorTheme listener threw",
      expect.any(Error),
    );
    handle.dispose();
    act(() => service.select("nord"));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("window.getThemeToken", () => {
  it("reads registry tokens and the caller's own colours, nothing else", () => {
    const { api } = setup();
    service.select(DARK);
    expect(api.window.getThemeToken("background")).toBe("#0d1117");
    // The fixture's own colour, by its id or `<extension id>.<id>`.
    expect(api.window.getThemeToken("glow")).toBe("#ff00aa");
    expect(api.window.getThemeToken(`${FIXTURE_EXTENSION_ID}.glow`)).toBe("#ff00aa");
    expect(api.window.getThemeToken("omnigent-elevation")).toBeUndefined();
    expect(api.window.getThemeToken("no-such-token")).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no-such-token"));
    // Another extension can't read the fixture's colours.
    const other = setup("acme.other").api;
    expect(other.window.getThemeToken(`${FIXTURE_EXTENSION_ID}.glow`)).toBeUndefined();
    expect(other.window.getThemeToken("glow")).toBeUndefined();
  });
});

describe("ThemeColor in SessionHeaderItem.color", () => {
  it("renders a theme colour as its variable and drops unknown ids with a warning", () => {
    const { api, headerItems } = setup();
    const item = api.window.createSessionHeaderItem("cost");
    item.text = "$1.00";
    item.show();
    const color = () => headerItems.getSnapshot()[0]!.color;
    expect(color()).toBeUndefined();
    item.color = new api.ThemeColor(`${FIXTURE_EXTENSION_ID}.glow`);
    expect(color()).toBe("var(--x-acme__fixture_2dthemes-glow)");
    expect(item.color).toBeInstanceOf(ThemeColor);
    item.color = new api.ThemeColor("muted-foreground");
    expect(color()).toBe("var(--muted-foreground)");
    item.color = new api.ThemeColor("acme.other.secret");
    expect(color()).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("acme.other.secret"));
    // A structured clone of a ThemeColor (a Worker host's) is a plain `{ id }`.
    item.color = { id: "muted-foreground" } as never;
    expect(color()).toBe("var(--muted-foreground)");
    item.color = { id: "muted-foreground", extra: 1 } as never;
    expect(color()).toBeUndefined();
    item.color = "#ff0000";
    expect(color()).toBe("#ff0000");
    item.color = "url(https://evil.example/x)";
    expect(color()).toBeUndefined();
    item.color = undefined;
    expect(color()).toBeUndefined();
  });
});
