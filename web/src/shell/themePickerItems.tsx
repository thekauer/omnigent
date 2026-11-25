// Rows of the "Select theme" picker: the current theme, the Appearance page,
// Omnigent Default, then the built-in themes and Custom, then each extension's themes
// under its name (the theme service's list, shared with Settings > Appearance).

import { ContrastIcon } from "lucide-react";

import { PaletteChip } from "@/components/theme/AppearancePreviews";
import type { ThemeMode } from "@/components/theme/themeMode";
import { THEME_MODE_OPTIONS, themeModeLabel } from "@/components/theme/themeModeOptions";
import type { QuickPickItem } from "@/components/ui/quick-pick";
import { DEFAULT_PALETTE, PALETTES, type PaletteSwatch } from "@/lib/themePalette";
import type { ThemeListEntry } from "@/theme/themeService";

export type ThemePickerPageId = "themes" | "appearance";

export type ThemePickerValue =
  { kind: "theme"; id: string } | { kind: "appearance" } | { kind: "mode"; mode: ThemeMode };

export const CURRENT_THEME_ITEM_ID = "theme:current";
export const APPEARANCE_ITEM_ID = "theme:appearance";
export const DEFAULT_THEME_ITEM_ID = "theme:default";

/** The built-in themes' group; an extension's themes are grouped under its name. */
export const THEMES_GROUP = "Themes";

/** A theme row's id: `theme:palette:<id>` for a built-in, `theme:<id>` for an extension's. */
export function themeItemId(entry: Pick<ThemeListEntry, "id" | "builtIn">): string {
  return entry.builtIn ? `theme:palette:${entry.id}` : `theme:${entry.id}`;
}

export function modeItemId(mode: ThemeMode): string {
  return `appearance:${mode}`;
}

export const DEFAULT_THEME_LABEL = "Omnigent Default";
export const UNAVAILABLE_LABEL = "Unavailable";

export interface ThemePickerContext {
  /** The theme list (`themeService.entries()`). */
  entries: readonly ThemeListEntry[];
  /** The committed theme's list id. */
  choice: string;
  mode: ThemeMode;
  /** Chips render in the mode the app shows now. */
  isDark: boolean;
  /** Embedded in Databricks, System follows the workspace. */
  followsHost: boolean;
  customSwatches: { light: PaletteSwatch; dark: PaletteSwatch };
}

const FALLBACK_SWATCH = PALETTES[0]!;

/** The swatch an entry shows in a mode: its own, the other mode's, or the default's. */
export function entrySwatch(
  entry: ThemeListEntry | undefined,
  isDark: boolean,
  customSwatches: { light: PaletteSwatch; dark: PaletteSwatch },
): PaletteSwatch {
  const mode = isDark ? "dark" : "light";
  if (entry?.custom) return customSwatches[mode];
  return (
    entry?.swatches[mode] ?? entry?.swatches[isDark ? "light" : "dark"] ?? FALLBACK_SWATCH[mode]
  );
}

/** An entry's name: "Omnigent Default" for the default palette, else its label. */
export function themeEntryLabel(entry: ThemeListEntry | undefined): string {
  if (!entry || entry.id === DEFAULT_PALETTE) return DEFAULT_THEME_LABEL;
  return entry.label;
}

/** "Dark only" for a theme that forces its mode, else nothing. */
export function forcedModeLabel(entry: ThemeListEntry | undefined): string | undefined {
  if (!entry?.forcedMode) return undefined;
  return entry.forcedMode === "dark" ? "Dark only" : "Light only";
}

function chip(entry: ThemeListEntry | undefined, context: ThemePickerContext) {
  return <PaletteChip swatch={entrySwatch(entry, context.isDark, context.customSwatches)} />;
}

function themeItem(
  entry: ThemeListEntry,
  context: ThemePickerContext,
): QuickPickItem<ThemePickerValue> {
  const current = entry.id === context.choice;
  return {
    id: themeItemId(entry),
    label: themeEntryLabel(entry),
    description: forcedModeLabel(entry),
    keywords: [
      ...(entry.description ? [entry.description] : []),
      ...(entry.custom ? ["your colors", "edit in settings"] : []),
      ...(entry.builtIn ? [] : [entry.groupLabel]),
    ],
    group: entry.builtIn ? THEMES_GROUP : entry.groupLabel,
    icon: chip(entry, context),
    detail: !entry.available ? UNAVAILABLE_LABEL : current ? "Current" : undefined,
    ...(entry.available
      ? {}
      : { disabledReason: `${UNAVAILABLE_LABEL}: its extension isn't installed` }),
    rememberInHistory: false,
    value: { kind: "theme", id: entry.id },
  };
}

/** The root page. */
export function themePageItems(context: ThemePickerContext): QuickPickItem<ThemePickerValue>[] {
  const modeLabel = themeModeLabel(context.mode, context.followsHost);
  const isDefault = context.choice === DEFAULT_PALETTE;
  const current = context.entries.find((entry) => entry.id === context.choice);
  const defaultEntry = context.entries.find((entry) => entry.id === DEFAULT_PALETTE);
  const currentDetail = [
    themeEntryLabel(current),
    ...(current && !current.available ? [UNAVAILABLE_LABEL] : []),
    forcedModeLabel(current) ?? modeLabel,
  ].join(" · ");
  const items: QuickPickItem<ThemePickerValue>[] = [
    {
      id: CURRENT_THEME_ITEM_ID,
      label: isDefault ? DEFAULT_THEME_LABEL : "Current theme",
      detail: isDefault ? modeLabel : currentDetail,
      keywords: ["current", "keep"],
      icon: chip(current, context),
      rememberInHistory: false,
      value: { kind: "theme", id: context.choice },
    },
    {
      id: APPEARANCE_ITEM_ID,
      label: "Appearance",
      detail: modeLabel,
      keywords: ["mode", "light", "dark", "system"],
      icon: <ContrastIcon />,
      opensPage: true,
      rememberInHistory: false,
      value: { kind: "appearance" },
    },
  ];
  if (!isDefault && defaultEntry) {
    items.push({
      id: DEFAULT_THEME_ITEM_ID,
      label: DEFAULT_THEME_LABEL,
      keywords: ["default", "reset", "omnigent", "pink"],
      icon: chip(defaultEntry, context),
      rememberInHistory: false,
      value: { kind: "theme", id: DEFAULT_PALETTE },
    });
  }
  for (const entry of context.entries) {
    if (entry.id === DEFAULT_PALETTE) continue;
    items.push(themeItem(entry, context));
  }
  return items;
}

const MODE_DESCRIPTIONS: Record<ThemeMode, { standalone: string; embedded: string }> = {
  system: { standalone: "Follow your system", embedded: "Follow Databricks" },
  light: { standalone: "Always light", embedded: "Always light" },
  dark: { standalone: "Always dark", embedded: "Always dark" },
};

/** The Appearance page: System, Light, Dark. */
export function appearancePageItems(
  context: Pick<ThemePickerContext, "mode" | "followsHost">,
): QuickPickItem<ThemePickerValue>[] {
  return THEME_MODE_OPTIONS.map(({ mode, icon: Icon }) => ({
    id: modeItemId(mode),
    label: themeModeLabel(mode, context.followsHost),
    description: MODE_DESCRIPTIONS[mode][context.followsHost ? "embedded" : "standalone"],
    detail: mode === context.mode ? "Current" : undefined,
    icon: <Icon />,
    rememberInHistory: false,
    value: { kind: "mode", mode },
  }));
}
