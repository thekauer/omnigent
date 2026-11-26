// The settings editor's language service (theming plan M10b): diagnostics, completions and
// hovers for the settings document against its schema, as VS Code's JSON language service
// does for `settings.json`. Offsets only; the Monaco adapter turns them into positions. Pure.
// Loaded with the settings dialog, not at boot. Validity is the document reader's
// (`parseSettingsText`); jsonc-parser only words syntax errors and reads unfinished text.

import {
  findNodeAtLocation,
  findNodeAtOffset,
  getLocation,
  getNodePath,
  type Node as JsonNode,
  type ParseError,
  parseTree,
  printParseErrorCode,
} from "jsonc-parser";

import { parseSettingsText, SET_BY_PRODUCT } from "./settingsDocument";
import { childSchema, type SettingsSchemaNode, schemaAt } from "./settingsSchema";

export type SettingsSeverity = "error" | "warning" | "info";

export interface SettingsDiagnostic {
  readonly offset: number;
  readonly length: number;
  readonly severity: SettingsSeverity;
  readonly message: string;
  /** Drawn faded: a value that doesn't apply (locked or turned off). */
  readonly unnecessary?: boolean;
  /** The key path, when the problem is a key's. */
  readonly path?: readonly string[];
}

export { SET_BY_PRODUCT };

/** What a locked key's diagnostic and hover say. */
export function lockedMessage(node: SettingsSchemaNode): string {
  const value = node.locked ? (node.locked.label ?? node.locked.value) : "";
  return `${SET_BY_PRODUCT}${value ? ` (${value})` : ""}: this value doesn't apply.`;
}

export const HIDDEN_MESSAGE = "Turned off by the product: this setting doesn't apply.";

const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false } as const;

function quote(value: string): string {
  return JSON.stringify(value);
}

function propertyKey(property: JsonNode): JsonNode | undefined {
  return property.children?.[0];
}

/** Checks the document's structure and values against `schema`. */
export function settingsDiagnostics(
  text: string,
  schema: SettingsSchemaNode,
): SettingsDiagnostic[] {
  const parsed = parseSettingsText(text);
  if (!parsed.ok) {
    const errors = syntaxErrors(text) ?? parsed.errors;
    return errors.map((error) => ({ ...error, severity: "error" as const }));
  }
  const out: SettingsDiagnostic[] = parsed.problems.map((problem) => ({
    ...problem,
    severity: "error" as const,
  }));
  const check = (value: JsonNode, node: SettingsSchemaNode, path: string[]) => {
    if (node.checkedByService && node.type === "object" && value.type === "object") {
      // Token values are the theme service's to check; only the duplicates are ours.
      duplicates(value, path);
      return;
    }
    if (node.checkedByService) return;
    if (node.type === "object") {
      if (value.type !== "object") {
        out.push({ ...span(value), severity: "error", message: "Expected an object.", path });
        return;
      }
      duplicates(value, path);
      for (const property of value.children ?? []) {
        const key = propertyKey(property);
        const child = property.children?.[1];
        if (!key || typeof key.value !== "string") continue;
        const keyPath = [...path, key.value];
        if (key.value === "__proto__") {
          out.push({ ...span(key), severity: "error", message: "Not a setting.", path: keyPath });
          continue;
        }
        const childNode = childSchema(node, key.value);
        if (!childNode) {
          if (node.additionalProperties === false) {
            out.push({
              ...span(key),
              severity: "warning",
              message:
                path.length === 0
                  ? `Unknown setting ${quote(key.value)}.`
                  : `Unknown property ${quote(key.value)}.`,
              path: keyPath,
            });
          }
          continue;
        }
        if (childNode.hidden) {
          out.push({
            ...span(property),
            severity: "warning",
            message: HIDDEN_MESSAGE,
            unnecessary: true,
            path: keyPath,
          });
          continue;
        }
        if (childNode.locked) {
          out.push({
            ...span(property),
            severity: "info",
            message: lockedMessage(childNode),
            unnecessary: true,
            path: keyPath,
          });
          continue;
        }
        if (childNode.warning) {
          out.push({
            ...span(key),
            severity: "warning",
            message: childNode.warning,
            path: keyPath,
          });
        }
        if (child) check(child, childNode, keyPath);
      }
      return;
    }
    if (node.type === "string" && value.type !== "string") {
      out.push({ ...span(value), severity: "error", message: "Expected a string.", path });
      return;
    }
    if (node.enum && !node.enum.includes(String(value.value))) {
      out.push({
        ...span(value),
        severity: "error",
        message: `Value is not accepted. Valid values: ${node.enum.map(quote).join(", ")}.`,
        path,
      });
    }
  };
  const duplicates = (object: JsonNode, path: string[]) => {
    const seen = new Set<string>();
    for (const property of object.children ?? []) {
      const key = propertyKey(property);
      if (!key || typeof key.value !== "string") continue;
      if (seen.has(key.value)) {
        out.push({
          ...span(key),
          severity: "warning",
          message: `Duplicate key ${quote(key.value)}: the last one applies.`,
          path: [...path, key.value],
        });
      }
      seen.add(key.value);
    }
  };
  if (parsed.root) check(parsed.root as JsonNode, schema, []);
  return out;
}

/** A syntax message as VS Code words it ("Comma expected"). */
function syntaxMessage(error: ParseError): string {
  return printParseErrorCode(error.error)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/^./, (first) => first.toUpperCase());
}

/**
 * Every syntax error of a text the reader refused, as jsonc-parser recovers past each; null
 * when it finds none (the reader's own error stands) or can't read the text.
 */
function syntaxErrors(text: string): { offset: number; length: number; message: string }[] | null {
  const errors: ParseError[] = [];
  try {
    parseTree(text, errors, PARSE_OPTIONS);
  } catch {
    return null;
  }
  if (errors.length === 0) return null;
  return errors.map((error) => ({
    offset: error.offset,
    length: error.length,
    message: syntaxMessage(error),
  }));
}

function span(node: JsonNode): { offset: number; length: number } {
  return { offset: node.offset, length: node.length };
}

/** The tree of a text, even one with errors (for completions and hovers while typing). */
function looseTree(text: string): JsonNode | undefined {
  const parsed = parseSettingsText(text);
  if (parsed.ok) return parsed.root as JsonNode | undefined;
  const errors: ParseError[] = [];
  try {
    return parseTree(text, errors, PARSE_OPTIONS);
  } catch {
    // Nested past the stack: nothing to complete or describe.
    return undefined;
  }
}

/**
 * The span a problem the theme service found at `path` points at: the key's property, or
 * the whole text when the path isn't in it.
 */
export function spanOfPath(
  text: string,
  path: readonly string[],
): { offset: number; length: number } {
  const root = looseTree(text);
  const node = root ? findNodeAtLocation(root, [...path]) : undefined;
  const property = node?.parent?.type === "property" ? node.parent : node;
  return property ? span(property) : { offset: 0, length: 0 };
}

export interface SettingsCompletion {
  readonly label: string;
  /** Text to insert; a snippet (`${1|a,b|}` choices) when `snippet` is set. */
  readonly insertText: string;
  readonly snippet?: boolean;
  readonly kind: "property" | "value";
  /** A short line beside the label (a value's label). */
  readonly detail?: string;
  /** Markdown shown with the item. */
  readonly documentation?: string;
  /** The span the item replaces. */
  readonly offset: number;
  readonly length: number;
}

function documentation(node: SettingsSchemaNode): string | undefined {
  return node.description;
}

function valueSnippet(node: SettingsSchemaNode): string {
  if (node.type === "object") return "{\n\t$1\n}";
  if (node.enum && node.enum.length > 0) {
    const escape = (value: string) => value.replace(/[$}\\,|]/g, (char) => `\\${char}`);
    return `"\${1|${node.enum.map(escape).join(",")}|}"`;
  }
  return '"$1"';
}

/** What may be typed at `offset`: the keys an object takes, or the values a key does. */
export function settingsCompletions(
  text: string,
  offset: number,
  schema: SettingsSchemaNode,
): SettingsCompletion[] {
  let location: ReturnType<typeof getLocation>;
  try {
    location = getLocation(text, offset);
  } catch {
    return [];
  }
  const previous = location.previousNode;
  if (location.isAtPropertyKey) {
    const objectPath = location.path.slice(0, -1);
    const node = schemaAt(schema, objectPath);
    if (!node || node.type !== "object" || node.locked || node.hidden) return [];
    const root = looseTree(text);
    const object = root
      ? objectPath.length === 0
        ? root
        : findNodeAtLocation(root, objectPath)
      : undefined;
    const typing = previous && previous.type === "property" ? previous : undefined;
    const existing = new Set(
      (object?.type === "object" ? (object.children ?? []) : [])
        .map((property) => propertyKey(property))
        .filter((key) => key !== undefined && key !== typing)
        .map((key) => String(key!.value)),
    );
    const replace = typing ? span(typing) : { offset, length: 0 };
    return Object.entries(node.properties ?? {})
      .filter(([key, child]) => !existing.has(key) && !child.locked && !child.hidden)
      .map(([key, child]) => ({
        label: key,
        insertText: `${quote(key)}: ${valueSnippet(child)}`,
        snippet: true,
        kind: "property" as const,
        documentation: documentation(child),
        ...replace,
      }));
  }
  const node = schemaAt(schema, location.path);
  if (!node || node.locked || node.hidden || !node.enum) return [];
  const replace = previous && previous.type === "string" ? span(previous) : { offset, length: 0 };
  return node.enum.map((value, index) => ({
    label: quote(value),
    insertText: quote(value),
    kind: "value" as const,
    detail: node.enumDescriptions?.[index],
    documentation: documentation(node),
    ...replace,
  }));
}

export interface SettingsHover {
  /** Markdown. */
  readonly contents: string;
  readonly offset: number;
  readonly length: number;
}

/** What the key or value at `offset` is: its description, a value's label, a lock. */
export function settingsHover(
  text: string,
  offset: number,
  schema: SettingsSchemaNode,
): SettingsHover | null {
  try {
    return hoverAt(text, offset, schema);
  } catch {
    return null;
  }
}

function hoverAt(text: string, offset: number, schema: SettingsSchemaNode): SettingsHover | null {
  const root = looseTree(text);
  const node = root ? findNodeAtOffset(root, offset) : undefined;
  if (!node || node.parent?.type !== "property") return null;
  const property = node.parent;
  const path = getNodePath(property.children?.[1] ?? node).map(String);
  if (property.children?.[1] === undefined) path.push(String(node.value));
  const entry = schemaAt(schema, path);
  if (!entry) return null;
  const lines: string[] = [];
  const isKey = property.children?.[0] === node;
  if (isKey) lines.push(`**${String(node.value)}**`);
  if (entry.description) lines.push(entry.description);
  if (!isKey && entry.enum && typeof node.value === "string") {
    const index = entry.enum.indexOf(node.value);
    const label = index >= 0 ? entry.enumDescriptions?.[index] : undefined;
    if (label) lines.unshift(`${quote(node.value)}: ${label}`);
  }
  // A lock or a hidden key is the marker's to say, shown in the same hover.
  if (lines.length === 0) return null;
  return { contents: lines.join("\n\n"), ...span(node) };
}
