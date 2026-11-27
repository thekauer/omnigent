import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeWorkspacePanelDefault,
  readDefaultWorkspacePanelOpen,
  readWorkspacePanelDefault,
  migrateLegacyDefault,
  WORKSPACE_PANEL_DEFAULT,
  writeDefaultWorkspacePanelOpen,
  writeWorkspacePanelDefault,
} from "./workspacePanelPreferences";
import { readStoredSettings, SETTINGS_STORAGE_KEY } from "@/configuration/settingsDocument";
import { LAYOUT_SLOTS, layoutState } from "@/workbench/layoutState";
import { configurationService } from "@/configuration/configurationService";

const STORAGE_KEY = "omnigent:default-workspace-panel";

afterEach(() => {
  localStorage.clear();
  layoutState.reset();
});

describe("workspacePanelPreferences — read/write", () => {
  it("returns collapsed when nothing is stored", () => {
    expect(readWorkspacePanelDefault()).toBe(WORKSPACE_PANEL_DEFAULT);
    expect(readDefaultWorkspacePanelOpen()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("records the rail's visibility from the collapse/expand toggle in the layout state", () => {
    writeDefaultWorkspacePanelOpen(false);
    expect(readDefaultWorkspacePanelOpen()).toBe(false);
    expect(layoutState.get(LAYOUT_SLOTS.auxiliaryBarLastVisibility)).toBeUndefined();

    writeDefaultWorkspacePanelOpen(true);
    expect(readDefaultWorkspacePanelOpen()).toBe(true);
    expect(layoutState.get(LAYOUT_SLOTS.auxiliaryBarLastVisibility)).toBe("open");
    // The settings JSON is the user's intent: a toggle doesn't write it.
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it("writes Appearance's choice to the settings JSON, over the last toggle", () => {
    writeDefaultWorkspacePanelOpen(true);
    writeWorkspacePanelDefault("collapsed");
    expect(readWorkspacePanelDefault()).toBe("collapsed");
    expect(layoutState.get(LAYOUT_SLOTS.auxiliaryBarLastVisibility)).toBeUndefined();

    writeWorkspacePanelDefault("open");
    expect(readWorkspacePanelDefault()).toBe("open");
    expect(readStoredSettings(localStorage.getItem(SETTINGS_STORAGE_KEY)).values).toEqual({
      "workbench.secondarySideBar.defaultVisibility": "visibleInWorkspace",
    });
    // A toggle back to the intent leaves no layout state.
    writeDefaultWorkspacePanelOpen(true);
    expect(layoutState.get(LAYOUT_SLOTS.auxiliaryBarLastVisibility)).toBeUndefined();
  });

  it("carries the old key's open into the settings JSON's intent once", () => {
    localStorage.setItem(STORAGE_KEY, "open");
    migrateLegacyDefault();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readStoredSettings(localStorage.getItem(SETTINGS_STORAGE_KEY)).values).toEqual({
      "workbench.secondarySideBar.defaultVisibility": "visibleInWorkspace",
    });
    expect(readWorkspacePanelDefault()).toBe("open");
  });

  it("keeps the old key while the settings JSON refuses the intent (it doesn't parse)", () => {
    localStorage.setItem(STORAGE_KEY, "open");
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ version: 1, text: "{ broken", values: {} }),
    );
    configurationService.reload();
    migrateLegacyDefault();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("open");
  });

  it("follows a change of the intent over the last toggle", () => {
    writeDefaultWorkspacePanelOpen(true);
    expect(readWorkspacePanelDefault()).toBe("open");
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        text: '{ "workbench.secondarySideBar.defaultVisibility": "hidden" }',
        values: {},
      }),
    );
    configurationService.reload();
    expect(layoutState.get(LAYOUT_SLOTS.auxiliaryBarLastVisibility)).toBeUndefined();
    expect(readWorkspacePanelDefault()).toBe("collapsed");
  });
});

describe("normalizeWorkspacePanelDefault", () => {
  it("passes through valid values", () => {
    expect(normalizeWorkspacePanelDefault("open")).toBe("open");
    expect(normalizeWorkspacePanelDefault("collapsed")).toBe("collapsed");
  });

  it("maps unknown, null, and garbage to collapsed", () => {
    expect(normalizeWorkspacePanelDefault("closed")).toBe("collapsed");
    expect(normalizeWorkspacePanelDefault("bogus")).toBe("collapsed");
    expect(normalizeWorkspacePanelDefault(null)).toBe("collapsed");
    expect(normalizeWorkspacePanelDefault(undefined)).toBe("collapsed");
  });
});
