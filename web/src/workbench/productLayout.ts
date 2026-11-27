// The product's layout policy (layout plan L6 and L8): parts, containers and views a product
// hides, the activity bar's default order, and whether views keep their places
// (`lockViewLocations`). The workbench reads it here; the product's sources (its embed prop, its
// build's `product.json`, the server's `/v1/info`) fill it in layout plan L8. Plain data, plus
// the React read.

import { useSyncExternalStore } from "react";

/** `product.layout`, as merged from the product's sources. Every field is optional. */
export interface ProductLayoutConfig {
  /** Parts not drawn, by id (`workbench.parts.titlebar`). */
  readonly hiddenParts?: readonly string[];
  /** View containers removed, by id or `*` pattern. */
  readonly hiddenContainers?: readonly string[];
  /** Views removed, by id or `*` pattern. */
  readonly hiddenViews?: readonly string[];
  /** The activity bar's order before the user's: container ids or `*` patterns. */
  readonly containerOrder?: readonly string[];
  /** Views stay where their extensions put them: the user can't move or hide them. */
  readonly lockViewLocations?: boolean;
}

const EMPTY: ProductLayoutConfig = Object.freeze({});

export class ProductLayoutPolicy {
  private config: ProductLayoutConfig = EMPTY;
  private readonly listeners = new Set<() => void>();

  get = (): ProductLayoutConfig => this.config;

  /** Replaces the policy (null: none). */
  set(config: ProductLayoutConfig | null): void {
    const next = config ? Object.freeze({ ...config }) : EMPTY;
    if (JSON.stringify(next) === JSON.stringify(this.config)) return;
    this.config = next;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[layout] a product layout listener failed", error);
      }
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Whether the product keeps views where their extensions put them. */
  viewLocationsLocked(): boolean {
    return this.config.lockViewLocations === true;
  }
}

/** The window's product layout policy. */
export const productLayout = new ProductLayoutPolicy();

export function useProductLayout(policy: ProductLayoutPolicy = productLayout): ProductLayoutConfig {
  return useSyncExternalStore(policy.subscribe, policy.get, policy.get);
}

/** Whether `id` matches one of `patterns` (ids, or `*` for any run of characters). */
export function matchesIdPattern(id: string, patterns: readonly string[] | undefined): boolean {
  if (!patterns) return false;
  return patterns.some((pattern) => {
    if (!pattern.includes("*")) return pattern === id;
    const source = pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${source}$`).test(id);
  });
}
