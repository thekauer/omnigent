import { afterEach, describe, expect, it } from "vitest";

import { LEGACY_FILES_PANEL_STORAGE_KEY } from "@/lib/filesPanelPreferences";
import { LEGACY_VARIANTS_STORAGE_KEY } from "@/theme/themeSettingKeys";
import { LEGACY_SETTINGS_STORAGE_KEYS } from "./legacySettings";
import { readStoredSettings, SETTINGS_STORAGE_KEY, SETTINGS_TEXT_LIMIT } from "./settingsDocument";
import { type SettingsDocumentChange, SettingsStore, SettingsWriteError } from "./settingsStore";

const stored = () => readStoredSettings(localStorage.getItem(SETTINGS_STORAGE_KEY));

afterEach(() => localStorage.clear());

describe("SettingsStore", () => {
  it("carries every legacy source into one document, and removes them all once it can", () => {
    localStorage.setItem(LEGACY_VARIANTS_STORAGE_KEY, JSON.stringify({ density: "compact" }));
    localStorage.setItem(LEGACY_FILES_PANEL_STORAGE_KEY, JSON.stringify({ sort: "size" }));
    const store = new SettingsStore();
    expect(store.read().values).toEqual({
      "omnigent.style.density": "compact",
      "omnigent.files.sortOrder": "size",
    });
    for (const key of LEGACY_SETTINGS_STORAGE_KEYS) expect(localStorage.getItem(key)).toBeNull();
  });

  it("keeps the legacy keys while the text doesn't parse, their values applying meanwhile", () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ version: 1, text: "{ broken", values: { "acme.x.y": 1 } }),
    );
    localStorage.setItem(LEGACY_FILES_PANEL_STORAGE_KEY, JSON.stringify({ sort: "type" }));
    const store = new SettingsStore();
    expect(store.read()).toMatchObject({
      valid: false,
      values: { "acme.x.y": 1, "omnigent.files.sortOrder": "type" },
    });
    expect(localStorage.getItem(LEGACY_FILES_PANEL_STORAGE_KEY)).not.toBeNull();
    store.saveText('{ "acme.x.y": 1 }');
    expect(store.read().values).toEqual({ "acme.x.y": 1, "omnigent.files.sortOrder": "type" });
    expect(localStorage.getItem(LEGACY_FILES_PANEL_STORAGE_KEY)).toBeNull();
  });

  it("edits several keys in one write and one event, naming the paths and the writer", () => {
    const store = new SettingsStore();
    const changes: SettingsDocumentChange[] = [];
    store.subscribe((change) => changes.push(change));
    const writer = {};
    store.edit(
      [
        [["acme.x.a"], 1],
        [["acme.x.b"], true],
      ],
      writer,
    );
    expect(stored().values).toEqual({ "acme.x.a": 1, "acme.x.b": true });
    expect(changes).toEqual([{ paths: [["acme.x.a"], ["acme.x.b"]], origin: writer }]);
    store.edit([[["acme.x.a"], undefined]]);
    expect(stored().values).toEqual({ "acme.x.b": true });
  });

  it("refuses an edit while the text doesn't parse, and stores no text over the cap", () => {
    const store = new SettingsStore();
    store.saveText("{ nope");
    expect(store.writeBlocked()).toBe("Fix the errors in the settings JSON first.");
    expect(() => store.edit([[["acme.x.a"], 1]])).toThrow(SettingsWriteError);
    expect(store.saveText("x".repeat(SETTINGS_TEXT_LIMIT + 1))).toBe(false);
    expect(stored().text).toBe("{ nope");
  });

  it("clears the document and only the legacy keys it is given", () => {
    const store = new SettingsStore();
    store.edit([[["acme.x.a"], 1]]);
    localStorage.setItem(LEGACY_FILES_PANEL_STORAGE_KEY, "{}");
    store.clear(undefined, [LEGACY_VARIANTS_STORAGE_KEY]);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_FILES_PANEL_STORAGE_KEY)).toBe("{}");
  });
});
