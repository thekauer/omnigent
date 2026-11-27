// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { parseConfigurationContributions } from "./configurationContributions";
import { ConfigurationRegistry } from "./configurationRegistry";

describe("parseConfigurationContributions", () => {
  it("reads VS Code's shape: one node or an array of titled nodes", () => {
    const { contributions, warnings } = parseConfigurationContributions("acme.x", {
      configuration: [
        {
          title: "Acme",
          order: 2,
          properties: {
            "acme.x.mode": {
              type: "string",
              enum: ["a", "b"],
              markdownEnumDescriptions: ["A", "B"],
              default: "a",
              markdownDescription: "The **mode**.",
              scope: "machine",
              order: 1,
              markdownDeprecationMessage: "Use acme.x.other.",
            },
            "acme.x.count": { type: "number", minimum: 1, maximum: 9 },
            "acme.x.tags": { type: "array", items: { type: "string", enum: ["t"] } },
          },
        },
      ],
    });
    expect(warnings).toEqual([]);
    expect(contributions.nodes).toEqual([
      {
        owner: "acme.x",
        title: "Acme",
        order: 2,
        properties: {
          "acme.x.mode": {
            type: "string",
            enum: ["a", "b"],
            enumDescriptions: ["A", "B"],
            default: "a",
            description: "The **mode**.",
            scope: "application",
            order: 1,
            deprecationMessage: "Use acme.x.other.",
          },
          "acme.x.count": { type: "number", minimum: 1, maximum: 9 },
          "acme.x.tags": { type: "array", items: { type: "string", enum: ["t"] } },
        },
      },
    ]);
  });

  it("keeps a third-party extension to its own keys and drops what it can't take", () => {
    const { contributions, warnings } = parseConfigurationContributions("acme.x", {
      configuration: {
        properties: {
          "workbench.sideBar.location": { type: "string" },
          "acme.xy.other": { type: "string" },
          "acme.x": { type: "string" },
          "acme.x.bad default": { type: "string" },
          "acme.x.ok": { type: "string", default: 3, defaultOverridable: false },
          "acme.x.type": { type: "color" },
          "acme.x.enum": { type: "number", enum: ["1"] },
          "acme.x.notObject": "string",
        },
      },
    });
    expect(Object.keys(contributions.nodes[0]!.properties)).toEqual([
      "acme.x.ok",
      "acme.x.type",
      "acme.x.enum",
    ]);
    expect(contributions.nodes[0]!.properties["acme.x.ok"]).toEqual({ type: "string" });
    expect(contributions.nodes[0]!.properties["acme.x.type"]).toEqual({});
    expect(contributions.nodes[0]!.properties["acme.x.enum"]).toEqual({ type: "number" });
    expect(warnings).toEqual([
      'contributes.configuration.properties["workbench.sideBar.location"]: a setting key must be "acme.x.<name>"',
      'contributes.configuration.properties["acme.xy.other"]: a setting key must be "acme.x.<name>"',
      'contributes.configuration.properties["acme.x"]: a setting key must be "acme.x.<name>"',
      'contributes.configuration.properties["acme.x.bad default"]: a setting key must be "acme.x.<name>"',
      'contributes.configuration.properties["acme.x.ok"].defaultOverridable is for built-in extensions; ignoring it',
      `contributes.configuration.properties["acme.x.ok"].default doesn't apply: Expected a string.`,
      expect.stringMatching(/\.type must be one of/),
      expect.stringMatching(/\.enum is taken for string settings only/),
      'contributes.configuration.properties["acme.x.notObject"] must be an object',
    ]);
  });

  it("lets a built-in register any key and mark its default as not overridable", () => {
    const { contributions, warnings } = parseConfigurationContributions(
      "omnigent.themes",
      {
        configuration: {
          properties: {
            "workbench.colorCustomizations": { type: "object", defaultOverridable: false },
          },
        },
      },
      { builtIn: true },
    );
    expect(warnings).toEqual([]);
    expect(contributions.nodes[0]!.properties["workbench.colorCustomizations"]).toEqual({
      type: "object",
      defaultOverridable: false,
    });
  });

  it("reads configurationDefaults for any setting key, without language overrides", () => {
    const { contributions, warnings } = parseConfigurationContributions("acme.x", {
      configurationDefaults: {
        "workbench.activityBar.location": "default",
        "[markdown]": { "editor.wordWrap": "on" },
        "omnigent.secondarySideBar.autoHideBelow": 1180,
      },
    });
    expect(contributions.defaults).toEqual({
      "workbench.activityBar.location": "default",
      "omnigent.secondarySideBar.autoHideBelow": 1180,
    });
    expect(warnings).toEqual([
      'contributes.configurationDefaults["[markdown]"]: not a setting key (language overrides aren\'t supported)',
    ]);
  });

  it("caps what it reads", () => {
    const properties = Object.fromEntries(
      Array.from({ length: 250 }, (_, index) => [`acme.x.k${index}`, { type: "string" }]),
    );
    const { contributions, warnings } = parseConfigurationContributions("acme.x", {
      configuration: { properties },
      configurationDefaults: "nope",
    });
    expect(Object.keys(contributions.nodes[0]!.properties)).toHaveLength(200);
    expect(warnings).toContain("contributes.configuration: only the first 200 settings apply");
    expect(warnings).toContain('"contributes.configurationDefaults" must be an object of settings');
  });
});

describe("ConfigurationRegistry", () => {
  it("keeps a key with its first owner, and gives it back on removal", () => {
    const log = { warn: vi.fn() };
    const registry = new ConfigurationRegistry(log);
    const first = registry.registerConfiguration({
      owner: "acme.a",
      properties: { "acme.shared.key": { type: "string", default: "a" } },
    });
    registry.registerConfiguration({
      owner: "acme.b",
      properties: { "acme.shared.key": { type: "string", default: "b" } },
    });
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/registered by acme\.a/));
    expect(registry.defaultValue("acme.shared.key")).toBe("a");
    first();
    expect(registry.getProperty("acme.shared.key")).toBeUndefined();
  });

  it("takes the last configurationDefaults its schema takes, unless the default is fixed", () => {
    const registry = new ConfigurationRegistry();
    const changes: string[][] = [];
    registry.onDidChange((change) => changes.push([...change.keys]));
    // Registered before the setting: applies once it registers.
    registry.registerDefaultConfigurations("acme.early", { "acme.k.mode": "b" });
    registry.registerConfiguration({
      owner: "acme.k",
      properties: {
        "acme.k.mode": { type: "string", enum: ["a", "b", "c"], default: "a" },
        "acme.k.fixed": { type: "string", default: "a", defaultOverridable: false },
      },
    });
    expect(registry.inspectDefault("acme.k.mode")).toEqual({ value: "b", source: "acme.early" });
    const later = registry.registerDefaultConfigurations("acme.later", {
      "acme.k.mode": "c",
      "acme.k.fixed": "b",
    });
    registry.registerDefaultConfigurations("acme.wrong", { "acme.k.mode": "z" });
    expect(registry.defaultValue("acme.k.mode")).toBe("c");
    expect(registry.defaultValue("acme.k.fixed")).toBe("a");
    expect(registry.defaultOverrideProblem("acme.k.fixed", "b")).toMatch(
      /can't be given a default/,
    );
    later();
    expect(registry.defaultValue("acme.k.mode")).toBe("b");
    expect(changes).toContainEqual(["acme.k.mode", "acme.k.fixed"]);
  });
});
