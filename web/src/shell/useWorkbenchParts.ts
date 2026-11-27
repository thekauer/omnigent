// The shell's side of the layout service (layout plan L2): each part AppShell draws registers
// with a controller over AppShell's own state, and the primary side bar's desktop open state
// is kept in the layout state.

import { useEffect, useLayoutEffect, useRef } from "react";

import { LAYOUT_SLOTS, layoutState } from "@/workbench/layoutState";
import { type LayoutService, layoutService, type Part } from "@/workbench/layoutService";

export interface WorkbenchPartState {
  readonly visible: boolean;
  readonly setHidden: (hidden: boolean) => void;
  readonly toggle?: () => void;
}

/**
 * Registers `part` with the layout service while `enabled`, answering from the latest
 * render's state, and tells the service when its visibility changes.
 */
export function useWorkbenchPart(
  part: Part,
  state: WorkbenchPartState,
  enabled = true,
  service: LayoutService = layoutService,
): void {
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
    });
  }, [enabled, part, service]);
  useLayoutEffect(() => {
    if (enabled) service.partChanged(part);
  }, [enabled, part, service, state.visible]);
}

/** The side bar's remembered desktop open state, or undefined when none is stored. */
export function readSidebarVisible(): boolean | undefined {
  const stored = layoutState.get(LAYOUT_SLOTS.sidebar);
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
    const stored = readSidebarVisible();
    if ((stored ?? true) === open) return;
    layoutState.set(LAYOUT_SLOTS.sidebar, { visible: open });
  }, [open, remember]);
}
