// The settings document's schema shape: a JSON Schema-shaped tree the editor's completions,
// hovers and checks read, and the value checks the configuration service applies with.
// The tree is the union of the registered configuration (configurationRegistry.ts) and the
// theme service's keys (theme/themeSettingsSchema.ts). Pure.

/** The JSON types a setting may take, as JSON Schema names them. */
export type SettingsValueType =
  "object" | "string" | "boolean" | "number" | "integer" | "array" | "null";

export const SETTINGS_VALUE_TYPES: readonly SettingsValueType[] = Object.freeze([
  "object",
  "string",
  "boolean",
  "number",
  "integer",
  "array",
  "null",
]);

/** A product lock on a key: its value applies, never the document's. */
export interface SettingsLock {
  readonly value: unknown;
  /** How the value reads (an option choice's or a variant value's label). */
  readonly label?: string;
}

export interface SettingsSchemaNode {
  readonly type?: SettingsValueType;
  readonly description?: string;
  readonly enum?: readonly string[];
  /** One label per `enum` value, as VS Code's `enumDescriptions`. */
  readonly enumDescriptions?: readonly string[];
  readonly default?: unknown;
  /** Numbers: the smallest and largest value taken. */
  readonly minimum?: number;
  readonly maximum?: number;
  /** Arrays: the schema of each item. */
  readonly items?: SettingsSchemaNode;
  readonly properties?: Readonly<Record<string, SettingsSchemaNode>>;
  /** The schema of keys `properties` doesn't name, by key pattern. */
  readonly patternProperties?: Readonly<Record<string, SettingsSchemaNode>>;
  /** False: any other key is unknown (a warning). */
  readonly additionalProperties?: false;
  /** Set by the product: shown, never applied. */
  readonly locked?: SettingsLock;
  /** The product turned these customizations off: they don't apply. */
  readonly hidden?: boolean;
  /** Said of every key this node matches, such as a theme that isn't installed. */
  readonly warning?: string;
  /**
   * Values the theme service checks itself (token values): the language service completes
   * and describes the keys but leaves their diagnostics to it.
   */
  readonly checkedByService?: boolean;
}

/** The node for the key `key` under `node`, if it takes one. */
export function childSchema(
  node: SettingsSchemaNode | undefined,
  key: string,
): SettingsSchemaNode | undefined {
  if (!node) return undefined;
  if (node.properties && Object.hasOwn(node.properties, key)) return node.properties[key];
  for (const [pattern, child] of Object.entries(node.patternProperties ?? {})) {
    if (new RegExp(pattern).test(key)) return child;
  }
  return undefined;
}

/** The node at `path` from the root. */
export function schemaAt(
  root: SettingsSchemaNode,
  path: readonly (string | number)[],
): SettingsSchemaNode | undefined {
  let node: SettingsSchemaNode | undefined = root;
  for (const segment of path) {
    node =
      node?.type === "array" && typeof segment === "number"
        ? node.items
        : childSchema(node, String(segment));
  }
  return node;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The JSON type of `value`, as JSON Schema names it (an integral number is "number"). */
export function jsonTypeOf(value: unknown): SettingsValueType | undefined {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  return undefined;
}

const ARTICLES: Readonly<Record<SettingsValueType, string>> = {
  object: "an object",
  string: "a string",
  boolean: "a boolean",
  number: "a number",
  integer: "an integer",
  array: "an array",
  null: "null",
};

/** The message for a value of the wrong type ("Expected a boolean."). */
export function expectedTypeMessage(type: SettingsValueType): string {
  return `Expected ${ARTICLES[type]}.`;
}

/**
 * Why `value` doesn't fit `node` (its type, enum, bounds, items), or undefined when it
 * does. Objects are checked by their declared properties only when `node` names a type
 * for them; the theme service's own keys (`checkedByService`) always fit here.
 */
export function valueProblem(node: SettingsSchemaNode, value: unknown): string | undefined {
  if (node.checkedByService) return undefined;
  const actual = jsonTypeOf(value);
  if (node.type !== undefined) {
    const fits =
      node.type === "integer"
        ? actual === "number" && Number.isInteger(value)
        : node.type === actual;
    if (!fits) return expectedTypeMessage(node.type);
  }
  if (node.enum && !node.enum.includes(String(value))) {
    return `Value is not accepted. Valid values: ${node.enum.map((entry) => JSON.stringify(entry)).join(", ")}.`;
  }
  if (typeof value === "number") {
    if (node.minimum !== undefined && value < node.minimum) {
      return `Value is below the minimum of ${node.minimum}.`;
    }
    if (node.maximum !== undefined && value > node.maximum) {
      return `Value is above the maximum of ${node.maximum}.`;
    }
  }
  if (Array.isArray(value) && node.items) {
    for (const item of value) {
      const problem = valueProblem(node.items, item);
      if (problem) return `An item: ${problem}`;
    }
  }
  if (isRecord(value) && node.properties) {
    for (const [key, child] of Object.entries(value)) {
      const childNode = childSchema(node, key);
      if (!childNode) {
        if (node.additionalProperties === false) return `Unknown property ${JSON.stringify(key)}.`;
        continue;
      }
      const problem = valueProblem(childNode, child);
      if (problem) return `${JSON.stringify(key)}: ${problem}`;
    }
  }
  return undefined;
}
