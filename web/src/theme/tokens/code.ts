// Code surface tokens: the file viewer's (CodeMirror) washes and the syntax themes every
// highlighter colours code with (Shiki in chat and the viewers, Monaco, diffs).

import { tw } from "./tailwindPalette.ts";
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
    id: "viewer-background",
    default: {},
    description:
      "The file viewers' and Monaco's background. Unset: each surface's own (`card` in Monaco, `background` in the file viewer).",
  },
  {
    id: "viewer-gutter-background",
    default: {},
    description: "The line number gutter's background. Unset: viewer-background.",
  },
  {
    id: "viewer-gutter-foreground",
    default: {},
    description:
      "Line numbers. Unset: the surface's own (`muted-foreground` in the file viewer, the syntax theme's in Monaco).",
  },
  {
    id: "viewer-gutter-active-foreground",
    default: {},
    description:
      "The active line's number. Unset: the surface's own (`foreground` in the file viewer, the syntax theme's in Monaco).",
  },
  {
    id: "code-block-background",
    default: {},
    description:
      "The frame around chat code blocks and the terminal-styled shell blocks. Unset: `sidebar` around chat code blocks, `background` around shell blocks.",
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
  {
    id: "viewer-highlight-rgb",
    kind: "channels",
    description:
      "The comment highlight's colour as `R G B` (Monaco's comment ranges, the PDF viewer's comments and selection), used at several alphas.",
    default: { light: "250 204 21" },
  },
  {
    id: "viewer-cited-line",
    description: "Lines a chat citation points at, in Monaco.",
    default: { light: "rgba(254, 240, 138, 0.4)", dark: "rgba(161, 98, 7, 0.3)" },
  },
  {
    id: "viewer-model-background",
    description: "The 3D model viewer's canvas (a hex colour, read by three.js).",
    default: { light: "#ffffff", dark: "#0e1013" },
  },
  {
    id: "viewer-model-surface",
    description: "The 3D model viewer's default material for STL meshes (a hex colour).",
    default: { light: "#9aa0a6", dark: "#c4c9ce" },
  },
  // The Shiki code viewer's marks (shell/CodeViewer.tsx): comments, citations, matches.
  {
    id: "viewer-shiki-background",
    description: "The Shiki code viewer's background, the GitHub themes' own.",
    default: { light: "#ffffff", dark: "#0d1117" },
  },
  {
    id: "viewer-mark-cited",
    description: "Cited lines and the current find match in the Shiki code viewer.",
    default: {
      light: `color-mix(in oklab, ${tw("yellow-200")} 40%, transparent)`,
      dark: `color-mix(in oklab, ${tw("yellow-700")} 30%, transparent)`,
    },
  },
  {
    id: "viewer-mark-icon",
    description: "The Shiki code viewer's comment icon in the gutter.",
    default: { light: tw("yellow-500"), dark: tw("yellow-400") },
  },
  {
    id: "viewer-mark-line",
    description: "The gutter of a commented line in the Shiki code viewer.",
    default: {
      light: `color-mix(in oklab, ${tw("yellow-500")} 10%, transparent)`,
      dark: `color-mix(in oklab, ${tw("yellow-400")} 15%, transparent)`,
    },
  },
  {
    id: "viewer-mark-active",
    description: "The selected comment's range, or a new selection, in the Shiki code viewer.",
    default: { light: `color-mix(in oklab, ${tw("yellow-400")} 25%, transparent)` },
  },
  {
    id: "viewer-mark-range",
    description: "A comment's range in the Shiki code viewer.",
    default: {
      light: `color-mix(in oklab, ${tw("yellow-200")} 40%, transparent)`,
      dark: `color-mix(in oklab, ${tw("yellow-400")} 20%, transparent)`,
    },
  },
]);
