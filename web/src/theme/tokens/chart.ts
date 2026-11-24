// Chart series colours.

import { defineTokens } from "./types.ts";

export const CHART_TOKENS = defineTokens(
  "chart",
  [
    { id: "chart-1", light: "#3b8ff5", dark: "oklch(0.64 0.22 254)" },
    { id: "chart-2", light: "#2272b4", dark: "oklch(0.65 0.14 200)" },
    { id: "chart-3", light: "#2ea65c", dark: "oklch(0.68 0.15 145)" },
    { id: "chart-4", light: "#d4972a", dark: "oklch(0.75 0.16 70)" },
    { id: "chart-5", light: "#8e99a4", dark: "oklch(0.65 0.008 240)" },
  ].map(({ id, light, dark }, index) => ({
    id,
    description: `Chart series ${index + 1}.`,
    default: { light, dark },
  })),
);
