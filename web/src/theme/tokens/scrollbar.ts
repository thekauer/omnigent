// Scrollbar tokens, read by the `.ui-scroll` hook class (index.css) and the
// transcript's own scrollbar (pages/TranscriptScrollbar.tsx).
//
// The colours have no default: unset, every surface keeps the colours it has today
// (the browser's own thin scrollbar where it draws one, the border colour on WebKit's
// styled bars, the transcript's translucent foreground). A theme that sets them
// colours all of them alike.

import { defineTokens } from "./types.ts";

// No value in either mode: the token stays unset, so the readers' `var()` fallbacks apply.
const UNSET = {};

export const SCROLLBAR_TOKENS = defineTokens("scrollbar", [
  {
    id: "ui-scrollbar-width",
    kind: "keyword",
    description:
      "`scrollbar-width` of `.ui-scroll` containers, `thin`. `auto` lets WebKit draw the bar styled by the other tokens.",
    default: { light: "thin" },
  },
  {
    id: "ui-scrollbar-size",
    kind: "length",
    description: "Width of WebKit's styled scrollbar in `.ui-scroll` containers, 8px.",
    default: { light: "calc(var(--spacing) * 2)" },
  },
  {
    id: "ui-scrollbar-thumb",
    default: UNSET,
    description: "Scrollbar thumb colour. Unset by default: each surface keeps its own.",
  },
  {
    id: "ui-scrollbar-thumb-hover",
    default: UNSET,
    description: "Scrollbar thumb colour on hover. Unset by default: each surface keeps its own.",
  },
  {
    id: "ui-scrollbar-track",
    default: UNSET,
    description: "Scrollbar track colour. Unset by default: transparent.",
  },
]);
