// The user's theme settings as one JSON document (theming plan M10b), as VS Code keeps
// `settings.json`: the theme options, the style variants and the colour customizations. The
// text is stored as written (JSONC: comments and trailing commas), with the last values that
// parsed, so a text with syntax errors keeps the previous values applying. Writes edit the
// text in place, keeping its comments, and are refused while it doesn't parse. Pure.
//
// Boot reads this document, so it carries its own small JSONC reader and editor rather than
// a parser library (the editor's language service loads one with the dialog). The reader is
// iterative: no nesting can overflow the stack. A key whose value nests deeper than the
// values' depth limit is left out of the values and reported at that key; the rest applies.

import { nullMap, type PlainData, snapshotPlainData } from "./validate";

/** The document's storage key: `{ version: 1, text, values }`. */
export const SETTINGS_STORAGE_KEY = "omnigent:ui-settings";

/** The colour customizations: token ids, and `[<theme id>]` objects of them (VS Code's key). */
export const COLOR_CUSTOMIZATIONS_SETTING = "workbench.colorCustomizations";
/** The theme options: `{ "[<scope>]": { "<option id>": "<choice id>" } }`. */
export const THEME_OPTIONS_SETTING = "omnigent.themeOptions";
/** One key per style variant: `omnigent.style.density`. */
export const STYLE_SETTING_PREFIX = "omnigent.style.";

/** What a product-locked setting's row, diagnostic and hover say. */
export const SET_BY_PRODUCT = "Set by product";

/** The keys before M10b, read into the document and removed once they are in its text. */
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
export const SETTINGS_VALUE_LIMITS = {
  chars: SETTINGS_TEXT_LIMIT,
  nodes: 10_000,
  depth: 6,
} as const;

/** What an empty document shows in the editor. */
export const EMPTY_SETTINGS_TEXT = "{\n}\n";

const INDENT_UNIT = "  ";

/** A problem at a span of the text. */
export interface SettingsTextProblem {
  readonly offset: number;
  readonly length: number;
  readonly message: string;
  /** The key path, when the problem is a key's (its value is left out). */
  readonly path?: readonly string[];
}

/**
 * A node of the parsed text, shaped as jsonc-parser's `Node`, so the language service's
 * tree helpers take it. A value nested past the depth limit is `truncated`: its span only.
 */
export interface SettingsNode {
  readonly type: "object" | "array" | "property" | "string" | "number" | "boolean" | "null";
  readonly offset: number;
  readonly length: number;
  readonly value?: unknown;
  readonly children?: SettingsNode[];
  readonly parent?: SettingsNode;
  readonly colonOffset?: number;
  readonly truncated?: true;
}

export type SettingsValues = Readonly<Record<string, PlainData>>;

/** The text parsed: its values (and keys left out of them), or why it doesn't parse. */
export type ParsedSettings =
  | {
      readonly ok: true;
      readonly values: SettingsValues;
      readonly root: SettingsNode | undefined;
      /** Keys whose values are left out (nested too deeply). */
      readonly problems: readonly SettingsTextProblem[];
    }
  | { readonly ok: false; readonly errors: readonly SettingsTextProblem[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- Reading -------------------------------------------------------------------------

type TokenKind =
  "{" | "}" | "[" | "]" | ":" | "," | "string" | "number" | "true" | "false" | "null" | "eof";

interface Token {
  readonly kind: TokenKind;
  readonly offset: number;
  readonly length: number;
  readonly value?: string | number;
}

/** The first syntax error, in VS Code's words ("Comma expected"). */
class SyntaxProblem {
  readonly offset: number;
  readonly length: number;
  readonly message: string;
  constructor(offset: number, length: number, message: string) {
    this.offset = offset;
    this.length = length;
    this.message = message;
  }
}

const PUNCTUATION = new Set<string>(["{", "}", "[", "]", ":", ","]);
const isDigit = (code: number) => code >= 48 && code <= 57;
/** The offset of the line break that ends the line `from` is on (or the text's end). */
function lineEnd(text: string, from: number): number {
  let offset = from;
  while (offset < text.length && text[offset] !== "\n" && text[offset] !== "\r") offset += 1;
  return offset;
}
const isHex = (char: string) => /^[0-9a-fA-F]$/.test(char);
/** Characters that end an unknown word, as jsonc-parser's scanner sees them. */
const endsWord = (char: string) => /[\s{}[\],:"/]/.test(char);

/** The text's tokens, comments and whitespace skipped; throws the first {@link SyntaxProblem}. */
function tokenizer(text: string): () => Token {
  let position = 0;
  const skipWhitespaceAndComments = () => {
    while (position < text.length) {
      const char = text[position]!;
      if (char === " " || char === "\t" || char === "\n" || char === "\r") {
        position += 1;
      } else if (char === "/" && text[position + 1] === "/") {
        position = lineEnd(text, position);
      } else if (char === "/" && text[position + 1] === "*") {
        const end = text.indexOf("*/", position + 2);
        if (end < 0) {
          throw new SyntaxProblem(position, text.length - position, "Unexpected end of comment");
        }
        position = end + 2;
      } else {
        return;
      }
    }
  };
  const scanString = (start: number): Token => {
    let index = start + 1;
    while (index < text.length) {
      const char = text[index]!;
      if (char === '"') {
        const raw = text.slice(start, index + 1);
        return {
          kind: "string",
          offset: start,
          length: raw.length,
          value: JSON.parse(raw) as string,
        };
      }
      if (char === "\\") {
        const escape = text[index + 1];
        if (escape === "u") {
          const digits = text.slice(index + 2, index + 6);
          if (digits.length < 4 || ![...digits].every(isHex)) {
            throw new SyntaxProblem(index, 2, "Invalid unicode");
          }
          index += 6;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
          throw new SyntaxProblem(index, 2, "Invalid escape character");
        }
        index += 2;
        continue;
      }
      if (char === "\n" || char === "\r") break;
      if (char.charCodeAt(0) <= 0x1f) throw new SyntaxProblem(index, 1, "Invalid character");
      index += 1;
    }
    throw new SyntaxProblem(start, index - start, "Unexpected end of string");
  };
  const scanNumber = (start: number): Token | undefined => {
    const match = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
    match.lastIndex = start;
    const found = match.exec(text);
    if (!found) return undefined;
    const end = start + found[0].length;
    // `1.` and `1e`: jsonc-parser's "Unexpected end of number".
    if (text[end] === "." || text[end] === "e" || text[end] === "E") {
      throw new SyntaxProblem(start, end + 1 - start, "Unexpected end of number");
    }
    const value = Number(found[0]);
    if (!Number.isFinite(value)) throw new SyntaxProblem(start, end - start, "Number out of range");
    return { kind: "number", offset: start, length: end - start, value };
  };
  return () => {
    skipWhitespaceAndComments();
    const start = position;
    if (start >= text.length) return { kind: "eof", offset: start, length: 0 };
    const char = text[start]!;
    let token: Token | undefined;
    if (PUNCTUATION.has(char)) {
      token = { kind: char as TokenKind, offset: start, length: 1 };
    } else if (char === '"') {
      token = scanString(start);
    } else if (char === "-" || isDigit(char.charCodeAt(0))) {
      token = scanNumber(start);
    }
    if (!token) {
      let end = start + 1;
      while (end < text.length && !endsWord(text[end]!)) end += 1;
      const word = text.slice(start, end);
      if (word === "true" || word === "false" || word === "null") {
        token = { kind: word, offset: start, length: end - start };
      } else {
        throw new SyntaxProblem(start, end - start, "Invalid symbol");
      }
    }
    position = token.offset + token.length;
    return token;
  };
}

interface MutableNode {
  type: SettingsNode["type"];
  offset: number;
  length: number;
  value?: unknown;
  children?: MutableNode[];
  parent?: MutableNode;
  colonOffset?: number;
  truncated?: true;
}

/** An open object or array. `node` is null inside a truncated value (nothing is built). */
interface Frame {
  readonly kind: "object" | "array";
  readonly node: MutableNode | null;
  readonly value: Record<string, unknown> | unknown[] | null;
  /** Whether the next token may close it: after its opening, or a (trailing) comma. */
  closable: boolean;
  /** The property being read (objects). */
  property: MutableNode | null;
  key: string | null;
  /** The property's value nests too deeply: it is left out of the values. */
  dropped: boolean;
}

/**
 * Reads the settings text (an empty or comment-only text is an empty document). Never
 * throws, and never recurses: a hostile nesting is a key left out, not a stack overflow.
 */
export function parseSettingsText(text: string): ParsedSettings {
  if (text.length > SETTINGS_TEXT_LIMIT) {
    return {
      ok: false,
      errors: [{ offset: 0, length: 0, message: `Longer than ${SETTINGS_TEXT_LIMIT} characters` }],
    };
  }
  try {
    return readText(text);
  } catch (error) {
    if (error instanceof SyntaxProblem) {
      return {
        ok: false,
        errors: [{ offset: error.offset, length: error.length, message: error.message }],
      };
    }
    return { ok: false, errors: [{ offset: 0, length: 0, message: "Unreadable settings" }] };
  }
}

function readText(text: string): ParsedSettings {
  const next = tokenizer(text);
  const limits = SETTINGS_VALUE_LIMITS;
  const stack: Frame[] = [];
  const problems: SettingsTextProblem[] = [];
  let root: MutableNode | undefined;
  let rootValue: unknown;
  let nodes = 0;
  let token = next();
  if (token.kind === "eof") return { ok: true, values: nullMap(), root: undefined, problems };

  const fail = (message: string): never => {
    throw new SyntaxProblem(token.offset, token.length, message);
  };
  const building = () => stack.length === 0 || stack.at(-1)!.node !== null;
  const newNode = (type: MutableNode["type"], value?: unknown): MutableNode => {
    nodes += 1;
    if (nodes > limits.nodes) {
      throw new SyntaxProblem(token.offset, token.length, `More than ${limits.nodes} values`);
    }
    return { type, offset: token.offset, length: token.length, value };
  };
  /** The key path to `owner`'s property, when every value holding it is an object. */
  const keyPath = (owner: Frame): string[] | undefined => {
    const path: string[] = [];
    for (const frame of stack.slice(0, stack.indexOf(owner) + 1)) {
      if (frame.kind !== "object" || frame.key === null) return undefined;
      path.push(frame.key);
    }
    return path;
  };
  /** Hands a finished value to what holds it. */
  const complete = (node: MutableNode | null, value: unknown) => {
    const parent = stack.at(-1);
    if (!parent) {
      root = node!;
      rootValue = value;
      return;
    }
    if (parent.kind === "array") {
      if (parent.node && node) {
        node.parent = parent.node;
        parent.node.children!.push(node);
        (parent.value as unknown[]).push(value);
      }
    } else {
      const property = parent.property;
      if (property && node) {
        node.parent = property;
        property.children!.push(node);
        property.length = node.offset + node.length - property.offset;
        const key = parent.key!;
        if (!parent.dropped && key !== "__proto__") {
          (parent.value as Record<string, unknown>)[key] = value;
        }
      }
      parent.property = null;
      parent.key = null;
      parent.dropped = false;
    }
    parent.closable = false;
  };
  const open = (kind: "object" | "array") => {
    const depth = stack.length;
    let node: MutableNode | null = null;
    let value: Frame["value"] = null;
    if (building()) {
      node = newNode(kind);
      if (depth >= limits.depth) {
        // Too deep: keep its span, build nothing inside, and leave the nearest key out.
        node.truncated = true;
        const owner = [...stack].reverse().find((frame) => frame.kind === "object");
        if (owner?.property && !owner.dropped) {
          owner.dropped = true;
          const key = owner.property.children![0]!;
          const path = keyPath(owner);
          problems.push({
            offset: key.offset,
            length: key.length,
            message: `Nested too deeply (more than ${limits.depth} levels): this value doesn't apply.`,
            ...(path ? { path } : {}),
          });
        }
      } else {
        node.children = [];
        value = kind === "object" ? nullMap<unknown>() : [];
      }
    }
    // A truncated value's node is attached when it closes; its contents never are.
    stack.push({
      kind,
      node: node && !node.truncated ? node : null,
      value,
      closable: true,
      property: null,
      key: null,
      dropped: false,
    });
    return node;
  };
  // Truncated values still open, by stack depth: their nodes close with them.
  const truncated = new Map<number, MutableNode>();
  const close = () => {
    const frame = stack.pop()!;
    const node = frame.node ?? truncated.get(stack.length) ?? null;
    truncated.delete(stack.length);
    if (node) node.length = token.offset + 1 - node.offset;
    complete(node, frame.value);
  };

  let state: "value" | "key" | "colon" | "after" = "value";
  for (;;) {
    switch (state) {
      case "value": {
        const frame = stack.at(-1);
        if (token.kind === "{" || token.kind === "[") {
          const node = open(token.kind === "{" ? "object" : "array");
          if (node?.truncated) truncated.set(stack.length - 1, node);
          state = token.kind === "{" ? "key" : "value";
          token = next();
          continue;
        }
        if (token.kind === "]" && frame?.kind === "array" && frame.closable) {
          close();
          state = "after";
          token = next();
          continue;
        }
        let value: unknown;
        let type: MutableNode["type"];
        switch (token.kind) {
          case "string":
          case "number":
            type = token.kind;
            value = token.value;
            break;
          case "true":
          case "false":
            type = "boolean";
            value = token.kind === "true";
            break;
          case "null":
            type = "null";
            value = null;
            break;
          default:
            return fail("Value expected");
        }
        complete(building() ? newNode(type, value) : null, value);
        state = "after";
        token = next();
        continue;
      }
      case "key": {
        const frame = stack.at(-1)!;
        if (token.kind === "string") {
          if (frame.node) {
            const property: MutableNode = {
              type: "property",
              offset: token.offset,
              length: token.length,
              parent: frame.node,
              children: [],
            };
            // A key isn't a value: it doesn't count toward the values limit.
            const key: MutableNode = {
              type: "string",
              offset: token.offset,
              length: token.length,
              value: token.value,
              parent: property,
            };
            property.children!.push(key);
            frame.node.children!.push(property);
            frame.property = property;
          }
          frame.key = token.value as string;
          state = "colon";
          token = next();
          continue;
        }
        if (token.kind === "}" && frame.closable) {
          close();
          state = "after";
          token = next();
          continue;
        }
        return fail(token.kind === "eof" ? "Close brace expected" : "Property name expected");
      }
      case "colon": {
        if (token.kind !== ":") return fail("Colon expected");
        const frame = stack.at(-1)!;
        if (frame.property) frame.property.colonOffset = token.offset;
        state = "value";
        token = next();
        continue;
      }
      case "after": {
        const frame = stack.at(-1);
        if (!frame) {
          if (token.kind !== "eof") return fail("End of file expected");
          break;
        }
        const closer = frame.kind === "object" ? "}" : "]";
        if (token.kind === ",") {
          frame.closable = true;
          state = frame.kind === "object" ? "key" : "value";
          token = next();
          continue;
        }
        if (token.kind === closer) {
          close();
          token = next();
          continue;
        }
        if (token.kind === "eof") {
          return fail(frame.kind === "object" ? "Close brace expected" : "Close bracket expected");
        }
        return fail("Comma expected");
      }
    }
    break;
  }
  if (!root || root.type !== "object") {
    return {
      ok: false,
      errors: [
        {
          offset: root?.offset ?? 0,
          length: root?.length ?? 0,
          message: "Settings are a JSON object",
        },
      ],
    };
  }
  return { ok: true, values: rootValue as SettingsValues, root, problems };
}

// --- Storing -------------------------------------------------------------------------

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

/** Stored values, checked again: a plain object within the limits, else none. */
function checkedValues(raw: unknown): SettingsValues {
  const snapshot = snapshotPlainData(raw ?? null, SETTINGS_VALUE_LIMITS);
  return snapshot.ok && isRecord(snapshot.value)
    ? (snapshot.value as SettingsValues)
    : nullMap<PlainData>();
}

/**
 * Reads the stored record, and never throws: whatever it holds, boot goes on. The text's
 * own values win when it parses; the stored `values` only stand in for a text that doesn't
 * (the last good ones), and are checked again where they apply. Anything unreadable is the
 * defaults.
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
  try {
    const parsed = parseSettingsText(text);
    if (parsed.ok) return { text, values: parsed.values, valid: true };
  } catch {
    // Not expected (the reader doesn't throw); the last good values stand in.
  }
  return { text, values: checkedValues(record.values), valid: false };
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

// --- Editing -------------------------------------------------------------------------

/** Why the text can't be written to, or null. */
export const SETTINGS_WRITE_BLOCKED = "Fix the errors in the settings JSON first.";

export type SettingsEdit =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string };

/** The whitespace that starts the line `offset` is on. */
function lineIndent(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start, offset))![0];
}

/** `value` as formatted JSON, its later lines indented by `indent`. */
function formatValue(value: unknown, indent: string): string {
  return JSON.stringify(value, null, INDENT_UNIT.length).replace(/\n/g, `\n${indent}`);
}

/** The last property of `object` named `key` (the one that applies). */
function findProperty(object: SettingsNode, key: string): SettingsNode | undefined {
  return (object.children ?? []).findLast((property) => property.children?.[0]?.value === key);
}

/** `value` under the keys of `path`, outermost first. */
function nest(path: readonly string[], value: unknown): unknown {
  return path.reduceRight<unknown>((inner, key) => {
    const object = nullMap<unknown>();
    object[key] = inner;
    return object;
  }, value);
}

/** The end of the comments that follow `from` on its line, or `from` when there are none. */
function lineCommentsEnd(text: string, from: number): number {
  let offset = from;
  let end = from;
  for (;;) {
    while (text[offset] === " " || text[offset] === "\t") offset += 1;
    if (text.startsWith("/*", offset)) {
      const close = text.indexOf("*/", offset + 2);
      if (close < 0 || text.slice(offset, close).includes("\n")) return end;
      offset = close + 2;
      end = offset;
    } else if (text.startsWith("//", offset)) {
      return lineEnd(text, offset);
    } else {
      return end;
    }
  }
}

function insertProperty(text: string, object: SettingsNode, key: string, value: unknown): string {
  const properties = object.children ?? [];
  const open = object.offset;
  const close = object.offset + object.length - 1;
  const objectIndent = lineIndent(text, open);
  const indent = objectIndent + INDENT_UNIT;
  const entry = (at: string) => `${JSON.stringify(key)}: ${formatValue(value, at)}`;
  const last = properties.at(-1);
  if (!last) {
    if (text.slice(open + 1, close).trim() === "") {
      return `${text.slice(0, open + 1)}\n${indent}${entry(indent)}\n${objectIndent}${text.slice(close)}`;
    }
    // Only comments inside: the property goes first.
    return `${text.slice(0, open + 1)}\n${indent}${entry(indent)}${text.slice(open + 1)}`;
  }
  const lastEnd = last.offset + last.length;
  if (!text.slice(open, last.offset).includes("\n")) {
    // A one-line object stays one line (an existing trailing comma follows the new entry).
    return `${text.slice(0, lastEnd)}, ${entry(objectIndent)}${text.slice(lastEnd)}`;
  }
  const lastIndent = lineIndent(text, last.offset);
  const lineStart = text.lastIndexOf("\n", last.offset - 1) + 1;
  const propertyIndent =
    text.slice(lineStart, last.offset).trim() === "" ? lastIndent : lastIndent + INDENT_UNIT;
  const entryText = `\n${propertyIndent}${entry(propertyIndent)}`;
  let comma = lastEnd;
  while (text[comma] === " " || text[comma] === "\t") comma += 1;
  if (text[comma] === ",") {
    // A comma follows already (a trailing one): the entry goes after that line's comments.
    const insertAt = lineCommentsEnd(text, comma + 1);
    return text.slice(0, insertAt) + entryText + text.slice(insertAt);
  }
  // A comma after the last value, and the entry after the comments on its line.
  const insertAt = lineCommentsEnd(text, lastEnd);
  return `${text.slice(0, lastEnd)},${text.slice(lastEnd, insertAt)}${entryText}${text.slice(insertAt)}`;
}

/** The offset past whitespace and comments from `offset`. */
function skipTrivia(text: string, offset: number): number {
  let at = offset;
  for (;;) {
    while (at < text.length && /\s/.test(text[at]!)) at += 1;
    if (text.startsWith("//", at)) {
      at = lineEnd(text, at);
    } else if (text.startsWith("/*", at)) {
      const end = text.indexOf("*/", at + 2);
      at = end < 0 ? text.length : end + 2;
    } else {
      return at;
    }
  }
}

function removeProperty(text: string, object: SettingsNode, property: SettingsNode): string {
  const properties = object.children ?? [];
  const index = properties.indexOf(property);
  let start = property.offset;
  let end = property.offset + property.length;
  const following = skipTrivia(text, end);
  if (text[following] === ",") {
    end = following + 1;
    while (text[end] === " " || text[end] === "\t") end += 1;
  } else if (index > 0) {
    // The last property: the comma before it goes with it.
    const previous = properties[index - 1]!;
    const comma = skipTrivia(text, previous.offset + previous.length);
    if (text[comma] === ",") start = comma;
  }
  // A line left blank goes too.
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const blankRest = /^[ \t]*(\r?\n|$)/.exec(text.slice(end));
  if (text.slice(lineStart, start).trim() === "" && blankRest) {
    start = lineStart;
    end += blankRest[0].length;
  }
  return text.slice(0, start) + text.slice(end);
}

/** The text with `path` set to `value` (a parsed text's `root`). */
function setPath(
  text: string,
  root: SettingsNode,
  path: readonly string[],
  value: unknown,
): string {
  let object = root;
  for (let index = 0; index < path.length; index += 1) {
    const property = findProperty(object, path[index]!);
    const rest = path.slice(index + 1);
    if (!property) return insertProperty(text, object, path[index]!, nest(rest, value));
    const current = property.children?.[1];
    if (!current) return text;
    if (rest.length === 0 || current.type !== "object" || current.truncated) {
      const replacement = formatValue(nest(rest, value), lineIndent(text, property.offset));
      return (
        text.slice(0, current.offset) + replacement + text.slice(current.offset + current.length)
      );
    }
    object = current;
  }
  return text;
}

/** The text without `path` (unchanged when it isn't there). */
function removePath(text: string, root: SettingsNode, path: readonly string[]): string {
  let object: SettingsNode | undefined = root;
  for (const segment of path.slice(0, -1)) {
    const value: SettingsNode | undefined = object && findProperty(object, segment)?.children?.[1];
    object = value?.type === "object" && !value.truncated ? value : undefined;
  }
  const property = object && findProperty(object, path.at(-1)!);
  return object && property ? removeProperty(text, object, property) : text;
}

/** The parsed text's tree, or undefined when it doesn't parse. */
function treeOf(text: string): SettingsNode | undefined {
  const parsed = parseSettingsText(text);
  return parsed.ok ? parsed.root : undefined;
}

/**
 * Sets (or with `undefined`, removes) the value at `path` in the text, keeping its comments
 * and layout. A removal takes every duplicate of the key, and also removes the objects it
 * leaves empty on the way up, so a cleared option leaves no `"[<scope>]": {}` behind.
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
    return editSettingsText(`${base.trimEnd()}\n{}\n`, path, value);
  }
  if (path.length === 0) return { ok: false, reason: "No setting to write." };
  let next: string;
  if (value === undefined) {
    next = base;
    for (let depth = path.length; depth > 0; depth -= 1) {
      const target = path.slice(0, depth);
      // Duplicates: each one goes, so none is left to apply.
      for (let tree = treeOf(next); tree; tree = treeOf(next)) {
        const removed = removePath(next, tree, target);
        if (removed === next) break;
        next = removed;
      }
      if (depth === 1) break;
      const values = (parseSettingsText(next) as { values?: unknown }).values;
      let parent: unknown = values;
      for (const segment of path.slice(0, depth - 1)) {
        parent = isRecord(parent) ? parent[segment] : undefined;
      }
      if (!isRecord(parent) || Object.keys(parent).length > 0) break;
    }
  } else {
    next = setPath(base, parsed.root, path, value);
  }
  if (next.length > SETTINGS_TEXT_LIMIT) {
    return {
      ok: false,
      reason: `The settings would be longer than ${SETTINGS_TEXT_LIMIT} characters.`,
    };
  }
  if (!parseSettingsText(next).ok)
    return { ok: false, reason: "The edit would break the settings." };
  return { ok: true, text: next.endsWith("\n") ? next : `${next}\n` };
}

// --- Migration -----------------------------------------------------------------------

/** What the legacy keys held, as read from storage. */
export interface LegacySettings {
  /** `omnigent:ui-theme-options`: scope (no brackets) to option choices. */
  readonly options?: unknown;
  /** `omnigent:ui-variants`: variant name to value. */
  readonly variants?: unknown;
  /** `omnigent:ui-color-customizations`. */
  readonly customizations?: unknown;
}

/**
 * The `[path, value]` writes that carry the legacy values into `existing` (the document's
 * values): options and variants over the document's, and colour customizations token by
 * token under them (a token the document sets keeps its value).
 */
export function legacySettingsWrites(
  legacy: LegacySettings,
  existing: SettingsValues = nullMap<PlainData>(),
): [string[], unknown][] {
  const writes: [string[], unknown][] = [];
  const readable = (value: unknown) => {
    const snapshot = snapshotPlainData(value ?? null, SETTINGS_VALUE_LIMITS);
    return snapshot.ok && isRecord(snapshot.value) ? snapshot.value : undefined;
  };
  const options = readable(legacy.options);
  for (const [scope, choices] of Object.entries(options ?? {})) {
    if (!isRecord(choices) || scope.length > 200 || /[[\]]/.test(scope)) continue;
    for (const [option, choice] of Object.entries(choices)) {
      if (typeof choice === "string") {
        writes.push([[THEME_OPTIONS_SETTING, `[${scope}]`, option], choice]);
      }
    }
  }
  const variants = readable(legacy.variants);
  for (const [name, value] of Object.entries(variants ?? {})) {
    if (typeof value === "string") writes.push([[`${STYLE_SETTING_PREFIX}${name}`], value]);
  }
  const customizations = readable(legacy.customizations);
  const current = existing[COLOR_CUSTOMIZATIONS_SETTING];
  const have = isRecord(current) ? current : undefined;
  for (const [key, value] of Object.entries(customizations ?? {})) {
    const path = [COLOR_CUSTOMIZATIONS_SETTING, key];
    if (key.startsWith("[") && isRecord(value)) {
      const scoped = have?.[key];
      if (scoped !== undefined && !isRecord(scoped)) continue;
      for (const [token, tokenValue] of Object.entries(value)) {
        if (!(isRecord(scoped) && Object.hasOwn(scoped, token))) {
          writes.push([[...path, token], tokenValue]);
        }
      }
    } else if (!(have && Object.hasOwn(have, key))) {
      writes.push([path, value]);
    }
  }
  // A `__proto__` key is never a setting (the reader leaves it out).
  return writes.filter(([path]) => !path.includes("__proto__"));
}

/** A migration's result: the document, and whether every legacy value is now in its text. */
export interface LegacyMigration {
  readonly settings: StoredSettings;
  /** The legacy keys may go: their values are in the text (or there were none). */
  readonly complete: boolean;
}

/**
 * The document with the legacy values written into its text. A text that doesn't parse
 * keeps its text; the values join its last good ones so they apply meanwhile, and the
 * migration stays incomplete (the legacy keys stay) until the text parses again.
 */
export function migrateLegacySettings(
  current: StoredSettings,
  legacy: LegacySettings,
): LegacyMigration {
  const writes = legacySettingsWrites(legacy, current.values);
  if (writes.length === 0) return { settings: current, complete: true };
  if (current.valid) {
    let text = current.text;
    let complete = true;
    for (const [path, value] of writes) {
      const edit = editSettingsText(text, path, value);
      if (edit.ok) text = edit.text;
      else complete = false;
    }
    return { settings: storeSettings(text, current.values), complete };
  }
  const copyOf = (record: unknown) =>
    Object.assign(nullMap<unknown>(), isRecord(record) ? record : {});
  const values = copyOf(current.values);
  for (const [path, value] of writes) {
    let target = values;
    for (const segment of path.slice(0, -1)) {
      const copy = copyOf(target[segment]);
      target[segment] = copy;
      target = copy;
    }
    target[path.at(-1)!] = value;
  }
  return {
    settings: { text: current.text, values: checkedValues(values), valid: false },
    complete: false,
  };
}
