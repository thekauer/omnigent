// The window's context keys, as VS Code's context key service: set through the
// `setContext` command and read by `when` clauses. One store per window.
import { EventEmitter } from "./base";

export type ContextKeyValue = string | number | boolean | null | readonly (string | number)[];

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_KEYS = 500;
const MAX_STRING_LENGTH = 1000;

function isContextKeyValue(value: unknown): value is ContextKeyValue {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= MAX_STRING_LENGTH;
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (item) =>
        (typeof item === "string" && item.length <= MAX_STRING_LENGTH) ||
        (typeof item === "number" && Number.isFinite(item)),
    )
  );
}

export class ContextKeyService {
  private readonly values = new Map<string, ContextKeyValue>();
  private readonly changeEmitter = new EventEmitter<readonly string[]>();
  /** Fires with the keys that changed. */
  readonly onDidChange = this.changeEmitter.event;

  get(key: string): ContextKeyValue | undefined {
    return this.values.get(key);
  }

  /** Sets `key`; `undefined` removes it. Invalid keys or values throw a TypeError. */
  set(key: unknown, value: unknown): void {
    if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
      throw new TypeError(`invalid context key ${JSON.stringify(key)}`);
    }
    if (value === undefined) {
      if (this.values.delete(key)) this.changeEmitter.fire([key]);
      return;
    }
    if (!isContextKeyValue(value)) {
      throw new TypeError(`context key ${key} needs a string, number, boolean or null value`);
    }
    if (!this.values.has(key) && this.values.size >= MAX_KEYS) {
      throw new Error(`too many context keys (at most ${MAX_KEYS})`);
    }
    const frozen = Array.isArray(value) ? Object.freeze([...value]) : value;
    const previous = this.values.get(key);
    if (previous === frozen || JSON.stringify(previous) === JSON.stringify(frozen)) return;
    this.values.set(key, frozen);
    this.changeEmitter.fire([key]);
  }

  /** A lookup for `when` clauses, with `overrides` (such as `view`) on top. */
  lookup(overrides: Readonly<Record<string, ContextKeyValue>> = {}): (key: string) => unknown {
    return (key) => (Object.hasOwn(overrides, key) ? overrides[key] : this.values.get(key));
  }
}
