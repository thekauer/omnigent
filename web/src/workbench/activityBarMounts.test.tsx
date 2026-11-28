import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useActivityBarItems } from "./activityBar";
import { LAYOUT_SLOTS } from "./layoutState";
import {
  createWorkbenchScope,
  type WorkbenchScope,
  WorkbenchScopeProvider,
} from "./workbenchScope";

describe("the activity bar's items per mount", () => {
  it("keeps each of two mounts' snapshots stable while the other mount reads its own", () => {
    const first = createWorkbenchScope("/activity-first");
    const second = createWorkbenchScope("/activity-second");
    first.state.set(LAYOUT_SLOTS.activityBar, { order: ["one", "two"] });
    second.state.set(LAYOUT_SLOTS.activityBar, { order: ["two", "one"], hidden: ["one"] });
    const wrap =
      (scope: WorkbenchScope) =>
      ({ children }: { children: ReactNode }) => (
        <WorkbenchScopeProvider scope={scope}>{children}</WorkbenchScopeProvider>
      );
    const reads = {
      first: renderHook(() => useActivityBarItems(), { wrapper: wrap(first) }),
      second: renderHook(() => useActivityBarItems(), { wrapper: wrap(second) }),
    };
    const firstItems = reads.first.result.current;
    const secondItems = reads.second.result.current;
    expect(firstItems).toEqual({ order: ["one", "two"], hidden: [] });
    expect(secondItems).toEqual({ order: ["two", "one"], hidden: ["one"] });

    // Each mount re-renders after the other has read: its snapshot is still the same object.
    reads.second.rerender();
    reads.first.rerender();
    expect(reads.first.result.current).toBe(firstItems);
    reads.first.rerender();
    reads.second.rerender();
    expect(reads.second.result.current).toBe(secondItems);
  });
});
