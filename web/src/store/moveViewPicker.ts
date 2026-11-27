import { toast } from "sonner";
import { create } from "zustand";
import { productLayout } from "@/workbench/productLayout";

// The "View: Move View..." picker's open state (layout plan L6), and what opens it.

interface MoveViewPickerState {
  readonly open: boolean;
  /** The view to move; the picker asks for one when unset. */
  readonly viewId: string | undefined;
  /** The view picked on the picker's first page. */
  readonly chosenViewId: string | undefined;
}

export const useMoveViewPickerStore = create<MoveViewPickerState>(() => ({
  open: false,
  viewId: undefined,
  chosenViewId: undefined,
}));

/** VS Code's "Move View...": picks the view (unless given), then where it goes. */
export function openMoveViewPicker(viewId?: string): void {
  if (productLayout.viewLocationsLocked()) {
    toast.warning("Views can't be moved in this product");
    return;
  }
  useMoveViewPickerStore.setState({ open: true, viewId, chosenViewId: undefined });
}

export function closeMoveViewPicker(): void {
  useMoveViewPickerStore.setState({ open: false, viewId: undefined, chosenViewId: undefined });
}
