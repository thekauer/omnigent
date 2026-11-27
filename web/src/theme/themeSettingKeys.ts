// The theme service's keys of the settings document (theming plan M10b), and how the keys
// before M10b carry into it. Pure.

import {
  SETTINGS_VALUE_LIMITS,
  type SettingsValues,
  type SettingsWrite,
} from "@/configuration/settingsDocument";
import { nullMap, type PlainData, snapshotPlainData } from "./validate";

/** The colour customizations: token ids, and `[<theme id>]` objects of them (VS Code's key). */
export const COLOR_CUSTOMIZATIONS_SETTING = "workbench.colorCustomizations";
/** The theme options: `{ "[<scope>]": { "<option id>": "<choice id>" } }`. */
export const THEME_OPTIONS_SETTING = "omnigent.themeOptions";
/** One key per style variant: `omnigent.style.density`. */
export const STYLE_SETTING_PREFIX = "omnigent.style.";

/** Whether `key` (a top-level settings key) is one of the theme service's. */
export function isThemeSettingKey(key: string): boolean {
  return (
    key === COLOR_CUSTOMIZATIONS_SETTING ||
    key === THEME_OPTIONS_SETTING ||
    key.startsWith(STYLE_SETTING_PREFIX)
  );
}

/** The keys before M10b, read into the document and removed once they are in its text. */
export const LEGACY_THEME_OPTIONS_STORAGE_KEY = "omnigent:ui-theme-options";
export const LEGACY_VARIANTS_STORAGE_KEY = "omnigent:ui-variants";
export const LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY = "omnigent:ui-color-customizations";
export const LEGACY_THEME_SETTINGS_STORAGE_KEYS = [
  LEGACY_THEME_OPTIONS_STORAGE_KEY,
  LEGACY_VARIANTS_STORAGE_KEY,
  LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY,
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What the legacy keys held, as read from storage. */
export interface LegacySettings {
  /** `omnigent:ui-theme-options`: scope (no brackets) to option choices. */
  readonly options?: unknown;
  /** `omnigent:ui-variants`: variant name to value. */
  readonly variants?: unknown;
  /** `omnigent:ui-color-customizations`. */
  readonly customizations?: unknown;
}

/**
 * The `[path, value]` writes that carry the legacy values into `existing` (the document's
 * values): options and variants over the document's, and colour customizations token by
 * token under them (a token the document sets keeps its value).
 */
export function legacyThemeSettingsWrites(
  legacy: LegacySettings,
  existing: SettingsValues = nullMap<PlainData>(),
): SettingsWrite[] {
  const writes: [string[], unknown][] = [];
  const readable = (value: unknown) => {
    const snapshot = snapshotPlainData(value ?? null, SETTINGS_VALUE_LIMITS);
    return snapshot.ok && isRecord(snapshot.value) ? snapshot.value : undefined;
  };
  const options = readable(legacy.options);
  for (const [scope, choices] of Object.entries(options ?? {})) {
    if (!isRecord(choices) || scope.length > 200 || /[[\]]/.test(scope)) continue;
    for (const [option, choice] of Object.entries(choices)) {
      if (typeof choice === "string") {
        writes.push([[THEME_OPTIONS_SETTING, `[${scope}]`, option], choice]);
      }
    }
  }
  const variants = readable(legacy.variants);
  for (const [name, value] of Object.entries(variants ?? {})) {
    if (typeof value === "string") writes.push([[`${STYLE_SETTING_PREFIX}${name}`], value]);
  }
  const customizations = readable(legacy.customizations);
  const current = existing[COLOR_CUSTOMIZATIONS_SETTING];
  const have = isRecord(current) ? current : undefined;
  for (const [key, value] of Object.entries(customizations ?? {})) {
    const path = [COLOR_CUSTOMIZATIONS_SETTING, key];
    if (key.startsWith("[") && isRecord(value)) {
      const scoped = have?.[key];
      if (scoped !== undefined && !isRecord(scoped)) continue;
      for (const [token, tokenValue] of Object.entries(value)) {
        if (!(isRecord(scoped) && Object.hasOwn(scoped, token))) {
          writes.push([[...path, token], tokenValue]);
        }
      }
    } else if (!(have && Object.hasOwn(have, key))) {
      writes.push([path, value]);
    }
  }
  return writes;
}
