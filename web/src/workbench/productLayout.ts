// The product's layout policy (layout plan L6 and L8): parts, containers and views a product
// hides, the activity bar's default order, and whether views keep their places
// (`lockViewLocations`). The workbench reads it here; the product's sources (its embed prop, its
// build's `product.json`, the server's `/v1/info`) fill it in layout plan L8. Plain data, plus
// the React read.

import { useSyncExternalStore } from "react";
import { RIGHT_PANEL_CONTAINER } from "./viewContainers";

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
  return patterns?.some((pattern) => wildcardMatch(pattern, id)) ?? false;
}

/** `*` matches any run of characters: a linear two-pointer match, no regular expression. */
function wildcardMatch(pattern: string, text: string): boolean {
  let at = 0;
  let textAt = 0;
  let starAt = -1;
  let resume = 0;
  while (textAt < text.length) {
    if (at < pattern.length && pattern[at] !== "*" && pattern[at] === text[textAt]) {
      at += 1;
      textAt += 1;
    } else if (at < pattern.length && pattern[at] === "*") {
      starAt = at;
      resume = textAt;
      at += 1;
    } else if (starAt >= 0) {
      at = starAt + 1;
      resume += 1;
      textAt = resume;
    } else {
      return false;
    }
  }
  while (at < pattern.length && pattern[at] === "*") at += 1;
  return at === pattern.length;
}

/** Whether the product hides `part` (`hiddenParts`; the main part can't be hidden). */
export function isPartHiddenByProduct(
  part: string,
  policy: ProductLayoutPolicy = productLayout,
): boolean {
  return part !== "workbench.parts.main" && matchesIdPattern(part, policy.get().hiddenParts);
}

/** Whether the product removes the view container `id` (`hiddenContainers`). */
export function isContainerHiddenByProduct(
  id: string,
  policy: ProductLayoutPolicy = productLayout,
): boolean {
  return matchesIdPattern(id, policy.get().hiddenContainers);
}

/** Whether the product removes the view, or navigation entry, `id` (`hiddenViews`). */
export function isViewHiddenByProduct(
  id: string,
  policy: ProductLayoutPolicy = productLayout,
): boolean {
  return matchesIdPattern(id, policy.get().hiddenViews);
}

/**
 * Whether the product removes `view`: by its id (`hiddenViews`), or by removing the container its
 * extension put it in (`hiddenContainers`). Moving it elsewhere doesn't bring it back.
 */
export function isViewRemovedByProduct(
  view: { readonly id: string; readonly containerId?: string | undefined },
  policy: ProductLayoutPolicy = productLayout,
): boolean {
  return (
    isViewHiddenByProduct(view.id, policy) ||
    isContainerHiddenByProduct(view.containerId ?? RIGHT_PANEL_CONTAINER, policy)
  );
}

/** Whether the product hides `part`, kept current. */
export function useProductHidesPart(part: string, policy: ProductLayoutPolicy = productLayout) {
  useProductLayout(policy);
  return isPartHiddenByProduct(part, policy);
}
