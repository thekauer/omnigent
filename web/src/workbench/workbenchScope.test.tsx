import { act, cleanup, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePartVisible, useWorkbenchPart } from "@/shell/useWorkbenchParts";
import { activityBarWidthPx, orderActivityBarItems } from "./activityBar";
import { LAYOUT_SLOTS, layoutState, standaloneLayoutState } from "./layoutState";
import { layoutService, Parts, standaloneLayoutService } from "./layoutService";
import { rootRelativeLength } from "./layoutTokens";
import { matchesIdPattern, productLayout } from "./productLayout";
import { isViewHidden } from "./viewsLayout";
import {
  activateWorkbenchScope,
  createWorkbenchScope,
  isActiveWorkbenchScope,
  releaseWorkbenchScope,
  WorkbenchScopeProvider,
} from "./workbenchScope";

afterEach(() => {
  cleanup();
  localStorage.clear();
  productLayout.set(null);
});

describe("workbench scopes", () => {
  it("keep each mount's layout state and parts apart", () => {
    const first = createWorkbenchScope("/one");
    const second = createWorkbenchScope("/two");
    first.state.set(LAYOUT_SLOTS.sidebar, { visible: false });
    expect(second.state.get(LAYOUT_SLOTS.sidebar)).toBeUndefined();
    expect(localStorage.getItem("omnigent:layout-state@embed:/one")).toContain("visible");
    const wrapper =
      (scope: typeof first) =>
      ({ children }: { children: ReactNode }) => (
        <WorkbenchScopeProvider scope={scope}>{children}</WorkbenchScopeProvider>
      );
    renderHook(() => useWorkbenchPart(Parts.SIDEBAR_PART, { visible: true, setHidden: () => {} }), {
      wrapper: wrapper(first),
    });
    expect(first.layout.isVisible(Parts.SIDEBAR_PART)).toBe(true);
    expect(second.layout.isVisible(Parts.SIDEBAR_PART)).toBe(false);
    const { result } = renderHook(() => usePartVisible(Parts.SIDEBAR_PART), {
      wrapper: wrapper(second),
    });
    expect(result.current).toBe(false);
  });

  it("route the window's layout to the mount last activated, and back when it goes", () => {
    const first = createWorkbenchScope("/one");
    const second = createWorkbenchScope("/two");
    const listener = vi.fn();
    const unsubscribe = layoutState.subscribe(listener);
    activateWorkbenchScope(first);
    activateWorkbenchScope(second);
    layoutState.set(LAYOUT_SLOTS.sidebar, { visible: false });
    expect(second.state.get(LAYOUT_SLOTS.sidebar)).toEqual({ visible: false });
    expect(first.state.get(LAYOUT_SLOTS.sidebar)).toBeUndefined();
    activateWorkbenchScope(first);
    expect(layoutService.getStore()).toBe(first.state);
    expect([isActiveWorkbenchScope(first), isActiveWorkbenchScope(second)]).toEqual([true, false]);
    releaseWorkbenchScope(first);
    expect(layoutService.getStore()).toBe(second.state);
    releaseWorkbenchScope(second);
    expect(layoutService.getStore()).toBe(standaloneLayoutState);
    expect(layoutService.getRootSize()).toEqual(standaloneLayoutService.getRootSize());
    // Each switch tells the window's listeners every slot may have changed.
    expect(listener).toHaveBeenCalledWith({});
    unsubscribe();
  });

  it("reset and restore the active mount's layout slots (View: Reset Layout and its undo)", () => {
    const scope = createWorkbenchScope("/one");
    scope.state.set(LAYOUT_SLOTS.sidebar, { visible: false });
    activateWorkbenchScope(scope);
    try {
      const removed = layoutState.resetSlots([LAYOUT_SLOTS.sidebar]);
      expect(removed).toEqual({ [LAYOUT_SLOTS.sidebar]: { visible: false } });
      expect(scope.state.get(LAYOUT_SLOTS.sidebar)).toBeUndefined();
      layoutState.restoreSlots(removed);
      expect(scope.state.get(LAYOUT_SLOTS.sidebar)).toEqual({ visible: false });
      expect(standaloneLayoutState.get(LAYOUT_SLOTS.sidebar)).toBeUndefined();
    } finally {
      releaseWorkbenchScope(scope);
    }
  });

  it("measure part sizes against the mount's root", () => {
    expect(rootRelativeLength("50vw", { width: 1000, height: 800 })).toBe("500px");
    expect(rootRelativeLength("clamp(420px, 36vw, 600px)", { width: 1000, height: 800 })).toBe(
      "clamp(420px, 360px, 600px)",
    );
    expect(rootRelativeLength("10vh", { width: 1000, height: 800 })).toBe("80px");
    expect(rootRelativeLength("320px", { width: 1000, height: 800 })).toBeUndefined();
    expect(rootRelativeLength("50vw", null)).toBeUndefined();
    // No layout in the test DOM: the default stands in.
    expect(activityBarWidthPx()).toBe(48);
  });
});

describe("the standalone app's tree", () => {
  it("reads and registers into its own workbench while an embed is active", () => {
    const embed = createWorkbenchScope("/one");
    activateWorkbenchScope(embed);
    try {
      renderHook(() =>
        useWorkbenchPart(Parts.SIDEBAR_PART, { visible: true, setHidden: () => {} }),
      );
      expect(standaloneLayoutService.isVisible(Parts.SIDEBAR_PART)).toBe(true);
      expect(embed.layout.isVisible(Parts.SIDEBAR_PART)).toBe(false);
    } finally {
      cleanup();
      releaseWorkbenchScope(embed);
    }
  });
});

describe("id patterns", () => {
  it("match `*` runs in linear time, however many stars", () => {
    expect(matchesIdPattern("acme.tools.list", ["acme.*"])).toBe(true);
    expect(matchesIdPattern("acme.tools.list", ["*.list"])).toBe(true);
    expect(matchesIdPattern("acme.tools.list", ["a*t*s*t"])).toBe(true);
    expect(matchesIdPattern("acme.tools.list", ["acme.*.x"])).toBe(false);
    const started = performance.now();
    expect(matchesIdPattern("a".repeat(200), [`${"*a".repeat(90)}*b`])).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("the product's layout", () => {
  it("hides views by id or pattern, and orders the activity bar before the user", () => {
    productLayout.set({ hiddenViews: ["acme.*"], containerOrder: ["omnigent.inbox", "acme.*"] });
    expect(isViewHidden({ id: "acme.tools.list" }, {})).toBe(true);
    expect(isViewHidden({ id: "omnigent.inbox.list" }, {})).toBe(false);
    const items = ["omnigent.conversations", "acme.tools", "omnigent.inbox"].map((id) => ({ id }));
    expect(orderActivityBarItems(items, { order: [], hidden: [] }).map((item) => item.id)).toEqual([
      "omnigent.inbox",
      "acme.tools",
      "omnigent.conversations",
    ]);
    // The user's order wins.
    expect(
      orderActivityBarItems(items, { order: ["omnigent.conversations"], hidden: [] }).map(
        (item) => item.id,
      ),
    ).toEqual(["omnigent.conversations", "omnigent.inbox", "acme.tools"]);
  });
});

describe("an embed's root", () => {
  it("is what the layout service measures", () => {
    const scope = createWorkbenchScope("/one");
    const root = document.createElement("div");
    root.getBoundingClientRect = () => ({ width: 640, height: 480 }) as DOMRect;
    document.body.append(root);
    act(() => scope.layout.setRoot(root));
    expect(scope.layout.getRootSize()).toEqual({ width: 640, height: 480 });
    scope.layout.setRoot(null);
    root.remove();
    render(<div />);
  });
});
