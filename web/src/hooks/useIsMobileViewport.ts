// Reactive "is this a mobile-width layout?" hook.
//
// The shell's responsive layout pivots on Tailwind's `md` breakpoint
// (`--breakpoint-md` in index.css), used both as CSS classes (`md:` / `max-md:`)
// and as the JS threshold in AppShell's `initialSidebarOpen`. This hook exposes
// the `max-md` side of that line to component logic that can't be expressed in
// CSS alone (e.g. swapping a hover flyout for an in-place page on touch). The
// width is the mount's (layout plan decision 14): the window's for the standalone
// app, an embed's root box inside an embed (workbench/layoutViewport.ts).

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

import { keepsDesktopLayout } from "@/lib/desktopAppLayout";
import { type LayoutService, layoutService } from "@/workbench/layoutService";
import { MOBILE_BREAKPOINT_PX } from "@/workbench/layoutViewport";
import { useWorkbenchScope } from "@/workbench/workbenchScope";

export { MOBILE_BREAKPOINT_PX };

/** Matches windows at or above `md`, the desktop layout. */
const DESKTOP_QUERY = `(min-width: ${MOBILE_BREAKPOINT_PX}px)`;

/**
 * Non-reactive read of a mount's layout (the active one's, last mounted or used, by default):
 * true at `md` and up, and at every width in the desktop app. Mirrors the `md` variant in
 * index.css.
 */
export function isDesktopLayout(layout: LayoutService = layoutService): boolean {
  if (typeof window === "undefined") return false;
  if (layout.getRoot()) return !layout.isMobileLayout();
  return keepsDesktopLayout() || (!!window.matchMedia && window.matchMedia(DESKTOP_QUERY).matches);
}

/**
 * Set by a desktop window that is narrower than `md` by design, such as the floating New Agent
 * panel, so its components keep desktop behavior: inline controls and keyboard submit.
 */
export const DesktopWindowContext = createContext(false);

/**
 * True when the mount is narrower than Tailwind's `md` breakpoint (1181px)
 * — i.e. the "mobile" layout the shell's `max-md:` classes target. Always false
 * in the desktop app, which keeps the desktop layout. Reactive: components
 * re-render when the width crosses the breakpoint. SSR-safe (returns `false`
 * on the server, matching `initialSidebarOpen`).
 */
export function useIsMobileViewport(): boolean {
  const desktopWindow = useContext(DesktopWindowContext);
  const narrow = useIsMobileLayout();
  return narrow && !desktopWindow;
}

/** {@link useIsMobileViewport} without the desktop window's override: the mount's width only. */
export function useIsMobileLayout(): boolean {
  const { layout } = useWorkbenchScope();
  const subscribe = useCallback((listener: () => void) => layout.onDidChangeViewport(listener), [
    layout,
  ]);
  return useSyncExternalStore(subscribe, () => layout.isMobileLayout(), () => false);
}
