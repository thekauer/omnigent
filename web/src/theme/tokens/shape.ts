// Shape tokens: one corner radius base and the scale derived from it. Tailwind's
// `rounded-*` utilities read the scale (`@theme inline` in index.css), so a theme
// that sets `--ui-radius-base: 0` squares the whole UI.

import { defineTokens, type TokenInput, type TokenSyntax } from "./types.ts";

/** A radius derived from the base: `factor` times it. */
function derived(
  id: string,
  factor: number,
  description: string,
  syntax?: TokenSyntax,
): TokenInput {
  return {
    id,
    kind: "length",
    description,
    default: { light: `calc(var(--ui-radius-base) * ${factor})` },
    ...(syntax ? { syntax } : {}),
  };
}

/** An older radius name that now reads a scale step. */
function alias(id: string, target: string, description: string): TokenInput {
  return { id, kind: "length", description, default: { light: `var(--${target})` } };
}

// The steps xs to lg were literal px values, so they are registered and read as px;
// xl and up were `calc(var(--radius) * n)` and keep reading as that calc. The
// registered steps take lengths and percentages, so a percentage base (or a theme
// setting a step to `50%`) keeps them valid instead of zeroing them.
export const SHAPE_TOKENS = defineTokens("shape", [
  {
    id: "ui-radius-base",
    kind: "length",
    description:
      "Corner radius base, 8px. Every radius derives from it; 0 squares the UI. Declared as 0.5rem, the value `--radius` always had.",
    default: { light: "0.5rem" },
  },
  derived("ui-radius-xs", 0.25, "Radius step xs (2px), `rounded-xs`.", "<length-percentage>"),
  derived(
    "ui-radius-sm",
    0.5,
    "Radius step sm (4px), `rounded-sm` and bare `rounded`.",
    "<length-percentage>",
  ),
  derived("ui-radius-md", 0.75, "Radius step md (6px), `rounded-md`.", "<length-percentage>"),
  derived("ui-radius-lg", 1, "Radius step lg (8px), `rounded-lg`.", "<length-percentage>"),
  derived("ui-radius-xl", 1.4, "Radius step xl (11.2px), `rounded-xl`."),
  derived("ui-radius-2xl", 1.8, "Radius step 2xl (14.4px), `rounded-2xl`."),
  derived("ui-radius-3xl", 2.2, "Radius step 3xl (17.6px), `rounded-3xl`."),
  derived("ui-radius-4xl", 2.6, "Radius step 4xl (20.8px), `rounded-4xl`."),
  {
    id: "ui-radius-pill",
    kind: "length",
    description:
      "Fully rounded ends, `rounded-full`. Infinite while the base is above 0; a 0 base makes it 0 (NaN computes to 0).",
    default: { light: "calc(var(--ui-radius-base) * infinity)" },
  },
  // Radii off the scale, named by their size at the default base.
  derived(
    "ui-radius-3",
    0.375,
    "Off-scale radius, 3px at the default base.",
    "<length-percentage>",
  ),
  derived(
    "ui-radius-10",
    1.25,
    "Off-scale radius, 10px at the default base.",
    "<length-percentage>",
  ),
  derived(
    "ui-radius-12",
    1.5,
    "Off-scale radius, 12px at the default base: menus, popovers and selects.",
    "<length-percentage>",
  ),
  derived(
    "ui-radius-16",
    2,
    "Off-scale radius, 16px at the default base: composer menus and panels.",
    "<length-percentage>",
  ),
  derived(
    "ui-radius-20",
    2.5,
    "Off-scale radius, 20px at the default base: the composer and large dialogs.",
    "<length-percentage>",
  ),
  derived(
    "ui-radius-30",
    3.75,
    "Off-scale radius, 30px at the default base: dialogs.",
    "<length-percentage>",
  ),
  alias("radius", "ui-radius-base", "The shadcn radius base; an alias of ui-radius-base."),
  alias("radius-otto-button", "ui-radius-md", "Button radius; an alias of ui-radius-md (6px)."),
  alias("radius-otto-sm", "ui-radius-lg", "Small surface radius; an alias of ui-radius-lg (8px)."),
  alias("radius-otto-md", "ui-radius-12", "Surface radius; an alias of ui-radius-12 (12px)."),
]);
