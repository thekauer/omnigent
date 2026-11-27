// The configuration service (layout plan L1), VS Code's `IConfigurationService` over the
// settings document: a setting's value is, from low to high, its registered default (or a
// `configurationDefaults` override), the product's default, the user's settings JSON, the
// window's memory, and the product's lock. Values the setting's schema doesn't take are left
// out (the editor marks them), so a wrong value never applies. The theme service reads its
// own keys from the same document and checks them itself.

import type { ConfigurationContributions } from "./configurationContributions";
import {
  ConfigurationRegistry,
  type ConfigurationScope,
  type RegisteredConfigurationProperty,
} from "./configurationRegistry";
import { SET_BY_PRODUCT } from "./settingsDocument";
import { type SettingsSchemaNode, valueProblem } from "./settingsSchema";
import { type SettingsStore, settingsStore, SettingsWriteError } from "./settingsStore";

/** Where a write goes, as VS Code's `ConfigurationTarget`. */
export type ConfigurationTarget = "user" | "memory";

/** A setting's value per layer, as VS Code's `inspect`. */
export interface ConfigurationInspection {
  readonly key: string;
  readonly defaultValue: unknown;
  readonly policyDefaultValue?: unknown;
  readonly userValue?: unknown;
  readonly memoryValue?: unknown;
  readonly lockedValue?: unknown;
  /** The value that applies. */
  readonly value: unknown;
}

export interface ConfigurationChangeEvent {
  readonly affectedKeys: readonly string[];
  /** Whether `section` (`omnigent.files` or `omnigent.files.sortOrder`) changed. */
  readonly affectsConfiguration: (section: string) => boolean;
}

/** A product's settings (layout plan L8 fills it from the three product sources). */
export interface ConfigurationPolicy {
  /** Defaults over the registered ones: what a first run and a reset get. */
  readonly defaults?: Readonly<Record<string, unknown>>;
  /** Applied last and refused on write ("Set by product"). */
  readonly locked?: Readonly<Record<string, unknown>>;
}

/** Fields of a registered setting the editor's schema leaves out. */
const REGISTRY_ONLY_FIELDS: ReadonlySet<string> = new Set([
  "scope",
  "order",
  "deprecationMessage",
  "defaultOverridable",
]);

/** Whether a changed `key` falls under `section`. */
export function affectsSection(keys: readonly string[], section: string): boolean {
  return keys.some(
    (key) => key === section || key.startsWith(`${section}.`) || section.startsWith(`${key}.`),
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function freezeDeep<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/** A frozen copy of plain JSON data, so a caller can't change what others read. */
function copyOf<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  return freezeDeep(JSON.parse(JSON.stringify(value)) as T);
}

export class ConfigurationService {
  readonly registry: ConfigurationRegistry;
  private readonly store: SettingsStore;
  private readonly memory = new Map<string, unknown>();
  private readonly policies = new Map<string, ConfigurationPolicy>();
  private readonly listeners = new Set<(event: ConfigurationChangeEvent) => void>();
  private readonly schemaListeners = new Set<() => void>();
  private snapshot: Map<string, unknown> | null = null;
  private version = 0;

  constructor(
    registry: ConfigurationRegistry = new ConfigurationRegistry(),
    store: SettingsStore = settingsStore,
  ) {
    this.registry = registry;
    this.store = store;
    registry.onDidChange(() => {
      this.changed();
      this.schemaChanged();
    });
    store.subscribe(() => this.changed());
  }

  /** Bumped on each change of the registry, the policy or a value. */
  getVersion(): number {
    return this.version + this.registry.getVersion();
  }

  // --- reading ---------------------------------------------------------------------

  private userValues(): Readonly<Record<string, unknown>> {
    return this.store.read().values;
  }

  /** The user's value for `key`, when the setting's schema takes it. */
  private userValue(key: string): unknown {
    const values = this.userValues();
    if (!Object.hasOwn(values, key)) return undefined;
    return this.accepted(key, values[key]);
  }

  /** `value`, or undefined when the registered setting `key` doesn't take it. */
  private accepted(key: string, value: unknown): unknown {
    const property = this.registry.getProperty(key);
    if (property && valueProblem(property.schema, value) !== undefined) return undefined;
    return value;
  }

  private policyValue(kind: keyof ConfigurationPolicy, key: string): unknown {
    let found: unknown;
    for (const policy of this.policies.values()) {
      const values = policy[kind];
      if (values && Object.hasOwn(values, key)) {
        const value = this.accepted(key, values[key]);
        if (value !== undefined) found = value;
      }
    }
    return found;
  }

  /** The value that applies for `key`, or undefined for a key nothing sets. */
  getValue<T = unknown>(key: string): T | undefined {
    return this.inspect(key).value as T | undefined;
  }

  inspect(key: string): ConfigurationInspection {
    const defaultValue = this.registry.defaultValue(key);
    const policyDefaultValue = this.policyValue("defaults", key);
    const userValue = this.userValue(key);
    const memoryValue = this.memory.get(key);
    const lockedValue = this.policyValue("locked", key);
    const value = lockedValue ?? memoryValue ?? userValue ?? policyDefaultValue ?? defaultValue;
    return Object.freeze({
      key,
      defaultValue: copyOf(defaultValue),
      ...(policyDefaultValue === undefined
        ? {}
        : { policyDefaultValue: copyOf(policyDefaultValue) }),
      ...(userValue === undefined ? {} : { userValue: copyOf(userValue) }),
      ...(memoryValue === undefined ? {} : { memoryValue: copyOf(memoryValue) }),
      ...(lockedValue === undefined ? {} : { lockedValue: copyOf(lockedValue) }),
      value: copyOf(value),
    });
  }

  /** Whether `key` is a registered setting. */
  has(key: string): boolean {
    return this.registry.getProperty(key) !== undefined;
  }

  /** Every key that is registered or set by the user. */
  keys(): string[] {
    return [
      ...new Set([
        ...this.registry.getProperties().map((property) => property.key),
        ...Object.keys(this.userValues()),
      ]),
    ];
  }

  /** Whether the product locks `key`. */
  isLocked(key: string): boolean {
    return this.policyValue("locked", key) !== undefined;
  }

  // --- writing ---------------------------------------------------------------------

  /** Why `value` can't be written to `key`, or undefined (undefined clears it). */
  writeProblem(
    key: string,
    value: unknown,
    target: ConfigurationTarget = "user",
  ): string | undefined {
    if (this.isLocked(key)) return `${key}: ${SET_BY_PRODUCT}`;
    const property = this.registry.getProperty(key);
    if (value !== undefined && property) {
      const problem = valueProblem(property.schema, value);
      if (problem) return `invalid value for ${key}: ${problem}`;
    }
    if (target === "user") return this.store.writeBlocked() ?? undefined;
    return undefined;
  }

  /**
   * Writes `value` (undefined: removes it) for `key` to the user's settings JSON, in place
   * with its comments kept, or to the window's memory. Throws {@link SettingsWriteError} when
   * the key is locked, the value doesn't fit its schema, or the document doesn't parse.
   */
  update(key: string, value: unknown, target: ConfigurationTarget = "user"): void {
    const problem = this.writeProblem(key, value, target);
    if (problem) throw new SettingsWriteError(problem);
    if (target === "memory") {
      if (value === undefined) this.memory.delete(key);
      else this.memory.set(key, copyOf(value));
      this.changed();
      return;
    }
    const hadMemory = this.memory.delete(key);
    try {
      this.store.edit([[[key], value === undefined ? undefined : copyOf(value)]], this);
    } finally {
      // The store's event already ran the diff; a memory value cleared alongside needs one too.
      if (hadMemory) this.changed();
    }
  }

  /**
   * Registers an extension's `contributes.configuration` and `configurationDefaults`; returns
   * their removal. A default the setting doesn't take, or may not be given, is a warning
   * (checked again once the setting registers).
   */
  addExtension(
    extensionId: string,
    contributions: ConfigurationContributions,
    log: Pick<Console, "warn"> = console,
  ): () => void {
    const removals = contributions.nodes.map((node) => this.registry.registerConfiguration(node));
    const defaults = contributions.defaults;
    if (Object.keys(defaults).length > 0) {
      for (const [key, value] of Object.entries(defaults)) {
        const problem = this.registry.defaultOverrideProblem(key, value);
        if (problem) {
          log.warn(`[configuration] ${extensionId}: configurationDefaults ${key}: ${problem}`);
        }
      }
      removals.push(this.registry.registerDefaultConfigurations(extensionId, defaults));
    }
    return () => {
      for (const remove of removals.reverse()) remove();
    };
  }

  /** Sets the product's settings of `source` (null removes them). */
  setPolicy(source: string, policy: ConfigurationPolicy | null): void {
    if (policy) this.policies.set(source, policy);
    else this.policies.delete(source);
    this.changed();
    this.schemaChanged();
  }

  /** The editor's schema of the registered settings, with the product's locks marked. */
  getSchema(): SettingsSchemaNode {
    const properties: Record<string, SettingsSchemaNode> = {};
    for (const property of this.registry.getProperties()) {
      properties[property.key] = this.schemaOf(property);
    }
    return { type: "object", properties, additionalProperties: false };
  }

  private schemaOf(property: RegisteredConfigurationProperty): SettingsSchemaNode {
    const schema = Object.fromEntries(
      Object.entries(property.schema).filter(([field]) => !REGISTRY_ONLY_FIELDS.has(field)),
    ) as SettingsSchemaNode;
    const { deprecationMessage } = property.schema;
    const defaultValue = this.registry.defaultValue(property.key);
    const notes = [
      schema.description,
      deprecationMessage ? `Deprecated: ${deprecationMessage}` : undefined,
      defaultValue === undefined ? undefined : `Default: \`${JSON.stringify(defaultValue)}\`.`,
    ].filter((note): note is string => Boolean(note));
    const locked = this.policyValue("locked", property.key);
    return {
      ...schema,
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
      ...(notes.length > 0 ? { description: notes.join(" ") } : {}),
      ...(locked === undefined ? {} : { locked: { value: locked } }),
    };
  }

  /** The scope `key` is registered with (`window` when it doesn't say). */
  scopeOf(key: string): ConfigurationScope {
    return this.registry.getProperty(key)?.schema.scope ?? "window";
  }

  // --- events ----------------------------------------------------------------------

  onDidChangeConfiguration(listener: (event: ConfigurationChangeEvent) => void): () => void {
    if (this.snapshot === null) this.snapshot = this.values();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Calls `listener` when the schema changes (a registration, the product's policy). */
  onDidChangeSchema(listener: () => void): () => void {
    this.schemaListeners.add(listener);
    return () => {
      this.schemaListeners.delete(listener);
    };
  }

  private schemaChanged(): void {
    for (const listener of [...this.schemaListeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[configuration] a schema listener failed", error);
      }
    }
  }

  /** Re-reads the document after something else stored it (a settings import). */
  reload(): void {
    this.changed();
  }

  private values(): Map<string, unknown> {
    return new Map(this.keys().map((key) => [key, this.getValue(key)]));
  }

  private changed(): void {
    this.version += 1;
    const previous = this.snapshot;
    if (previous === null) return;
    const next = this.values();
    this.snapshot = next;
    const affected = [...new Set([...previous.keys(), ...next.keys()])].filter(
      (key) => !sameValue(previous.get(key), next.get(key)),
    );
    if (affected.length === 0) return;
    const event: ConfigurationChangeEvent = Object.freeze({
      affectedKeys: Object.freeze(affected),
      affectsConfiguration: (section: string) => affectsSection(affected, section),
    });
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error("[configuration] a configuration listener failed", error);
      }
    }
  }
}

/** The app's configuration: the registry the extension host fills, over the settings document. */
export const configurationService = new ConfigurationService();
