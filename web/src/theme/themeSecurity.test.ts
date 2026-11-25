// Attack reproductions for the theming security review (M6 findings F1 to F8): each
// test drives the attack through the public entry point and expects it to fail.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeAppName } from "@/lib/branding";
import { applyImportedSettings, collectSettings } from "@/lib/settingsPortability";
import { FIXTURE_CONTRIBUTES, FIXTURE_EXTENSION_ID, fixtureFiles } from "@/test/themeFixtures";

import { sanitizeSvg } from "./brandAssets";
import { extensionCssPrefix, parseThemeContributions } from "./themeContributions";
import { themeSelectors } from "./themeCss";
import { parseThemeFile } from "./themeFile";
import {
  checkCache,
  isHostAssetUrl,
  THEME_CACHE_STORAGE_KEY,
  ThemeService,
  type ThemeExtension,
} from "./themeService";
import { getToken } from "./tokens/registry";
import { TOKEN_CONSTRAINTS, validateTokenValue, type ValueContext } from "./validate";

const DARK = `${FIXTURE_EXTENSION_ID}/full-dark`;
const registryOnly: ValueContext = { isKnownToken: (id) => getToken(id) !== undefined };

function fixture(): ThemeExtension {
  const { contributions } = parseThemeContributions(FIXTURE_EXTENSION_ID, FIXTURE_CONTRIBUTES, {
    isKnownToken: (id) => getToken(id) !== undefined,
  });
  return { id: FIXTURE_EXTENSION_ID, version: "1.0.0", contributions, files: fixtureFiles() };
}

/** A cache as a tampered localStorage holds it, for the fixture's dark theme. */
function forgedCache(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: DARK,
    key: "k",
    label: "Forged",
    uiTheme: "dark",
    blocks: { dark: { background: "#000000" }, probes: {} },
    fonts: [{ family: "x-evil", url: "//evil.example/font.woff2" }],
    brand: {
      appName: "Evil",
      logos: {
        main: "//evil.example/logo.svg",
        loading: "/__omnigent/extension-assets/../../evil.svg",
        favicon: "/elsewhere/favicon.svg",
      },
    },
    syntax: [],
    ...overrides,
  };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  document.getElementById("omnigent-theme-runtime")?.remove();
  document.documentElement.removeAttribute("data-omni-theme");
  document.documentElement.removeAttribute("data-theme");
  warn.mockRestore();
});

describe("F1: a tampered first-paint cache loads nothing off-origin", () => {
  it("drops protocol-relative, traversing and foreign asset paths", () => {
    const cache = checkCache(forgedCache())!;
    expect(cache.fonts).toEqual([]);
    expect(cache.brand?.logos).toEqual({});
  });

  it("takes only the extension-assets and bundled asset prefixes, same origin", () => {
    expect(isHostAssetUrl("/__omnigent/extension-assets/acme.x/0a1b2c3d/brand/logo.svg")).toBe(
      true,
    );
    expect(isHostAssetUrl("/assets/logo-abc123.svg")).toBe(true);
    for (const url of [
      "//evil.example/x.woff2",
      "/\\evil.example/x.woff2",
      "https://evil.example/x.woff2",
      "/__omnigent/extension-assets/../x.svg",
      "/__omnigent/extension-assets/a/./b.svg",
      "/__omnigent/extension-assets//evil.example/x.svg",
      "/v1/info",
      "/assets/%2e%2e/x.svg",
    ]) {
      expect(isHostAssetUrl(url), url).toBe(false);
    }
  });

  it("leaves the derived cache out of exported settings, and skips it on import", () => {
    localStorage.setItem(THEME_CACHE_STORAGE_KEY, JSON.stringify(forgedCache()));
    localStorage.setItem("omnigent:ui-theme-palette", JSON.stringify("nord"));
    const exported = collectSettings()!;
    expect(Object.keys(exported.settings)).not.toContain(THEME_CACHE_STORAGE_KEY);
    localStorage.clear();
    applyImportedSettings({
      version: 1,
      settings: {
        "omnigent:ui-theme-palette": JSON.stringify(DARK),
        [THEME_CACHE_STORAGE_KEY]: JSON.stringify(forgedCache()),
      },
    });
    expect(localStorage.getItem(THEME_CACHE_STORAGE_KEY)).toBeNull();
  });

  it("repairs a forged cache once the live theme resolves", () => {
    const first = new ThemeService();
    first.addExtension(fixture());
    first.markStarted();
    first.select(DARK);
    const live = JSON.parse(localStorage.getItem(THEME_CACHE_STORAGE_KEY)!) as { key: string };
    // Same key as the live values, forged blocks: the key alone must not vouch for them.
    localStorage.setItem(
      THEME_CACHE_STORAGE_KEY,
      JSON.stringify(forgedCache({ key: live.key, fonts: [], brand: undefined })),
    );
    const reloaded = new ThemeService();
    const loading = reloaded.beginLoading();
    reloaded.applyCached();
    reloaded.addExtension(fixture());
    reloaded.markStarted();
    loading();
    const repaired = JSON.parse(localStorage.getItem(THEME_CACHE_STORAGE_KEY)!) as {
      label: string;
      blocks: { dark: Record<string, string> };
    };
    expect(repaired.label).toBe("Fixture Dark");
    expect(repaired.blocks.dark.background).toBe("#0d1117");
  });
});

describe("F2: a cached theme whose extension is missing is dropped once loading settles", () => {
  it("does not paint the cache after the built-ins settled (the production boot order)", () => {
    localStorage.setItem("omnigent:ui-theme-palette", JSON.stringify(DARK));
    localStorage.setItem(
      THEME_CACHE_STORAGE_KEY,
      JSON.stringify(forgedCache({ fonts: [], brand: undefined })),
    );
    const service = new ThemeService();
    // Production: no dev loader, so the built-ins settle before applyCached runs.
    service.markStarted();
    service.applyCached();
    expect(document.getElementById("omnigent-theme-runtime")?.textContent ?? "").toBe("");
    expect(service.getActive()).toMatchObject({ id: DARK, available: false, fromCache: false });
  });

  it("keeps the live values when the theme is already registered", () => {
    const service = new ThemeService();
    service.addExtension(fixture());
    service.markStarted();
    service.select(DARK);
    localStorage.setItem(
      THEME_CACHE_STORAGE_KEY,
      JSON.stringify(forgedCache({ fonts: [], brand: undefined })),
    );
    service.applyCached();
    expect(document.getElementById("omnigent-theme-runtime")?.textContent).toContain("#0d1117");
    expect(service.getActive()).toMatchObject({ fromCache: false });
  });
});

describe("F3: the runtime selectors match the theme roots only", () => {
  it("standalone: the document root, not an injected element", () => {
    const selectors = themeSelectors(null);
    const injected = document.createElement("div");
    injected.setAttribute("data-omni-theme", "");
    const byId = document.createElement("div");
    byId.id = "omnigent-theme-runtime-root";
    document.body.append(injected, byId);
    document.documentElement.setAttribute("data-omni-theme", "");
    try {
      expect(document.documentElement.matches(selectors.light)).toBe(true);
      expect(injected.matches(selectors.light)).toBe(false);
      expect(byId.matches(selectors.light)).toBe(false);
    } finally {
      injected.remove();
      byId.remove();
    }
  });

  it("embedded: the scope root and its inner root, not an element deeper inside", () => {
    const selectors = themeSelectors(".omnigent-app");
    const scope = document.createElement("div");
    scope.className = "omnigent-app";
    scope.setAttribute("data-omni-theme", "");
    const inner = document.createElement("div");
    inner.className = "dark";
    inner.setAttribute("data-omni-theme", "");
    const injected = document.createElement("div");
    injected.className = "dark";
    injected.setAttribute("data-omni-theme", "");
    inner.append(injected);
    scope.append(inner);
    document.body.append(scope);
    try {
      expect(scope.matches(selectors.light)).toBe(true);
      expect(inner.matches(selectors.dark)).toBe(true);
      expect(injected.matches(selectors.dark)).toBe(false);
    } finally {
      scope.remove();
    }
  });
});

describe("F4: extension CSS names don't collide, and themes read only their own colours", () => {
  it("encodes extension ids injectively", () => {
    expect(extensionCssPrefix("evil.x-y")).not.toBe(extensionCssPrefix("evil-x.y"));
    expect(extensionCssPrefix("Acme.x")).not.toBe(extensionCssPrefix("acme.x"));
    const colour = (extension: string, id: string) =>
      parseThemeContributions(
        extension,
        { colors: [{ id, description: "", defaults: { dark: "#000" } }] },
        registryOnly,
      ).contributions.colors[0]!.token;
    expect(colour("evil.x-y", "z")).not.toBe(colour("evil-x.y", "z"));
    expect(colour("evil.x", "y-z")).not.toBe(colour("evil.x-y", "z"));
  });

  it("refuses var() of another extension's colour", () => {
    const victim: ThemeExtension = {
      id: "victim.ext",
      version: "1.0.0",
      contributions: parseThemeContributions(
        "victim.ext",
        { colors: [{ id: "secret", description: "", defaults: { dark: "#123456" } }] },
        registryOnly,
      ).contributions,
      files: {},
    };
    const attacker: ThemeExtension = {
      id: "evil.ext",
      version: "1.0.0",
      contributions: parseThemeContributions(
        "evil.ext",
        { themes: [{ id: "t", label: "T", uiTheme: "dark", path: "./t.json" }] },
        registryOnly,
      ).contributions,
      files: {
        "t.json": {
          kind: "json",
          data: { colors: { background: `var(--${victim.contributions.colors[0]!.token})` } },
        },
      },
    };
    const service = new ThemeService();
    service.addExtension(victim);
    service.addExtension(attacker);
    service.markStarted();
    service.select("evil.ext/t");
    expect(document.getElementById("omnigent-theme-runtime")?.textContent).not.toContain(
      "--background:",
    );
    service.select(null);
  });
});

describe("F5: a font list reads only the ui-font-* tokens", () => {
  it("refuses a non-font var() after a font one", () => {
    for (const value of [
      "var(--ui-font-ui), var(--text-sm)",
      "var(--ui-font-ui), var(--spacing)",
      "var(--ui-font-ui), var(--background)",
      "var(--spacing)",
    ]) {
      expect(validateTokenValue("font", value, registryOnly).ok, value).toBe(false);
    }
    expect(validateTokenValue("font", "var(--ui-font-ui), monospace", registryOnly).ok).toBe(true);
  });
});

describe("F6: a brand SVG's styles cannot load images", () => {
  it("drops style attributes and image functions", () => {
    for (const attribute of [
      `style="fill: image-set('https://evil.example/x.png' 1x)"`,
      `style="background: -webkit-image-set('x.png' 1x)"`,
      `style="fill: cross-fade(red, blue)"`,
      `style="fill: image(red)"`,
      `style="fill: src('x')"`,
      `style="fill: red"`,
      `cursor="image-set('https://evil.example/x.png' 1x), auto"`,
    ]) {
      const result = sanitizeSvg(
        `<svg xmlns="http://www.w3.org/2000/svg"><rect ${attribute} width="1" height="1"/></svg>`,
      );
      expect(result.ok, attribute).toBe(true);
      const svg = (result as { svg: string }).svg;
      expect(svg, attribute).not.toMatch(/image-set|cross-fade|image\(|src\(|style=/);
    }
  });
});

describe("F7: an app name carries no bidi or zero-width characters", () => {
  it("strips format characters", () => {
    expect(normalizeAppName("Om‮nigent​⁦‍﻿")).toBe("Omnigent");
    expect(normalizeAppName("‮​")).toBeUndefined();
  });
});

describe("F8: value ranges, CSS-wide keywords and __proto__", () => {
  it("bounds lengths, with tighter caps where they matter", () => {
    const check = (id: string, value: string) =>
      validateTokenValue(getToken(id)!.kind, value, registryOnly, TOKEN_CONSTRAINTS[id]).ok;
    expect(check("ui-radius-base", "8px")).toBe(true);
    expect(check("ui-radius-base", "100000px")).toBe(false);
    expect(check("ui-radius-base", "-4px")).toBe(false);
    expect(check("ui-radius-base", "1e9rem")).toBe(false);
    expect(check("ui-row-height", "calc(1e9px * 1)")).toBe(false);
    expect(check("ui-border-width", "64px")).toBe(false);
    expect(check("ui-scrollbar-size", "200px")).toBe(false);
    expect(check("ui-letter-spacing", "-0.02em")).toBe(true);
    expect(check("ui-radius-pill", "calc(var(--ui-radius-base) * infinity)")).toBe(true);
  });

  it("refuses initial, inherit, unset, revert and revert-layer for every kind", () => {
    for (const keyword of ["initial", "inherit", "unset", "revert", "revert-layer", "INHERIT"]) {
      for (const id of ["background", "ui-radius-base", "ui-label-transform", "ui-font-ui"]) {
        expect(
          validateTokenValue(getToken(id)!.kind, keyword, registryOnly, TOKEN_CONSTRAINTS[id]).ok,
          `${id}: ${keyword}`,
        ).toBe(false);
      }
    }
  });

  it("warns about and drops __proto__ keys instead of rejecting the theme", () => {
    const data = JSON.parse(
      '{"colors": {"__proto__": {"x": "#fff"}, "background": "#101010"}, "__proto__": {}}',
    ) as unknown;
    const parsed = parseThemeFile(data, {
      uiTheme: "dark",
      context: registryOnly,
      extensionColors: new Map(),
      assetUrl: () => undefined,
    });
    expect(parsed.tokens.background?.value).toBe("#101010");
    expect(parsed.issues.join("\n")).toMatch(/__proto__/);
    expect(parsed.issues.join("\n")).not.toMatch(/theme rejected/);
  });
});

describe("M7 follow-up: SVG sanitizer bypasses", () => {
  const attributesOf = (svg: string) => {
    const result = sanitizeSvg(svg);
    if (!result.ok) throw new Error(result.reason);
    return result;
  };

  it("drops CSS escapes in presentation attributes", () => {
    const { svg, issues } = attributesOf(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="\\75 rl(https://evil.example/x)" stroke="red"/></svg>',
    );
    expect(svg).not.toContain("fill=");
    expect(svg).toContain('stroke="red"');
    expect(issues.join(";")).toMatch(/backslash/);
  });

  it("resolves no namespace prefix but xlink and xml", () => {
    const { svg } = attributesOf(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:foo="http://www.w3.org/1999/xlink" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        '<use foo:href="https://evil.example/x.svg#a"/><use xlink:href="#ok"/><use href="#ok2"/></svg>',
    );
    expect(svg).not.toContain("foo:");
    expect(svg).not.toContain("evil.example");
    expect(svg).toContain('xlink:href="#ok"');
    expect(svg).toContain('href="#ok2"');
    // The xlink prefix bound to another namespace, or the default namespace changed, is dropped.
    const rebound = attributesOf(
      '<svg xmlns="http://www.w3.org/2000/svg"><g xmlns:xlink="http://example.com/ns" xmlns="http://www.w3.org/1999/xhtml"/></svg>',
    ).svg;
    expect(rebound).toBe('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>');
  });

  it("drops xml:base and requiredExtensions, and xlink attributes but href", () => {
    const { svg, issues } = attributesOf(
      '<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://evil.example/"><g requiredExtensions="http://example.com/x" xml:space="preserve"><a xlink:show="new"/></g></svg>',
    );
    expect(svg).not.toMatch(/xml:base|requiredExtensions/);
    expect(svg).toContain('xml:space="preserve"');
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });
});

describe("M7 follow-up: calc() can't get around the ranges", () => {
  const check = (id: string, value: string) =>
    validateTokenValue(getToken(id)!.kind, value, registryOnly, TOKEN_CONSTRAINTS[id]);

  it("bounds a calc() of literals by the token's range", () => {
    expect(check("ui-border-width", "calc(32px * 300)").ok).toBe(false);
    expect(check("ui-border-width", "calc(16px * 2)").ok).toBe(true);
    expect(check("ui-radius-base", "calc(10000px + 10000px)").ok).toBe(false);
    expect(check("ui-label-size", "min(1px, 9000px)").ok).toBe(false);
  });

  it("bounds a calc() of tokens near the range, and never past the cap", () => {
    // The registry's own formulas pass.
    expect(check("ui-row-height", "calc(var(--ui-row-line) + calc(var(--spacing) * 2))").ok).toBe(
      true,
    );
    expect(check("ui-radius-sm", "calc(var(--ui-radius-base) * 0.5)").ok).toBe(true);
    expect(check("ui-border-width", "calc(var(--ui-border-width) * 300)").ok).toBe(false);
    expect(check("ui-radius-base", "calc(var(--ui-radius-base) * 9 * 9 * 9)").ok).toBe(false);
  });

  it("rejects division by zero, by a token and infinity but the pill's", () => {
    expect(check("ui-radius-base", "calc(1px / 0)").ok).toBe(false);
    expect(check("ui-radius-base", "calc(1px / (2 - 2))").ok).toBe(false);
    expect(check("ui-radius-base", "calc(10px / var(--ui-radius-base))").ok).toBe(false);
    expect(check("ui-radius-base", "calc(10px / 0.0001)").ok).toBe(false);
    expect(check("ui-radius-base", "calc(16px / 2)").ok).toBe(true);
    expect(check("ui-radius-base", "calc(1px * infinity)").ok).toBe(false);
    expect(check("ui-row-height", "calc(infinity * 1px)").ok).toBe(false);
    expect(check("ui-radius-pill", "calc(var(--ui-radius-base) * infinity)").ok).toBe(true);
    expect(check("ui-radius-pill", "calc(1px / infinity)").ok).toBe(false);
  });

  it("caps colour channels and gradient stops", () => {
    expect(check("background", "rgb(1e5 0 0)").ok).toBe(false);
    expect(check("background", "rgb(255 0 0 / 2)").ok).toBe(false);
    expect(check("background", "hsl(200deg 150% 50%)").ok).toBe(false);
    expect(check("background", "rgb(calc(255 * 1000) 0 0)").ok).toBe(false);
    expect(check("background", "oklch(0.7 0.1 200 / 50%)").ok).toBe(true);
    const stops = (count: number) =>
      `linear-gradient(${Array.from({ length: count }, () => "red").join(", ")})`;
    expect(check("ui-glass-sheen", stops(32)).ok).toBe(true);
    expect(check("ui-glass-sheen", stops(33)).ok).toBe(false);
    expect(check("ui-glass-sheen", "linear-gradient(red 1e6px, blue)").ok).toBe(false);
  });
});
