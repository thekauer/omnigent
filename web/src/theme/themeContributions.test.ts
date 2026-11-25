import { describe, expect, it } from "vitest";

import { FIXTURE_CONTRIBUTES, FIXTURE_EXTENSION_ID } from "@/test/themeFixtures";

import {
  namespacedFontFamily,
  normalizeExtensionPath,
  parseThemeContributions,
} from "./themeContributions";
import { getToken } from "./tokens/registry";

const CONTEXT = { isKnownToken: (id: string) => getToken(id) !== undefined };

describe("parseThemeContributions", () => {
  it("reads themes, colours and fonts", () => {
    const { contributions, warnings } = parseThemeContributions(
      FIXTURE_EXTENSION_ID,
      FIXTURE_CONTRIBUTES,
      CONTEXT,
    );
    expect(warnings).toEqual([]);
    expect(
      contributions.themes.map((theme) => [theme.fullId, theme.uiTheme, theme.family, theme.path]),
    ).toEqual([
      ["acme.fixture-themes/full-dark", "dark", "fixture", "themes/full-dark.json"],
      ["acme.fixture-themes/full-light", "light", "fixture", "themes/full-light.json"],
      ["acme.fixture-themes/invalid", "dark", undefined, "themes/invalid.json"],
      ["acme.fixture-themes/vscode-dark", "dark", undefined, "themes/vscode-dark.json"],
    ]);
    expect(contributions.colors).toEqual([
      {
        id: "glow",
        token: "x-acme__fixture_2dthemes-glow",
        description: "The fixture's glow.",
        defaults: { light: "#ffcc00", dark: "color-mix(in srgb, var(--primary) 40%, transparent)" },
      },
    ]);
    expect(contributions.fonts).toEqual([
      {
        family: "Fixture Sans",
        cssFamily: "x-acme__fixture_2dthemes-fixture-sans",
        src: "fonts/fixture-sans.woff2",
        weight: "100 900",
        style: undefined,
      },
    ]);
  });

  it("warns about every malformed entry and keeps the rest", () => {
    const { contributions, warnings } = parseThemeContributions(
      "acme.x",
      {
        themes: [
          { id: "ok", uiTheme: "light", path: "./a.json" },
          { id: "ok", uiTheme: "light", path: "./b.json" },
          { id: "Bad Id", uiTheme: "dark", path: "./c.json" },
          { id: "mode", uiTheme: "sepia", path: "./c.json" },
          { id: "escape", uiTheme: "dark", path: "../c.json" },
          { id: "notjson", uiTheme: "dark", path: "./c.css" },
          { id: "fam1", uiTheme: "dark", path: "./d.json", family: "f" },
          { id: "fam2", uiTheme: "dark", path: "./e.json", family: "f" },
          "nope",
        ],
        colors: [
          { id: "x", defaults: { light: "url(x)", dark: "#000" } },
          { id: "x" },
          { id: "Upper" },
        ],
        fonts: [
          { family: "Ok", src: "./ok.woff2" },
          { family: "Evil;", src: "./x.woff2" },
          { family: "Ttf", src: "./x.ttf" },
          { family: "Up", src: "/etc/passwd.woff2" },
          { family: "Weight", src: "./w.woff2", weight: "heavy" },
        ],
      },
      CONTEXT,
    );
    expect(contributions.themes.map((theme) => theme.id)).toEqual(["ok", "fam1", "fam2"]);
    expect(contributions.themes[2]!.family).toBeUndefined();
    expect(contributions.colors).toEqual([
      { id: "x", token: "x-acme__x-x", description: "", defaults: { dark: "#000" } },
    ]);
    expect(contributions.fonts.map((font) => font.family)).toEqual(["Ok"]);
    expect(warnings).toHaveLength(14);
    expect(parseThemeContributions("acme.x", { themes: {} }, CONTEXT).warnings).toEqual([
      '"contributes.themes" must be an array',
    ]);
  });

  it("caps the themes per extension", () => {
    const themes = Array.from({ length: 25 }, (_, index) => ({
      id: `t${index}`,
      uiTheme: "dark",
      path: `./t${index}.json`,
    }));
    const { contributions, warnings } = parseThemeContributions("acme.x", { themes }, CONTEXT);
    expect(contributions.themes).toHaveLength(20);
    expect(warnings[0]).toMatch(/more than 20/);
  });
});

describe("normalizeExtensionPath", () => {
  it("keeps paths inside the folder only", () => {
    expect(normalizeExtensionPath("./themes/a.json")).toBe("themes/a.json");
    expect(normalizeExtensionPath("themes/a.json")).toBe("themes/a.json");
    for (const path of [
      "../a.json",
      "/a.json",
      "a/../../b",
      "a//b",
      "a\\b",
      "https://x/a",
      "",
      7,
      "./",
    ]) {
      expect(normalizeExtensionPath(path), String(path)).toBeUndefined();
    }
  });

  it("namespaces font families by extension", () => {
    expect(namespacedFontFamily("thekauer.dev", "Geist Mono")).toBe("x-thekauer__dev-geist-mono");
  });
});
