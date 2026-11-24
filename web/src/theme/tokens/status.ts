// Status colours. success/warning/info mirror the green/yellow/blue named hues, so
// badges and indicators share one status palette in both modes.

import { defineTokens } from "./types.ts";

const SAME_IN_BOTH = (value: string) => ({ light: value, dark: value });

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
]);
