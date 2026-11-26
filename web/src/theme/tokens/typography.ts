// Typography tokens: the font families, weights and letter-spacing the host uses, and
// the label style the `.ui-label` hook class reads (index.css): the sidebar section
// labels, the right panel's view titles and the transcript's fold row. Tailwind's `font-sans`, `font-mono`, `font-heading` and
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
    description:
      "Font of section labels and the other `.ui-label` sites, under the Appearance font setting.",
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
    id: "ui-code-letter-spacing",
    kind: "length",
    default: {},
    description:
      "Letter-spacing of code text (`pre`, `code`, `kbd`, `samp`), e.g. 0 under a tracked interface. Unset: inherited.",
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
  // The other `.ui-label` sites share the label font, case and tracking, and keep
  // their own size and weight; a theme that wants one label style sets these to
  // `var(--ui-label-size)` and `var(--ui-label-weight)`.
  {
    id: "ui-view-title-size",
    kind: "length",
    description: "Font size of a right panel view's title (`[data-slot=view-title-label]`).",
    default: { light: "var(--text-ui)" },
  },
  {
    id: "ui-view-title-weight",
    kind: "number",
    description: "Font weight of a right panel view's title.",
    default: { light: "var(--ui-weight-medium)" },
  },
  {
    id: "ui-fold-label-size",
    kind: "length",
    description:
      "Font size of the transcript's fold row label, `Worked for 5s` (`[data-slot=fold-label]`). Its weight is ui-label-weight.",
    default: { light: "var(--text-ui)" },
  },
  // The app name the sidebar header shows when the branding (a theme's `brand.appName`
  // or the server's) sets one, in place of the wordmark image.
  {
    id: "ui-app-name-font",
    kind: "font",
    default: {},
    description: "Font of the sidebar's app name. Unset: the interface font.",
  },
  {
    id: "ui-app-name-size",
    kind: "length",
    description: "Font size of the sidebar's app name, 15px.",
    default: { light: "15px" },
  },
  {
    id: "ui-app-name-weight",
    kind: "number",
    description: "Font weight of the sidebar's app name, `ui-weight-strong`.",
    default: { light: "var(--ui-weight-strong)" },
  },
  {
    id: "ui-app-name-tracking",
    kind: "length",
    description: "Letter-spacing of the sidebar's app name, -0.025em.",
    default: { light: "-0.025em" },
  },
]);
