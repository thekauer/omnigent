// @vitest-environment node
// The surface tokens added for full themes (theming plan M11): inline code, the code block
// body, the square Share and Stop's shape and type, the sidebar's app name, surface and
// edges, the right panel's dark background and edge, the dark shell's image, the context
// strip, the square pulse, the chat column and code letter-spacing. Unset (or at their
// defaults) each leaves today's look; a theme sets them like any token.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CHAT_COLUMN_WIDTH } from "../pages/chatLayout";
import { SIDEBAR_ACTIVE_HIGHLIGHT } from "../shell/sidebarStyles";

import { parseThemeFile, type ThemeFileOptions } from "./themeFile";
import { getToken, UNSET_VALUE } from "./tokens/registry";
import { TOKEN_CONSTRAINTS } from "./validate";

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const INDEX_CSS = source("../index.css");
const VARIANTS_CSS = source("./variants.css");
const SIDEBAR_TSX = source("../shell/Sidebar.tsx");

const OPTIONS: ThemeFileOptions = {
  uiTheme: "dark",
  context: {
    isKnownToken: (id) => getToken(id) !== undefined && !TOKEN_CONSTRAINTS[id]?.internal,
    fontFamily: (name) => (name === "Brand Sans" ? "x-acme-brand-sans" : undefined),
  },
  extensionColors: new Map(),
  assetUrl: () => undefined,
};

const parse = (tokens: Record<string, string>) => parseThemeFile({ omnigent: { tokens } }, OPTIONS);

/** Each new token: its kind and default (undefined: unset, the reader's fallback applies). */
const NEW_TOKENS: Record<string, { kind: string; light?: string }> = {
  "code-block-body-background": { kind: "color" },
  "code-inline-bg": { kind: "color", light: "var(--code-bg)" },
  "code-inline-border": { kind: "color" },
  "code-inline-radius": { kind: "length", light: "var(--ui-radius-sm)" },
  "ui-app-name-font": { kind: "font" },
  "ui-app-name-size": { kind: "length", light: "15px" },
  "ui-app-name-weight": { kind: "number", light: "var(--ui-weight-strong)" },
  "ui-app-name-tracking": { kind: "length", light: "-0.025em" },
  "ui-code-letter-spacing": { kind: "length" },
  "ui-chat-column-width": { kind: "length" },
  "ui-sidebar-surface": { kind: "color" },
  "ui-sidebar-edge": { kind: "color" },
  "ui-sidebar-header-rule": { kind: "color" },
  "ui-sidebar-active-ring": { kind: "shadow", light: "var(--ui-shadow-none)" },
  "ui-panel-edge": { kind: "color" },
  "ui-panel-background": { kind: "color" },
  "ui-shell-image": { kind: "image" },
  "ui-cta-radius": { kind: "length", light: "0px" },
  "ui-cta-font": { kind: "font", light: "var(--ui-font-mono)" },
  "ui-cta-size": { kind: "length", light: "12px" },
  "ui-cta-transform": { kind: "keyword", light: "uppercase" },
  "ui-cta-tracking": { kind: "length", light: "0px" },
  "ui-context-strip-background": { kind: "color" },
  "ui-context-strip-radius": { kind: "length", light: "var(--ui-radius-sm)" },
  "ui-working-pulse-radius": { kind: "length" },
};

describe("surface tokens", () => {
  it("registers each with its kind and today's value (or none)", () => {
    for (const [id, { kind, light }] of Object.entries(NEW_TOKENS)) {
      const token = getToken(id);
      expect(token, id).toBeDefined();
      expect(token!.kind, id).toBe(kind);
      expect(token!.default?.light, id).toBe(light);
      expect(token!.default?.dark, id).toBeUndefined();
    }
    expect(UNSET_VALUE).toBe("initial");
  });

  it("reads each where it applies, with today's value as the fallback", () => {
    // Inline code: an unset border makes the inset shadow invalid, so none is drawn.
    expect(INDEX_CSS).toMatch(
      /\[data-streamdown="inline-code"\] \{[^}]*background-color: var\(--code-inline-bg\);[^}]*border-radius: var\(--code-inline-radius\);[^}]*box-shadow: inset 0 0 0 1px var\(--code-inline-border\);/,
    );
    expect(INDEX_CSS).toContain(
      "background-color: var(--code-block-body-background, var(--background));",
    );
    // The dark shell's glow and the right panel's dark background and edge.
    expect(INDEX_CSS).toContain(
      'background-image: var(--ui-shell-image, url("./assets/omnigent-center-glow.svg")) !important;',
    );
    expect(INDEX_CSS).toContain("background: var(--ui-panel-background, transparent) !important;");
    expect(INDEX_CSS).toContain(
      "--workspace-panel-border: var(--ui-panel-edge, rgb(255 255 255 / 8%));",
    );
    // The sidebar's surface (both modes), edge (dark keeps its hairline; light, unset,
    // has none) and header rule.
    expect(INDEX_CSS).toContain("background-color: var(--ui-sidebar-surface, var(--sidebar));");
    expect(INDEX_CSS).toContain(
      "background: var(--ui-sidebar-surface, var(--sidebar-background, var(--sidebar)));",
    );
    expect(INDEX_CSS).toContain(
      "border-right: 1px solid var(--ui-sidebar-edge, var(--sidebar-edge-border));",
    );
    expect(INDEX_CSS).toMatch(
      /html:not\(\.dark\) \.conversations-sidebar:not\(\.is-peek\) \{[^}]*border-right: 1px solid var\(--ui-sidebar-edge\);/,
    );
    expect(SIDEBAR_TSX).toContain("shadow-[inset_0_-1px_0_var(--ui-sidebar-header-rule)]");
    // Code letter-spacing in the base layer, so tracking utilities still win.
    expect(INDEX_CSS).toMatch(
      /@layer base \{[\s\S]*pre,\s*code,\s*kbd,\s*samp \{\s*letter-spacing: var\(--ui-code-letter-spacing\);/,
    );
    expect(SIDEBAR_ACTIVE_HIGHLIGHT).toContain("shadow-(--ui-sidebar-active-ring)");
    // The app name: an unset font inherits the interface font.
    expect(SIDEBAR_TSX).toContain(
      "font-(family-name:--ui-app-name-font) text-(length:--ui-app-name-size) font-(weight:--ui-app-name-weight) tracking-(--ui-app-name-tracking)",
    );
    // The chat column keeps its three widths unless a theme sets one.
    expect(CHAT_COLUMN_WIDTH).toContain("[--chat-column-width:var(--ui-chat-column-width,48rem)]");
    expect(CHAT_COLUMN_WIDTH).toContain(
      "min-[1921px]:[--chat-column-width:var(--ui-chat-column-width,56rem)]",
    );
    expect(CHAT_COLUMN_WIDTH).toContain(
      "min-[2561px]:[--chat-column-width:var(--ui-chat-column-width,clamp(64rem,40vw,100rem))]",
    );
    // The square Share and Stop, the attached strip and the pulse.
    expect(VARIANTS_CSS).toContain("border-radius: var(--ui-cta-radius);");
    expect(VARIANTS_CSS).toMatch(
      /font-family: var\(--ui-cta-font\);\s*font-size: var\(--ui-cta-size\);\s*letter-spacing: var\(--ui-cta-tracking\);\s*text-transform: var\(--ui-cta-transform\);/,
    );
    expect(VARIANTS_CSS).toContain(
      "border-radius: var(--ui-context-strip-radius) var(--ui-context-strip-radius) 0 0;",
    );
    expect(VARIANTS_CSS).toContain(
      "background-color: var(--ui-context-strip-background, var(--sidebar));",
    );
    expect(VARIANTS_CSS).toMatch(
      /\.ui-working-pulse \{[^}]*border-radius: var\(--ui-working-pulse-radius\);/,
    );
  });

  it("takes a full theme's values", () => {
    const parsed = parse({
      "code-block-body-background": "#1c1d22",
      "code-inline-bg": "#1c1d22",
      "code-inline-border": "#2e3038",
      "code-inline-radius": "4px",
      "ui-app-name-font": '"Brand Sans", ui-sans-serif, sans-serif',
      "ui-app-name-size": "19px",
      "ui-app-name-weight": "500",
      "ui-app-name-tracking": "-0.03em",
      "ui-code-letter-spacing": "0px",
      "ui-chat-column-width": "760px",
      "ui-sidebar-surface": "#000000",
      "ui-sidebar-edge": "transparent",
      "ui-sidebar-header-rule": "hsl(228 10% 20%)",
      "ui-sidebar-active-ring": "inset 0 0 0 1px rgb(255 255 255 / 8%)",
      "ui-panel-edge": "#242424",
      "ui-panel-background": "var(--card)",
      "ui-shell-image": "none",
      "ui-cta-radius": "var(--ui-radius-base)",
      "ui-cta-font": "var(--ui-font-ui)",
      "ui-cta-size": "14px",
      "ui-cta-transform": "none",
      "ui-cta-tracking": "-0.01em",
      "ui-context-strip-background": "var(--card)",
      "ui-context-strip-radius": "10px",
      "ui-working-pulse-radius": "50%",
    });
    expect(parsed.issues).toEqual([]);
    expect(parsed.tokens["ui-app-name-font"]?.value).toBe(
      '"x-acme-brand-sans", ui-sans-serif, sans-serif',
    );
    expect(parsed.tokens["ui-shell-image"]?.value).toBe("none");
    expect(Object.keys(parsed.tokens)).toHaveLength(25);
  });

  it("rejects what the readers can't take", () => {
    const cases: Record<string, string> = {
      "ui-cta-transform": "blink",
      "ui-cta-size": "400px",
      "ui-app-name-size": "5em",
      "ui-app-name-weight": "1200",
      "ui-app-name-tracking": "200px",
      "ui-code-letter-spacing": "-200px",
      "ui-shell-image": 'url("https://example.com/glow.svg")',
      "ui-sidebar-active-ring": "inset 0 0 0 1px url(x)",
    };
    for (const [id, value] of Object.entries(cases)) {
      const parsed = parse({ [id]: value });
      expect(parsed.tokens[id], `${id}: ${value}`).toBeUndefined();
      expect(parsed.issues.join("\n"), id).toContain(id);
    }
  });
});
