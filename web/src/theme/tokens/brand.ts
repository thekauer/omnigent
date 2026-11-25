// Brand art colours (theming decision 7: brand art is themable): the Otto mascot's
// (components/icons/OttoIcon.tsx, also the working indicator and the fallback logo).
// The Nessie glyph is `currentColor`. The logo, wordmark and favicon images come from
// the brand source (lib/branding.ts), not tokens.

import { defineTokens } from "./types.ts";

// raw-colors-data: the brand art's default colours
const SAME_IN_BOTH = (value: string) => ({ light: value, dark: value });

export const BRAND_TOKENS = defineTokens("brand", [
  { id: "brand-otto-body", description: "Otto's body.", default: SAME_IN_BOTH("#F53B9D") },
  {
    id: "brand-otto-buddy",
    description: "The starfish buddy's body.",
    default: SAME_IN_BOTH("#4DC5A0"),
  },
  {
    id: "brand-otto-buddy-shade",
    description: "The buddy's spots and shading.",
    default: SAME_IN_BOTH("#26A079"),
  },
  {
    id: "brand-otto-shade",
    description: "Otto's spots, cheeks and shading.",
    default: SAME_IN_BOTH("#E60C7F"),
  },
  {
    id: "brand-otto-eye",
    description: "The eyes' whites and glints.",
    default: SAME_IN_BOTH("#FEFEFE"),
  },
  { id: "brand-otto-pupil", description: "The pupils.", default: SAME_IN_BOTH("black") },
]);
// raw-colors-data-end
