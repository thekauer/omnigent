// A part's width and maximized state reach the layout service (layout plan L10): a drag's width
// and the secondary side bar's maximize are layout changes the extensions hear.
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LayoutService, Parts } from "@/workbench/layoutService";
import { useWorkbenchPart, type WorkbenchPartState } from "./useWorkbenchParts";

describe("useWorkbenchPart", () => {
  it("reports a change of the part's width and its maximized state to the layout listeners", () => {
    const layout = new LayoutService();
    const changes = vi.fn();
    layout.onDidChangeLayout(changes);
    const partState = (overrides: Partial<WorkbenchPartState> = {}): WorkbenchPartState => ({
      visible: true,
      setHidden: () => {},
      width: 320,
      ...overrides,
    });
    const { rerender } = renderHook(
      (state: WorkbenchPartState) => useWorkbenchPart(Parts.AUXILIARYBAR_PART, state, true, layout),
      { initialProps: partState() },
    );
    const mounted = changes.mock.calls.length;
    rerender(partState({ width: 340 }));
    expect(changes).toHaveBeenCalledTimes(mounted + 1);
    // Another render of the same state reports nothing new.
    rerender(partState({ width: 340 }));
    expect(changes).toHaveBeenCalledTimes(mounted + 1);
    expect(layout.isMaximized(Parts.AUXILIARYBAR_PART)).toBe(false);
    rerender(partState({ width: 340, maximized: true }));
    expect(changes).toHaveBeenCalledTimes(mounted + 2);
    expect(layout.isMaximized(Parts.AUXILIARYBAR_PART)).toBe(true);
  });
});
