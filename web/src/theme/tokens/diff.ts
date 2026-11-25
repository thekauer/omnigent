// Diff tokens, read by every diff's shared stylesheet (lib/diffTheme.ts DIFF_PALETTE_CSS)
// inside the diff component's shadow root.
//
// The colours have no default: unset, the diff component keeps its own (and the syntax
// theme's). The mix percentages are per scheme, because a diff picks its light or dark
// tint with `light-dark()` from its own colour scheme; `diff-*-mix` overrides both.

import { defineTokens, type TokenInput } from "./types.ts";

const UNSET = {};

function mix(name: string, light: string, dark: string, what: string): TokenInput[] {
  return [
    {
      id: `diff-${name}-mix`,
      kind: "percentage",
      default: UNSET,
      description: `${what} in both schemes; unset by default (diff-${name}-mix-light and -dark apply).`,
    },
    {
      id: `diff-${name}-mix-light`,
      kind: "percentage",
      default: { light },
      description: `${what} in a light diff, ${light}.`,
    },
    {
      id: `diff-${name}-mix-dark`,
      kind: "percentage",
      default: { light: dark },
      description: `${what} in a dark diff, ${dark}.`,
    },
  ];
}

export const DIFF_TOKENS = defineTokens("diff", [
  {
    id: "diff-addition-base",
    default: UNSET,
    description: "The base colour added lines and words are tinted from. Unset: the diff's green.",
  },
  {
    id: "diff-deletion-base",
    default: UNSET,
    description: "The base colour deleted lines and words are tinted from. Unset: the diff's red.",
  },
  {
    id: "diff-addition-text",
    default: UNSET,
    description: "Line numbers of added lines. Unset: the diff's own.",
  },
  {
    id: "diff-deletion-text",
    default: UNSET,
    description: "Line numbers of deleted lines. Unset: the diff's own.",
  },
  {
    id: "diff-number-text",
    default: UNSET,
    description: "Line numbers of context lines. Unset: the diff's own.",
  },
  {
    id: "diff-word-mix",
    kind: "alpha",
    default: UNSET,
    description: "Alpha of changed words' tint over the base colour. Unset: the diff's own.",
  },
  ...mix("line", "12%", "20%", "How far a changed line's background mixes towards its base colour"),
  ...mix("gutter", "9%", "15%", "How far a changed line's gutter mixes towards its base colour"),
  ...mix("hover", "3%", "9%", "How far the hovered line mixes towards the hover colour"),
]);
