// The configuration registry (layout plan L1), VS Code's `IConfigurationRegistry`: the
// settings each extension registers (`contributes.configuration`, built-ins included) with
// their schema and default, and the defaults extensions override for others' settings
// (`contributes.configurationDefaults`). The settings document's schema is the union of what
// is registered here and the theme service's keys. Plain data; no storage.

import { valueProblem, type SettingsSchemaNode } from "./settingsSchema";

/**
 * Where a setting may be set, as VS Code's `ConfigurationScope`: `application` only in the
 * user's settings; `window` (the default) also for the window in memory; `resource` also per
 * workspace (the workspace on screen sets it, as the Files tab's eye toggle does).
 */
export type ConfigurationScope = "application" | "window" | "resource";

export interface ConfigurationPropertySchema extends SettingsSchemaNode {
  readonly scope?: ConfigurationScope;
  /** Sorts the setting within its node (lower first), then by key. */
  readonly order?: number;
  /** Shown instead of using the setting, as VS Code's `deprecationMessage`. */
  readonly deprecationMessage?: string;
  /**
   * False: `configurationDefaults` can't change its default. The theme's keys are such: an
   * extension changes the look through a theme, not by default settings.
   */
  readonly defaultOverridable?: boolean;
}

/** One `contributes.configuration` entry: a titled group of settings. */
export interface ConfigurationNode {
  /** The registering extension's id. */
  readonly owner: string;
  readonly title?: string;
  readonly order?: number;
  readonly properties: Readonly<Record<string, ConfigurationPropertySchema>>;
}

export interface RegisteredConfigurationProperty {
  readonly key: string;
  readonly schema: ConfigurationPropertySchema;
  readonly owner: string;
  readonly title?: string;
}

/** A configuration default override, after it is checked against the setting's schema. */
interface DefaultOverride {
  readonly source: string;
  readonly overrides: Readonly<Record<string, unknown>>;
}

/** What changed: the keys whose schema or default changed. */
export interface ConfigurationRegistryChange {
  readonly keys: readonly string[];
}

export class ConfigurationRegistry {
  private readonly properties = new Map<string, RegisteredConfigurationProperty>();
  private readonly defaultOverrides: DefaultOverride[] = [];
  private readonly listeners = new Set<(change: ConfigurationRegistryChange) => void>();
  private version = 0;
  private readonly log: Pick<Console, "warn">;

  constructor(log: Pick<Console, "warn"> = console) {
    this.log = log;
  }

  /** Bumped on each change: caches of the schema key on it. */
  getVersion(): number {
    return this.version;
  }

  /**
   * Registers a node's settings. A key someone registered already stays theirs (a warning);
   * returns the removal of the keys this call took.
   */
  registerConfiguration(node: ConfigurationNode): () => void {
    const taken: string[] = [];
    for (const [key, schema] of Object.entries(node.properties)) {
      const existing = this.properties.get(key);
      if (existing) {
        this.log.warn(
          `[configuration] ${node.owner}: ${JSON.stringify(key)} is registered by ${existing.owner}; ignoring it`,
        );
        continue;
      }
      this.properties.set(key, {
        key,
        schema,
        owner: node.owner,
        ...(node.title === undefined ? {} : { title: node.title }),
      });
      taken.push(key);
    }
    if (taken.length > 0) this.changed(taken);
    return () => {
      const removed = taken.filter((key) => this.properties.get(key)?.owner === node.owner);
      for (const key of removed) this.properties.delete(key);
      taken.length = 0;
      if (removed.length > 0) this.changed(removed);
    };
  }

  /** Drops `key`'s registration (another extension's namespace turned out to hold it). */
  unregisterKey(key: string): void {
    if (this.properties.delete(key)) this.changed([key]);
  }

  /**
   * `contributes.configurationDefaults` of `source`: new defaults for settings, registered or
   * not yet (they apply once the setting registers). The last registered wins a key.
   */
  registerDefaultConfigurations(
    source: string,
    overrides: Readonly<Record<string, unknown>>,
  ): () => void {
    const entry: DefaultOverride = { source, overrides };
    this.defaultOverrides.push(entry);
    const keys = Object.keys(overrides);
    if (keys.length > 0) this.changed(keys);
    return () => {
      const index = this.defaultOverrides.indexOf(entry);
      if (index < 0) return;
      this.defaultOverrides.splice(index, 1);
      if (keys.length > 0) this.changed(keys);
    };
  }

  getProperty(key: string): RegisteredConfigurationProperty | undefined {
    return this.properties.get(key);
  }

  /** Every registered setting, sorted by `order`, then key. */
  getProperties(): readonly RegisteredConfigurationProperty[] {
    return [...this.properties.values()].sort(
      (a, b) =>
        (a.schema.order ?? Number.MAX_SAFE_INTEGER) - (b.schema.order ?? Number.MAX_SAFE_INTEGER) ||
        a.key.localeCompare(b.key),
    );
  }

  /** Keys some `configurationDefaults` names. */
  overriddenKeys(): string[] {
    return [...new Set(this.defaultOverrides.flatMap((entry) => Object.keys(entry.overrides)))];
  }

  /**
   * A registered setting's default: the last `configurationDefaults` value its schema takes
   * (when it may be overridden), else the schema's `default`. Undefined for a key no one
   * registered.
   */
  defaultValue(key: string): unknown {
    return this.inspectDefault(key).value;
  }

  /** The default, and the source of the override that set it (if one did). */
  inspectDefault(key: string): { value: unknown; source?: string } {
    const property = this.properties.get(key);
    if (!property) return { value: undefined };
    if (property.schema.defaultOverridable !== false) {
      for (let index = this.defaultOverrides.length - 1; index >= 0; index -= 1) {
        const entry = this.defaultOverrides[index]!;
        if (!Object.hasOwn(entry.overrides, key)) continue;
        const value = entry.overrides[key];
        if (valueProblem(property.schema, value) === undefined) {
          return { value, source: entry.source };
        }
      }
    }
    return { value: property.schema.default };
  }

  /** Why a `configurationDefaults` value for `key` doesn't apply, or undefined. */
  defaultOverrideProblem(key: string, value: unknown): string | undefined {
    const property = this.properties.get(key);
    if (!property) return undefined;
    if (property.schema.defaultOverridable === false) {
      return `${key} can't be given a default by another extension`;
    }
    return valueProblem(property.schema, value);
  }

  onDidChange(listener: (change: ConfigurationRegistryChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(keys: readonly string[]): void {
    this.version += 1;
    const change = Object.freeze({ keys: Object.freeze([...keys]) });
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        console.error("[configuration] a registry listener failed", error);
      }
    }
  }
}
