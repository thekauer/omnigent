// The layout tokens' values in pixels (layout plan L5): the side bars' default, smallest and
// largest widths and the activity bar's width are theme tokens (`theme/tokens/layout.ts`), so a
// theme or a product sets them in CSS (`320px`, `clamp(220px, 20vw, 280px)`, `50vw`), and the
// resize hooks clamp to them in JS. A hidden probe on the theme root measures a token's
// computed width; without layout (a test's DOM) the registered default's fallback applies.

import { getThemeRoots } from "@/lib/host";
import { activeLayoutService } from "./layoutService";

export const LayoutTokens = Object.freeze({
  sidebarWidth: "ui-sidebar-width",
  sidebarMinWidth: "ui-sidebar-min-width",
  sidebarMaxWidth: "ui-sidebar-max-width",
  auxiliaryBarWidth: "ui-auxiliarybar-width",
  auxiliaryBarMinWidth: "ui-auxiliarybar-min-width",
  auxiliaryBarMaxWidth: "ui-auxiliarybar-max-width",
  activityBarWidth: "ui-activitybar-width",
});

/** Each root's probe and measures (an embed's root, or the document's). */
interface RootMeasures {
  probe: HTMLElement | null;
  key: string;
  readonly cache: Map<string, number>;
}

const measures = new WeakMap<Element, RootMeasures>();
/** Bumped by an invalidation: every root's measures are read again. */
let invalidated = 0;

/** What a cached measure depends on: the window's and the root's size, the root's class and style. */
function currentKey(root: Element, size: { width: number; height: number } | null): string {
  const box = size ? `${size.width}x${size.height}` : "";
  return `${invalidated}:${window.innerWidth}x${window.innerHeight}:${box}:${root.className}:${root.getAttribute("style") ?? ""}`;
}

/**
 * The root the tokens are measured on: the active mount's (an embed's own root, layout plan
 * L8), else the first theme root, else the document.
 */
function themeRoot(): { root: Element; size: { width: number; height: number } | null } | null {
  if (typeof document === "undefined") return null;
  const mount = activeLayoutService().getRoot();
  if (mount) return { root: mount, size: activeLayoutService().getRootSize() };
  return { root: getThemeRoots()[0] ?? document.documentElement, size: null };
}

/**
 * A token's value with `vw` and `vh` read as the mount root's width and height: in an embed the
 * parts size to the embed, not the window (decision 14). Undefined when nothing needs it.
 */
export function rootRelativeLength(
  value: string,
  size: { width: number; height: number } | null,
): string | undefined {
  if (!size || !/\d(vw|vh)\b/.test(value)) return undefined;
  return value.replace(/(-?\d*\.?\d+)(vw|vh)\b/g, (_match, amount: string, unit: string) => {
    const base = unit === "vw" ? size.width : size.height;
    return `${(Number(amount) * base) / 100}px`;
  });
}

/**
 * The token `id`'s width in px on the theme root, or `fallback` when it can't be measured
 * (no DOM, no layout, an invalid value). `fallback` is what the token's default computes to.
 */
export function readLengthToken(id: string, fallback: () => number): number {
  const found = themeRoot();
  if (!found || typeof window === "undefined") return fallback();
  const { root, size } = found;
  let entry = measures.get(root);
  if (!entry) {
    entry = { probe: null, key: "", cache: new Map() };
    measures.set(root, entry);
  }
  const key = currentKey(root, size);
  if (key !== entry.key) {
    entry.cache.clear();
    entry.key = key;
  }
  const cache = entry.cache;
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  // The root's tokens are inherited: on the document, the probe sits in the body.
  const host = root === document.documentElement ? document.body : root;
  if (!entry.probe || entry.probe.parentElement !== host) {
    entry.probe?.remove();
    entry.probe = document.createElement("div");
    entry.probe.setAttribute("aria-hidden", "true");
    entry.probe.dataset.layoutTokenProbe = "";
    entry.probe.style.cssText =
      "position:absolute;top:0;left:0;height:0;visibility:hidden;pointer-events:none;contain:strict;";
    host.appendChild(entry.probe);
  }
  const probe = entry.probe;
  // In a mount's root, `vw` and `vh` are the root's: the token's own text, rewritten.
  const specified = size ? getComputedStyle(root).getPropertyValue(`--${id}`).trim() : "";
  probe.style.width = rootRelativeLength(specified, size) ?? `var(--${id})`;
  // A laid-out probe computes to px (0 is a width too); without layout it doesn't, and the
  // fallback stands in, uncached.
  const computed = getComputedStyle(probe).width;
  const width = probe.getBoundingClientRect().width;
  if (!computed.endsWith("px") || (width === 0 && Number.parseFloat(computed) !== 0)) {
    return fallback();
  }
  cache.set(id, width);
  return width;
}

const listeners = new Set<() => void>();
let version = 0;

/** Bumped on each invalidation, for `useSyncExternalStore` readers. */
export function layoutTokensVersion(): number {
  return version;
}

/** Forgets the measures, as after a theme change that may set the tokens; readers re-read. */
export function invalidateLayoutTokens(): void {
  invalidated += 1;
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** Calls `listener` when the tokens may have changed (a theme change). */
export function subscribeLayoutTokens(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
