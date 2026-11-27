// Tokens the style variants read (`theme/variants.css`): the user bubble, the floating
// sheet, the square Share and Stop buttons and the square pulse. Nothing reads them while
// every variant is at its default, so the stock look stays as it is; a theme that turns a
// variant on may tune it through them. The colours are unset: each falls back to a
// palette colour.

import { defineTokens } from "./types.ts";

const UNSET = {};

export const VARIANT_SURFACE_TOKENS = defineTokens("variant", [
  {
    id: "ui-bubble-background",
    default: UNSET,
    description:
      "Your message bubbles' background under the Soft and Square variants. Unset: `muted`.",
  },
  {
    id: "ui-bubble-border",
    default: UNSET,
    description:
      "Your message bubbles' 1px outline under the Soft and Square variants. Unset: the border colour at 60%.",
  },
  {
    id: "ui-bubble-radius",
    kind: "length",
    description: "Your message bubbles' corner radius under the Soft variant, 12px.",
    default: { light: "calc(var(--ui-radius-base) * 1.5)" },
  },
  {
    id: "ui-sheet-gap",
    kind: "length",
    description:
      "The floating sheet's margin from the window's edges (the left one too while the sidebar is collapsed), 8px.",
    default: { light: "calc(var(--spacing) * 2)" },
  },
  {
    id: "ui-sheet-gap-top",
    kind: "length",
    description:
      "The floating sheet's margin from the top edge, `ui-sheet-gap` (a layout with a top bar sets its own).",
    default: { light: "var(--ui-sheet-gap)" },
  },
  {
    id: "ui-sheet-gap-top-titlebar",
    kind: "length",
    description:
      "The floating sheet's margin from the title bar while it shows (`window.titleBar.visible`), `ui-sheet-gap`.",
    default: { light: "var(--ui-sheet-gap)" },
  },
  {
    id: "ui-sheet-radius",
    kind: "length",
    description: "The floating sheet's corner radius, 12px.",
    default: { light: "calc(var(--ui-radius-base) * 1.5)" },
  },
  {
    id: "ui-sheet-shadow",
    kind: "shadow",
    default: UNSET,
    description: "The floating sheet's shadow. Unset: `ui-shadow-2xl` with a hairline ring.",
  },
  {
    id: "ui-cta-background",
    default: UNSET,
    description:
      "Share and Stop's background under the square variants. Unset: `primary` (Accent) or `foreground` (Light).",
  },
  {
    id: "ui-cta-foreground",
    default: UNSET,
    description:
      "Share and Stop's text and glyph colour under the square variants. Unset: `primary-foreground` (Accent) or `background` (Light).",
  },
  {
    id: "ui-cta-hover",
    default: UNSET,
    description: "Share and Stop's hover background under the square variants. Unset: darkened.",
  },
  {
    id: "ui-cta-radius",
    kind: "length",
    description: "Share and Stop's corner radius under the square variants, 0.",
    default: { light: "0px" },
  },
  {
    id: "ui-cta-font",
    kind: "font",
    description: "Share's font under the square variants, `ui-font-mono`.",
    default: { light: "var(--ui-font-mono)" },
  },
  {
    id: "ui-cta-size",
    kind: "length",
    description: "Share's font size under the square variants, 12px.",
    default: { light: "12px" },
  },
  {
    id: "ui-cta-transform",
    kind: "keyword",
    description: "Share's text-transform under the square variants, `uppercase`.",
    default: { light: "uppercase" },
  },
  {
    id: "ui-cta-tracking",
    kind: "length",
    description: "Share's letter-spacing under the square variants, 0.",
    default: { light: "0px" },
  },
  {
    id: "ui-working-pulse-radius",
    kind: "length",
    default: {},
    description:
      "The square pulse working indicator's corner radius (50% makes it a dot). Unset: square.",
  },
  {
    id: "ui-context-strip-background",
    default: {},
    description: "The attached context strip's background. Unset: `sidebar`.",
  },
  {
    id: "ui-context-strip-radius",
    kind: "length",
    description: "The attached context strip's top corner radius, `ui-radius-sm`.",
    default: { light: "var(--ui-radius-sm)" },
  },
]);
