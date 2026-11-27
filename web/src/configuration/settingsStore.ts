// The stored settings document (`omnigent:ui-settings`): read with the legacy keys carried
// into it, edited in place and saved as text, with a change event for its readers (the
// configuration service and the theme service). Never throws on read: a document it can't
// read is the defaults.

import { LEGACY_SETTINGS_SOURCES, type LegacySettingsSource } from "./legacySettings";
import {
  editSettingsText,
  migrateLegacySettings,
  readStoredSettings,
  serializeSettings,
  SETTINGS_STORAGE_KEY,
  SETTINGS_TEXT_LIMIT,
  SETTINGS_WRITE_BLOCKED,
  type SettingsWrite,
  type StoredSettings,
  storeSettings,
} from "./settingsDocument";

/** Thrown by a write the settings document refuses (it doesn't parse, or the key is locked). */
export class SettingsWriteError extends Error {
  override readonly name = "SettingsWriteError";
}

/** What changed in the document: the key paths an edit wrote, or the whole text. */
export interface SettingsDocumentChange {
  /** The paths edited; undefined when the whole text changed (a save, a reset, a reload). */
  readonly paths?: readonly (readonly string[])[];
  /** Who wrote it, as the writer passed it (a reader skips its own writes). */
  readonly origin?: unknown;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** A legacy key's value: its JSON, or nothing when it isn't JSON. */
function parseLegacy(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export class SettingsStore {
  private readonly sources: readonly LegacySettingsSource[];
  private readonly listeners = new Set<(change: SettingsDocumentChange) => void>();
  // The last document read, by the stored texts it came from: reads happen several times per
  // refresh.
  private cache: { stored: readonly (string | null)[]; settings: StoredSettings } | null = null;

  constructor(sources: readonly LegacySettingsSource[] = LEGACY_SETTINGS_SOURCES) {
    this.sources = sources;
  }

  private legacyKeys(): string[] {
    return this.sources.flatMap((source) => source.storageKeys);
  }

  /** The stored document's and the legacy keys' texts, as the cache keys on them. */
  private storedTexts(): (string | null)[] {
    return [SETTINGS_STORAGE_KEY, ...this.legacyKeys()].map(readStorage);
  }

  /**
   * The stored document, first carrying any legacy keys into it. The legacy keys are removed
   * only once their values are in the document's text (while the text doesn't parse they
   * stay, and their values apply over the last good ones).
   */
  read(): StoredSettings {
    if (typeof window === "undefined") return readStoredSettings(null);
    const stored = this.storedTexts();
    if (this.cache && this.cache.stored.every((text, index) => text === stored[index])) {
      return this.cache.settings;
    }
    const [raw = null, ...legacyRaw] = stored;
    let settings: StoredSettings;
    try {
      settings = readStoredSettings(raw);
      if (legacyRaw.some((value) => value !== null)) {
        const values = legacyRaw.map(parseLegacy);
        const writes: SettingsWrite[] = [];
        let offset = 0;
        for (const source of this.sources) {
          const own = values.slice(offset, offset + source.storageKeys.length);
          offset += source.storageKeys.length;
          if (own.every((value) => value === undefined)) continue;
          writes.push(...source.writes(own, settings.values));
        }
        const migration = migrateLegacySettings(settings, writes);
        try {
          if (migration.settings !== settings) {
            window.localStorage.setItem(
              SETTINGS_STORAGE_KEY,
              serializeSettings(migration.settings),
            );
          }
          if (migration.complete) {
            for (const legacyKey of this.legacyKeys()) window.localStorage.removeItem(legacyKey);
          }
        } catch {
          // Quota or access errors: the legacy keys stay, and are read again next time.
        }
        settings = migration.settings;
      }
    } catch (error) {
      console.warn("[settings] the settings document can't be read; the defaults apply", error);
      settings = readStoredSettings(null);
    }
    this.cache = { stored: this.storedTexts(), settings };
    return settings;
  }

  private write(settings: StoredSettings): void {
    try {
      if (settings.text.trim() === "") window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
      else window.localStorage.setItem(SETTINGS_STORAGE_KEY, serializeSettings(settings));
    } catch {
      // Quota or access errors keep the in-memory state.
    }
  }

  /** Why the document can't be written now (it doesn't parse), or null. */
  writeBlocked(): string | null {
    return this.read().valid ? null : SETTINGS_WRITE_BLOCKED;
  }

  /**
   * Sets (or with `undefined`, removes) the values at `paths` in the text, keeping its
   * comments; refused while it doesn't parse. One change event for all of them.
   */
  edit(edits: readonly SettingsWrite[], origin?: unknown): void {
    const current = this.read();
    if (!current.valid) throw new SettingsWriteError(SETTINGS_WRITE_BLOCKED);
    let text = current.text;
    for (const [path, value] of edits) {
      const edit = editSettingsText(text, path, value);
      if (!edit.ok) throw new SettingsWriteError(edit.reason);
      text = edit.text;
    }
    this.write(storeSettings(text, current.values));
    this.fire({ paths: edits.map(([path]) => path), origin });
  }

  /**
   * Stores the text as the editor saves it. A text that parses applies; one with syntax
   * errors is stored, and the last good values keep applying. Nothing is stored over the
   * size cap (false).
   */
  saveText(text: string, origin?: unknown): boolean {
    if (text.length > SETTINGS_TEXT_LIMIT) return false;
    this.write(storeSettings(text, this.read().values));
    this.fire({ origin });
    return true;
  }

  /** Removes the document and the legacy keys `legacyKeys` (all of them by default). */
  clear(origin?: unknown, legacyKeys: readonly string[] = this.legacyKeys()): void {
    try {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
      for (const key of legacyKeys) window.localStorage.removeItem(key);
    } catch {
      // Quota or access errors keep the in-memory state.
    }
    this.fire({ origin });
  }

  /** Tells the readers that something else stored the document (a settings import). */
  reload(origin?: unknown): void {
    this.fire({ origin });
  }

  /** Calls `listener` after each write; returns the unsubscribe. */
  subscribe(listener: (change: SettingsDocumentChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private fire(change: SettingsDocumentChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        console.error("[settings] a settings listener failed", error);
      }
    }
  }
}

/** The app's settings document. */
export const settingsStore = new SettingsStore();
