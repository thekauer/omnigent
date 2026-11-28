import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationRegistry } from "@/configuration/configurationRegistry";
import { ConfigurationService } from "@/configuration/configurationService";
import { SettingsStore } from "@/configuration/settingsStore";
import { FALLBACK_SERVER_INFO, type ServerInfo } from "@/lib/capabilities";
import { ProductLayoutPolicy } from "@/workbench/productLayout";
import {
  applyServerProductConfig,
  createEmbedProductConfigSource,
  LAST_SERVER_PRODUCT_CONFIG_STORAGE_KEY,
  mergeProductConfigs,
  parseProductLayout,
  parseProductSettings,
  parseServerProductConfig,
  PRODUCT_NUMBER_COST,
  PRODUCT_SETTINGS_MAX_CHARS,
  PRODUCT_VALUE_MAX_DEPTH,
  PRODUCT_VALUE_MAX_NODES,
  productValueCost,
  resetProductConfigsForTests,
  setProductConfig,
  setProductConfigSinks,
} from "./productConfig";

function configuration() {
  const registry = new ConfigurationRegistry({ warn: () => {} });
  const service = new ConfigurationService(registry, new SettingsStore());
  service.addExtension(
    "acme.layout",
    {
      nodes: [
        {
          owner: "acme.layout",
          properties: {
            "acme.layout.location": { type: "string", enum: ["a", "b"], default: "a" },
            "acme.layout.visible": { type: "boolean", default: false },
          },
        },
      ],
      defaults: {},
    },
    { warn: () => {} },
    { builtIn: true },
  );
  return service;
}

let restore = () => {};
beforeEach(() => {
  localStorage.clear();
  resetProductConfigsForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

describe("product settings", () => {
  it("keep the well-formed keys, a lock with an unreadable value still locking its key", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const deep: unknown[] = [];
    let level: unknown[] = deep;
    for (let index = 0; index < PRODUCT_VALUE_MAX_DEPTH; index += 1) {
      const next: unknown[] = [];
      level.push(next);
      level = next;
    }
    expect(
      parseProductSettings(
        {
          defaults: { "acme.layout.location": "b", "bad key": 1, "acme.deep": deep },
          locked: { "acme.layout.visible": true, "acme.cycle": cycle, "acme.lone": "x\uD800" },
        },
        "test",
      ),
    ).toEqual({
      defaults: { "acme.layout.location": "b" },
      locked: { "acme.layout.visible": true },
      lockedInvalid: ["acme.cycle", "acme.lone"],
    });
  });

  it("warn about the server's snake_case spellings", () => {
    parseProductLayout({ hidden_parts: ["x"] }, "test");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("hidden_parts is not a key; did you mean hiddenParts?"),
    );
  });

  it("count values as the server does, and cap a source, locks first", () => {
    expect(productValueCost("ab")).toBe(4);
    expect(productValueCost("\u{1F600}")).toBe(4);
    expect(productValueCost(1.5)).toBe(PRODUCT_NUMBER_COST);
    expect(productValueCost([true, false, null])).toBe(2 + 2 + 4 + 5 + 4);
    expect(productValueCost({ a: 1 })).toBe(2 + 3 + 1 + PRODUCT_NUMBER_COST);
    expect(productValueCost(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(productValueCost(Array(PRODUCT_VALUE_MAX_NODES - 1).fill("x"))).toBeDefined();
    expect(productValueCost(Array(PRODUCT_VALUE_MAX_NODES).fill("x"))).toBeUndefined();
    const big = "x".repeat(60_000);
    expect(
      parseProductSettings(
        { defaults: { "acme.a": big }, locked: { "acme.b": big, "acme.c": big } },
        "test",
      ),
    ).toEqual({ locked: { "acme.b": big, "acme.c": big } });
    expect(PRODUCT_SETTINGS_MAX_CHARS).toBe(131_072);
  });

  it("keep an over-budget lock, and a getter's, locked to the default", () => {
    const big = "x".repeat(70_000);
    const getter = vi.fn(() => "b");
    const locked: Record<string, unknown> = { "acme.b": big, "acme.c": big };
    Object.defineProperty(locked, "acme.g", { get: getter, enumerable: true });
    expect(parseProductSettings({ locked }, "test")).toEqual({
      locked: { "acme.b": big },
      lockedInvalid: ["acme.g", "acme.c"].sort(
        (a, b) => Object.keys(locked).indexOf(a) - Object.keys(locked).indexOf(b),
      ),
    });
    expect(getter).not.toHaveBeenCalled();
    // A getter for lockViewLocations keeps views in place.
    const layout = Object.defineProperty({}, "lockViewLocations", {
      get: getter,
      enumerable: true,
    });
    expect(parseProductLayout(layout, "test")).toEqual({ lockViewLocations: true });
  });

  it("trim ids of ASCII whitespace only, as the server does", () => {
    expect(parseProductLayout({ hiddenViews: [" a ", "\u001cb"] }, "test")).toEqual({
      hiddenViews: ["a"],
    });
  });

  it("read accessors as nothing, without running them", () => {
    const getter = vi.fn(() => "b");
    const defaults = Object.defineProperty({}, "acme.layout.location", {
      get: getter,
      enumerable: true,
    });
    expect(parseProductSettings({ defaults }, "test")).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("product layout", () => {
  it("keeps the well-formed ids, and lockViewLocations as a boolean", () => {
    expect(
      parseProductLayout(
        {
          hiddenParts: ["workbench.parts.titlebar", 3, "bad id"],
          hiddenViews: "omnigent.newSession",
          containerOrder: ["omnigent.inbox", "omnigent.inbox", "acme.*"],
          hiddenContainers: [],
          lockViewLocations: "yes",
        },
        "test",
      ),
    ).toEqual({
      hiddenParts: ["workbench.parts.titlebar"],
      hiddenViews: ["omnigent.newSession"],
      containerOrder: ["omnigent.inbox", "acme.*"],
    });
  });

  it("maps the server's snake_case block", () => {
    expect(
      parseServerProductConfig({
        theme: null,
        settings: { defaults: { "acme.a": 1 }, locked: null, locked_invalid: ["acme.b"] },
        layout: { hidden_views: ["acme.view"], lock_view_locations: true, hidden_parts: null },
      }),
    ).toEqual({
      settings: { defaults: { "acme.a": 1 }, lockedInvalid: ["acme.b"] },
      layout: { hiddenViews: ["acme.view"], lockViewLocations: true },
    });
  });
});

describe("the product's sources", () => {
  it("merge per key, highest first; the hidden lists add up, any source locks view locations", () => {
    expect(
      mergeProductConfigs([
        {
          settings: { locked: { "acme.a": 1 }, lockedInvalid: ["acme.b"] },
          layout: { hiddenViews: ["one"], containerOrder: ["x"], lockViewLocations: false },
        },
        {
          settings: {
            defaults: { "acme.c": 3 },
            locked: { "acme.a": 2, "acme.b": 2, "acme.d": 4 },
          },
          layout: { hiddenViews: ["two", "one"], containerOrder: ["y"], lockViewLocations: true },
        },
      ]),
    ).toEqual({
      settings: {
        defaults: { "acme.c": 3 },
        locked: { "acme.a": 1, "acme.d": 4 },
        lockedInvalid: ["acme.b"],
      },
      layout: { hiddenViews: ["one", "two"], containerOrder: ["x"], lockViewLocations: true },
    });
  });

  it("give the configuration service the product's defaults and locks, invalid ones locked too", () => {
    const service = configuration();
    const layout = new ProductLayoutPolicy();
    restore = setProductConfigSinks({ configuration: service, layout });
    setProductConfig("build", {
      settings: {
        defaults: { "acme.layout.location": "b" },
        lockedInvalid: ["acme.layout.visible"],
      },
      layout: { lockViewLocations: true },
    });
    expect(service.getValue("acme.layout.location")).toBe("b");
    // Locked to its default, and refused on write.
    expect(service.getValue("acme.layout.visible")).toBe(false);
    expect(service.isLocked("acme.layout.visible")).toBe(true);
    expect(() => service.update("acme.layout.visible", true)).toThrow();
    expect(layout.viewLocationsLocked()).toBe(true);
    // A mounted embed's fields win over the build's.
    const embed = createEmbedProductConfigSource();
    embed.set({ settings: { defaults: { "acme.layout.location": "a" } } });
    expect(service.getValue("acme.layout.location")).toBe("a");
    embed.set(undefined);
    expect(service.getValue("acme.layout.location")).toBe("b");
  });

  it("keep the server's last-known policy when the probe fails", () => {
    const service = configuration();
    restore = setProductConfigSinks({ configuration: service, layout: new ProductLayoutPolicy() });
    applyServerProductConfig({
      product: { settings: { locked: { "acme.layout.location": "b" } } },
    } as unknown as ServerInfo);
    expect(localStorage.getItem(LAST_SERVER_PRODUCT_CONFIG_STORAGE_KEY)).toContain(
      "acme.layout.location",
    );
    resetProductConfigsForTests();
    applyServerProductConfig(FALLBACK_SERVER_INFO);
    expect(service.getValue("acme.layout.location")).toBe("b");
    expect(service.isLocked("acme.layout.location")).toBe(true);
  });
});
