import { afterEach, describe, expect, it } from "vitest";

import filesManifest from "@/builtinExtensions/omnigent.files/package.json";
import { SettingsStore } from "@/configuration/settingsStore";
import { readStoredSettings, SETTINGS_STORAGE_KEY } from "@/configuration/settingsDocument";
import {
  DEFAULT_FILES_SHOW_HIDDEN,
  DEFAULT_FILES_SORT_ORDER,
  FILES_SHOW_HIDDEN_SETTING,
  FILES_SORT_ORDER_SETTING,
  filesSortOrder,
  LEGACY_FILES_PANEL_STORAGE_KEY,
  legacyFilesSettingsWrites,
} from "./filesPanelPreferences";

afterEach(() => {
  localStorage.clear();
});

const stored = () => readStoredSettings(localStorage.getItem(SETTINGS_STORAGE_KEY));

describe("filesPanelPreferences", () => {
  it("registers its settings with the defaults the panel falls back to", () => {
    const properties = filesManifest.contributes.configuration.properties;
    expect(properties[FILES_SORT_ORDER_SETTING].default).toBe(DEFAULT_FILES_SORT_ORDER);
    expect(DEFAULT_FILES_SORT_ORDER).toBe("alpha");
    expect(properties[FILES_SORT_ORDER_SETTING].enum).toEqual(["alpha", "recent", "size", "type"]);
    expect(properties[FILES_SHOW_HIDDEN_SETTING].default).toBe(DEFAULT_FILES_SHOW_HIDDEN);
  });

  it("reads a sort name, and nothing else", () => {
    expect(filesSortOrder("recent")).toBe("recent");
    expect(filesSortOrder("bogus")).toBeUndefined();
    expect(filesSortOrder(3)).toBeUndefined();
  });

  it("carries the legacy sort into the document unless the document sets one", () => {
    expect(legacyFilesSettingsWrites({ sort: "size" }, {})).toEqual([
      [[FILES_SORT_ORDER_SETTING], "size"],
    ]);
    expect(
      legacyFilesSettingsWrites({ sort: "size" }, { [FILES_SORT_ORDER_SETTING]: "type" }),
    ).toEqual([]);
    // The wrong shape or an unknown sort carries nothing.
    for (const legacy of [undefined, null, [true], "recent", { sort: "bogus" }, { sort: 1 }]) {
      expect(legacyFilesSettingsWrites(legacy, {})).toEqual([]);
    }
  });

  it("is migrated into the settings document on the first read, and the old key goes", () => {
    localStorage.setItem(LEGACY_FILES_PANEL_STORAGE_KEY, JSON.stringify({ sort: "recent" }));
    const store = new SettingsStore();
    expect(store.read().values[FILES_SORT_ORDER_SETTING]).toBe("recent");
    expect(stored().text).toContain('"omnigent.files.sortOrder": "recent"');
    expect(localStorage.getItem(LEGACY_FILES_PANEL_STORAGE_KEY)).toBeNull();
  });

  it("drops a malformed legacy key without writing a document", () => {
    localStorage.setItem(LEGACY_FILES_PANEL_STORAGE_KEY, "}{not json");
    new SettingsStore().read();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_FILES_PANEL_STORAGE_KEY)).toBeNull();
  });
});
