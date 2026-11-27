// The localStorage keys that held settings before the settings document, and how each
// carries into it. The store reads them on its first read, writes their values into the
// document's text and removes them once every value is there (the M10b rule).

import {
  FILES_SORT_ORDER_SETTING,
  LEGACY_FILES_PANEL_STORAGE_KEY,
  legacyFilesSettingsWrites,
} from "@/lib/filesPanelPreferences";
import {
  LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY,
  LEGACY_THEME_OPTIONS_STORAGE_KEY,
  LEGACY_VARIANTS_STORAGE_KEY,
  legacyThemeSettingsWrites,
} from "@/theme/themeSettingKeys";
import type { SettingsValues, SettingsWrite } from "./settingsDocument";

export interface LegacySettingsSource {
  /** The keys it reads, in the order `writes` takes their values. */
  readonly storageKeys: readonly string[];
  /** The settings they carry: each key's JSON (undefined when absent or not JSON). */
  readonly writes: (values: readonly unknown[], existing: SettingsValues) => SettingsWrite[];
  /** The settings keys it writes, for the tests. */
  readonly settings?: readonly string[];
}

export const LEGACY_SETTINGS_SOURCES: readonly LegacySettingsSource[] = Object.freeze([
  {
    // Theming M10b: the theme options, style variants and colour customizations.
    storageKeys: [
      LEGACY_THEME_OPTIONS_STORAGE_KEY,
      LEGACY_VARIANTS_STORAGE_KEY,
      LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY,
    ],
    writes: ([options, variants, customizations], existing) =>
      legacyThemeSettingsWrites({ options, variants, customizations }, existing),
  },
  {
    // Layout L1: the Files and Changes tabs' sort.
    storageKeys: [LEGACY_FILES_PANEL_STORAGE_KEY],
    writes: ([preferences], existing) => legacyFilesSettingsWrites(preferences, existing),
    settings: [FILES_SORT_ORDER_SETTING],
  },
]);

/** Every legacy key: removed by a reset, imported from an older export and migrated. */
export const LEGACY_SETTINGS_STORAGE_KEYS: readonly string[] = Object.freeze(
  LEGACY_SETTINGS_SOURCES.flatMap((source) => source.storageKeys),
);
