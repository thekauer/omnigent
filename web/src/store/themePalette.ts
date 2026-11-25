import { useSyncExternalStore } from "react";

import { DEFAULT_PALETTE, isThemeSelection, type ThemeSelection } from "@/lib/themePalette";
import { themeService, type ThemeListEntry } from "@/theme/themeService";

// The committed theme, shared by Settings and the theme picker so a choice made in one
// shows in the other: the theme service's choice (a built-in palette or a contributed
// theme). Previews never change it.

function subscribe(listener: () => void): () => void {
  return themeService.onDidChange(listener);
}

/** The chosen theme's list id: a built-in palette's id, else a contributed theme's. */
export function useThemeChoice(): string {
  return useSyncExternalStore(
    subscribe,
    () => themeService.getChoice(),
    () => DEFAULT_PALETTE,
  );
}

/** The chosen built-in palette; the default while a contributed theme is chosen. */
export function useThemePaletteSelection(): ThemeSelection {
  const choice = useThemeChoice();
  return isThemeSelection(choice) ? choice : DEFAULT_PALETTE;
}

/** The theme list ({@link themeService.entries}), recomputed when the service changes. */
export function useThemeEntries(): readonly ThemeListEntry[] {
  const version = useSyncExternalStore(
    subscribe,
    () => themeService.getVersion(),
    () => 0,
  );
  return entriesAt(version);
}

// One list per service version, shared by every reader (a stable snapshot for React).
let cachedVersion = -1;
let cachedEntries: readonly ThemeListEntry[] = [];
function entriesAt(version: number): readonly ThemeListEntry[] {
  if (version !== cachedVersion) {
    cachedVersion = version;
    cachedEntries = themeService.entries();
  }
  return cachedEntries;
}

/** Persists and applies a theme choice (a palette or a contributed theme's id). */
export function commitThemePalette(selection: string): void {
  themeService.select(selection);
}

/** Re-reads the stored choice after something else wrote it, such as a settings import. */
export function reloadThemePalette(): void {
  themeService.reload();
}
