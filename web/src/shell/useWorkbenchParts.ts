// The shell's side of the layout service (layout plan L2): each part AppShell draws registers
// with a controller over AppShell's own state, and the primary side bar's desktop open state
// is kept in the layout state.

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import type { ContextKeyValue } from "@/vscodeExtensions/contextKeys";
import { LAYOUT_SLOTS, type LayoutStateStore, layoutState } from "@/workbench/layoutState";
import {
  isActiveWorkbenchScope,
  subscribeActiveWorkbenchScope,
  useWorkbenchScope,
} from "@/workbench/workbenchScope";
import { type WorkbenchContext, workbenchContext } from "@/workbench/workbenchContext";
import type { LayoutService, Part } from "@/workbench/layoutService";

export interface WorkbenchPartState {
  readonly visible: boolean;
  readonly setHidden: (hidden: boolean) => void;
  readonly toggle?: () => void;
  /** Moves keyboard focus into the part (`workbench.action.focus*`). */
  readonly focus?: () => void;
  /** Maximizes the part over the main part, or restores it. */
  readonly toggleMaximized?: () => void;
  /** Whether the part is maximized. */
  readonly maximized?: boolean;
  /**
   * The part's width as the shell draws it: a drag's changes reach the layout listeners through
   * it (the part's box is measured when read, not when it changes).
   */
  readonly width?: number;
}

/**
 * Registers `part` with the layout service while `enabled`, answering from the latest
 * render's state, and tells the service when its visibility changes.
 */
export function useWorkbenchPart(
  part: Part,
  state: WorkbenchPartState,
  enabled = true,
  given?: LayoutService,
): void {
  // The mount's own layout unless one is given.
  const scoped = useWorkbenchScope().layout;
  const service = given ?? scoped;
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    if (!enabled) return undefined;
    return service.registerPart(part, {
      isVisible: () => latest.current.visible,
      setHidden: (hidden) => latest.current.setHidden(hidden),
      toggle: () => {
        const { toggle, visible, setHidden } = latest.current;
        if (toggle) toggle();
        else setHidden(visible);
      },
      focus: () => latest.current.focus?.(),
      toggleMaximized: () => latest.current.toggleMaximized?.(),
      isMaximized: () => latest.current.maximized ?? false,
    });
  }, [enabled, part, service]);
  useLayoutEffect(() => {
    if (enabled) service.partChanged(part);
  }, [enabled, part, service, state.visible, state.maximized, state.width]);
}

/** The side bar's remembered desktop open state, or undefined when none is stored. */
export function readSidebarVisible(store: LayoutStateStore = layoutState): boolean | undefined {
  const stored = store.get(LAYOUT_SLOTS.sidebar);
  if (typeof stored !== "object" || stored === null) return undefined;
  const visible = (stored as Record<string, unknown>).visible;
  return typeof visible === "boolean" ? visible : undefined;
}

/**
 * Remembers the side bar's open state when it changes while `remember` holds (a desktop
 * window, outside the states that open or close it for the user: Settings, the canvas, a
 * maximized rail, a peek). The default (open) is not written, so a window that never closed it
 * stores nothing, and another window's choice stands until this one's user changes it.
 */
export function useRememberSidebarVisible(open: boolean, remember: boolean): void {
  const store = useWorkbenchScope().state;
  // The state when remembering last began or changed: coming back from Settings (or a narrow
  // window) to a state is not a choice, so only a change while remembering is written.
  const seen = useRef<boolean | null>(null);
  useEffect(() => {
    if (!remember) {
      seen.current = null;
      return;
    }
    const previous = seen.current;
    seen.current = open;
    if (previous === null || previous === open) return;
    const stored = readSidebarVisible(store);
    if ((stored ?? true) === open) return;
    store.set(LAYOUT_SLOTS.sidebar, { visible: open });
  }, [open, remember, store]);
}

/**
 * Publishes the shell's workbench context keys while this mount is the active one, and again
 * when it becomes active: the window's keys are the active mount's, so an inactive mount
 * publishes nothing, and the keys go when the mount does.
 */
export function useWorkbenchContextKeys(
  values: Readonly<Record<string, ContextKeyValue>>,
  context: WorkbenchContext = workbenchContext,
): void {
  const scope = useWorkbenchScope();
  const latest = useRef(values);
  latest.current = values;
  useEffect(() => {
    if (isActiveWorkbenchScope(scope)) context.replace(values);
  }, [context, scope, values]);
  useEffect(() => {
    const publishIfActive = () => {
      if (isActiveWorkbenchScope(scope)) context.replace(latest.current);
    };
    const unsubscribe = subscribeActiveWorkbenchScope(publishIfActive);
    return () => {
      unsubscribe();
      if (isActiveWorkbenchScope(scope)) context.replace({});
    };
  }, [context, scope]);
}

/** Whether `part` is on screen, kept current. */
export function usePartVisible(part: Part, given?: LayoutService): boolean {
  const scoped = useWorkbenchScope().layout;
  const service = given ?? scoped;
  return useSyncExternalStore(
    (listener) => service.onDidChangePartVisibility(listener),
    () => service.isVisible(part),
    () => false,
  );
}

/** The view container the primary side bar shows, kept current. */
export function useActiveViewContainer(given?: LayoutService): string {
  const scoped = useWorkbenchScope().layout;
  const service = given ?? scoped;
  return useSyncExternalStore(
    service.onDidChangeSideBar,
    () => service.getActiveViewContainer(),
    () => service.getActiveViewContainer(),
  );
}
