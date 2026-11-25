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
]);
