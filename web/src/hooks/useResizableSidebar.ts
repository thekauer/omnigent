// Resize hook for the always-visible left sidebar (the conversations aside in
// AppShell/Sidebar). Mirrors useResizableInlinePanel's persistence + keyboard
// behavior, but for a LEFT-edge panel: the drag handle lives on the sidebar's
// right edge, so the live width tracks the cursor's distance from the
// viewport's left edge (``e.clientX``) and ArrowRight grows / ArrowLeft
// shrinks. It keeps its own store (one per mount) + preference key so resizing the
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
import {
  LAYOUT_SLOTS,
  type LayoutStateStore,
  standaloneLayoutState,
} from "@/workbench/layoutState";
import type { LayoutService } from "@/workbench/layoutService";
import { useWorkbenchScope } from "@/workbench/workbenchScope";
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

function defaultWidth(layout: LayoutService): number {
  return readLengthToken(LayoutTokens.sidebarWidth, () => DEFAULT_WIDTH_PX, layout);
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

function clamp(w: number, layout: LayoutService): number {
  // No viewport available off the DOM (SSR / node test env) — this runs during
  // render, so guard before reading ``window`` to avoid a hard throw.
  const floor = readLengthToken(LayoutTokens.sidebarMinWidth, () => MIN_WIDTH_PX, layout);
  if (typeof window === "undefined") return Math.max(floor, w);
  // The mount's box: the window, or an embed's root (decision 14).
  const rootWidth = layout.getRootSize().width;
  const ceiling = readLengthToken(
    LayoutTokens.sidebarMaxWidth,
    () => rootWidth * MAX_WIDTH_RATIO,
    layout,
  );
  // A phone's drawer goes over the chat: only beside it does the chat need its room.
  if (!isDesktopLayout(layout)) return Math.max(floor, Math.min(w, ceiling));
  return clampSidebarWidth(w, floor, ceiling, rootWidth, activityBarBeside(layout));
}

/** The activity bar's width when it sits beside the side bar (it shares the mount's box). */
function activityBarBeside(layout: LayoutService): number {
  if (typeof document === "undefined") return 0;
  const bar = (layout.getRoot() ?? document).querySelector<HTMLElement>(
    '[data-part="activitybar"][data-location="default"]',
  );
  return bar ? bar.getBoundingClientRect().width : 0;
}

// ---------------------------------------------------------------------------
// Width store, one per mount's layout state (independent of the inline panel /
// push-panel stores)
// ---------------------------------------------------------------------------

/**
 * ``preferred`` mirrors the persisted user choice; ``stored`` is the effective
 * (viewport-clamped) width. Keeping the preference in memory lets a resize
 * re-derive the effective width from it, springing back to the larger choice
 * when space returns, without touching disk. Each mount's layout state has its
 * own, so two embeds keep their own dragged width.
 */
class SidebarWidthStore {
  preferred: number | null;
  stored: number | null;
  private readonly listeners = new Set<() => void>();
  private readonly state: LayoutStateStore;

  constructor(state: LayoutStateStore) {
    this.state = state;
    this.preferred = readPanelSizePreference("sidebarWidthPx", state);
    this.stored = this.preferred;
    // View: Reset Layout clears the layout state: the dragged width goes with it.
    state.subscribe((change) => {
      if (change.slots !== undefined && !change.slots.includes(LAYOUT_SLOTS.panelSizes)) return;
      this.reload();
    });
  }

  persist(value: number | null): void {
    this.preferred = value;
    writePanelSizePreference("sidebarWidthPx", value, this.state);
  }

  setRaw(value: number | null, persist = false): void {
    if (value === this.stored) return;
    this.stored = value;
    if (persist) this.persist(value);
    for (const listener of [...this.listeners]) listener();
  }

  set(next: number | ((prev: number | null) => number), persist = false): void {
    this.setRaw(typeof next === "function" ? next(this.stored) : next, persist);
  }

  /** Back to the token's width: the edge's double-click, and View: Reset Layout. */
  reset = (): void => {
    this.persist(null);
    this.setRaw(null);
  };

  reload(): void {
    this.preferred = readPanelSizePreference("sidebarWidthPx", this.state);
    this.setRaw(this.preferred);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number | null => this.stored;
}

// Weak: an embed's store goes with its unmounted workbench.
const widthStores = new WeakMap<LayoutStateStore, SidebarWidthStore>();

function widthStoreOf(state: LayoutStateStore): SidebarWidthStore {
  let store = widthStores.get(state);
  if (!store) {
    store = new SidebarWidthStore(state);
    widthStores.set(state, store);
  }
  return store;
}

function getServerSnapshot(): number | null {
  return null;
}

/** Reset module-level state. Only for use in tests. */
export function resetSidebarWidthStoreForTesting(): void {
  widthStores.get(standaloneLayoutState)?.reload();
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Where a side bar drag measures from when its element isn't found: the mount's own edge. */
function sideBarFallbackEdge(side: "left" | "right", layout: LayoutService): number {
  const bounds = layout.getRoot()?.getBoundingClientRect();
  if (side === "left") return bounds?.left ?? 0;
  return bounds?.right ?? (typeof window === "undefined" ? 0 : window.innerWidth);
}

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
  const { layout, state } = useWorkbenchScope();
  const store = widthStoreOf(state);
  const raw = useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
  // A theme setting the width tokens re-renders with their new values.
  useSyncExternalStore(subscribeLayoutTokens, layoutTokensVersion, layoutTokensVersion);
  // The root's width is read at render, so a re-render follows its changes, its first measure
  // included (the ref callback measures during commit, before this effect could subscribe).
  useSyncExternalStore(
    useCallback((listener: () => void) => layout.onDidChangeRootSize(listener), [layout]),
    () => layout.getRootSize().width,
    () => 0,
  );
  const sideRef = useRef(side);
  sideRef.current = side;
  const width = clamp(raw ?? defaultWidth(layout), layout);
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
  useEffect(
    () =>
      layout.onDidChangeRootSize(() => {
        store.set((prev) => clamp(store.preferred ?? prev ?? defaultWidth(layout), layout));
      }),
    [layout, store],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const aside = (e.currentTarget as HTMLElement | null)?.closest?.("aside");
      const box = aside?.getBoundingClientRect();
      anchor.current = box
        ? sideRef.current === "left"
          ? box.left
          : box.right
        : // Without the side bar's element, the mount's own edge: an embed's root needn't start at x 0.
          sideBarFallbackEdge(sideRef.current, layout);
      dragging.current = true;
      setResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [layout],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = 20;
      // Right edge of a left panel: ArrowRight widens, ArrowLeft narrows (mirrored on the right).
      const widen = side === "left" ? "ArrowRight" : "ArrowLeft";
      const narrow = side === "left" ? "ArrowLeft" : "ArrowRight";
      if (e.key === widen) {
        e.preventDefault();
        store.set((prev) => clamp((prev ?? width) + step, layout), true);
      } else if (e.key === narrow) {
        e.preventDefault();
        store.set((prev) => clamp((prev ?? width) - step, layout), true);
      }
    },
    [width, side, store, layout],
  );

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      // Left panel: width is the cursor's distance from the viewport's left
      // edge. Update the live width only; persist once on release to avoid a
      // synchronous localStorage write per mousemove.
      store.set(
        clamp(
          sideRef.current === "left" ? e.clientX - anchor.current : anchor.current - e.clientX,
          layout,
        ),
      );
    }

    function onMouseUp() {
      if (!dragging.current) return;
      dragging.current = false;
      setResizing(false);
      store.persist(store.stored);
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
  }, [store, layout]);

  return {
    /** Current sidebar width in px (already viewport-clamped). */
    width,
    /** True while the user drags the resize handle. */
    resizing,
    handleProps: {
      onMouseDown,
      onKeyDown,
      // Double-click: back to the theme's width (`ui-sidebar-width`).
      onDoubleClick: store.reset,
      role: "separator" as const,
      "aria-orientation": "vertical" as const,
      "aria-label": "Resize sidebar",
      tabIndex: 0,
    },
  };
}
