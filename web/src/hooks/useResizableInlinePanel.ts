// Resize hook for the always-visible right inline panel (the aside in
// AppShell that holds FilesPanel + SessionRail). Uses a separate
// width store per mount (keyed by the mount's layout state) so the inline panel's preferred width
// doesn't bleed into the push-panel store shared by FileViewer / TerminalsPanel /
// ExecutionLogsPanel / FilesPanelDrawer - those open at ~50 % by default
// while the inline panel starts at a compact sidebar width.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { readSessionWorkspaceState, writeSessionWorkspaceState } from "@/lib/sessionWorkspaceState";
import type { LayoutStateStore } from "@/workbench/layoutState";
import { standaloneLayoutState } from "@/workbench/layoutState";
import type { LayoutService } from "@/workbench/layoutService";
import { useWorkbenchScope } from "@/workbench/workbenchScope";
import {
  LayoutTokens,
  layoutTokensVersion,
  readLengthToken,
  subscribeLayoutTokens,
} from "@/workbench/layoutTokens";

const MIN_WIDTH_PX = 240;
const MAX_WIDTH_RATIO = 0.99;
/** The center chat column never shrinks past this, whatever the rail wants. */
const CHAT_MIN_WIDTH_PX = 480;
/** Visual gap between the chat column and the rail. */
const GAP_PX = 8;

// ~36 % of viewport, clamped [420, 600] - ~30 % wider than the prior default so
// the first manual open lands at a comfortable working width.
const DEFAULT_RATIO = 0.36;
const DEFAULT_MIN_PX = 420;
const DEFAULT_MAX_PX = 600;
const DEFAULT_SSR_PX = 500;

/** What `ui-auxiliarybar-width`'s default, `clamp(420px, 36vw, 600px)`, computes to. */
function registeredDefaultWidthPx(rootWidth: number): number {
  if (typeof window === "undefined") return DEFAULT_SSR_PX;
  const candidate = Math.round(rootWidth * DEFAULT_RATIO);
  return Math.max(DEFAULT_MIN_PX, Math.min(DEFAULT_MAX_PX, candidate));
}

/** The default width: the `ui-auxiliarybar-width` token (a theme's or a product's) on the mount. */
function defaultWidthPx(layout: LayoutService): number {
  if (typeof window === "undefined") return DEFAULT_SSR_PX;
  const rootWidth = layout.getRootSize().width;
  return Math.round(
    readLengthToken(
      LayoutTokens.auxiliaryBarWidth,
      () => registeredDefaultWidthPx(rootWidth),
      layout,
    ),
  );
}

/** The default width once the mount's box grows by it, which keeps the chat's width unchanged. */
function defaultWidthInWiderWindowPx(layout: LayoutService): number {
  if (typeof window === "undefined") return DEFAULT_SSR_PX;
  // A width a theme set is the width wherever the window goes; the registered default's
  // share of the window grows with it.
  const rootWidth = layout.getRootSize().width;
  const width = defaultWidthPx(layout);
  if (width !== registeredDefaultWidthPx(rootWidth)) return width;
  const candidate = Math.round((rootWidth * DEFAULT_RATIO) / (1 - DEFAULT_RATIO));
  return Math.max(DEFAULT_MIN_PX, Math.min(DEFAULT_MAX_PX, candidate));
}

/** The smallest width: the `ui-auxiliarybar-min-width` token. */
function minimumWidthPx(layout: LayoutService): number {
  return readLengthToken(LayoutTokens.auxiliaryBarMinWidth, () => MIN_WIDTH_PX, layout);
}

// Width the panel may not eat into: the sidebar when it's open. Passed down
// from AppShell so opening the sidebar tightens the ceiling instead of
// squeezing the chat.
function clamp(
  w: number,
  layout: LayoutService,
  minPx: number = minimumWidthPx(layout),
  reservedPx = 0,
  chatMinPx = CHAT_MIN_WIDTH_PX,
): number {
  // No viewport ceiling available off the DOM (SSR / node test env) - this runs
  // during render, so guard before reading `window` to avoid a hard throw.
  if (typeof window === "undefined") return Math.max(minPx, w);
  // The mount's box: the window, or an embed's root (decision 14).
  const rootWidth = layout.getRootSize().width;
  // 99vw is the nominal ceiling, but the chat column's minimum (plus the gap
  // between the two) is the one that actually binds on a normal desktop.
  const ceiling = Math.max(
    0,
    Math.min(
      readLengthToken(LayoutTokens.auxiliaryBarMaxWidth, () => rootWidth * MAX_WIDTH_RATIO, layout),
      rootWidth - reservedPx - chatMinPx - GAP_PX,
    ),
  );
  // The chat's width floor wins over the panel's own comfort minimum: when the
  // viewport (with the sidebar open) is too small to grant both, the panel
  // yields below `minPx` rather than let the chat break its minimum. Clamping
  // the floor to the ceiling keeps the range valid so `Math.max` can't push the
  // width back up past the chat-preserving cap.
  return Math.max(Math.min(minPx, ceiling), Math.min(w, ceiling));
}

// ---------------------------------------------------------------------------
// Width store, one per mount's layout state (independent of the push-panel store)
// ---------------------------------------------------------------------------

/**
 * `preferred` mirrors the persisted user choice; `stored` is the effective
 * (viewport-clamped) width. Keeping the preference in memory lets the resize
 * handler re-derive the effective width from it - restoring the larger choice
 * when space returns - without touching disk. Both start null: the active
 * session's saved width is loaded once the hook learns its storage key (see
 * loadSession), since width is scoped by the caller. Each mount has its own, so
 * a drag in one embed never writes another mount's session.
 */
class InlinePanelWidthStore {
  /** The session whose saved width the store holds; null while none is loaded. */
  sessionId: string | null = null;
  preferred: number | null = null;
  stored: number | null = null;
  private readonly listeners = new Set<() => void>();

  persist(value: number | null): void {
    this.preferred = value;
    if (this.sessionId !== null && value !== null) {
      writeSessionWorkspaceState(this.sessionId, { widthPx: value });
    }
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

  /** Snapshot the current width to storage (called once at drag end). */
  persistStored(): void {
    this.persist(this.stored);
  }

  /** Re-seeds the store from a storage key's saved width; a key with none has no preference. */
  loadSession(sessionId: string | null): void {
    if (sessionId === this.sessionId) return;
    this.sessionId = sessionId;
    this.preferred =
      sessionId !== null ? (readSessionWorkspaceState(sessionId).widthPx ?? null) : null;
    this.setRaw(this.preferred);
  }

  /** Double-click: back to the theme's width for this session. */
  clearSaved(): void {
    if (this.sessionId !== null) writeSessionWorkspaceState(this.sessionId, { widthPx: undefined });
    this.preferred = null;
    this.setRaw(null);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): number | null => this.stored;
}

// Weak: an embed's store goes with its unmounted workbench.
const widthStores = new WeakMap<LayoutStateStore, InlinePanelWidthStore>();

function widthStoreOf(state: LayoutStateStore): InlinePanelWidthStore {
  let store = widthStores.get(state);
  if (!store) {
    store = new InlinePanelWidthStore();
    widthStores.set(state, store);
  }
  return store;
}

function getServerSnapshot(): number | null {
  return null;
}

/** Reset the standalone app's width store. Only for use in tests. */
export function resetWidthStoreForTesting(): void {
  const store = widthStores.get(standaloneLayoutState);
  if (!store) return;
  store.sessionId = null;
  store.preferred = null;
  store.setRaw(null);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Makes the always-visible right inline panel (AppShell aside) resizable via
 * a drag handle on its left edge. Uses its own width store so resizing the
 * inline panel doesn't disturb the push-panel widths (TerminalsPanel etc.).
 *
 * Returns the current pixel width and handle props to spread onto the resize
 * handle element. Intended for desktop-only use - callers should not render
 * the handle on mobile.
 *
 * `sessionId` scopes the persisted width. AppShell passes the root session so
 * one agent tree shares a rail width. Pass `null` when there is no active
 * conversation (the panel then uses the default width and resizes are not
 * persisted).
 *
 * `reservedPx` is layout width the panel may not claim - the open sidebar. It
 * tightens the ceiling without touching the persisted preference, so opening
 * the sidebar temporarily shrinks the panel and collapsing it restores the
 * user's width.
 *
 * `persistEnabled` disables manual resizing while the storage key is tentative.
 * `chatMinWidthPx` lets a nested Canvas conversation use its own width floor.
 */
export function useResizableInlinePanel(
  sessionId: string | null,
  minWidthPx: number | undefined = undefined,
  reservedPx = 0,
  persistEnabled = true,
  chatMinWidthPx = CHAT_MIN_WIDTH_PX,
  side: "left" | "right" = "right",
) {
  // The mount's box: the window, or an embed's root (decision 14). Its layout state holds the
  // store, so each mount keeps its own width.
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
  const floorPx = minWidthPx ?? minimumWidthPx(layout);
  const sideRef = useRef(side);
  sideRef.current = side;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // The panel's outer edge when a drag began: the width is the cursor's distance from it.
  const dragAnchor = useRef(0);
  // On a session switch the store still holds the previous session's
  // width until the effect below re-seeds it after commit. Derive this render's
  // width straight from the incoming session's saved value so the panel doesn't
  // flash the old width for a frame. Once the effect runs `store.sessionId`
  // catches up and we fall back to the live store value (which the drag and
  // keyboard handlers mutate in place).
  let effectiveRaw = raw;
  if (sessionId !== store.sessionId) {
    effectiveRaw =
      sessionId !== null ? (readSessionWorkspaceState(sessionId).widthPx ?? null) : null;
  }
  // Clamped at render time only - the store keeps the user's preferred width, so
  // a temporary squeeze (sidebar opening) is undone when the space returns.
  const preferredPanelWidth = Math.max(floorPx, effectiveRaw ?? defaultWidthPx(layout));
  const resolvedWidth = clamp(preferredPanelWidth, layout, floorPx, reservedPx, chatMinWidthPx);
  // Drives the drag listeners' lifecycle: they mount only while a drag is
  // live, so there's no idle window-level mousemove handler firing during
  // ordinary page use.
  const [isDragging, setIsDragging] = useState(false);
  // `resolvedWidth` reads the root's width at render, but a viewport resize
  // that leaves the stored (no-reserve) width unchanged wouldn't otherwise
  // re-render - so the render-time reserve clamp would go stale and the chat
  // could dip below its minimum on a shrink. This tick forces a recompute on
  // every resize regardless of whether the stored width moved.
  const [, bumpViewport] = useReducer((n: number) => n + 1, 0);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const minWidthRef = useRef(floorPx);
  minWidthRef.current = floorPx;
  const reservedRef = useRef(reservedPx);
  reservedRef.current = reservedPx;
  const chatMinRef = useRef(chatMinWidthPx);
  chatMinRef.current = chatMinWidthPx;
  const persistEnabledRef = useRef(persistEnabled);
  persistEnabledRef.current = persistEnabled;

  // While dragging, a transparent full-window overlay sits above the panel so
  // the pointer stream keeps reaching the parent document. Without it, dragging
  // over a cross-origin/sandboxed iframe (e.g. the HTML preview) routes mousemove
  // /mouseup into the frame, the parent never sees mouseup, and the drag sticks.
  const addDragOverlay = useCallback(() => {
    if (overlayRef.current || typeof document === "undefined") return;
    const el = document.createElement("div");
    el.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;cursor:col-resize;background:transparent;";
    document.body.appendChild(el);
    overlayRef.current = el;
  }, []);

  const removeDragOverlay = useCallback(() => {
    overlayRef.current?.remove();
    overlayRef.current = null;
  }, []);

  // Load the active session's saved width into the store (and re-load
  // when it changes) so the live store and the drag handlers operate on the
  // right session.
  useEffect(() => {
    store.loadSession(sessionId);
  }, [sessionId, store]);

  // Re-clamp the saved choice to the new viewport (without one, the default tracks it).
  // No `reservedPx` here: the sidebar's squeeze is applied at render time only.
  useEffect(
    () =>
      layout.onDidChangeRootSize(() => {
        store.setRaw(
          store.preferred !== null
            ? clamp(store.preferred, layout, minWidthRef.current, 0, chatMinRef.current)
            : null,
        );
        // Force a re-render even when the stored width is unchanged, so the
        // render-time reserve clamp re-runs against the new viewport.
        bumpViewport();
      }),
    [layout, store],
  );

  // The resolvedWidth formula already enforces the visual minimum. No effect
  // needed - this lets the panel shrink back when minWidthPx drops.

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!persistEnabled) return;
      e.preventDefault();
      const panel = (e.currentTarget as HTMLElement | null)?.closest?.(
        '[data-slot="workspace-panel"], aside',
      );
      const box = panel?.getBoundingClientRect();
      // Without a panel element, the mount's own edge: an embed's root needn't start at x 0.
      const bounds = layoutRef.current.getRoot()?.getBoundingClientRect();
      const right = sideRef.current === "right";
      dragAnchor.current = box
        ? right
          ? box.right
          : box.left
        : right
          ? (bounds?.right ?? window.innerWidth)
          : (bounds?.left ?? 0);
      setIsDragging(true);
      addDragOverlay();
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [addDragOverlay, persistEnabled],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!persistEnabled) return;
      const step = 20;
      // The handle is the panel's inner edge: towards the chat widens.
      const widen = side === "right" ? "ArrowLeft" : "ArrowRight";
      const narrow = side === "right" ? "ArrowRight" : "ArrowLeft";
      if (e.key === widen) {
        e.preventDefault();
        store.set(
          (prev) =>
            clamp(
              (prev ?? resolvedWidth) + step,
              layoutRef.current,
              minWidthRef.current,
              reservedRef.current,
              chatMinRef.current,
            ),
          true,
        );
      } else if (e.key === narrow) {
        e.preventDefault();
        store.set(
          (prev) =>
            clamp(
              (prev ?? resolvedWidth) - step,
              layoutRef.current,
              minWidthRef.current,
              reservedRef.current,
              chatMinRef.current,
            ),
          true,
        );
      }
    },
    [persistEnabled, resolvedWidth, side, store],
  );

  // Drag listeners live only while a drag is active - no idle window-level
  // mousemove handler firing during ordinary use. Moves are coalesced through a
  // single rAF so a burst of mousemove events yields at most one width update
  // per frame (store.set already dedupes equal values).
  useEffect(() => {
    if (!isDragging) return;
    let frame = 0;
    let pending: number | null = null;

    function flush() {
      frame = 0;
      if (pending === null || !persistEnabledRef.current) return;
      store.set(
        clamp(
          pending,
          layoutRef.current,
          minWidthRef.current,
          reservedRef.current,
          chatMinRef.current,
        ),
      );
      pending = null;
    }

    function onMouseMove(e: MouseEvent) {
      pending =
        sideRef.current === "right"
          ? dragAnchor.current - e.clientX
          : e.clientX - dragAnchor.current;
      if (frame === 0) frame = requestAnimationFrame(flush);
    }

    function stop() {
      if (frame !== 0) cancelAnimationFrame(frame);
      flush();
      setIsDragging(false);
      removeDragOverlay();
      if (persistEnabledRef.current) store.persistStored();
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stop);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stop);
      // Unmounted mid-drag (panel closed via tab switch): reset the cursor and
      // drop the overlay so it can't swallow later clicks.
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      removeDragOverlay();
    };
  }, [isDragging, removeDragOverlay, store]);

  // Stable identity so consumers memoized on this prop (WorkspacePanel) don't
  // re-render on every parent render - the object only changes when its inputs do.
  // Double-click: back to the theme's width (`ui-auxiliarybar-width`) for this session.
  const onDoubleClick = useCallback(() => {
    if (!persistEnabledRef.current) return;
    store.clearSaved();
  }, [store]);

  const handleProps = useMemo(
    () => ({
      onMouseDown,
      onKeyDown,
      onDoubleClick,
      role: "separator" as const,
      "aria-orientation": "vertical" as const,
      "aria-label": "Resize panel",
      "aria-disabled": !persistEnabled,
      tabIndex: persistEnabled ? 0 : -1,
    }),
    [onMouseDown, onKeyDown, onDoubleClick, persistEnabled],
  );

  // Read when the panel opens, so a window resized since the last render is measured.
  // The store holds the choice clamped to this viewport; a wider window can fit all of it.
  const widthInWiderWindow = useCallback(() => {
    const chosen = sessionId === store.sessionId ? store.preferred : effectiveRaw;
    return Math.max(floorPx, chosen ?? defaultWidthInWiderWindowPx(layoutRef.current));
  }, [sessionId, effectiveRaw, floorPx, store]);

  return {
    panelWidth: resolvedWidth,
    /** How much wider the window must get for the panel to leave the chat its width. */
    widthInWiderWindow,
    preferredContentWidth: preferredPanelWidth + chatMinWidthPx + GAP_PX,
    handleProps,
    isDragging,
  };
}
