// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  editSettingsText,
  EMPTY_STORED_SETTINGS,
  migrateLegacySettings,
  parseSettingsText,
  readStoredSettings,
  serializeSettings,
  SETTINGS_TEXT_LIMIT,
  SETTINGS_WRITE_BLOCKED,
  storeSettings,
} from "./settingsDocument";

const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

describe("parseSettingsText", () => {
  it("takes comments and trailing commas, and an empty or comment-only text as no settings", () => {
    const parsed = parseSettingsText(
      '// mine\n{\n  "omnigent.style.density": "compact", /* x */\n}\n',
    );
    expect(parsed.ok && plain(parsed.values)).toEqual({ "omnigent.style.density": "compact" });
    for (const text of ["", "  \n", "// only a comment\n", "/* a */"]) {
      const empty = parseSettingsText(text);
      expect(empty.ok && plain(empty.values), JSON.stringify(text)).toEqual({});
    }
  });

  it("reports syntax errors with their spans, a non-object, and an oversized text", () => {
    const parsed = parseSettingsText('{ "a": "b" "c": 1 }');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors[0]).toMatchObject({ offset: 11, message: "Comma expected" });
    }
    const list = parseSettingsText("[1]");
    expect(!list.ok && list.errors[0]?.message).toBe("Settings are a JSON object");
    const long = parseSettingsText(" ".repeat(SETTINGS_TEXT_LIMIT + 1));
    expect(!long.ok && long.errors[0]?.message).toMatch(/Longer than/);
  });

  it("keeps a __proto__ key a plain key, left out of the values", () => {
    const parsed = parseSettingsText(
      '{ "__proto__": { "polluted": true }, "a": { "__proto__": 1 } }',
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(Object.getPrototypeOf(parsed.values)).toBeNull();
      expect(plain(parsed.values)).toEqual({ a: {} });
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("stored settings and last good values", () => {
  it("keeps the previous values while the text has syntax errors", () => {
    const good = storeSettings(
      '{ "omnigent.style.density": "compact" }',
      EMPTY_STORED_SETTINGS.values,
    );
    expect(good.valid).toBe(true);
    const broken = storeSettings('{ "omnigent.style.density": "comfortable" ', good.values);
    expect(broken).toMatchObject({
      valid: false,
      text: '{ "omnigent.style.density": "comfortable" ',
    });
    expect(plain(broken.values)).toEqual({ "omnigent.style.density": "compact" });
    const read = readStoredSettings(serializeSettings(broken));
    expect(read.valid).toBe(false);
    expect(plain(read.values)).toEqual({ "omnigent.style.density": "compact" });
  });

  it("reads the text's own values over stored ones, and anything malformed as nothing", () => {
    const forged = JSON.stringify({
      version: 1,
      text: '{ "omnigent.style.density": "compact" }',
      values: { "omnigent.style.density": "comfortable" },
    });
    expect(plain(readStoredSettings(forged).values)).toEqual({
      "omnigent.style.density": "compact",
    });
    for (const raw of [null, "nope", "[]", JSON.stringify({ version: 2, text: "{}" })]) {
      expect(readStoredSettings(raw)).toBe(EMPTY_STORED_SETTINGS);
    }
  });
});

describe("editSettingsText", () => {
  it("sets keys in place, keeping comments", () => {
    const text = '// my settings\n{\n  // dense\n  "omnigent.style.density": "compact"\n}\n';
    const edit = editSettingsText(
      text,
      ["omnigent.themeOptions", "[acme.x/family]", "accent"],
      "lava",
    );
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(edit.text).toContain("// my settings");
    expect(edit.text).toContain("// dense");
    const parsed = parseSettingsText(edit.text);
    expect(parsed.ok && plain(parsed.values)).toEqual({
      "omnigent.style.density": "compact",
      "omnigent.themeOptions": { "[acme.x/family]": { accent: "lava" } },
    });
  });

  it("removes a key and the objects it leaves empty", () => {
    const start = editSettingsText(
      "",
      ["omnigent.themeOptions", "[acme.x/family]", "accent"],
      "lava",
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const removed = editSettingsText(
      start.text,
      ["omnigent.themeOptions", "[acme.x/family]", "accent"],
      undefined,
    );
    expect(
      removed.ok && plain((parseSettingsText(removed.text) as { values: unknown }).values),
    ).toEqual({});
  });

  it("refuses a text with syntax errors", () => {
    expect(editSettingsText('{ "a": ', ["b"], "c")).toEqual({
      ok: false,
      reason: SETTINGS_WRITE_BLOCKED,
    });
  });

  it("writes after a comment-only text", () => {
    const edit = editSettingsText("// notes\n", ["omnigent.style.header"], "solid");
    expect(edit.ok && edit.text).toMatch(/^\/\/ notes\n\{/);
  });
});

describe("migrateLegacySettings", () => {
  const legacy = {
    options: { "acme.x/family": { accent: "lava", corners: "soft" }, "bad[": { a: "b" } },
    variants: { density: "compact", label: 3 },
    customizations: { primary: "#111111", "[nord]": { background: "#000" } },
  };

  it("builds the document from the old keys", () => {
    const migrated = migrateLegacySettings(EMPTY_STORED_SETTINGS, legacy);
    expect(migrated.valid).toBe(true);
    expect(plain(migrated.values)).toEqual({
      "omnigent.themeOptions": { "[acme.x/family]": { accent: "lava", corners: "soft" } },
      "omnigent.style.density": "compact",
      "workbench.colorCustomizations": { primary: "#111111", "[nord]": { background: "#000" } },
    });
  });

  it("writes them over an existing document's keys, keeping its others and comments", () => {
    const current = storeSettings(
      '// mine\n{ "omnigent.style.density": "comfortable", "omnigent.style.header": "solid" }',
      EMPTY_STORED_SETTINGS.values,
    );
    const migrated = migrateLegacySettings(current, { variants: { density: "compact" } });
    expect(migrated.text).toContain("// mine");
    expect(plain(migrated.values)).toEqual({
      "omnigent.style.density": "compact",
      "omnigent.style.header": "solid",
    });
  });

  it("joins a malformed document's last good values, leaving its text alone", () => {
    const current = { text: "{ oops", values: EMPTY_STORED_SETTINGS.values, valid: false };
    const migrated = migrateLegacySettings(current, { variants: { density: "compact" } });
    expect(migrated).toMatchObject({ text: "{ oops", valid: false });
    expect(plain(migrated.values)).toEqual({ "omnigent.style.density": "compact" });
  });

  it("changes nothing without legacy values", () => {
    expect(migrateLegacySettings(EMPTY_STORED_SETTINGS, {})).toBe(EMPTY_STORED_SETTINGS);
  });
});
