// The Files and Changes tabs' settings in the settings document (layout plan L1):
// `omnigent.files.sortOrder`, the app-global sort of the changed files and the Files tab, and
// `omnigent.files.showHidden`, whether a workspace shows dot files until its eye toggle says
// otherwise. The built-in `omnigent.files` extension registers both; this module holds their
// names, defaults and the migration of the key the sort was kept in before.

import type { SettingsValues, SettingsWrite } from "@/configuration/settingsDocument";
import { type ChangedSort, isValidSort } from "@/lib/changedSort";

export const FILES_SORT_ORDER_SETTING = "omnigent.files.sortOrder";
export const FILES_SHOW_HIDDEN_SETTING = "omnigent.files.showHidden";

// Alphabetical, with folders first in the tree; the other sorts stay a choice away.
export const DEFAULT_FILES_SORT_ORDER: ChangedSort = "alpha";
// Hidden (dot-prefixed) files are shown by default; the eye toggle hides them.
export const DEFAULT_FILES_SHOW_HIDDEN = true;

/** Where the sort was kept before the settings document: `{ "sort": "<order>" }`. */
export const LEGACY_FILES_PANEL_STORAGE_KEY = "omnigent:files-panel-preferences";

/** The sort `value` names, or undefined. */
export function filesSortOrder(value: unknown): ChangedSort | undefined {
  return typeof value === "string" && isValidSort(value) ? value : undefined;
}

/**
 * The write that carries the legacy key's sort into the document's values `existing`, unless
 * the document sets the sort already. An unreadable or unknown sort carries nothing.
 */
export function legacyFilesSettingsWrites(
  legacy: unknown,
  existing: SettingsValues,
): SettingsWrite[] {
  if (typeof legacy !== "object" || legacy === null || Array.isArray(legacy)) return [];
  const sort = filesSortOrder((legacy as Record<string, unknown>).sort);
  if (sort === undefined || Object.hasOwn(existing, FILES_SORT_ORDER_SETTING)) return [];
  return [[[FILES_SORT_ORDER_SETTING], sort]];
}
