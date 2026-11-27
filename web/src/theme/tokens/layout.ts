// Layout tokens (layout plan L5): the default, smallest and largest widths of the side bars
// and the activity bar's width, so a theme sets them (a `clamp(220px, 20vw, 280px)`
// side bar) and a product locks them (`lockedTokens`). A drag's width is layout state, clamped
// to the min and max; double-clicking the edge or View: Reset Layout returns to the default.

import { defineTokens } from "./types.ts";

export const LAYOUT_TOKENS = defineTokens("layout", [
  {
    id: "ui-sidebar-width",
    kind: "length",
    description: "Default width of the primary side bar, 320px.",
    default: { light: "320px" },
  },
  {
    id: "ui-sidebar-min-width",
    kind: "length",
    description: "Smallest width the primary side bar is dragged to, 220px.",
    default: { light: "220px" },
  },
  {
    id: "ui-sidebar-max-width",
    kind: "length",
    description: "Largest width the primary side bar is dragged to, half the window (50vw).",
    default: { light: "50vw" },
  },
  {
    id: "ui-auxiliarybar-width",
    kind: "length",
    description:
      "Default width of the secondary side bar (the workspace rail), about a third of the window: clamp(420px, 36vw, 600px).",
    default: { light: "clamp(420px, 36vw, 600px)" },
  },
  {
    id: "ui-auxiliarybar-min-width",
    kind: "length",
    description: "Smallest width the secondary side bar is dragged to, 240px.",
    default: { light: "240px" },
  },
  {
    id: "ui-auxiliarybar-max-width",
    kind: "length",
    description:
      "Largest width the secondary side bar is dragged to, 99vw (the chat column's minimum binds first).",
    default: { light: "99vw" },
  },
  {
    id: "ui-activitybar-width",
    kind: "length",
    description: "Width of the activity bar beside the primary side bar, 48px.",
    default: { light: "48px" },
  },
  {
    id: "ui-titlebar-height",
    kind: "length",
    description: "Height of the title bar (`window.titleBar.visible`), 48px.",
    default: { light: "48px" },
  },
]);
