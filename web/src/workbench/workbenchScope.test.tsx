import { act, cleanup, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDesktopLayout, useIsMobileViewport } from "@/hooks/useIsMobileViewport";
import { useIsSideBySideSidebarViewport } from "@/hooks/useIsSideBySideSidebarViewport";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import { readPanelSizePreference, writePanelSizePreference } from "@/lib/panelSizePreferences";
import { usePartVisible, useWorkbenchPart } from "@/shell/useWorkbenchParts";
import { installResizableWidth } from "@/test/resizableWidth";
import { activityBarWidthPx, orderActivityBarItems } from "./activityBar";
import { LAYOUT_SLOTS, layoutState, standaloneLayoutState } from "./layoutState";
import { layoutService, Parts, standaloneLayoutService } from "./layoutService";
import { rootRelativeLength } from "./layoutTokens";
import { LAYOUT_WIDTH_ATTRIBUTE, viewportOfSize } from "./layoutViewport";
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
    expect(activityBarWidthPx(standaloneLayoutService)).toBe(48);
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

describe("an embed's breakpoints (decision 14)", () => {
  function mountRoot(
    scope: ReturnType<typeof createWorkbenchScope>,
    width: number,
    height: number,
  ) {
    const root = document.createElement("div");
    let box = { width, height };
    root.getBoundingClientRect = () => box as DOMRect;
    document.body.append(root);
    act(() => scope.layout.setRoot(root));
    return {
      root,
      resize(next: { width: number; height: number }) {
        box = next;
        // jsdom has no ResizeObserver: measure as a resize would.
        act(() => {
          scope.layout.setRoot(null);
          scope.layout.setRoot(root);
        });
      },
      remove() {
        scope.layout.setRoot(null);
        root.remove();
      },
    };
  }

  it("follow the root's box, not the window's, and mark it for the CSS variants", () => {
    const scope = createWorkbenchScope("/narrow");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <WorkbenchScopeProvider scope={scope}>{children}</WorkbenchScopeProvider>
    );
    const mobile = renderHook(() => [useIsMobileViewport(), useIsSideBySideSidebarViewport()], {
      wrapper,
    });
    // No box yet: the window's answer (the test window is desktop).
    expect(mobile.result.current).toEqual([false, false]);
    const root = mountRoot(scope, 390, 844);
    expect(root.root).toHaveAttribute(LAYOUT_WIDTH_ATTRIBUTE, "mobile");
    expect(mobile.result.current).toEqual([true, false]);
    expect(isDesktopLayout(scope.layout)).toBe(false);
    root.resize({ width: 800, height: 700 });
    expect(mobile.result.current).toEqual([true, true]);
    root.resize({ width: 1400, height: 900 });
    expect(root.root).toHaveAttribute(LAYOUT_WIDTH_ATTRIBUTE, "desktop");
    expect(mobile.result.current).toEqual([false, false]);
    expect(isDesktopLayout(scope.layout)).toBe(true);
    // A root with no box (not laid out) follows the window again, unmarked.
    root.resize({ width: 0, height: 0 });
    expect(root.root).not.toHaveAttribute(LAYOUT_WIDTH_ATTRIBUTE);
    root.remove();
    expect(root.root).not.toHaveAttribute(LAYOUT_WIDTH_ATTRIBUTE);
  });

  it("keep the desktop layout in the desktop app at any root width", () => {
    vi.stubGlobal("omnigentDesktop", { kind: "electron" });
    try {
      expect(viewportOfSize(390, 844)).toEqual({ mobile: false, sideBySide: false });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(viewportOfSize(390, 844)).toEqual({ mobile: true, sideBySide: false });
    // The band needs 600px at a squarish aspect.
    expect(viewportOfSize(700, 1200).sideBySide).toBe(false);
    expect(viewportOfSize(1180, 900).sideBySide).toBe(true);
    expect(viewportOfSize(1181, 900).mobile).toBe(false);
  });
});

describe("the side bar's dragged width", () => {
  it("is each mount's own", () => {
    const first = createWorkbenchScope("/first");
    const second = createWorkbenchScope("/second");
    const wrapper =
      (scope: typeof first) =>
      ({ children }: { children: ReactNode }) => (
        <WorkbenchScopeProvider scope={scope}>{children}</WorkbenchScopeProvider>
      );
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(2000);
    try {
      const one = renderHook(() => useResizableSidebar(), { wrapper: wrapper(first) });
      const two = renderHook(() => useResizableSidebar(), { wrapper: wrapper(second) });
      act(() =>
        one.result.current.handleProps.onKeyDown({
          key: "ArrowRight",
          preventDefault: () => {},
        } as React.KeyboardEvent),
      );
      expect(one.result.current.width).toBe(340);
      expect(two.result.current.width).toBe(320);
      expect(readPanelSizePreference("sidebarWidthPx", first.state)).toBe(340);
      expect(readPanelSizePreference("sidebarWidthPx", second.state)).toBeNull();
      expect(readPanelSizePreference("sidebarWidthPx", standaloneLayoutState)).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("the side bar's width in an embed", () => {
  it("clamps against the embed's root, not the window", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(3000);
    const scope = createWorkbenchScope("/sized");
    const root = document.createElement("div");
    root.getBoundingClientRect = () => ({ width: 1400, height: 900 }) as DOMRect;
    document.body.append(root);
    act(() => scope.layout.setRoot(root));
    const { result } = renderHook(() => useResizableSidebar(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <WorkbenchScopeProvider scope={scope}>{children}</WorkbenchScopeProvider>
      ),
    });
    for (let step = 0; step < 40; step++) {
      act(() =>
        result.current.handleProps.onKeyDown({
          key: "ArrowRight",
          preventDefault: () => {},
        } as React.KeyboardEvent),
      );
    }
    // 50% of the 1400px root (the window's 3000 would allow 1500).
    expect(result.current.width).toBe(700);
    scope.layout.setRoot(null);
    root.remove();
    vi.restoreAllMocks();
  });

  it("re-renders when its root is measured after the first render", () => {
    // The ref callback measures the root during commit, before the hook's effects subscribe:
    // the width read at render (the window's 3000) must still follow the root's 1000.
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(3000);
    const scope = createWorkbenchScope("/first-measure");
    writePanelSizePreference("sidebarWidthPx", 900, scope.state);
    function Probe() {
      return <span data-testid="width">{useResizableSidebar().width}</span>;
    }
    const { getByTestId, unmount } = render(
      <WorkbenchScopeProvider scope={scope}>
        <div
          ref={(element) => {
            if (!element) return;
            element.getBoundingClientRect = () => ({ width: 1000, height: 800 }) as DOMRect;
            scope.layout.setRoot(element);
          }}
        >
          <Probe />
        </div>
      </WorkbenchScopeProvider>,
    );
    // 50% of the 1000px root, not the window's 1500.
    expect(getByTestId("width").textContent).toBe("500");
    unmount();
    scope.layout.setRoot(null);
    vi.restoreAllMocks();
  });

  it("keeps a hidden root's layout and the side bar's width until it shows again", () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const setRootWidth = installResizableWidth(1400);
    const scope = createWorkbenchScope("/hidden");
    const root = document.createElement("div");
    document.body.append(root);
    try {
      act(() => scope.layout.setRoot(root));
      const { result } = renderHook(() => useResizableSidebar(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <WorkbenchScopeProvider scope={scope}>{children}</WorkbenchScopeProvider>
        ),
      });
      expect(result.current.width).toBe(320);
      // display: none: the root reports no box, and the mount keeps its desktop layout.
      setRootWidth(0);
      expect(scope.layout.getViewport()).toEqual(viewportOfSize(1400, 0));
      expect(result.current.width).toBe(320);
      // Shown again: the never-dragged side bar is still its default, not the floor.
      setRootWidth(1400);
      expect(result.current.width).toBe(320);
    } finally {
      scope.layout.setRoot(null);
      root.remove();
      vi.restoreAllMocks();
      vi.stubGlobal("ResizeObserver", originalResizeObserver);
    }
  });
});
