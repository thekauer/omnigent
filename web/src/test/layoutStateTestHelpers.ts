// Reads what the layout state stored for one of the keys it replaced, so tests written
// against those keys read the same value from the layout state document.
import {
  LAYOUT_STATE_STORAGE_KEY,
  LEGACY_LAYOUT_STORAGE_KEYS,
  readLayoutStateText,
} from "@/workbench/layoutState";

/**
 * The stored layout state value of the slot `legacyKey` was migrated to, or null. Typed as
 * `JSON.parse`'s result, as the tests' reads of the old keys were.
 */
export function storedLegacyLayoutValue(legacyKey: string): ReturnType<typeof JSON.parse> {
  const slot = LEGACY_LAYOUT_STORAGE_KEYS[legacyKey];
  if (!slot) throw new Error(`${legacyKey} is not a layout state key`);
  const values = readLayoutStateText(localStorage.getItem(LAYOUT_STATE_STORAGE_KEY));
  return Object.hasOwn(values, slot) ? values[slot] : null;
}
