// Typography tokens: the font families, weights and letter-spacing the host uses, and
// the section-label style. Tailwind's `font-sans`, `font-mono`, `font-heading` and
// `font-normal`/`-medium`/`-semibold` read them (index.css).
//
// The Appearance font setting (`--ui-font-family`, lib/uiFontPreferences.ts) is a
// layer above `ui-font-ui`: the document font is `var(--ui-font-family, var(--ui-font-ui))`.

import { defineTokens } from "./types.ts";

export const TYPOGRAPHY_TOKENS = defineTokens("typography", [
  {
    id: "ui-font-ui",
    kind: "font",
    description: "Interface font: the system UI stack. The Appearance font setting overrides it.",
    default: {
      light:
        'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
    },
  },
  {
    id: "ui-font-title",
    kind: "font",
    description: "Title and heading font, `font-heading`.",
    default: { light: "var(--ui-font-ui)" },
  },
  {
    id: "ui-font-mono",
    kind: "font",
    description: "Monospace font, `font-mono`.",
    default: { light: '"Geist Mono Variable", "JetBrains Mono", ui-monospace, monospace' },
  },
  {
    id: "ui-font-code",
    kind: "font",
    description: "Font of code surfaces: editors, terminals and diffs.",
    default: { light: "var(--ui-font-mono)" },
  },
  {
    id: "ui-font-label",
    kind: "font",
    description: "Font of section labels.",
    default: { light: "var(--ui-font-ui)" },
  },
  {
    id: "ui-weight-normal",
    kind: "number",
    description: "Body text weight, `font-normal`.",
    default: { light: "450" },
  },
  {
    id: "ui-weight-medium",
    kind: "number",
    description: "Emphasis weight, `font-medium`.",
    default: { light: "500" },
  },
  {
    id: "ui-weight-strong",
    kind: "number",
    description: "Strong weight, `font-semibold`.",
    default: { light: "600" },
  },
  {
    id: "ui-letter-spacing",
    kind: "length",
    description: "Letter-spacing of the whole interface.",
    default: { light: "0em" },
  },
  {
    id: "ui-label-size",
    kind: "length",
    description: "Section label font size.",
    default: { light: "var(--text-sm)" },
  },
  {
    id: "ui-label-transform",
    kind: "keyword",
    description: "Section label text-transform, e.g. `uppercase`.",
    default: { light: "none" },
  },
  {
    id: "ui-label-tracking",
    kind: "length",
    description: "Section label letter-spacing.",
    default: { light: "var(--ui-letter-spacing)" },
  },
  {
    id: "ui-label-weight",
    kind: "number",
    description: "Section label font weight.",
    default: { light: "var(--ui-weight-normal)" },
  },
]);
