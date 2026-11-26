// @vitest-environment node
import { type ParseError, parseTree } from "jsonc-parser";
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

describe("parseSettingsText on hostile and unusual text", () => {
  const deep = (depth: number) => `{"x":${"[".repeat(depth)}${"]".repeat(depth)}}`;

  it("reads any nesting without recursing, leaving the too-deep key out", () => {
    for (const depth of [3000, 65_000]) {
      const parsed = parseSettingsText(deep(depth));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(plain(parsed.values)).toEqual({});
      expect(parsed.problems).toEqual([
        {
          offset: 1,
          length: 3,
          message: "Nested too deeply (more than 6 levels): this value doesn't apply.",
          path: ["x"],
        },
      ]);
    }
  });

  it("leaves out only the key whose value is too deep, at that key", () => {
    const text = `{
  "omnigent.style.header": "solid",
  "workbench.colorCustomizations": { "primary": "#111111", "deep": [[[[[[1]]]]]] },
  "list": [{ "inner": { "a": { "b": [[1]] } } }]
}`;
    const parsed = parseSettingsText(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(plain(parsed.values)).toEqual({
      "omnigent.style.header": "solid",
      "workbench.colorCustomizations": { primary: "#111111" },
      list: [{ inner: { a: {} } }],
    });
    expect(
      parsed.problems.map((problem) => text.slice(problem.offset, problem.offset + problem.length)),
    ).toEqual(['"deep"', '"b"']);
    expect(parsed.problems.map((problem) => problem.path)).toEqual([
      ["workbench.colorCustomizations", "deep"],
      undefined,
    ]);
    // Six levels is the limit: five nested arrays under a key still apply.
    const edge = parseSettingsText('{ "x": [[[[[1]]]]] }');
    expect(edge.ok && plain(edge.values)).toEqual({ x: [[[[[1]]]]] });
  });

  it("refuses a text with more values than the limit, at the one over it", () => {
    const text = `{ "x": [${"1,".repeat(10_000)}1] }`;
    const parsed = parseSettingsText(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]?.message).toBe("More than 10000 values");
  });

  it("agrees with jsonc-parser on what parses, and on the values", () => {
    const texts = [
      "{}",
      "{ }",
      '{ "a": 1, }',
      '{ "a": [1, 2,], }',
      '{ "a": [,] }',
      "{ , }",
      '{ "a" 1 }',
      '{ "a": }',
      '{ "a": 1 "b": 2 }',
      '{ "a": 01 }',
      '{ "a": 1. }',
      '{ "a": 1e }',
      '{ "a": -1.5e+3, "b": -0, "c": 0.25 }',
      '{ "a": -x }',
      '{ "a": tru }',
      '{ "a": true, "b": false, "c": null }',
      '{ "a": "\\u12" }',
      '{ "a": "\\q" }',
      '{ "a": "line\nbreak" }',
      '{ "a": "tab\there" }',
      '{ "a": "\\u00e9\\n\\"" }',
      '{ "a": "unterminated }',
      "{ /* open comment",
      '{ "a": 1 } // trailing comment',
      '{ "a": 1 } x',
      '{ "a": 1 }}',
      '/* a */ { // b\n "a": /* c */ 1 }',
      '{ "a": { "a": 1 }, "a": 2 }',
      "{ 'a': 1 }",
      '{ "a": 1 /',
      "[]",
      '"x"',
      "{",
      "\u00a0{}",
    ];
    for (const text of texts) {
      const errors: ParseError[] = [];
      const tree = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
      const parsed = parseSettingsText(text);
      const theirs = errors.length === 0 && tree?.type === "object";
      expect(parsed.ok, text).toBe(theirs);
      if (parsed.ok && errors.length === 0) {
        expect(plain(parsed.values), text).toEqual(
          JSON.parse(JSON.stringify(nodeData(tree))) as unknown,
        );
      }
    }
  });
});

describe("the reader and editor against jsonc-parser on generated text", () => {
  // A seeded generator: nested JSONC with comments and trailing commas, then a few edits.
  let seed = 987;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const gap = () => pick(["", " ", "\n  ", " /* c */ ", " // l\n"]);
  const generate = (depth: number): string => {
    const roll = random();
    if (depth > 3 || roll < 0.4) return pick(['"s"', "1", "-2.5e3", "true", "null", '"a\\nb"']);
    const count = Math.floor(random() * 4);
    const trailing = count > 0 && random() < 0.3 ? "," : "";
    if (roll < 0.7) {
      const entries = Array.from(
        { length: count },
        () =>
          `${gap()}"${pick(["a", "b", "c", "__proto__"])}"${gap()}:${gap()}${generate(depth + 1)}${gap()}`,
      );
      return `{${entries.join(",")}${trailing}${gap()}}`;
    }
    const items = Array.from({ length: count }, () => `${gap()}${generate(depth + 1)}${gap()}`);
    return `[${items.join(",")}${trailing}]`;
  };
  const noise = ["\t", "\u0001", "u", "\r", "0", "E", "+", "{", "}", "[", "]", ",", ":", '"'];
  const moreNoise = [...noise, "/", "*", "\n", " ", "a", "1", "\\", ".", "-", "e"];
  const without = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(without)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([key]) => key !== "__proto__")
              .map(([key, inner]) => [key, without(inner)]),
          )
        : value;

  it("agrees on validity and values, and every edit lands and parses", () => {
    for (let round = 0; round < 3000; round += 1) {
      let text = `{ "k": ${generate(0)} }`;
      for (let edits = Math.floor(random() * 3); edits > 0; edits -= 1) {
        const at = Math.floor(random() * (text.length + 1));
        text =
          random() < 0.5
            ? text.slice(0, at) + pick(moreNoise) + text.slice(at)
            : text.slice(0, at) + text.slice(at + 1);
      }
      const errors: ParseError[] = [];
      const tree = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
      const theirs = errors.length === 0 && (tree === undefined || tree.type === "object");
      const parsed = parseSettingsText(text);
      expect(parsed.ok, text).toBe(theirs);
      if (!parsed.ok || !tree) continue;
      expect(plain(parsed.values), text).toEqual(without(plain(nodeData(tree))));
      const writes: [string[], unknown][] = [
        [["a"], "X"],
        [["b", "c"], { z: 1 }],
        [["a"], undefined],
        [["c", "a"], undefined],
      ];
      for (const [path, value] of writes) {
        const edit = editSettingsText(text, path, value);
        expect(edit.ok, text).toBe(true);
        const after = edit.ok ? parseSettingsText(edit.text) : undefined;
        expect(after?.ok, text).toBe(true);
        let current: unknown = after?.ok ? after.values : undefined;
        for (const segment of path) {
          current =
            current && typeof current === "object" ? (current as never)[segment] : undefined;
        }
        const asData = (entry: unknown) => (entry === undefined ? undefined : plain(entry));
        expect(asData(current), `${text} ${path.join(".")}`).toEqual(asData(value));
      }
    }
  });
});

/** A jsonc-parser tree's value, as the reader builds it (the last duplicate applies). */
function nodeData(node: ReturnType<typeof parseTree>): unknown {
  if (!node) return undefined;
  if (node.type === "object") {
    const out: Record<string, unknown> = {};
    for (const property of node.children ?? []) {
      out[property.children![0]!.value as string] = nodeData(property.children![1]);
    }
    return out;
  }
  if (node.type === "array") return (node.children ?? []).map(nodeData);
  return node.value as unknown;
}

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

describe("editSettingsText layouts", () => {
  const edit = (text: string, path: string[], value: unknown) => {
    const result = editSettingsText(text, path, value);
    if (!result.ok) throw new Error(result.reason);
    return result.text;
  };

  it("formats new keys into an empty and a multi-line document", () => {
    expect(edit("{\n}\n", ["omnigent.style.header"], "solid")).toBe(
      '{\n  "omnigent.style.header": "solid"\n}\n',
    );
    expect(edit('{\n  "a": "b"\n}\n', ["c", "d"], "e")).toBe(
      '{\n  "a": "b",\n  "c": {\n    "d": "e"\n  }\n}\n',
    );
  });

  it("keeps a trailing comma, and a comment on the last line, where they are", () => {
    expect(edit('{\n  "a": "b", // note\n}\n', ["c"], "d")).toBe(
      '{\n  "a": "b", // note\n  "c": "d"\n}\n',
    );
    expect(edit('{\n  "a": "b" // note\n}\n', ["c"], "d")).toBe(
      '{\n  "a": "b", // note\n  "c": "d"\n}\n',
    );
    expect(edit('{ "a": "b" }', ["c"], "d")).toBe('{ "a": "b", "c": "d" }\n');
  });

  it("replaces a value in place, and removes keys with their commas and lines", () => {
    expect(edit('{\n  "a": "b", // keep\n  "c": "d"\n}\n', ["a"], "z")).toBe(
      '{\n  "a": "z", // keep\n  "c": "d"\n}\n',
    );
    expect(edit('{\n  "a": "b",\n  "c": "d"\n}\n', ["a"], undefined)).toBe('{\n  "c": "d"\n}\n');
    expect(edit('{\n  "a": "b",\n  "c": "d"\n}\n', ["c"], undefined)).toBe('{\n  "a": "b"\n}\n');
    expect(edit('{ "a": "b", "c": "d" }', ["a"], undefined)).toBe('{ "c": "d" }\n');
  });

  it("removes every duplicate of a key, and writes the one that applies", () => {
    const text = '{ "a": "1", "a": "2" }';
    expect(edit(text, ["a"], undefined)).toBe("{  }\n");
    const set = edit(text, ["a"], "3");
    const parsed = parseSettingsText(set);
    expect(parsed.ok && plain(parsed.values)).toEqual({ a: "3" });
  });

  it("writes over a value nested too deeply", () => {
    const text = '{ "x": [[[[[[[1]]]]]]], "y": "z" }';
    const parsed = parseSettingsText(edit(text, ["x", "a"], "b"));
    expect(parsed.ok && plain(parsed.values)).toEqual({ x: { a: "b" }, y: "z" });
    expect(parsed.ok && parsed.problems).toEqual([]);
  });
});

describe("migrateLegacySettings", () => {
  const legacy = {
    options: { "acme.x/family": { accent: "lava", corners: "soft" }, "bad[": { a: "b" } },
    variants: { density: "compact", label: 3 },
    customizations: { primary: "#111111", "[nord]": { background: "#000" } },
  };

  it("builds the document from the old keys", () => {
    const { settings, complete } = migrateLegacySettings(EMPTY_STORED_SETTINGS, legacy);
    expect(complete).toBe(true);
    expect(settings.valid).toBe(true);
    expect(plain(settings.values)).toEqual({
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
    const { settings } = migrateLegacySettings(current, { variants: { density: "compact" } });
    expect(settings.text).toContain("// mine");
    expect(plain(settings.values)).toEqual({
      "omnigent.style.density": "compact",
      "omnigent.style.header": "solid",
    });
  });

  it("merges colour customizations token by token, the document's tokens winning", () => {
    const current = storeSettings(
      '{\n  // mine\n  "workbench.colorCustomizations": { "primary": "#222222", "[nord]": { "ring": "#333333" } }\n}\n',
      EMPTY_STORED_SETTINGS.values,
    );
    const { settings, complete } = migrateLegacySettings(current, {
      customizations: {
        primary: "#111111",
        foreground: "#444444",
        "[nord]": { ring: "#555555", background: "#000000" },
        "[dracula]": { primary: "#666666" },
      },
    });
    expect(complete).toBe(true);
    expect(settings.text).toContain("// mine");
    expect(plain(settings.values)).toEqual({
      "workbench.colorCustomizations": {
        primary: "#222222",
        foreground: "#444444",
        "[nord]": { ring: "#333333", background: "#000000" },
        "[dracula]": { primary: "#666666" },
      },
    });
  });

  it("keeps the legacy keys while a malformed document can't take them, applying them meanwhile", () => {
    const current = { text: "{ oops", values: EMPTY_STORED_SETTINGS.values, valid: false };
    const { settings, complete } = migrateLegacySettings(current, {
      variants: { density: "compact" },
    });
    expect(complete).toBe(false);
    expect(settings).toMatchObject({ text: "{ oops", valid: false });
    expect(plain(settings.values)).toEqual({ "omnigent.style.density": "compact" });
    // Fixed, the same legacy values go into the text.
    const fixed = storeSettings('{ "omnigent.style.header": "solid" }', settings.values);
    const again = migrateLegacySettings(fixed, { variants: { density: "compact" } });
    expect(again.complete).toBe(true);
    expect(plain(parseSettingsText(again.settings.text).ok && again.settings.values)).toEqual({
      "omnigent.style.header": "solid",
      "omnigent.style.density": "compact",
    });
  });

  it("is incomplete when a write is refused, such as one over the length limit", () => {
    const { settings, complete } = migrateLegacySettings(EMPTY_STORED_SETTINGS, {
      variants: { density: "compact", header: "x".repeat(SETTINGS_TEXT_LIMIT - 30) },
    });
    expect(complete).toBe(false);
    expect(plain(settings.values)).toEqual({ "omnigent.style.density": "compact" });
  });

  it("never takes a __proto__ key, nor loses the last good values to one", () => {
    const legacyProto = {
      options: JSON.parse('{ "__proto__": { "a": "b" }, "s": { "__proto__": "x", "ok": "y" } }'),
      customizations: JSON.parse('{ "__proto__": { "primary": "red" }, "ring": "#123456" }'),
    } as const;
    const broken = {
      text: "{",
      values: storeSettings('{ "omnigent.style.header": "solid" }', EMPTY_STORED_SETTINGS.values)
        .values,
      valid: false,
    };
    const { settings } = migrateLegacySettings(broken, legacyProto);
    expect(plain(settings.values)).toEqual({
      "omnigent.style.header": "solid",
      // A scope named __proto__ is only a name in brackets.
      "omnigent.themeOptions": { "[__proto__]": { a: "b" }, "[s]": { ok: "y" } },
      "workbench.colorCustomizations": { ring: "#123456" },
    });
    const valid = migrateLegacySettings(EMPTY_STORED_SETTINGS, legacyProto).settings;
    expect(valid.text).not.toMatch(/"__proto__"/);
    expect(({} as Record<string, unknown>).primary).toBeUndefined();
  });

  it("changes nothing without legacy values, and drops unreadable ones", () => {
    expect(migrateLegacySettings(EMPTY_STORED_SETTINGS, {})).toEqual({
      settings: EMPTY_STORED_SETTINGS,
      complete: true,
    });
    let deep: unknown = "x";
    for (let index = 0; index < 50; index += 1) deep = { a: deep };
    expect(migrateLegacySettings(EMPTY_STORED_SETTINGS, { customizations: deep }).complete).toBe(
      true,
    );
  });
});
