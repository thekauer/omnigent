// Workbench colour tokens: the palette tokens every built-in palette sets, then the
// colours and surfaces with one host default per mode.

import { defineTokens, type TokenDef } from "./types.ts";

/**
 * Tokens every palette sets, in the generated stylesheet's order. `palette` is the
 * `PaletteTokens` key; the default is the default palette's value.
 */
export const PALETTE_TOKENS = [
  { id: "background", palette: "background", description: "Page canvas." },
  { id: "foreground", palette: "foreground", description: "Body text." },
  { id: "card", palette: "card", description: "Card and panel surface, may be translucent." },
  {
    id: "card-solid",
    palette: "cardSolid",
    description: "Opaque card surface, for cards that must hide what is behind them.",
  },
  { id: "card-foreground", palette: "cardForeground", description: "Text on cards." },
  {
    id: "tray",
    palette: "tray",
    description: "Translucent tray surface on the page, used with an opacity modifier.",
  },
  { id: "popover", palette: "popover", description: "Popover and menu surface." },
  { id: "popover-foreground", palette: "popoverForeground", description: "Text on popovers." },
  { id: "primary", palette: "primary", description: "Primary accent." },
  { id: "link", palette: "link", description: "Link text." },
  { id: "primary-foreground", palette: "primaryForeground", description: "Text on primary." },
  {
    id: "selection-background",
    palette: "selectionBackground",
    description: "Text selection wash.",
  },
  { id: "selection-foreground", palette: "selectionForeground", description: "Selected text." },
  {
    id: "code-selection",
    palette: "codeSelection",
    description: "Selection in the code viewer, under the text.",
  },
  { id: "secondary", palette: "secondary", description: "Secondary surface." },
  {
    id: "secondary-foreground",
    palette: "secondaryForeground",
    description: "Text on secondary.",
  },
  { id: "muted", palette: "muted", description: "Muted surface." },
  { id: "muted-foreground", palette: "mutedForeground", description: "Muted text." },
  { id: "code-bg", palette: "codeBackground", description: "Code block and inline code surface." },
  { id: "accent", palette: "accent", description: "Hover and active row surface." },
  { id: "accent-foreground", palette: "accentForeground", description: "Text on accent." },
  { id: "border", palette: "border", description: "Default border and divider." },
  { id: "border-strong", palette: "borderStrong", description: "Higher-contrast border." },
  { id: "button-border", palette: "buttonBorder", description: "Neutral button border." },
  { id: "input", palette: "input", description: "Input border." },
  { id: "ring", palette: "ring", description: "Focus ring." },
  { id: "brand-accent", palette: "brandAccent", description: "Brand accent for brand moments." },
  { id: "sidebar", palette: "sidebar", description: "Sidebar surface colour." },
  { id: "sidebar-foreground", palette: "sidebarForeground", description: "Sidebar text." },
  { id: "sidebar-primary", palette: "sidebarPrimary", description: "Sidebar primary accent." },
  {
    id: "sidebar-primary-foreground",
    palette: "sidebarPrimaryForeground",
    description: "Text on the sidebar primary accent.",
  },
  { id: "sidebar-accent", palette: "sidebarAccent", description: "Sidebar hover surface." },
  {
    id: "sidebar-accent-foreground",
    palette: "sidebarAccentForeground",
    description: "Text on the sidebar hover surface.",
  },
  { id: "sidebar-border", palette: "sidebarBorder", description: "Sidebar border." },
  { id: "sidebar-ring", palette: "sidebarRing", description: "Sidebar focus ring." },
  { id: "sidebar-active", palette: "sidebarActive", description: "Active sidebar row surface." },
  {
    id: "sidebar-active-foreground",
    palette: "sidebarActiveForeground",
    description: "Active sidebar row text.",
  },
  {
    id: "sidebar-background",
    palette: "sidebarBackground",
    kind: "image",
    description: "Sidebar background, a colour or gradients.",
  },
  {
    id: "shell-background",
    palette: "shellBackground",
    kind: "image",
    description: "App shell background, a colour or gradients.",
  },
] as const satisfies readonly (Pick<TokenDef, "id" | "description"> & {
  palette: string;
  kind?: TokenDef["kind"];
})[];

/** Workbench colours and surfaces no palette sets. */
export const WORKBENCH_TOKENS = defineTokens("workbench", [
  {
    id: "foreground-tertiary",
    description: "Tertiary text for lighter, disabled and placeholder labels.",
    default: { light: "#a1a1aa", dark: "rgb(245 245 244 / 24%)" },
  },
  {
    id: "border-weak",
    description: "Weaker panel border for low-contrast dividers.",
    default: { light: "#ececee" },
  },
  {
    id: "button-icon-hover-color",
    description: "Icon button glyph on hover.",
    default: { light: "#27272a" },
  },
  {
    id: "primary-cta",
    description: "Call-to-action button surface.",
    default: { light: "#11171c", dark: "#e8ecf0" },
  },
  {
    id: "primary-cta-foreground",
    description: "Text on the call-to-action button.",
    default: { light: "#fff", dark: "#11171c" },
  },
  {
    id: "destructive",
    description: "Destructive action and error colour.",
    default: { light: "#c8324c", dark: "#e65b77" },
  },
  {
    id: "destructive-foreground",
    description: "Text on destructive surfaces.",
    default: { light: "#fff", dark: "#fff" },
  },
  {
    id: "search-match-foreground",
    description: "Matched text in finders, readable on popovers and their active row.",
    default: { light: "#7b5300", dark: "#efb14a" },
  },
  {
    id: "session-active",
    description: "Session active and idle-alive blue for sub-agent states.",
    default: { light: "#2f7fd4", dark: "#5ca4f5" },
  },
  {
    id: "tag-pink",
    description: "Pink tag surface, a translucent wash.",
    default: { light: "rgba(240, 1, 150, 0.06)", dark: "rgba(240, 1, 150, 0.15)" },
  },
  {
    id: "tooltip-bg",
    description: "Tooltip surface in dark mode.",
    default: { dark: "#2a2440" },
  },
  {
    id: "onboarding-wizard-background",
    description: "Onboarding wizard page surface behind its card.",
    default: { light: "#fcfbfb", dark: "#131315" },
  },
  {
    id: "onboarding-modal-border",
    description: "Onboarding modal border.",
    default: { light: "#0000001a", dark: "#ffffff14" },
  },
  // Surfaces.
  {
    id: "app-shell-bg",
    description: "App shell canvas in dark mode.",
    default: { dark: "var(--background)" },
  },
  {
    id: "session-composer-mask-bg",
    description: "Mask behind the session composer in dark mode.",
    default: { dark: "var(--app-shell-bg)" },
  },
  {
    id: "sidebar-surface-image",
    kind: "image",
    description: "Gradients over the dark sidebar surface.",
    default: {
      dark: "linear-gradient(transparent 35%, rgb(255 255 255 / 6%)), linear-gradient(135deg, rgb(255 255 255 / 4%), transparent 60%)",
    },
  },
  {
    id: "composer-header-bg",
    description: "Composer header strip.",
    default: {
      light: "color-mix(in srgb, var(--background) 94%, black)",
      dark: "color-mix(in srgb, var(--app-shell-bg) 97%, white)",
    },
  },
  {
    id: "composer-surface-bg",
    description: "Composer surface in dark mode.",
    default: { dark: "color-mix(in srgb, var(--app-shell-bg) 95%, white)" },
  },
  {
    id: "menu-surface-bg",
    description: "Menu surface in dark mode.",
    default: { dark: "var(--composer-surface-bg)" },
  },
  {
    id: "card-surface-bg",
    description: "Card surface in dark mode.",
    default: {
      dark: "color-mix(in srgb, color-mix(in srgb, var(--card) 95%, white) 75%, transparent)",
    },
  },
  {
    id: "menu-surface-border",
    description: "Menu surface border in dark mode.",
    default: { dark: "rgb(255 255 255 / 8%)" },
  },
  {
    id: "segmented-active-bg",
    description: "Active segment of a segmented control in dark mode.",
    default: { dark: "rgb(255 255 255 / 12%)" },
  },
  {
    id: "segmented-inactive-bg",
    description: "Inactive segment of a segmented control in dark mode.",
    default: { dark: "transparent" },
  },
  {
    id: "segmented-trough-bg",
    description: "Segmented control trough in dark mode.",
    default: { dark: "rgb(255 255 255 / 6%)" },
  },
]);
