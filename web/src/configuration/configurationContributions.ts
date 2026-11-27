// Reads an extension's `contributes.configuration` and `contributes.configurationDefaults`
// (layout plan L1) into checked plain data, as VS Code's contribution points shape them.
// Problems are warnings: the rest still loads.

import { nullMap, snapshotPlainData } from "@/theme/validate";
import type {
  ConfigurationNode,
  ConfigurationPropertySchema,
  ConfigurationScope,
} from "./configurationRegistry";
import {
  SETTINGS_VALUE_TYPES,
  type SettingsSchemaNode,
  type SettingsValueType,
  valueProblem,
} from "./settingsSchema";

export interface ConfigurationContributions {
  readonly nodes: readonly ConfigurationNode[];
  /** `contributes.configurationDefaults`: setting key to its new default. */
  readonly defaults: Readonly<Record<string, unknown>>;
}

export const EMPTY_CONFIGURATION_CONTRIBUTIONS: ConfigurationContributions = Object.freeze({
  nodes: Object.freeze([]),
  defaults: Object.freeze({}),
});

const MAX_NODES = 20;
const MAX_PROPERTIES = 200;
const MAX_DEFAULTS = 100;
const MAX_KEY_LENGTH = 200;
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_ENUM_ENTRIES = 100;
const MAX_ENUM_LENGTH = 200;
/** A default value's size: small, as a setting's default is. */
const DEFAULT_LIMITS = { chars: 16_384, nodes: 500, depth: 4 } as const;

/** A setting key: dotted words, as VS Code's (`omnigent.files.sortOrder`). */
const SETTING_KEY = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/;

const SCOPES: ReadonlySet<string> = new Set<ConfigurationScope>([
  "application",
  "window",
  "resource",
]);
// VS Code's other scopes, read as the nearest one here.
const SCOPE_ALIASES: Readonly<Record<string, ConfigurationScope>> = {
  machine: "application",
  "machine-overridable": "window",
  "language-overridable": "resource",
};

export interface ParseConfigurationOptions {
  /**
   * Built-ins may register any key; their settings' defaults are not overridable by other
   * extensions' `configurationDefaults` unless they set `defaultOverridable: true`.
   */
  readonly builtIn?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `text` as markdown that draws exactly that text. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*_[\]<>|~]/g, (char) => `\\${char}`)
    .replace(/^(\s*)([#>+-]|\d+\.)/gm, "$1\\$2");
}

/**
 * Markdown with no images (which would load remote URLs) and no raw HTML: the bracket of every
 * `![` is escaped, so no image of any form (inline, nested brackets, reference) starts; reference
 * definitions, which only images and links read, are dropped; tags are left out.
 */
export function sanitizeMarkdown(markdown: string): string {
  return markdown
    .replace(/^ {0,3}\[(?:[^\]\\]|\\.)+\]:.*(?:\n|$)/gm, "")
    .replace(/!\[/g, "!\\[")
    .replace(/<\/?[A-Za-z][^>]*>/g, "");
}

function textOf(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.slice(0, max) : undefined;
}

/** Whether `key` is a setting key `extensionId` may register (its own prefix, unless built-in). */
export function isOwnSettingKey(
  extensionId: string,
  key: string,
  options: ParseConfigurationOptions = {},
): boolean {
  if (key.length > MAX_KEY_LENGTH || !SETTING_KEY.test(key)) return false;
  return options.builtIn === true || key.startsWith(`${extensionId}.`);
}

function stringList(value: unknown, where: string, warnings: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_ENUM_ENTRIES) {
    warnings.push(`${where} must be an array of at most ${MAX_ENUM_ENTRIES} strings`);
    return undefined;
  }
  if (!value.every((entry) => typeof entry === "string" && entry.length <= MAX_ENUM_LENGTH)) {
    warnings.push(`${where} must hold strings of at most ${MAX_ENUM_LENGTH} characters`);
    return undefined;
  }
  return value as string[];
}

function typeOf(value: unknown, where: string, warnings: string[]): SettingsValueType | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && (SETTINGS_VALUE_TYPES as readonly string[]).includes(value)) {
    return value as SettingsValueType;
  }
  warnings.push(
    `${where}.type must be one of ${SETTINGS_VALUE_TYPES.map((type) => JSON.stringify(type)).join(", ")}; the value's type isn't checked`,
  );
  return undefined;
}

/** A schema's value checks: `type`, `enum`, bounds and `items` (one level). */
function valueSchemaOf(
  raw: Record<string, unknown>,
  where: string,
  warnings: string[],
  trusted = false,
): SettingsSchemaNode {
  const type = typeOf(raw.type, where, warnings);
  // The editor's hovers draw markdown: a third party's `description` is text, as in VS Code,
  // and its `markdownDescription` markdown without remote images or raw HTML.
  const plain = textOf(raw.description, MAX_DESCRIPTION_LENGTH);
  const markdown = textOf(raw.markdownDescription, MAX_DESCRIPTION_LENGTH);
  const description = trusted
    ? (plain ?? markdown)
    : plain !== undefined
      ? escapeMarkdown(plain)
      : markdown !== undefined
        ? sanitizeMarkdown(markdown)
        : undefined;
  const enumValues = stringList(raw.enum, `${where}.enum`, warnings);
  if (enumValues && type !== undefined && type !== "string") {
    warnings.push(`${where}.enum is taken for string settings only; ignoring it`);
  }
  const plainEnum = stringList(raw.enumDescriptions, `${where}.enumDescriptions`, warnings);
  const markdownEnum = stringList(
    raw.markdownEnumDescriptions,
    `${where}.markdownEnumDescriptions`,
    warnings,
  );
  const enumDescriptions = trusted
    ? (plainEnum ?? markdownEnum)
    : (plainEnum?.map(escapeMarkdown) ?? markdownEnum?.map(sanitizeMarkdown));
  const bound = (name: "minimum" | "maximum") => {
    const value = raw[name];
    if (value === undefined) return undefined;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    warnings.push(`${where}.${name} must be a number`);
    return undefined;
  };
  const minimum = bound("minimum");
  const maximum = bound("maximum");
  const useEnum = enumValues && (type === undefined || type === "string");
  return {
    ...(type === undefined ? {} : { type }),
    ...(description === undefined ? {} : { description }),
    ...(useEnum ? { enum: Object.freeze(enumValues) } : {}),
    ...(useEnum && enumDescriptions
      ? { enumDescriptions: Object.freeze(enumDescriptions.slice(0, enumValues.length)) }
      : {}),
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
  };
}

function propertyOf(
  raw: unknown,
  where: string,
  warnings: string[],
  options: ParseConfigurationOptions,
): ConfigurationPropertySchema | undefined {
  if (!isRecord(raw)) {
    warnings.push(`${where} must be an object`);
    return undefined;
  }
  const trusted = options.builtIn === true;
  const schema: Record<string, unknown> = { ...valueSchemaOf(raw, where, warnings, trusted) };
  if (raw.items !== undefined) {
    if (schema.type !== "array") {
      warnings.push(`${where}.items is taken for array settings only; ignoring it`);
    } else if (!isRecord(raw.items)) {
      warnings.push(`${where}.items must be an object`);
    } else {
      schema.items = Object.freeze(valueSchemaOf(raw.items, `${where}.items`, warnings, trusted));
    }
  }
  if (raw.scope !== undefined) {
    const scope =
      typeof raw.scope === "string"
        ? SCOPES.has(raw.scope)
          ? (raw.scope as ConfigurationScope)
          : SCOPE_ALIASES[raw.scope]
        : undefined;
    if (scope === undefined)
      warnings.push(`${where}.scope ${JSON.stringify(raw.scope)} is unknown`);
    else schema.scope = scope;
  }
  if (raw.order !== undefined) {
    if (typeof raw.order === "number" && Number.isFinite(raw.order)) schema.order = raw.order;
    else warnings.push(`${where}.order must be a number`);
  }
  const deprecation =
    textOf(raw.deprecationMessage, MAX_DESCRIPTION_LENGTH) ??
    textOf(raw.markdownDeprecationMessage, MAX_DESCRIPTION_LENGTH);
  if (deprecation !== undefined) schema.deprecationMessage = deprecation;
  if (raw.defaultOverridable !== undefined) {
    if (!options.builtIn) {
      warnings.push(`${where}.defaultOverridable is for built-in extensions; ignoring it`);
    } else if (typeof raw.defaultOverridable === "boolean") {
      schema.defaultOverridable = raw.defaultOverridable;
    }
  }
  // A built-in's setting takes no other extension's default unless it opts in.
  if (options.builtIn && schema.defaultOverridable === undefined) {
    schema.defaultOverridable = false;
  }
  if (raw.default !== undefined) {
    const snapshot = snapshotPlainData(raw.default, DEFAULT_LIMITS);
    if (!snapshot.ok) {
      warnings.push(`${where}.default doesn't apply: too large or not plain JSON`);
    } else {
      const problem = valueProblem(schema as SettingsSchemaNode, snapshot.value);
      if (problem) warnings.push(`${where}.default doesn't apply: ${problem}`);
      else schema.default = snapshot.value;
    }
  }
  return Object.freeze(schema) as ConfigurationPropertySchema;
}

/** `contributes.configuration` and `contributes.configurationDefaults` of `extensionId`. */
export function parseConfigurationContributions(
  extensionId: string,
  contributes: Record<string, unknown>,
  options: ParseConfigurationOptions = {},
): { contributions: ConfigurationContributions; warnings: string[] } {
  const warnings: string[] = [];
  const nodes: ConfigurationNode[] = [];
  const seen = new Set<string>();
  const rawConfiguration = contributes.configuration;
  if (rawConfiguration !== undefined) {
    const entries = Array.isArray(rawConfiguration) ? rawConfiguration : [rawConfiguration];
    if (entries.length > MAX_NODES) {
      warnings.push(`contributes.configuration: only the first ${MAX_NODES} entries apply`);
    }
    entries.slice(0, MAX_NODES).forEach((entry: unknown, index) => {
      const where = Array.isArray(rawConfiguration)
        ? `contributes.configuration[${index}]`
        : "contributes.configuration";
      if (!isRecord(entry)) {
        warnings.push(`${where} must be an object`);
        return;
      }
      if (!isRecord(entry.properties)) {
        warnings.push(`${where}.properties must be an object of settings`);
        return;
      }
      const properties: Record<string, ConfigurationPropertySchema> = nullMap();
      for (const [key, raw] of Object.entries(entry.properties)) {
        const at = `${where}.properties[${JSON.stringify(key.slice(0, MAX_KEY_LENGTH))}]`;
        if (seen.size >= MAX_PROPERTIES) {
          warnings.push(
            `contributes.configuration: only the first ${MAX_PROPERTIES} settings apply`,
          );
          break;
        }
        if (!isOwnSettingKey(extensionId, key, options)) {
          warnings.push(`${at}: a setting key must be "${extensionId}.<name>"`);
          continue;
        }
        if (seen.has(key)) {
          warnings.push(`${at}: duplicate setting`);
          continue;
        }
        const property = propertyOf(raw, at, warnings, options);
        if (!property) continue;
        seen.add(key);
        properties[key] = property;
      }
      const title = textOf(entry.title, MAX_TITLE_LENGTH);
      const order =
        typeof entry.order === "number" && Number.isFinite(entry.order) ? entry.order : undefined;
      nodes.push(
        Object.freeze({
          owner: extensionId,
          ...(title === undefined ? {} : { title }),
          ...(order === undefined ? {} : { order }),
          properties: Object.freeze(properties),
        }),
      );
    });
  }
  const defaults: Record<string, unknown> = nullMap();
  const rawDefaults = contributes.configurationDefaults;
  if (rawDefaults !== undefined) {
    if (!isRecord(rawDefaults)) {
      warnings.push('"contributes.configurationDefaults" must be an object of settings');
    } else {
      const keys = Object.keys(rawDefaults);
      if (keys.length > MAX_DEFAULTS) {
        warnings.push(`contributes.configurationDefaults: only the first ${MAX_DEFAULTS} apply`);
      }
      for (const key of keys.slice(0, MAX_DEFAULTS)) {
        const at = `contributes.configurationDefaults[${JSON.stringify(key.slice(0, MAX_KEY_LENGTH))}]`;
        if (key.length > MAX_KEY_LENGTH || !SETTING_KEY.test(key)) {
          warnings.push(`${at}: not a setting key (language overrides aren't supported)`);
          continue;
        }
        const snapshot = snapshotPlainData(rawDefaults[key], DEFAULT_LIMITS);
        if (!snapshot.ok) {
          warnings.push(`${at}: too large or not plain JSON`);
          continue;
        }
        defaults[key] = snapshot.value;
      }
    }
  }
  return {
    contributions: Object.freeze({
      nodes: Object.freeze(nodes),
      defaults: Object.freeze(defaults),
    }),
    warnings,
  };
}
