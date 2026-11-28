// Reactive "should the open sidebar sit beside the chat?" hook for the mobile layout.
//
// Wide mobile widths (an unfolded foldable, a small phone in landscape) are
// still below `md`, but have room to show the sidebar beside the chat instead of
// over it: Material's "medium" width class (600dp+) at a squarish-or-wider aspect
// ratio. Tall narrow ones stay on the overlay drawer. The box is the mount's: the
// window, or an embed's root (workbench/layoutViewport.ts).

import { useCallback, useSyncExternalStore } from "react";
import { layoutService, type LayoutService } from "@/workbench/layoutService";
import { useWorkbenchScope } from "@/workbench/workbenchScope";

/** Non-reactive read of {@link useIsSideBySideSidebarViewport} for a mount (the active one's by default). */
export function isSideBySideSidebarViewport(layout: LayoutService = layoutService): boolean {
  if (typeof window === "undefined") return false;
  return layout.isSideBySideLayout();
}

/**
 * True on a mobile-layout width wide enough that the open sidebar pushes the
 * chat aside rather than covering it, so both stay usable at once. Always false
 * in the desktop app, which never uses the mobile layout.
 */
export function useIsSideBySideSidebarViewport(): boolean {
  const { layout } = useWorkbenchScope();
  const subscribe = useCallback(
    (listener: () => void) => layout.onDidChangeViewport(listener),
    [layout],
  );
  return useSyncExternalStore(
    subscribe,
    () => layout.isSideBySideLayout(),
    () => false,
  );
}
