// Border tokens: the hairline width and the line styles of the hooked chrome and the
// shadcn primitives in components/ui. A style token sets Tailwind's
// `--tw-border-style`, so a `border-dashed` on the element still wins.

import { defineTokens } from "./types.ts";

export const BORDER_TOKENS = defineTokens("border", [
  {
    id: "ui-border-width",
    kind: "length",
    description: "Width of hairline borders: the primitives' outlines and the chrome's dividers.",
    default: { light: "1px" },
  },
  {
    id: "ui-border-style",
    kind: "keyword",
    description: "Line style of the primitives' outlines (inputs, cards, menus), e.g. `solid`.",
    default: { light: "solid" },
  },
  {
    id: "ui-divider-style",
    kind: "keyword",
    description: "Line style of the chrome's dividers, e.g. the right panel's tab strip rule.",
    default: { light: "solid" },
  },
  {
    id: "ui-divider-dashed-style",
    kind: "keyword",
    description:
      "Line style of the transcript's dashed dividers (subagent and task activity), `dashed`.",
    default: { light: "dashed" },
  },
  // The chrome's edges and the sidebar's own surface (index.css). Unset, each keeps
  // today's look.
  {
    id: "ui-sidebar-surface",
    default: {},
    description:
      "The left sidebar's own background, where it differs from the `sidebar` colour other surfaces use (code block frames, the context strip). Unset: `sidebar-background` in light, `sidebar` in dark.",
  },
  {
    id: "ui-sidebar-edge",
    default: {},
    description:
      "The sidebar's 1px right edge. Unset: a 4% foreground hairline in dark, none in light (an inset shadow instead).",
  },
  {
    id: "ui-sidebar-header-rule",
    default: {},
    description: "A 1px rule under the sidebar's header row (an inset shadow). Unset: none.",
  },
  {
    id: "ui-panel-edge",
    default: {},
    description:
      "The right panel's left edge and its tab strip rule in dark. Unset: white at 8%. In light they are `border`.",
  },
]);
