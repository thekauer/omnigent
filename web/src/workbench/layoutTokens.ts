// The layout tokens' values in pixels (layout plan L5): the side bars' default, smallest and
// largest widths and the activity bar's width are theme tokens (`theme/tokens/layout.ts`), so a
// theme or a product sets them in CSS (`320px`, `clamp(220px, 20vw, 280px)`, `50vw`), and the
// resize hooks clamp to them in JS. A hidden probe on the theme root measures a token's
// computed width; without layout (a test's DOM) the registered default's fallback applies.

import { getThemeRoots } from "@/lib/host";

export const LayoutTokens = Object.freeze({
  sidebarWidth: "ui-sidebar-width",
  sidebarMinWidth: "ui-sidebar-min-width",
  sidebarMaxWidth: "ui-sidebar-max-width",
  auxiliaryBarWidth: "ui-auxiliarybar-width",
  auxiliaryBarMinWidth: "ui-auxiliarybar-min-width",
  auxiliaryBarMaxWidth: "ui-auxiliarybar-max-width",
  activityBarWidth: "ui-activitybar-width",
});

let probe: HTMLElement | null = null;
const cache = new Map<string, number>();
let cacheKey = "";

/** What a cached measure depends on: the window's width and the root's inline and class state. */
function currentKey(root: Element): string {
  return `${window.innerWidth}x${window.innerHeight}:${root.className}:${root.getAttribute("style") ?? ""}`;
}

function themeRoot(): Element | null {
  if (typeof document === "undefined") return null;
  return getThemeRoots()[0] ?? document.documentElement;
}

/**
 * The token `id`'s width in px on the theme root, or `fallback` when it can't be measured
 * (no DOM, no layout, an invalid value). `fallback` is what the token's default computes to.
 */
export function readLengthToken(id: string, fallback: () => number): number {
  const root = themeRoot();
  if (!root || typeof window === "undefined") return fallback();
  const key = currentKey(root);
  if (key !== cacheKey) {
    cache.clear();
    cacheKey = key;
  }
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  // The root's tokens are inherited: on the document, the probe sits in the body.
  const host = root === document.documentElement ? document.body : root;
  if (!probe || probe.parentElement !== host) {
    probe?.remove();
    probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.dataset.layoutTokenProbe = "";
    probe.style.cssText =
      "position:absolute;top:0;left:0;height:0;visibility:hidden;pointer-events:none;contain:strict;";
    host.appendChild(probe);
  }
  probe.style.width = `var(--${id})`;
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
  cache.clear();
  cacheKey = "";
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
