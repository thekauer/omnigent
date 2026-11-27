// Which layout a width picks (layout plan L9, decision 14): the mobile layout below `md`, the
// side bar docked beside the chat in the band from 600px at aspect 3/4. The standalone app reads
// the window's media queries; an embed reads its root's box, so a narrow host box gets the
// mobile layout in a wide window. The desktop app keeps the desktop layout at every width.

import { keepsDesktopLayout } from "@/lib/desktopAppLayout";

/** Tailwind's `md` breakpoint: tablets up to an iPad Air in landscape (1180px) get the mobile layout. */
export const MOBILE_BREAKPOINT_PX = 1181;
/** The band's floor: Material's "medium" width class. */
export const SIDE_BY_SIDE_MIN_WIDTH_PX = 600;
/** The band's aspect floor (width over height): squarish or wider. */
export const SIDE_BY_SIDE_MIN_ASPECT = 3 / 4;

// Mirror Tailwind's `max-md` variant exactly so the window's answer stays in lockstep with the
// `max-md:` / `md:` classes.
export const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 0.02}px)`;
export const SIDE_BY_SIDE_QUERY = `(min-width: ${SIDE_BY_SIDE_MIN_WIDTH_PX}px) and (max-width: ${
  MOBILE_BREAKPOINT_PX - 0.02
}px) and (min-aspect-ratio: 3/4)`;

/** The layout a width picks: `mobile` below md, `sideBySide` in the band inside it. */
export interface LayoutViewport {
  readonly mobile: boolean;
  readonly sideBySide: boolean;
}

export const DESKTOP_VIEWPORT: LayoutViewport = Object.freeze({ mobile: false, sideBySide: false });
const MOBILE_VIEWPORT: LayoutViewport = Object.freeze({ mobile: true, sideBySide: false });
const BAND_VIEWPORT: LayoutViewport = Object.freeze({ mobile: true, sideBySide: true });

/** The layout a box of this size picks (an embed's root). */
export function viewportOfSize(width: number, height: number): LayoutViewport {
  if (keepsDesktopLayout() || width >= MOBILE_BREAKPOINT_PX) return DESKTOP_VIEWPORT;
  const band =
    width >= SIDE_BY_SIDE_MIN_WIDTH_PX && height > 0 && width / height >= SIDE_BY_SIDE_MIN_ASPECT;
  return band ? BAND_VIEWPORT : MOBILE_VIEWPORT;
}

function matches(query: string): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches;
}

/** The layout the window's width picks (the standalone app). */
export function windowViewport(): LayoutViewport {
  if (keepsDesktopLayout() || !matches(MOBILE_QUERY)) return DESKTOP_VIEWPORT;
  return matches(SIDE_BY_SIDE_QUERY) ? BAND_VIEWPORT : MOBILE_VIEWPORT;
}

/** Calls `listener` when the window crosses `md` or the band's edges. */
export function onDidChangeWindowViewport(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const queries = [window.matchMedia(MOBILE_QUERY), window.matchMedia(SIDE_BY_SIDE_QUERY)];
  for (const query of queries) query.addEventListener("change", listener);
  return () => {
    for (const query of queries) query.removeEventListener("change", listener);
  };
}

/**
 * The root's attribute the `md` / `max-md` variants in index.css read inside an embed, so its
 * CSS follows its box as its components do.
 */
export const LAYOUT_WIDTH_ATTRIBUTE = "data-layout-width";

export function layoutWidthAttributeValue(viewport: LayoutViewport): "mobile" | "desktop" {
  return viewport.mobile ? "mobile" : "desktop";
}
