// The user's theme settings as one JSON document (theming plan M10b), as VS Code keeps
// `settings.json`: the theme options, the style variants and the colour customizations. The
// text is stored as written (JSONC: comments and trailing commas), with the last values that
// parsed, so a text with syntax errors keeps the previous values applying. Writes edit the
// text in place, keeping its comments, and are refused while it doesn't parse. Pure.

import {
  applyEdits,
  modify,
  type Node as JsonNode,
  type ParseError,
  parseTree,
  printParseErrorCode,
} from "jsonc-parser";

import { nullMap, type PlainData, snapshotPlainData } from "./validate";

/** The document's storage key: `{ version: 1, text, values }`. */
export const SETTINGS_STORAGE_KEY = "omnigent:ui-settings";

/** The colour customizations: token ids, and `[<theme id>]` objects of them (VS Code's key). */
export const COLOR_CUSTOMIZATIONS_SETTING = "workbench.colorCustomizations";
/** The theme options: `{ "[<scope>]": { "<option id>": "<choice id>" } }`. */
export const THEME_OPTIONS_SETTING = "omnigent.themeOptions";
/** One key per style variant: `omnigent.style.density`. */
export const STYLE_SETTING_PREFIX = "omnigent.style.";

/** The keys before M10b, read once into the document and removed. */
export const LEGACY_THEME_OPTIONS_STORAGE_KEY = "omnigent:ui-theme-options";
export const LEGACY_VARIANTS_STORAGE_KEY = "omnigent:ui-variants";
export const LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY = "omnigent:ui-color-customizations";
export const LEGACY_SETTINGS_STORAGE_KEYS = [
  LEGACY_THEME_OPTIONS_STORAGE_KEY,
  LEGACY_VARIANTS_STORAGE_KEY,
  LEGACY_COLOR_CUSTOMIZATIONS_STORAGE_KEY,
] as const;

/** The longest text stored or parsed. */
export const SETTINGS_TEXT_LIMIT = 131_072;
/** The values' limits (the colour customizations keep their own, tighter ones). */
const VALUE_LIMITS = { chars: SETTINGS_TEXT_LIMIT, nodes: 10_000, depth: 6 } as const;

/** What an empty document shows in the editor. */
export const EMPTY_SETTINGS_TEXT = "{\n}\n";

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: "\n" } as const;
const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false } as const;

/** A problem at a span of the text. */
export interface SettingsTextProblem {
  readonly offset: number;
  readonly length: number;
  readonly message: string;
}

export type SettingsValues = Readonly<Record<string, PlainData>>;

/** The text parsed: its values, or why it doesn't parse. */
export type ParsedSettings =
  | { readonly ok: true; readonly values: SettingsValues; readonly root: JsonNode | undefined }
  | { readonly ok: false; readonly errors: readonly SettingsTextProblem[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A syntax error's message, as VS Code words them ("Expected comma"). */
function syntaxMessage(error: ParseError): string {
  const code = printParseErrorCode(error.error);
  return code
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/^./, (first) => first.toUpperCase());
}

/**
 * The value `node` holds, built from the tree rather than by assignment, so a `__proto__`
 * key is only a key (it is left out, and flagged by the language service).
 */
function nodeValue(node: JsonNode): unknown {
  switch (node.type) {
    case "object": {
      const out = nullMap<unknown>();
      for (const property of node.children ?? []) {
        const [key, value] = property.children ?? [];
        if (!key || !value || typeof key.value !== "string" || key.value === "__proto__") continue;
        out[key.value] = nodeValue(value);
      }
      return out;
    }
    case "array":
      return (node.children ?? []).map(nodeValue);
    default:
      return node.value;
  }
}

/** Parses the settings text (an empty text is an empty document). */
export function parseSettingsText(text: string): ParsedSettings {
  if (text.length > SETTINGS_TEXT_LIMIT) {
    return {
      ok: false,
      errors: [{ offset: 0, length: 0, message: `Longer than ${SETTINGS_TEXT_LIMIT} characters` }],
    };
  }
  if (text.trim() === "" || /^\s*(\/\/[^\n]*\n?\s*|\/\*[\s\S]*?\*\/\s*)*$/.test(text)) {
    return { ok: true, values: nullMap(), root: undefined };
  }
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, PARSE_OPTIONS);
  if (errors.length > 0 || !root) {
    return {
      ok: false,
      errors: errors.map((error) => ({
        offset: error.offset,
        length: error.length,
        message: syntaxMessage(error),
      })),
    };
  }
  if (root.type !== "object") {
    return {
      ok: false,
      errors: [{ offset: root.offset, length: root.length, message: "Settings are a JSON object" }],
    };
  }
  const snapshot = snapshotPlainData(nodeValue(root), VALUE_LIMITS);
  if (!snapshot.ok) {
    return { ok: false, errors: [{ offset: 0, length: 0, message: snapshot.reason }] };
  }
  return { ok: true, values: snapshot.value as SettingsValues, root };
}

/** The stored document: the text as written, and the values that apply. */
export interface StoredSettings {
  readonly text: string;
  readonly values: SettingsValues;
  /** Whether the text parses (else `values` are the last ones that did). */
  readonly valid: boolean;
}

export const EMPTY_STORED_SETTINGS: StoredSettings = Object.freeze({
  text: "",
  values: Object.freeze(nullMap<PlainData>()),
  valid: true,
});

/**
 * Reads the stored record (never throws). The text's own values win when it parses; the
 * stored `values` only stand in for a text that doesn't, and are checked again where they apply.
 */
export function readStoredSettings(raw: string | null): StoredSettings {
  if (raw === null) return EMPTY_STORED_SETTINGS;
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return EMPTY_STORED_SETTINGS;
  }
  if (!isRecord(record) || record.version !== 1 || typeof record.text !== "string") {
    return EMPTY_STORED_SETTINGS;
  }
  const text = record.text.slice(0, SETTINGS_TEXT_LIMIT);
  const parsed = parseSettingsText(text);
  if (parsed.ok) return { text, values: parsed.values, valid: true };
  const snapshot = snapshotPlainData(record.values ?? null, VALUE_LIMITS);
  const values =
    snapshot.ok && isRecord(snapshot.value)
      ? (snapshot.value as SettingsValues)
      : nullMap<PlainData>();
  return { text, values, valid: false };
}

/** The record to store for `text`, keeping `previous` values when the text doesn't parse. */
export function storeSettings(text: string, previous: SettingsValues): StoredSettings {
  const parsed = parseSettingsText(text);
  return parsed.ok
    ? { text, values: parsed.values, valid: true }
    : { text, values: previous, valid: false };
}

export function serializeSettings(settings: StoredSettings): string {
  return JSON.stringify({ version: 1, text: settings.text, values: settings.values });
}

/** Why the text can't be written to, or null. */
export const SETTINGS_WRITE_BLOCKED = "Fix the errors in the settings JSON first.";

export type SettingsEdit =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string };

/**
 * Sets (or with `undefined`, removes) the value at `path` in the text, keeping its comments
 * and layout. A removal also removes the objects it leaves empty on the way up, so a
 * cleared option leaves no `"[<scope>]": {}` behind.
 */
export function editSettingsText(
  text: string,
  path: readonly string[],
  value: unknown,
): SettingsEdit {
  const base = text.trim() === "" ? "{}" : text;
  const parsed = parseSettingsText(base);
  if (!parsed.ok) return { ok: false, reason: SETTINGS_WRITE_BLOCKED };
  if (!parsed.root) {
    // Only comments: a document after them.
    return editSettingsText(`${base.replace(/\s*$/, "\n")}{}\n`, path, value);
  }
  let next = applyEdits(base, modify(base, [...path], value, { formattingOptions: FORMATTING }));
  if (value === undefined) {
    for (let depth = path.length - 1; depth > 0; depth -= 1) {
      const parent = path.slice(0, depth);
      const reparsed = parseSettingsText(next);
      if (!reparsed.ok) break;
      let current: unknown = reparsed.values;
      for (const segment of parent) current = isRecord(current) ? current[segment] : undefined;
      if (!isRecord(current) || Object.keys(current).length > 0) break;
      next = applyEdits(next, modify(next, parent, undefined, { formattingOptions: FORMATTING }));
    }
  }
  if (next.length > SETTINGS_TEXT_LIMIT) {
    return {
      ok: false,
      reason: `The settings would be longer than ${SETTINGS_TEXT_LIMIT} characters.`,
    };
  }
  return { ok: true, text: next.endsWith("\n") ? next : `${next}\n` };
}

/** What the legacy keys held, as read from storage. */
export interface LegacySettings {
  /** `omnigent:ui-theme-options`: scope (no brackets) to option choices. */
  readonly options?: unknown;
  /** `omnigent:ui-variants`: variant name to value. */
  readonly variants?: unknown;
  /** `omnigent:ui-color-customizations`. */
  readonly customizations?: unknown;
}

/** The `[path, value]` writes that carry the legacy values into the document. */
export function legacySettingsWrites(legacy: LegacySettings): [string[], unknown][] {
  const writes: [string[], unknown][] = [];
  if (isRecord(legacy.options)) {
    for (const [scope, choices] of Object.entries(legacy.options)) {
      if (!isRecord(choices) || scope.length > 200 || /[[\]]/.test(scope)) continue;
      for (const [option, choice] of Object.entries(choices)) {
        if (typeof choice === "string") {
          writes.push([[THEME_OPTIONS_SETTING, `[${scope}]`, option], choice]);
        }
      }
    }
  }
  if (isRecord(legacy.variants)) {
    for (const [name, value] of Object.entries(legacy.variants)) {
      if (typeof value === "string") writes.push([[`${STYLE_SETTING_PREFIX}${name}`], value]);
    }
  }
  if (isRecord(legacy.customizations) && Object.keys(legacy.customizations).length > 0) {
    writes.push([[COLOR_CUSTOMIZATIONS_SETTING], legacy.customizations]);
  }
  return writes;
}

/**
 * The document with the legacy values written over its keys. A text that doesn't parse
 * keeps its text, and the values join its last good ones instead.
 */
export function migrateLegacySettings(
  current: StoredSettings,
  legacy: LegacySettings,
): StoredSettings {
  const writes = legacySettingsWrites(legacy);
  if (writes.length === 0) return current;
  if (current.valid) {
    let text = current.text;
    for (const [path, value] of writes) {
      const edit = editSettingsText(text, path, value);
      if (edit.ok) text = edit.text;
    }
    return storeSettings(text, current.values);
  }
  const values = { ...current.values } as Record<string, unknown>;
  for (const [path, value] of writes) {
    let target = values;
    for (const segment of path.slice(0, -1)) {
      const existing = target[segment];
      const copy = isRecord(existing) ? { ...existing } : {};
      target[segment] = copy;
      target = copy;
    }
    target[path.at(-1)!] = value;
  }
  const snapshot = snapshotPlainData(values, VALUE_LIMITS);
  return {
    text: current.text,
    values: snapshot.ok ? (snapshot.value as SettingsValues) : current.values,
    valid: false,
  };
}
