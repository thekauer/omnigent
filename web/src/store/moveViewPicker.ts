import { toast } from "sonner";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ProductLayoutPolicy } from "@/workbench/productLayout";

// The "View: Move View..." picker's open state (layout plan L6). Each mounted app has its own
// picker (`workbench/workbenchScope.ts`), so "View: Move View..." opens it in the active mount only.

export interface MoveViewPickerState {
  readonly open: boolean;
  /** The view to move; the picker asks for one when unset. */
  readonly viewId: string | undefined;
  /** The view picked on the picker's first page. */
  readonly chosenViewId: string | undefined;
}

export interface MoveViewPicker {
  readonly store: StoreApi<MoveViewPickerState>;
  /** VS Code's "Move View...": picks the view (unless given), then where it goes. */
  readonly open: (viewId?: string) => void;
  readonly close: () => void;
}

/** A picker for one mount, refusing to open while the mount's product locks its views in place. */
export function createMoveViewPicker(policy: ProductLayoutPolicy): MoveViewPicker {
  const store = createStore<MoveViewPickerState>(() => ({
    open: false,
    viewId: undefined,
    chosenViewId: undefined,
  }));
  return {
    store,
    open(viewId) {
      if (policy.viewLocationsLocked()) {
        toast.warning("Views can't be moved in this product");
        return;
      }
      store.setState({ open: true, viewId, chosenViewId: undefined });
    },
    close() {
      store.setState({ open: false, viewId: undefined, chosenViewId: undefined });
    },
  };
}
