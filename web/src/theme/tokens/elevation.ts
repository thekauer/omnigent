// Elevation tokens: the shadow recipes, each scaled by `ui-elevation` (1 by default,
// 0 removes every shadow). Tailwind's `shadow-*` utilities read the recipes.
//
// A recipe's alpha is its own registered token, so the recipe reads the same plain
// colour (`rgb(0 0 0 / 0.08)`) it had as a literal.
//
// Readers scale by `omnigent-elevation`, not `ui-elevation` itself: the embed leaves
// `ui-elevation` unregistered, where an invalid value would make every shadow alpha,
// and so the whole `box-shadow` with its rings and insets, invalid. The guard is
// registered in both builds and takes 1 instead.

import { tw } from "./tailwindPalette.ts";
import { defineTokens, type TokenInput } from "./types.ts";

const NEUTRAL = "var(--ui-shadow-neutral-rgb)";
const GLASS = "var(--ui-shadow-glass-rgb)";

// Every shadow alpha takes a number or a percentage, the two forms `rgb()` accepts,
// so a theme may write either. Each keeps the form of the literal it replaced
// (0.08, 12%), so it computes to the same value.
const ALPHA_SYNTAX = "<number> | <percentage>";

/** A recipe's elevation-scaled alpha and the recipe reading it. */
function recipe(
  name: string,
  alpha: number,
  layers: readonly string[],
  description: string,
  channels: string = NEUTRAL,
): TokenInput[] {
  const alphaId = `ui-shadow-${name}-alpha`;
  return [
    {
      id: alphaId,
      kind: "alpha",
      syntax: ALPHA_SYNTAX,
      description: `Alpha of ui-shadow-${name}, scaled by ui-elevation.`,
      default: { light: `calc(${alpha} * var(--omnigent-elevation))` },
    },
    {
      id: `ui-shadow-${name}`,
      kind: "shadow",
      description,
      default: {
        light: layers.map((layer) => `${layer} rgb(${channels} / var(--${alphaId}))`).join(", "),
      },
    },
  ];
}

// One raised-surface recipe at every size: the drop is ~0.3x the blur and the spread
// ~-0.4x it, so each shadow gathers under the element's bottom center.
export const ELEVATION_TOKENS = defineTokens("elevation", [
  // A number only: `calc()` cannot multiply two percentages, so a percentage
  // elevation would invalidate the percentage alphas (composer-shadow's 12%). An
  // invalid value (`50%`, `high`) on the top root falls back to the initial 1, full
  // shadows, and below it to the parent's value; it never silently flattens the UI.
  // The theme API's validation (theming plan M6) rejects it with a warning first.
  {
    id: "ui-elevation",
    kind: "number",
    syntax: "<number>",
    initial: "1",
    description:
      "Shadow strength, a number from 0 to 1 (not a percentage). Every shadow's alpha is multiplied by it.",
    default: { light: "1" },
  },
  {
    id: "omnigent-elevation",
    kind: "number",
    syntax: "<number>",
    initial: "1",
    registerInEmbed: true,
    description:
      "Internal: ui-elevation as a registered number in both builds, so an invalid ui-elevation reads 1 (full shadows) in the embed too. Shadows read this; themes set ui-elevation.",
    default: { light: "var(--ui-elevation)" },
  },
  {
    id: "ui-shadow-neutral-rgb",
    kind: "channels",
    description: "Shadow colour channels of the neutral recipes.",
    default: { light: "0 0 0", dark: "0 0 0" },
  },
  {
    id: "ui-shadow-warm-rgb",
    kind: "channels",
    description: "Shadow colour channels of warm shadows.",
    default: { light: "60 40 10", dark: "0 0 0" },
  },
  ...recipe("xs", 0.08, ["0 2px 8px -3px"], "Shadow xs, `shadow-xs` and `shadow-tooltip`."),
  ...recipe("sm", 0.1, ["0 4px 12px -5px"], "Shadow sm, `shadow-sm`."),
  ...recipe("md", 0.12, ["0 5px 16px -6px"], "Shadow md, `shadow-md`."),
  ...recipe(
    "lg",
    0.12,
    ["0 6px 20px -8px"],
    "Shadow lg, `shadow-lg`, `shadow-card` and `shadow-composer`.",
  ),
  ...recipe("xl", 0.16, ["0 10px 32px -13px"], "Shadow xl, `shadow-xl` and `shadow-menu`."),
  ...recipe("2xl", 0.25, ["0 25px 50px -12px"], "Shadow 2xl, `shadow-2xl`."),
  ...recipe("dialog", 0.2, ["0 14px 48px -19px"], "Dialog shadow, `shadow-dialog`."),
  ...recipe(
    "default",
    0.1,
    ["0 1px 3px 0", "0 1px 2px -1px"],
    "The bare `shadow` utility's two-layer shadow.",
  ),
  ...recipe("inner", 0.05, ["inset 0 2px 4px 0"], "Inset shadow, `shadow-inner`."),
  {
    id: "ui-shadow-none",
    kind: "shadow",
    description: "No shadow, as a shadow value (a transparent zero layer).",
    default: { light: "0 0 #0000" },
  },
  {
    id: "ui-shadow-glass-rgb",
    kind: "channels",
    description: "Shadow colour channels of the glass surfaces.",
    default: { light: "17 17 26" },
  },
  ...recipe(
    "glass",
    0.05,
    ["0px 4px 16px", "0px 8px 24px", "0px 16px 56px"],
    "A glass surface's cast shadow (components/ui/glass-surface).",
    GLASS,
  ),
  ...recipe(
    "glass-inset",
    0.05,
    ["inset 0px 4px 16px", "inset 0px 8px 24px", "inset 0px 16px 56px"],
    "A glass surface's inner shade.",
    GLASS,
  ),
  ...recipe(
    "glass-fallback",
    0.06,
    ["0px 4px 16px", "0px 8px 24px", "0px 16px 56px"],
    "A glass surface's cast shadow where it falls back to a blur.",
    GLASS,
  ),
  ...recipe(
    "glass-drop",
    0.08,
    ["0 2px 6px 1px"],
    "The app's glass controls' drop shadow (OmniGlassSurface); `--omni-glass-drop-shadow` overrides it per site.",
    GLASS,
  ),
  {
    id: "ui-shadow-composer-alpha",
    kind: "alpha",
    syntax: ALPHA_SYNTAX,
    description: "Alpha of composer-shadow, scaled by ui-elevation.",
    default: {
      light: "calc(12% * var(--omnigent-elevation))",
      dark: "calc(80% * var(--omnigent-elevation))",
    },
  },
  {
    id: "composer-shadow",
    kind: "shadow",
    description:
      "The composer's shadow on hover and while typing: the lg recipe, darker in dark mode.",
    default: { light: `0 6px 20px -8px rgb(${NEUTRAL} / var(--ui-shadow-composer-alpha))` },
  },
  {
    id: "ui-shadow-onboarding-alpha",
    kind: "alpha",
    syntax: ALPHA_SYNTAX,
    description: "Alpha of ui-shadow-onboarding, scaled by ui-elevation.",
    default: {
      light: "calc(18 / 255 * var(--omnigent-elevation))",
      dark: "calc(56 / 255 * var(--omnigent-elevation))",
    },
  },
  {
    id: "ui-shadow-onboarding",
    kind: "shadow",
    description: "The onboarding modal's shadow.",
    default: { light: `0 24px 80px 8px rgb(${NEUTRAL} / var(--ui-shadow-onboarding-alpha))` },
  },
  {
    id: "onboarding-modal-shadow",
    kind: "shadow",
    description:
      "Deprecated, not scaled by ui-elevation: the onboarding modal reads ui-shadow-onboarding. Kept with its value until the theme contribution API ships (theming plan M6).",
    default: { light: "0 24px 80px 8px #00000012", dark: "0 24px 80px 8px #00000038" },
  },
  {
    id: "ui-glass-rim-edge",
    description: "The glass surfaces' inner edge highlight (the liquid glass and its frame).",
    default: {
      light:
        "light-dark(color-mix(in oklch, black, transparent 85%), color-mix(in oklch, white, transparent 65%))",
    },
  },
  {
    id: "ui-glass-rim-glow",
    description: "The glass surfaces' inner glow.",
    default: {
      light:
        "light-dark(color-mix(in oklch, black, transparent 90%), color-mix(in oklch, white, transparent 85%))",
    },
  },
  {
    id: "ui-glass-fallback-highlight-top",
    description: "The fallback glass's top highlight, where SVG filters are unavailable.",
    default: { light: "light-dark(hsl(0 0% 100% / 0.85), hsl(0 0% 100% / 0.3))" },
  },
  {
    id: "ui-glass-fallback-highlight-bottom",
    description: "The fallback glass's bottom highlight.",
    default: { light: "light-dark(hsl(0 0% 100% / 0.35), hsl(0 0% 100% / 0.08))" },
  },
  {
    id: "ui-glass-fallback-edge",
    description: "The fallback glass's inner edge.",
    default: {
      light:
        "light-dark(color-mix(in oklch, black, transparent 88%), color-mix(in oklch, white, transparent 72%))",
    },
  },
  {
    id: "ui-glass-fallback-glow",
    description: "The fallback glass's inner glow.",
    default: {
      light:
        "light-dark(color-mix(in oklch, white, transparent 72%), color-mix(in oklch, white, transparent 90%))",
    },
  },
  {
    id: "ui-glass-sheen",
    kind: "image",
    description: "The glass surfaces' diagonal sheen (a background image).",
    default: {
      light:
        "linear-gradient(135deg, light-dark(hsl(0 0% 100% / 0.42), hsl(0 0% 100% / 0.14)) 0%, transparent 42%, transparent 64%, light-dark(hsl(0 0% 100% / 0.18), hsl(0 0% 100% / 0.05)) 100%)",
    },
  },
  {
    id: "ui-glass-rim",
    kind: "image",
    description: "The glass surfaces' rim (a background image, masked to the border).",
    default: {
      light:
        "linear-gradient(150deg, light-dark(hsl(0 0% 100% / 0.7), hsl(0 0% 100% / 0.34)), light-dark(hsl(0 0% 100% / 0.1), hsl(0 0% 100% / 0.03)) 45%, light-dark(hsl(0 0% 100% / 0.08), hsl(0 0% 100% / 0.02)) 60%, light-dark(hsl(0 0% 100% / 0.42), hsl(0 0% 100% / 0.18)))",
    },
  },
  {
    id: "ui-omni-glass-highlight-top",
    description: "The app's glass panels' top highlight (OmniGlassSurface).",
    default: { light: "light-dark(hsl(0 0% 100% / 0.85), hsl(0 0% 100% / 0.15))" },
  },
  {
    id: "ui-omni-glass-highlight-bottom",
    description: "The app's glass panels' bottom highlight.",
    default: { light: "light-dark(hsl(0 0% 100% / 0.35), hsl(0 0% 100% / 0.04))" },
  },
  {
    id: "ui-omni-glass-ring",
    description: "The app's glass panels' inner ring.",
    default: { light: "rgba(212, 212, 216, 0.08)" },
  },
  {
    id: "ui-omni-glass-glow",
    description: "The app's glass panels' inner glow.",
    default: {
      light:
        "light-dark(color-mix(in oklch, white, transparent 72%), color-mix(in oklch, white, transparent 95%))",
    },
  },
  {
    id: "ui-omni-glass-border",
    description: "The app's glass panels' border in light mode (none in dark).",
    default: { light: `color-mix(in oklab, ${tw("black")} 8%, transparent)` },
  },
]);
