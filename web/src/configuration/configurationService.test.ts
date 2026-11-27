import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseConfigurationContributions } from "./configurationContributions";
import { ConfigurationRegistry } from "./configurationRegistry";
import { type ConfigurationChangeEvent, ConfigurationService } from "./configurationService";
import { readStoredSettings, SETTINGS_STORAGE_KEY } from "./settingsDocument";
import { SettingsStore, SettingsWriteError } from "./settingsStore";

const stored = () => readStoredSettings(localStorage.getItem(SETTINGS_STORAGE_KEY));
const writeText = (text: string) =>
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, text, values: {} }));

/** The `acme.layout` extension's settings, as its manifest contributes them. */
const ACME = parseConfigurationContributions("acme.layout", {
  configuration: {
    title: "Layout",
    properties: {
      "acme.layout.location": {
        type: "string",
        enum: ["default", "top", "hidden"],
        default: "hidden",
        description: "Where the bar goes.",
      },
      "acme.layout.width": { type: "integer", minimum: 0, maximum: 2000, default: 0 },
      "acme.layout.visible": { type: "boolean", default: false },
      "acme.layout.hidden": { type: "array", items: { type: "string" }, default: [] },
    },
  },
}).contributions;

let store: SettingsStore;
let registry: ConfigurationRegistry;
let service: ConfigurationService;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  store = new SettingsStore();
  registry = new ConfigurationRegistry();
  service = new ConfigurationService(registry, store);
});

afterEach(() => {
  warn.mockRestore();
});

describe("ConfigurationService", () => {
  it("layers the registered default, configurationDefaults, the product, the user, memory and the lock", () => {
    const remove = service.addExtension("acme.layout", ACME);
    expect(service.getValue("acme.layout.location")).toBe("hidden");
    service.addExtension(
      "acme.theme",
      parseConfigurationContributions("acme.theme", {
        configurationDefaults: { "acme.layout.location": "top" },
      }).contributions,
    );
    expect(service.inspect("acme.layout.location")).toMatchObject({
      defaultValue: "top",
      value: "top",
    });
    service.setPolicy("product", { defaults: { "acme.layout.location": "default" } });
    expect(service.getValue("acme.layout.location")).toBe("default");
    writeText('{ "acme.layout.location": "hidden" }');
    expect(service.getValue("acme.layout.location")).toBe("hidden");
    service.update("acme.layout.location", "top", "memory");
    expect(service.inspect("acme.layout.location")).toMatchObject({
      userValue: "hidden",
      memoryValue: "top",
      value: "top",
    });
    service.setPolicy("product", { locked: { "acme.layout.location": "default" } });
    expect(service.inspect("acme.layout.location")).toMatchObject({
      lockedValue: "default",
      value: "default",
    });
    remove();
    // Unregistered: the user's raw value still reads, the default is gone.
    service.setPolicy("product", null);
    expect(service.inspect("acme.layout.location").defaultValue).toBeUndefined();
  });

  it("leaves out a value the schema doesn't take, at every layer", () => {
    service.addExtension("acme.layout", ACME);
    writeText(
      '{ "acme.layout.location": "sideways", "acme.layout.width": 2.5, "acme.layout.visible": "yes", "acme.layout.hidden": [1] }',
    );
    expect(service.getValue("acme.layout.location")).toBe("hidden");
    expect(service.getValue("acme.layout.width")).toBe(0);
    expect(service.getValue("acme.layout.visible")).toBe(false);
    expect(service.getValue("acme.layout.hidden")).toEqual([]);
    writeText('{ "acme.layout.width": 3000 }');
    expect(service.getValue("acme.layout.width")).toBe(0);
    service.setPolicy("product", {
      defaults: { "acme.layout.width": -1 },
      locked: { "acme.layout.visible": "no" },
    });
    expect(service.getValue("acme.layout.width")).toBe(0);
    expect(service.isLocked("acme.layout.visible")).toBe(false);
    // An override the setting doesn't take is a warning, and the registered default stays.
    service.addExtension(
      "acme.other",
      parseConfigurationContributions("acme.other", {
        configurationDefaults: { "acme.layout.width": "wide" },
      }).contributions,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/acme\.other: configurationDefaults acme\.layout\.width/),
    );
    expect(service.getValue("acme.layout.width")).toBe(0);
  });

  it("writes the user's settings JSON in place, keeping its comments", () => {
    service.addExtension("acme.layout", ACME);
    writeText('{\n  // mine\n  "acme.layout.width": 10\n}\n');
    service.update("acme.layout.location", "top");
    expect(stored().text).toBe(
      '{\n  // mine\n  "acme.layout.width": 10,\n  "acme.layout.location": "top"\n}\n',
    );
    service.update("acme.layout.width", undefined);
    expect(stored().text).toBe('{\n  // mine\n  "acme.layout.location": "top"\n}\n');
    expect(service.getValue("acme.layout.width")).toBe(0);
  });

  it("refuses a wrong value, a locked key and a document that doesn't parse", () => {
    service.addExtension("acme.layout", ACME);
    expect(() => service.update("acme.layout.location", "sideways")).toThrow(SettingsWriteError);
    expect(() => service.update("acme.layout.width", 1.5, "memory")).toThrow(/an integer/);
    service.setPolicy("product", { locked: { "acme.layout.visible": true } });
    expect(() => service.update("acme.layout.visible", false)).toThrow(/Set by product/);
    expect(() => service.update("acme.layout.visible", false, "memory")).toThrow(/Set by product/);
    writeText("{ broken");
    expect(() => service.update("acme.layout.location", "top")).toThrow(
      "Fix the errors in the settings JSON first.",
    );
    // Memory still takes it, so a window keeps a choice its settings can't store.
    service.update("acme.layout.location", "top", "memory");
    expect(service.getValue("acme.layout.location")).toBe("top");
    expect(stored().text).toBe("{ broken");
  });

  it("clears a memory value when the user's value is written", () => {
    service.addExtension("acme.layout", ACME);
    service.update("acme.layout.location", "top", "memory");
    service.update("acme.layout.location", "default");
    expect(service.inspect("acme.layout.location")).not.toHaveProperty("memoryValue");
    expect(service.getValue("acme.layout.location")).toBe("default");
  });

  it("fires one change with the keys whose value changed, from any layer", () => {
    service.addExtension("acme.layout", ACME);
    const events: ConfigurationChangeEvent[] = [];
    service.onDidChangeConfiguration((event) => events.push(event));
    service.update("acme.layout.location", "top");
    expect(events.map((event) => event.affectedKeys)).toEqual([["acme.layout.location"]]);
    expect(events[0]!.affectsConfiguration("acme.layout")).toBe(true);
    expect(events[0]!.affectsConfiguration("acme.layout.width")).toBe(false);
    expect(events[0]!.affectsConfiguration("acme")).toBe(true);
    // A save that changes nothing that applies fires nothing.
    store.saveText(stored().text.replace("{", "{\n  // a comment\n"));
    expect(events).toHaveLength(1);
    service.setPolicy("product", { locked: { "acme.layout.width": 5 } });
    expect(events.at(-1)!.affectedKeys).toEqual(["acme.layout.width"]);
    service.addExtension(
      "acme.theme",
      parseConfigurationContributions("acme.theme", {
        configurationDefaults: { "acme.layout.visible": true },
      }).contributions,
    );
    expect(events.at(-1)!.affectedKeys).toEqual(["acme.layout.visible"]);
  });

  it("returns frozen copies, so a reader can't change what others read", () => {
    service.addExtension("acme.layout", ACME);
    writeText('{ "acme.layout.hidden": ["a"] }');
    const value = service.getValue<string[]>("acme.layout.hidden")!;
    expect(Object.isFrozen(value)).toBe(true);
    expect(() => value.push("b")).toThrow();
    expect(service.getValue("acme.layout.hidden")).toEqual(["a"]);
  });

  it("builds the editor's schema of the registered settings, with their defaults and locks", () => {
    service.addExtension("acme.layout", ACME);
    service.setPolicy("product", { locked: { "acme.layout.visible": true } });
    const schema = service.getSchema();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.["acme.layout.location"]).toEqual({
      type: "string",
      enum: ["default", "top", "hidden"],
      default: "hidden",
      description: 'Where the bar goes. Default: `"hidden"`.',
    });
    expect(schema.properties?.["acme.layout.visible"]?.locked).toEqual({ value: true });
    expect(schema.properties?.["acme.layout.width"]).not.toHaveProperty("scope");
  });

  it("lists every registered or user-set key", () => {
    service.addExtension("acme.layout", ACME);
    writeText('{ "acme.unregistered": 1 }');
    expect(service.keys()).toEqual(
      expect.arrayContaining(["acme.layout.location", "acme.unregistered"]),
    );
    expect(service.has("acme.unregistered")).toBe(false);
    expect(service.getValue("acme.unregistered")).toBe(1);
  });
});
