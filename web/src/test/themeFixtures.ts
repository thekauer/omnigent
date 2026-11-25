// Fixture theme contributions for the theming tests (theming plan M6): a full theme
// family, an invalid theme, a stock-like VS Code colour theme, a font and a brand logo.
// The same shapes ship as an extension in my-extensions' verify fixtures.

import { parseThemeContributions } from "@/theme/themeContributions";
import type { ThemeExtension } from "@/theme/themeService";
import { getToken } from "@/theme/tokens/registry";

/** The fixture extension's id. */
export const FIXTURE_EXTENSION_ID = "acme.fixture-themes";

/** `contributes` of the fixture extension's package.json. */
export const FIXTURE_CONTRIBUTES = {
  themes: [
    {
      id: "full-dark",
      label: "Fixture Dark",
      uiTheme: "dark",
      path: "./themes/full-dark.json",
      family: "fixture",
    },
    {
      id: "full-light",
      label: "Fixture Light",
      uiTheme: "light",
      path: "./themes/full-light.json",
      family: "fixture",
    },
    { id: "invalid", label: "Fixture Invalid", uiTheme: "dark", path: "./themes/invalid.json" },
    {
      id: "vscode-dark",
      label: "Stock Dark (VS Code)",
      uiTheme: "vs-dark",
      path: "./themes/vscode-dark.json",
    },
  ],
  colors: [
    {
      id: "glow",
      description: "The fixture's glow.",
      defaults: { light: "#ffcc00", dark: "color-mix(in srgb, var(--primary) 40%, transparent)" },
    },
  ],
  fonts: [{ family: "Fixture Sans", src: "./fonts/fixture-sans.woff2", weight: "100 900" }],
} as const;

/** The full dark member: every section of a theme file. */
export const FULL_DARK_THEME = {
  $schema: "vscode://schemas/color-theme",
  name: "Fixture Dark",
  type: "dark",
  colors: {
    "editor.background": "#101820",
    "editor.foreground": "#e6e1cf",
    "sideBar.background": "#0b1016",
    focusBorder: "#ff8800",
    background: "#0d1117",
    glow: "#ff00aa",
  },
  tokenColors: [
    { scope: ["keyword", "storage"], settings: { foreground: "#ff7733", fontStyle: "bold" } },
    { scope: "string", settings: { foreground: "#aad94c" } },
    { scope: "comment", settings: { foreground: "#5c6773", fontStyle: "italic" } },
  ],
  terminal: {
    background: "#0a0e14",
    foreground: "#b3b1ad",
    ansiRed: "#ff3333",
    brightGreen: "#c2d94c",
  },
  brand: {
    logo: "./brand/logo.svg",
    favicon: "./brand/logo.svg",
    appName: "Fixture Studio",
  },
  omnigent: {
    tokens: {
      "ui-radius-base": "0",
      "ui-elevation": "0.5",
      "ui-font-ui": "Fixture Sans, ui-sans-serif, sans-serif",
      "ui-label-transform": "uppercase",
      "ui-row-height": "34px",
      "x-acme__fixture_2dthemes-glow": "#ff00aa",
    },
    variants: { density: "compact", label: "mono-upper" },
    options: [
      {
        id: "accent",
        label: "Accent",
        default: "orange",
        choices: {
          orange: { label: "Orange", tokens: { primary: "#ff6a00" } },
          lava: { label: "Lava", tokens: { primary: "#e5322d" } },
        },
      },
      {
        id: "corners",
        label: "Corners",
        default: "square",
        choices: {
          square: { label: "Square", tokens: { "ui-radius-base": "0" } },
          soft: { label: "Soft", tokens: { "ui-radius-base": "6px" } },
        },
      },
    ],
  },
} as const;

/** The light member of the same family. */
export const FULL_LIGHT_THEME = {
  name: "Fixture Light",
  type: "light",
  colors: { "editor.background": "#fafafa", background: "#ffffff", foreground: "#1f2328" },
  tokenColors: [{ scope: "keyword", settings: { foreground: "#a626a4" } }],
  omnigent: {
    tokens: { "ui-radius-base": "0" },
    options: [
      {
        id: "accent",
        label: "Accent",
        default: "orange",
        choices: {
          orange: { tokens: { primary: "#d35400" } },
          lava: { tokens: { primary: "#c0392b" } },
        },
      },
    ],
  },
} as const;

/** Bad values, dangerous constructs, unknown keys and a reference cycle. */
export const INVALID_THEME = {
  colors: {
    background: "url(https://example.com/track.png)",
    foreground: "red; --primary: blue",
    "editor.background": "#zzzzzz",
    "sideBar.background": "#123456",
    "not-a-token": "#ffffff",
    "color-red-500": "#000000",
  },
  terminal: { background: "@import 'x'", nope: "#000" },
  omnigent: {
    tokens: {
      "ui-elevation": "2",
      "ui-radius-base": "expression(alert(1))",
      "ui-font-ui": "Comic Sans MS, cursive",
      card: "var(--popover)",
      popover: "var(--card)",
      primary: "var(--color-red-500)",
      "omnigent-elevation": "0",
    },
    unknownSection: {},
  },
  extraKey: true,
} as const;

/** A stock-like VS Code dark theme: workbench colours and TextMate rules only. */
export const VSCODE_DARK_THEME = {
  $schema: "vscode://schemas/color-theme",
  name: "Stock Dark",
  type: "dark",
  semanticHighlighting: true,
  colors: {
    "activityBar.background": "#181818",
    "activityBar.foreground": "#d7d7d7",
    "badge.background": "#616161",
    "badge.foreground": "#f8f8f8",
    "button.background": "#0078d4",
    "button.foreground": "#ffffff",
    "button.secondaryBackground": "#313131",
    "button.secondaryForeground": "#cccccc",
    descriptionForeground: "#9d9d9d",
    "dropdown.background": "#313131",
    "dropdown.border": "#3c3c3c",
    "editor.background": "#1f1f1f",
    "editor.foreground": "#cccccc",
    "editor.findMatchBackground": "#9e6a03",
    "editor.lineHighlightBackground": "#2a2d2e",
    "editor.selectionBackground": "#264f78",
    "editorGutter.background": "#1f1f1f",
    "editorLineNumber.activeForeground": "#cccccc",
    "editorLineNumber.foreground": "#6e7681",
    "editorWidget.background": "#202020",
    errorForeground: "#f85149",
    focusBorder: "#0078d4",
    foreground: "#cccccc",
    "input.background": "#313131",
    "input.border": "#3c3c3c",
    "list.activeSelectionBackground": "#04395e",
    "list.hoverBackground": "#2a2d2e",
    "menu.background": "#1f1f1f",
    "panel.background": "#181818",
    "scrollbarSlider.background": "#79797966",
    "sideBar.background": "#181818",
    "sideBar.border": "#2b2b2b",
    "sideBar.foreground": "#cccccc",
    "statusBar.background": "#181818",
    "tab.activeBackground": "#1f1f1f",
    "terminal.foreground": "#cccccc",
    "terminal.ansiRed": "#cd3131",
    "terminal.ansiBrightBlue": "#3b8eea",
    "textLink.foreground": "#4daafc",
    "titleBar.activeBackground": "#181818",
    "widget.border": "#313131",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#6a9955" } },
    { scope: "string", settings: { foreground: "#ce9178" } },
    { scope: ["keyword", "storage.type"], settings: { foreground: "#569cd6" } },
    { scope: "entity.name.function", settings: { foreground: "#dcdcaa" } },
    { scope: "variable", settings: { foreground: "#9cdcfe" } },
  ],
} as const;

/** The fixture font: a WOFF2 signature and padding (enough for the checks, not a real font). */
export const FIXTURE_FONT_BYTES = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0, 0, 0, 0, 0]);

/** The fixture logo, with an event handler the sanitizer drops. */
export const FIXTURE_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" onload="alert(1)"><rect width="16" height="16" fill="#ff00aa"/></svg>';

/** The fixture's theme files by normalized path, as `ExtensionDescription.files` gives them. */
export function fixtureFiles(assetBase = "/__omnigent/extension-assets/acme.fixture-themes/0") {
  return {
    "themes/full-dark.json": { kind: "json", data: FULL_DARK_THEME },
    "themes/full-light.json": { kind: "json", data: FULL_LIGHT_THEME },
    "themes/invalid.json": { kind: "json", data: INVALID_THEME },
    "themes/vscode-dark.json": { kind: "json", data: VSCODE_DARK_THEME },
    "brand/logo.svg": { kind: "asset", url: `${assetBase}/brand/logo.svg`, type: "image/svg+xml" },
    "fonts/fixture-sans.woff2": {
      kind: "asset",
      url: `${assetBase}/fonts/fixture-sans.woff2`,
      type: "font/woff2",
    },
  } as const;
}

/** The fixture extension as the theme service takes it (`ThemeExtension`), labelled. */
export function fixtureThemeExtension(): ThemeExtension {
  const { contributions } = parseThemeContributions(FIXTURE_EXTENSION_ID, FIXTURE_CONTRIBUTES, {
    isKnownToken: (id) => getToken(id) !== undefined,
  });
  return {
    id: FIXTURE_EXTENSION_ID,
    version: "1.0.0",
    label: "Fixture themes",
    contributions,
    files: fixtureFiles(),
  };
}
