// The settings document's schema (theming plan M10b): a JSON Schema-shaped tree the
// editor's completions, hovers and checks read. Built from what is registered now (the
// token registry, every theme's options under its scope, the style variants), so an
// extension's theme options appear with nothing else to register. Pure.

import {
  COLOR_CUSTOMIZATIONS_SETTING,
  STYLE_SETTING_PREFIX,
  THEME_OPTIONS_SETTING,
} from "./settingsDocument";

/** A product lock on a key: its value applies, never the document's. */
export interface SettingsLock {
  readonly value: string;
  /** How the value reads (an option choice's or a variant value's label). */
  readonly label?: string;
}

export interface SettingsSchemaNode {
  readonly type?: "object" | "string";
  readonly description?: string;
  readonly enum?: readonly string[];
  /** One label per `enum` value, as VS Code's `enumDescriptions`. */
  readonly enumDescriptions?: readonly string[];
  readonly default?: string;
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

export interface SettingsSchemaToken {
  readonly id: string;
  readonly kind: string;
  readonly description: string;
}

export interface SettingsSchemaOption {
  readonly id: string;
  readonly label: string;
  readonly default: string;
  readonly choices: readonly { readonly id: string; readonly label: string }[];
}

/** A theme's options, under the scope they're kept in. */
export interface SettingsSchemaOptionScope {
  /** `<extension id>/<family>` or the theme's id, without brackets. */
  readonly scope: string;
  readonly label: string;
  readonly options: readonly SettingsSchemaOption[];
}

export interface SettingsSchemaVariant {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly values: readonly { readonly value: string; readonly label: string }[];
  /** The chosen theme's own value, which an unset key keeps. */
  readonly themeValue?: string;
}

export interface SettingsSchemaInput {
  readonly tokens: readonly SettingsSchemaToken[];
  /** Theme ids a customization scope may name, with their labels. */
  readonly themeScopes: readonly { readonly id: string; readonly label: string }[];
  readonly optionScopes: readonly SettingsSchemaOptionScope[];
  readonly variants: readonly SettingsSchemaVariant[];
  readonly locks: {
    readonly tokens: Readonly<Record<string, string>>;
    readonly options: Readonly<Record<string, string>>;
    readonly variants: Readonly<Record<string, string>>;
  };
  readonly hideCustomizations: boolean;
}

/** A theme scope key: `[<theme id>]`. */
export const SCOPE_KEY_PATTERN = "^\\[[^\\[\\]]{1,200}\\]$";

function tokenProperties(input: SettingsSchemaInput): Record<string, SettingsSchemaNode> {
  const properties: Record<string, SettingsSchemaNode> = {};
  for (const token of input.tokens) {
    const lock = input.locks.tokens[token.id];
    properties[token.id] = {
      type: "string",
      description: `${token.description} (${token.kind})`,
      checkedByService: true,
      ...(lock !== undefined ? { locked: { value: lock } } : {}),
    };
  }
  return properties;
}

function colorCustomizationsNode(input: SettingsSchemaInput): SettingsSchemaNode {
  const tokens = tokenProperties(input);
  const scope = (description: string): SettingsSchemaNode => ({
    type: "object",
    description,
    properties: tokens,
    checkedByService: true,
  });
  return {
    type: "object",
    description:
      "Color customizations: token values over every theme, or over one theme in a `[<theme id>]` object.",
    properties: {
      ...tokens,
      ...Object.fromEntries(
        input.themeScopes.map((theme) => [`[${theme.id}]`, scope(`Only for ${theme.label}.`)]),
      ),
    },
    patternProperties: { [SCOPE_KEY_PATTERN]: scope("Only for this theme.") },
    checkedByService: true,
    ...(input.hideCustomizations ? { hidden: true } : {}),
  };
}

function optionNode(option: SettingsSchemaOption, lock: string | undefined): SettingsSchemaNode {
  const choice = option.choices.find((entry) => entry.id === lock);
  return {
    type: "string",
    description: `${option.label}. Unset: ${
      option.choices.find((entry) => entry.id === option.default)?.label ?? option.default
    }.`,
    enum: option.choices.map((entry) => entry.id),
    enumDescriptions: option.choices.map((entry) => entry.label),
    default: option.default,
    ...(choice ? { locked: { value: choice.id, label: choice.label } } : {}),
  };
}

function themeOptionsNode(input: SettingsSchemaInput): SettingsSchemaNode {
  const scopes: Record<string, SettingsSchemaNode> = {};
  for (const scope of input.optionScopes) {
    if (scope.options.length === 0) continue;
    scopes[`[${scope.scope}]`] = {
      type: "object",
      description: `${scope.label}'s options.`,
      properties: Object.fromEntries(
        scope.options.map((option) => [
          option.id,
          optionNode(option, input.locks.options[option.id]),
        ]),
      ),
      additionalProperties: false,
    };
  }
  return {
    type: "object",
    description: 'Theme options by theme: `{ "[<theme id>]": { "<option>": "<choice>" } }`.',
    properties: scopes,
    patternProperties: {
      [SCOPE_KEY_PATTERN]: {
        type: "object",
        warning: "No installed theme has these options; they are kept for when one does.",
      },
    },
    additionalProperties: false,
    ...(input.hideCustomizations ? { hidden: true } : {}),
  };
}

function variantNode(
  input: SettingsSchemaInput,
  variant: SettingsSchemaVariant,
): SettingsSchemaNode {
  const labelOf = (value: string | undefined) =>
    variant.values.find((entry) => entry.value === value)?.label ?? value;
  const lock = input.locks.variants[variant.name];
  return {
    type: "string",
    description: `${variant.label}: ${variant.description} Unset: the theme's own${
      variant.themeValue ? ` (${labelOf(variant.themeValue)})` : ""
    }.`,
    enum: variant.values.map((entry) => entry.value),
    enumDescriptions: variant.values.map((entry) => entry.label),
    default: variant.values[0]?.value,
    ...(lock !== undefined ? { locked: { value: lock, label: labelOf(lock) } } : {}),
    ...(input.hideCustomizations ? { hidden: true } : {}),
  };
}

/** The document's schema for what is registered and locked now. */
export function buildSettingsSchema(input: SettingsSchemaInput): SettingsSchemaNode {
  return {
    type: "object",
    properties: {
      [THEME_OPTIONS_SETTING]: themeOptionsNode(input),
      ...Object.fromEntries(
        input.variants.map((variant) => [
          `${STYLE_SETTING_PREFIX}${variant.name}`,
          variantNode(input, variant),
        ]),
      ),
      [COLOR_CUSTOMIZATIONS_SETTING]: colorCustomizationsNode(input),
    },
    additionalProperties: false,
  };
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
  for (const segment of path) node = childSchema(node, String(segment));
  return node;
}
