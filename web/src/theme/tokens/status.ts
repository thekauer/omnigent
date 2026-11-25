// Status colours. success/warning/info mirror the green/yellow/blue named hues, so
// badges and indicators share one status palette in both modes.

import { type TailwindColor, tw } from "./tailwindPalette.ts";
import { defineTokens } from "./types.ts";

const SAME_IN_BOTH = (value: string) => ({ light: value, dark: value });

// Status tones taken over from raw palette classes (`text-amber-600 dark:text-amber-500`),
// each pair as it was. `-tone` is the status's hue, used with an alpha for washes and
// borders; the `-text` tokens are text on the app's surfaces, from soft to emphasis.
const tone = (id: string, step: TailwindColor, description: string) => ({
  id,
  description,
  default: SAME_IN_BOTH(tw(step)),
});
const pair = (id: string, light: TailwindColor, dark: TailwindColor, description: string) => ({
  id,
  description,
  default: { light: tw(light), dark: tw(dark) },
});

export const STATUS_TOKENS = defineTokens("status", [
  {
    id: "success",
    description: "Success, the green status hue.",
    default: SAME_IN_BOTH("#2ea65c"),
  },
  {
    id: "warning",
    description: "Warning, the yellow status hue.",
    default: SAME_IN_BOTH("#d4972a"),
  },
  {
    id: "info",
    description: "Information, the blue status hue.",
    default: SAME_IN_BOTH("#3b8ff5"),
  },
  { id: "status-blue", description: "Named blue status hue.", default: SAME_IN_BOTH("#3b8ff5") },
  { id: "status-green", description: "Named green status hue.", default: SAME_IN_BOTH("#2ea65c") },
  {
    id: "status-yellow",
    description: "Named yellow status hue.",
    default: SAME_IN_BOTH("#d4972a"),
  },
  { id: "status-red", description: "Named red status hue.", default: SAME_IN_BOTH("#f04858") },
  { id: "status-gray", description: "Named gray status hue.", default: SAME_IN_BOTH("#8e99a4") },

  tone("ui-success-tone", "green-500", "The success hue for washes, borders and dots."),
  tone("ui-warning-tone", "amber-500", "The warning hue for washes, borders and icons."),
  tone("ui-danger-tone", "red-500", "The danger hue for washes, borders and dots."),
  tone("ui-merged-tone", "purple-500", "The merged (pull request) hue for washes and borders."),
  pair("ui-success-text", "green-600", "green-400", "Success text and icons."),
  pair("ui-success-text-strong", "green-700", "green-400", "Success text on a success wash."),
  pair("ui-success-text-emphasis", "green-700", "green-300", "Success text in a success banner."),
  pair("ui-warning-text", "amber-600", "amber-500", "Warning text and icons."),
  pair("ui-warning-text-soft", "amber-600", "amber-400", "Warning text in file lists and hints."),
  pair("ui-warning-text-strong", "amber-700", "amber-400", "Warning text on a warning wash."),
  pair("ui-warning-text-emphasis", "amber-700", "amber-300", "Warning text in a warning banner."),
  pair("ui-danger-text", "red-600", "red-400", "Danger text and icons."),
  pair("ui-danger-text-strong", "red-700", "red-400", "Danger text on a danger wash."),
  pair("ui-info-text", "blue-600", "blue-400", "Information text and icons."),
  pair("ui-info-text-strong", "blue-700", "blue-400", "Information text on a wash."),
  pair("ui-merged-text-strong", "purple-700", "purple-400", "Merged (pull request) text."),
  pair("ui-warning-banner-background", "amber-100", "amber-950", "A warning banner's background."),
  {
    id: "ui-warning-banner-border",
    description: "A warning banner's border.",
    default: {
      light: tw("amber-300"),
      dark: `color-mix(in oklab, ${tw("amber-700")} 60%, transparent)`,
    },
  },
  pair("ui-warning-banner-foreground", "amber-900", "amber-100", "A warning banner's text."),
  pair(
    "ui-warning-banner-hover",
    "amber-200",
    "amber-900",
    "A warning banner's button under the pointer.",
  ),
  {
    id: "ui-warning-callout-border",
    description: "A warning badge's border (the new session's harness warnings).",
    default: {
      light: tw("amber-300"),
      dark: `color-mix(in oklab, ${tw("amber-500")} 30%, transparent)`,
    },
  },
  {
    id: "ui-warning-callout-background",
    description: "A warning badge's background.",
    default: {
      light: tw("amber-50"),
      dark: `color-mix(in oklab, ${tw("amber-500")} 10%, transparent)`,
    },
  },
  {
    id: "ui-warning-chip-border",
    description: "A warning chip button's border (Set up an agent).",
    default: {
      light: tw("amber-300"),
      dark: `color-mix(in oklab, ${tw("amber-500")} 40%, transparent)`,
    },
  },
  {
    id: "ui-warning-chip-hover",
    description: "A warning chip button under the pointer.",
    default: {
      light: tw("amber-100"),
      dark: `color-mix(in oklab, ${tw("amber-500")} 20%, transparent)`,
    },
  },
  tone("ui-warning-chip-ring", "amber-400", "A warning chip button's focus ring."),
  tone("ui-merge-button", "green-600", "The pull request merge button (GitHub's green)."),
  pair("ui-merge-button-hover", "green-700", "green-500", "The merge button under the pointer."),
  tone("ui-merge-button-foreground", "white", "The merge button's text."),
]);
