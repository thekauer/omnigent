// The shell's side of the layout service (layout plan L2): each part AppShell draws registers
// with a controller over AppShell's own state, and the primary side bar's desktop open state
// is kept in the layout state.

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import type { ContextKeyValue } from "@/vscodeExtensions/contextKeys";
import { LAYOUT_SLOTS, layoutState } from "@/workbench/layoutState";
import { type WorkbenchContext, workbenchContext } from "@/workbench/workbenchContext";
import { type LayoutService, layoutService, type Part } from "@/workbench/layoutService";

export interface WorkbenchPartState {
  readonly visible: boolean;
  readonly setHidden: (hidden: boolean) => void;
  readonly toggle?: () => void;
  /** Moves keyboard focus into the part (`workbench.action.focus*`). */
  readonly focus?: () => void;
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
      focus: () => latest.current.focus?.(),
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

/**
 * Publishes the shell's workbench context keys while mounted: keys left out of a later render
 * are removed, and all of them on unmount.
 */
export function useWorkbenchContextKeys(
  values: Readonly<Record<string, ContextKeyValue>>,
  context: WorkbenchContext = workbenchContext,
): void {
  const published = useRef<readonly string[]>([]);
  useEffect(() => {
    const removed = Object.fromEntries(
      published.current.filter((key) => !Object.hasOwn(values, key)).map((key) => [key, undefined]),
    );
    context.update({ ...removed, ...values });
    published.current = Object.keys(values);
  }, [context, values]);
  useEffect(
    () => () => {
      context.update(Object.fromEntries(published.current.map((key) => [key, undefined])));
      published.current = [];
    },
    [context],
  );
}

/** Whether `part` is on screen, kept current. */
export function usePartVisible(part: Part, service: LayoutService = layoutService): boolean {
  return useSyncExternalStore(
    (listener) => service.onDidChangePartVisibility(listener),
    () => service.isVisible(part),
    () => false,
  );
}

/** The view container the primary side bar shows, kept current. */
export function useActiveViewContainer(service: LayoutService = layoutService): string {
  return useSyncExternalStore(
    service.onDidChangeSideBar,
    () => service.getActiveViewContainer(),
    () => service.getActiveViewContainer(),
  );
}
