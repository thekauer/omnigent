// Density tokens: the heights, padding and gaps of the hooked chrome (sidebar rows,
// buttons, the session header, the right panel's tab strip and its view title bar).
// Tailwind's `--spacing` stays as it is; the defaults are written in its steps, so
// each token computes to exactly what the utility it replaced did.

import { defineTokens } from "./types.ts";

/** `n` Tailwind spacing steps (4px each at the default `--spacing`). */
const steps = (n: number) => `calc(var(--spacing) * ${n})`;

export const DENSITY_TOKENS = defineTokens("density", [
  {
    id: "ui-row-line",
    kind: "length",
    description: "Line box of a sidebar row (`.sidebar-row`), 20px.",
    default: { light: "20px" },
  },
  {
    id: "ui-row-height",
    kind: "length",
    description:
      "Minimum height of a sidebar row: its line box plus its block padding, 28px. Set it to grow rows (34px for a roomier list); the line box stays centered.",
    default: { light: `calc(var(--ui-row-line) + ${steps(2)})` },
  },
  {
    id: "ui-control-h-xs",
    kind: "length",
    description: "Height of xs buttons and the icon-xs size, 24px.",
    default: { light: steps(6) },
  },
  {
    id: "ui-control-h-sm",
    kind: "length",
    description: "Height of sm buttons and the icon-sm size, 28px.",
    default: { light: steps(7) },
  },
  {
    id: "ui-control-h-md",
    kind: "length",
    description: "Height of default buttons and the desktop icon size, 32px.",
    default: { light: steps(8) },
  },
  {
    id: "ui-control-h-lg",
    kind: "length",
    description: "Height of lg buttons and the icon-lg size, 36px.",
    default: { light: steps(9) },
  },
  {
    id: "ui-header-height",
    kind: "length",
    description:
      "Height of the session header and the sidebar header row on desktop (`.chat-header`, `.sidebar-header-row`), 48px.",
    default: { light: steps(12) },
  },
  {
    id: "ui-tabstrip-padding-x",
    kind: "length",
    description: "Inline padding of the right panel's tab strip (`.workspace-tab-strip`), 8px.",
    default: { light: steps(2) },
  },
  {
    id: "ui-tabstrip-padding-y",
    kind: "length",
    description: "Block padding of the right panel's tab strip, 12px.",
    default: { light: steps(3) },
  },
  {
    id: "ui-tabstrip-height",
    kind: "length",
    description:
      "Minimum height of the right panel's tab strip: its padding, a 24px tab and its bottom border, 49px.",
    default: {
      light: `calc(var(--ui-tabstrip-padding-y) * 2 + ${steps(6)} + var(--ui-border-width))`,
    },
  },
  {
    id: "ui-view-title-height",
    kind: "length",
    description: "Height of a right panel view's title bar (`[data-slot=view-title]`), 44px.",
    default: { light: steps(11) },
  },
  {
    id: "ui-view-title-padding-x",
    kind: "length",
    description: "Inline padding of a view's title bar, 8px.",
    default: { light: steps(2) },
  },
  {
    id: "ui-view-title-gap",
    kind: "length",
    description: "Gap between the items of a view's title bar, 2px.",
    default: { light: "2px" },
  },
]);
