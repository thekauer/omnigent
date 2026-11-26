// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  HIDDEN_MESSAGE,
  settingsCompletions,
  settingsDiagnostics,
  settingsHover,
  spanOfPath,
} from "./settingsLanguage";
import { buildSettingsSchema, schemaAt, type SettingsSchemaInput } from "./settingsSchema";

const INPUT: SettingsSchemaInput = {
  tokens: [
    { id: "primary", kind: "color", description: "The accent" },
    { id: "ui-radius-base", kind: "length", description: "The base radius" },
  ],
  themeScopes: [{ id: "nord", label: "Nord" }],
  optionScopes: [
    {
      scope: "acme.dev/devhub",
      label: "DevHub",
      options: [
        {
          id: "accent",
          label: "Accent",
          default: "orange",
          choices: [
            { id: "orange", label: "Orange" },
            { id: "lava", label: "Lava" },
          ],
        },
        {
          id: "cta",
          label: "Share and Stop",
          default: "orange",
          choices: [
            { id: "orange", label: "Orange" },
            { id: "light", label: "Light" },
          ],
        },
      ],
    },
  ],
  variants: [
    {
      name: "density",
      label: "Density",
      description: "Row heights.",
      values: [
        { value: "regular", label: "Regular" },
        { value: "compact", label: "Compact" },
      ],
      themeValue: "compact",
    },
    {
      name: "header",
      label: "Header",
      description: "The header.",
      values: [
        { value: "glass", label: "Glass" },
        { value: "solid", label: "Solid" },
      ],
    },
  ],
  locks: { tokens: {}, options: {}, variants: {} },
  hideCustomizations: false,
};

const schema = (overrides: Partial<SettingsSchemaInput> = {}) =>
  buildSettingsSchema({ ...INPUT, ...overrides });

describe("buildSettingsSchema", () => {
  it("lists every theme's options under its scope, the variants and the tokens", () => {
    const root = schema();
    expect(Object.keys(root.properties ?? {})).toEqual([
      "omnigent.themeOptions",
      "omnigent.style.density",
      "omnigent.style.header",
      "workbench.colorCustomizations",
    ]);
    expect(schemaAt(root, ["omnigent.themeOptions", "[acme.dev/devhub]", "accent"])).toMatchObject({
      enum: ["orange", "lava"],
      enumDescriptions: ["Orange", "Lava"],
      default: "orange",
    });
    expect(schemaAt(root, ["omnigent.style.density"])?.description).toContain("(Compact)");
    expect(schemaAt(root, ["workbench.colorCustomizations", "primary"])).toMatchObject({
      checkedByService: true,
    });
    expect(schemaAt(root, ["workbench.colorCustomizations", "[nord]", "primary"])).toBeDefined();
    expect(schemaAt(root, ["workbench.colorCustomizations", "[acme.other/x]"])).toBeDefined();
  });

  it("marks the product's locks with their values, and everything hidden under hideCustomizations", () => {
    const locked = schema({
      locks: {
        tokens: { primary: "#000" },
        options: { accent: "lava" },
        variants: { header: "solid" },
      },
    });
    expect(
      schemaAt(locked, ["omnigent.themeOptions", "[acme.dev/devhub]", "accent"])?.locked,
    ).toEqual({
      value: "lava",
      label: "Lava",
    });
    expect(schemaAt(locked, ["omnigent.style.header"])?.locked).toEqual({
      value: "solid",
      label: "Solid",
    });
    expect(schemaAt(locked, ["workbench.colorCustomizations", "primary"])?.locked).toEqual({
      value: "#000",
    });
    // A lock a theme has no choice for locks nothing there.
    const other = schema({ locks: { tokens: {}, options: { accent: "purple" }, variants: {} } });
    expect(
      schemaAt(other, ["omnigent.themeOptions", "[acme.dev/devhub]", "accent"])?.locked,
    ).toBeUndefined();
    const hidden = schema({ hideCustomizations: true });
    for (const key of Object.keys(hidden.properties ?? {})) {
      expect(hidden.properties?.[key]?.hidden, key).toBe(true);
    }
  });
});

describe("settingsDiagnostics", () => {
  it("flags unknown keys, wrong values and duplicates, and nothing in a good document", () => {
    const good =
      '{\n  "omnigent.style.density": "compact",\n  "omnigent.themeOptions": { "[acme.dev/devhub]": { "accent": "lava" } }\n}';
    expect(settingsDiagnostics(good, schema())).toEqual([]);
    const text =
      '{ "omnigent.style.density": "huge", "omnigent.styl.header": "solid", "omnigent.style.header": 3, "omnigent.style.density": "compact" }';
    const found = settingsDiagnostics(text, schema()).map(({ severity, message, path }) => ({
      severity,
      message,
      path,
    }));
    expect(found).toEqual([
      {
        severity: "warning",
        message: 'Duplicate key "omnigent.style.density": the last one applies.',
        path: ["omnigent.style.density"],
      },
      {
        severity: "error",
        message: 'Value is not accepted. Valid values: "regular", "compact".',
        path: ["omnigent.style.density"],
      },
      {
        severity: "warning",
        message: 'Unknown setting "omnigent.styl.header".',
        path: ["omnigent.styl.header"],
      },
      { severity: "error", message: "Expected a string.", path: ["omnigent.style.header"] },
    ]);
  });

  it("points a value error at the value", () => {
    const text = '{ "omnigent.style.density": "huge" }';
    const [error] = settingsDiagnostics(text, schema());
    expect(text.slice(error!.offset, error!.offset + error!.length)).toBe('"huge"');
  });

  it("reports syntax errors only, for a text that doesn't parse", () => {
    const found = settingsDiagnostics('{ "omnigent.style.density": "huge" ', schema());
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error" });
  });

  it("warns about options of a theme that isn't installed, and unknown options", () => {
    const text =
      '{ "omnigent.themeOptions": { "[acme.gone/x]": { "a": "b" }, "[acme.dev/devhub]": { "nope": "x" } } }';
    expect(settingsDiagnostics(text, schema()).map((entry) => entry.message)).toEqual([
      "No installed theme has these options; they are kept for when one does.",
      'Unknown property "nope".',
    ]);
  });

  it("marks locked keys 'Set by product' as faded information, whatever their value", () => {
    const locked = schema({
      locks: { tokens: {}, options: { accent: "lava" }, variants: { header: "solid" } },
    });
    const text =
      '{ "omnigent.style.header": "not-a-value", "omnigent.themeOptions": { "[acme.dev/devhub]": { "accent": "orange" } } }';
    const found = settingsDiagnostics(text, locked);
    expect(found).toEqual([
      expect.objectContaining({
        severity: "info",
        unnecessary: true,
        message: "Set by product (Solid): this value doesn't apply.",
        path: ["omnigent.style.header"],
      }),
      expect.objectContaining({
        severity: "info",
        unnecessary: true,
        message: "Set by product (Lava): this value doesn't apply.",
      }),
    ]);
    expect(text.slice(found[0]!.offset, found[0]!.offset + found[0]!.length)).toBe(
      '"omnigent.style.header": "not-a-value"',
    );
  });

  it("marks every key turned off under hideCustomizations", () => {
    const found = settingsDiagnostics(
      '{ "omnigent.style.header": "solid" }',
      schema({ hideCustomizations: true }),
    );
    expect(found).toEqual([
      expect.objectContaining({ message: HIDDEN_MESSAGE, unnecessary: true }),
    ]);
  });

  it("leaves token values to the theme service", () => {
    const text =
      '{ "workbench.colorCustomizations": { "primary": 12, "nope": "x", "[nord]": { "primary": "x" } } }';
    expect(settingsDiagnostics(text, schema())).toEqual([]);
  });

  it("flags a __proto__ key", () => {
    expect(settingsDiagnostics('{ "__proto__": {} }', schema())[0]?.message).toBe("Not a setting.");
  });
});

describe("settingsCompletions", () => {
  const at = (marked: string) => {
    const offset = marked.indexOf("|");
    return { text: marked.replace("|", ""), offset };
  };

  it("offers the keys not set yet, as snippets with their values", () => {
    const { text, offset } = at('{\n  "omnigent.style.density": "compact",\n  |\n}');
    const items = settingsCompletions(text, offset, schema());
    expect(items.map((item) => item.label)).toEqual([
      "omnigent.themeOptions",
      "omnigent.style.header",
      "workbench.colorCustomizations",
    ]);
    expect(items[1]).toMatchObject({
      insertText: '"omnigent.style.header": "${1|glass,solid|}"',
      snippet: true,
      offset,
      length: 0,
    });
  });

  it("replaces the key being typed", () => {
    const { text, offset } = at('{ "omnigent.sty| }');
    const items = settingsCompletions(text, offset, schema());
    expect(items.map((item) => item.label)).toContain("omnigent.style.density");
    expect(items[0]).toMatchObject({ offset: 2 });
  });

  it("offers a key's values with their labels, and a theme's options in its scope", () => {
    const value = at('{ "omnigent.style.density": "|" }');
    expect(settingsCompletions(value.text, value.offset, schema())).toEqual([
      expect.objectContaining({ label: '"regular"', detail: "Regular", kind: "value" }),
      expect.objectContaining({ label: '"compact"', detail: "Compact" }),
    ]);
    const scopes = at('{ "omnigent.themeOptions": { | } }');
    expect(
      settingsCompletions(scopes.text, scopes.offset, schema()).map((item) => item.label),
    ).toEqual(["[acme.dev/devhub]"]);
    const options = at('{ "omnigent.themeOptions": { "[acme.dev/devhub]": { | } } }');
    expect(
      settingsCompletions(options.text, options.offset, schema()).map((item) => item.label),
    ).toEqual(["accent", "cta"]);
    const tokens = at('{ "workbench.colorCustomizations": { | } }');
    expect(
      settingsCompletions(tokens.text, tokens.offset, schema()).map((item) => item.label),
    ).toEqual(["primary", "ui-radius-base", "[nord]"]);
  });

  it("leaves locked and hidden keys out", () => {
    const locked = schema({
      locks: { tokens: {}, options: { accent: "lava" }, variants: { header: "solid" } },
    });
    const root = at("{ | }");
    expect(
      settingsCompletions(root.text, root.offset, locked).map((item) => item.label),
    ).not.toContain("omnigent.style.header");
    const options = at('{ "omnigent.themeOptions": { "[acme.dev/devhub]": { | } } }');
    expect(
      settingsCompletions(options.text, options.offset, locked).map((item) => item.label),
    ).toEqual(["cta"]);
    const value = at('{ "omnigent.style.header": "|" }');
    expect(settingsCompletions(value.text, value.offset, locked)).toEqual([]);
    expect(
      settingsCompletions(root.text, root.offset, schema({ hideCustomizations: true })),
    ).toEqual([]);
  });
});

describe("settingsHover", () => {
  it("describes a key and a value's label", () => {
    const text = '{ "omnigent.style.header": "solid", "omnigent.style.density": "compact" }';
    const key = settingsHover(text, text.indexOf("style.header"), schema());
    expect(key?.contents).toContain("**omnigent.style.header**");
    expect(key?.contents).toContain("The header.");
    const value = settingsHover(text, text.indexOf('"compact"') + 2, schema());
    expect(value?.contents).toMatch(/^"compact": Compact/);
    expect(settingsHover(text, 0, schema())).toBeNull();
  });
});

describe("spanOfPath", () => {
  it("is the key's property, or nothing for a path not in the text", () => {
    const text = '{ "workbench.colorCustomizations": { "[nord]": { "primary": "x" } } }';
    const span = spanOfPath(text, ["workbench.colorCustomizations", "[nord]", "primary"]);
    expect(text.slice(span.offset, span.offset + span.length)).toBe('"primary": "x"');
    expect(spanOfPath(text, ["nope"])).toEqual({ offset: 0, length: 0 });
  });
});
