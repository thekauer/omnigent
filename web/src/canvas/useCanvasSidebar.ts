import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import type { LayoutService } from "@/workbench/layoutService";
import { useWorkbenchScope } from "@/workbench/workbenchScope";

/**
 * The side bar's open state, kept by the layout service: collapse once on Canvas entry, and
 * remember subsequent manual changes.
 */
export function useCanvasSidebar(
  inCanvas: boolean,
  initialOpen: () => boolean,
  given?: LayoutService,
) {
  // The mount's own layout unless one is given.
  const scoped = useWorkbenchScope().layout;
  const service = given ?? scoped;
  const initial = useRef(initialOpen);
  initial.current = initialOpen;
  const open = useSyncExternalStore(
    service.onDidChangeSideBar,
    () => service.isSideBarOpen(initial.current),
    () => service.isSideBarOpen(initial.current),
  );
  useEffect(() => service.holdSideBarState(), [service]);
  const beforeCanvas = useRef<boolean | null>(null);
  const inCanvasRef = useRef(inCanvas);
  inCanvasRef.current = inCanvas;

  useLayoutEffect(() => {
    if (inCanvas) {
      service.setSideBarOpen((previous) => {
        beforeCanvas.current ??= previous;
        return false;
      });
    } else if (beforeCanvas.current !== null) {
      service.setSideBarOpen(beforeCanvas.current);
      beforeCanvas.current = null;
    }
  }, [inCanvas, service]);

  const setManually = useCallback(
    (update: SetStateAction<boolean>) => {
      service.setSideBarOpen((previous) => {
        const next = typeof update === "function" ? update(previous) : update;
        if (inCanvasRef.current && next !== previous) beforeCanvas.current = next;
        return next;
      });
    },
    [service],
  );

  return [open, setManually] as const;
}
