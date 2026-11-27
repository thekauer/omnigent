// Resize hook for the always-visible left sidebar (the conversations aside in
// AppShell/Sidebar). Mirrors useResizableInlinePanel's persistence + keyboard
// behavior, but for a LEFT-edge panel: the drag handle lives on the sidebar's
// right edge, so the live width tracks the cursor's distance from the
// viewport's left edge (``e.clientX``) and ArrowRight grows / ArrowLeft
// shrinks. It keeps its own module-level store + preference key so resizing the
// sidebar never disturbs the right rail's inline-panel width (and vice versa).
//
// Unlike the inline panel this has no "boost" machinery — nothing auto-widens
// the sidebar — so the store is just a persisted, viewport-clamped width.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { readPanelSizePreference, writePanelSizePreference } from "@/lib/panelSizePreferences";
import {
  LayoutTokens,
  layoutTokensVersion,
  readLengthToken,
  subscribeLayoutTokens,
} from "@/workbench/layoutTokens";
import { LAYOUT_SLOTS, layoutState } from "@/workbench/layoutState";
import { isDesktopLayout } from "@/hooks/useIsMobileViewport";

// Default 320px (20rem) — wider than the old fixed ``md:w-64`` (256px) sidebar
// so conversation titles have more room before truncating. The floor keeps the
// search box + "New session" button usable; the viewport-relative ceiling keeps
// the sidebar from consuming more than half of the desktop layout.
// The default, floor and ceiling are the layout tokens `ui-sidebar-width` (320px),
// `ui-sidebar-min-width` (220px) and `ui-sidebar-max-width` (50vw), so themes and products set
// them; these are the values they compute to when they can't be measured.
const DEFAULT_WIDTH_PX = 320;
const MIN_WIDTH_PX = 220;
const MAX_WIDTH_RATIO = 0.5;

function defaultWidth(): number {
  return readLengthToken(LayoutTokens.sidebarWidth, () => DEFAULT_WIDTH_PX);
}

/** The narrowest the chat stays beside the side bar, whatever the width tokens say. */
export const MIN_CHAT_WIDTH_PX = 360;

/**
 * `w` within the tokens' floor and ceiling, and never so wide that the chat (and the activity
 * bar beside the side bar) has less than {@link MIN_CHAT_WIDTH_PX}; the floor never exceeds
 * the ceiling, so absurd tokens can't hide the chat.
 */
export function clampSidebarWidth(
  w: number,
  floorToken: number,
  ceilingToken: number,
  windowWidth: number,
  besideWidth = 0,
): number {
  const room = Math.max(0, windowWidth - besideWidth - MIN_CHAT_WIDTH_PX);
  const ceiling = Math.max(0, Math.min(ceilingToken, room));
  const floor = Math.min(Math.max(0, floorToken), ceiling);
  return Math.max(floor, Math.min(w, ceiling));
}

function clamp(w: number): number {
  // No viewport available off the DOM (SSR / node test env) — this runs during
  // render, so guard before reading ``window`` to avoid a hard throw.
  const floor = readLengthToken(LayoutTokens.sidebarMinWidth, () => MIN_WIDTH_PX);
  if (typeof window === "undefined") return Math.max(floor, w);
  const ceiling = readLengthToken(
    LayoutTokens.sidebarMaxWidth,
    () => window.innerWidth * MAX_WIDTH_RATIO,
  );
  // A phone's drawer goes over the chat: only beside it does the chat need its room.
  if (!isDesktopLayout()) return Math.max(floor, Math.min(w, ceiling));
  return clampSidebarWidth(w, floor, ceiling, window.innerWidth, activityBarBeside());
}

/** The activity bar's width when it sits beside the side bar (it shares the window). */
function activityBarBeside(): number {
  if (typeof document === "undefined") return 0;
  const bar = document.querySelector<HTMLElement>(
    '[data-part="activitybar"][data-location="default"]',
  );
  return bar ? bar.getBoundingClientRect().width : 0;
}

// ---------------------------------------------------------------------------
// Module-level width store (independent of the inline panel / push-panel stores)
// ---------------------------------------------------------------------------

// ``preferredWidth`` mirrors the persisted user choice; ``storedWidth`` is the
// effective (viewport-clamped) width. Keeping the preference in memory lets a
// viewport-resize re-derive the effective width from it — springing back to the
// larger choice when space returns — without ever touching disk.
let preferredWidth: number | null = readPanelSizePreference("sidebarWidthPx");
let storedWidth: number | null = preferredWidth;
const listeners = new Set<() => void>();

function persistWidth(value: number | null) {
  preferredWidth = value;
  writePanelSizePreference("sidebarWidthPx", value);
}

function setStoredWidthRaw(value: number | null, persist = false) {
  if (value === storedWidth) return;
  storedWidth = value;
  if (persist) persistWidth(value);
  for (const l of listeners) l();
}

function setStoredWidth(next: number | ((prev: number | null) => number), persist = false) {
  setStoredWidthRaw(typeof next === "function" ? next(storedWidth) : next, persist);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Back to the token's width: the edge's double-click, and View: Reset Layout. */
export function resetSidebarWidth(): void {
  persistWidth(null);
  setStoredWidthRaw(null);
}

// View: Reset Layout clears the layout state: the dragged width goes with it.
layoutState.subscribe((change) => {
  if (change.slots !== undefined && !change.slots.includes(LAYOUT_SLOTS.panelSizes)) return;
  preferredWidth = readPanelSizePreference("sidebarWidthPx");
  setStoredWidthRaw(preferredWidth);
});

function getSnapshot(): number | null {
  return storedWidth;
}

function getServerSnapshot(): number | null {
  return null;
}

/** Reset module-level state. Only for use in tests. */
export function resetSidebarWidthStoreForTesting(): void {
  preferredWidth = readPanelSizePreference("sidebarWidthPx");
  setStoredWidthRaw(preferredWidth);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Makes the desktop left sidebar resizable via a drag handle on its right
 * edge. Persists the chosen width across reloads and re-clamps on viewport
 * resize so the sidebar can't overflow a shrunken window.
 *
 * Returns the current pixel width and handle props to spread onto the resize
 * handle element. Desktop-only — callers should not render the handle on
 * mobile (where the sidebar is a full-screen overlay).
 */
export function useResizableSidebar(side: "left" | "right" = "left") {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // A theme setting the width tokens re-renders with their new values.
  useSyncExternalStore(subscribeLayoutTokens, layoutTokensVersion, layoutTokensVersion);
  const sideRef = useRef(side);
  sideRef.current = side;
  const width = clamp(raw ?? defaultWidth());
  const dragging = useRef(false);
  // The side bar's outer edge when the drag began (its left edge on the left, its right edge
  // on the right): the width is the cursor's distance from it, whatever sits beside it.
  const anchor = useRef(0);
  // Mirrors `dragging` for rendering, so the open/close width animation can
  // stay off while the user drags the edge.
  const [resizing, setResizing] = useState(false);

  // Re-clamp on viewport resize so a shrunken window pulls the sidebar back
  // under the ceiling; widening re-derives from the persisted preference so the
  // user's chosen width springs back when space returns.
  useEffect(() => {
    function onResize() {
      setStoredWidth((prev) => clamp(preferredWidth ?? prev ?? defaultWidth()));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const aside = (e.currentTarget as HTMLElement | null)?.closest?.("aside");
    const box = aside?.getBoundingClientRect();
    anchor.current = box
      ? sideRef.current === "left"
        ? box.left
        : box.right
      : sideRef.current === "left"
        ? 0
        : window.innerWidth;
    dragging.current = true;
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = 20;
      // Right edge of a left panel: ArrowRight widens, ArrowLeft narrows (mirrored on the right).
      const widen = side === "left" ? "ArrowRight" : "ArrowLeft";
      const narrow = side === "left" ? "ArrowLeft" : "ArrowRight";
      if (e.key === widen) {
        e.preventDefault();
        setStoredWidth((prev) => clamp((prev ?? width) + step), true);
      } else if (e.key === narrow) {
        e.preventDefault();
        setStoredWidth((prev) => clamp((prev ?? width) - step), true);
      }
    },
    [width, side],
  );

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      // Left panel: width is the cursor's distance from the viewport's left
      // edge. Update the live width only; persist once on release to avoid a
      // synchronous localStorage write per mousemove.
      setStoredWidth(
        clamp(sideRef.current === "left" ? e.clientX - anchor.current : anchor.current - e.clientX),
      );
    }

    function onMouseUp() {
      if (!dragging.current) return;
      dragging.current = false;
      setResizing(false);
      persistWidth(storedWidth);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
  }, []);

  return {
    /** Current sidebar width in px (already viewport-clamped). */
    width,
    /** True while the user drags the resize handle. */
    resizing,
    handleProps: {
      onMouseDown,
      onKeyDown,
      // Double-click: back to the theme's width (`ui-sidebar-width`).
      onDoubleClick: resetSidebarWidth,
      role: "separator" as const,
      "aria-orientation": "vertical" as const,
      "aria-label": "Resize sidebar",
      tabIndex: 0,
    },
  };
}
