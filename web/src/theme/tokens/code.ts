// Code surface tokens: the file viewer's (CodeMirror) washes and the syntax themes every
// highlighter colours code with (Shiki in chat and the viewers, Monaco, diffs).

import { defineTokens } from "./types.ts";

export const CODE_TOKENS = defineTokens("code", [
  {
    id: "viewer-active-line",
    description:
      "The file viewer's active line wash, faint enough that code on a commented or cited active line stays readable.",
    default: { light: "color-mix(in oklch, var(--foreground) 3%, transparent)" },
  },
  {
    id: "viewer-search-match",
    description: "A find match in the file viewer.",
    default: { light: "color-mix(in oklch, var(--warning) 30%, transparent)" },
  },
  {
    id: "viewer-search-match-selected",
    description: "The current find match in the file viewer.",
    default: { light: "color-mix(in oklch, var(--warning) 70%, transparent)" },
  },
  {
    id: "viewer-selection-match",
    description: "Other occurrences of the selected text in the file viewer.",
    default: { light: "color-mix(in oklch, var(--primary) 16%, transparent)" },
  },
  {
    id: "code-selected-line",
    default: {},
    description:
      "Selected lines in diffs. Unset by default: the sidebar's active row colour (`sidebar-active`).",
  },
  {
    id: "syntax-theme-light",
    kind: "keyword",
    description:
      "The syntax theme code is coloured with in light mode: a bundled Shiki theme's name or one registered from a theme's `tokenColors`.",
    default: { light: "github-light" },
  },
  {
    id: "syntax-theme-dark",
    kind: "keyword",
    description: "The syntax theme code is coloured with in dark mode, as syntax-theme-light.",
    default: { light: "github-dark" },
  },
]);
