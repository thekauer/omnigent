import { act, cleanup, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDesktopLayout, useIsMobileViewport } from "@/hooks/useIsMobileViewport";
import { useIsSideBySideSidebarViewport } from "@/hooks/useIsSideBySideSidebarViewport";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import { readPanelSizePreference, writePanelSizePreference } from "@/lib/panelSizePreferences";
import {
  usePartVisible,
  useWorkbenchContextKeys,
  useWorkbenchPart,
} from "@/shell/useWorkbenchParts";
import { installResizableWidth } from "@/test/resizableWidth";
import { stubWindowMediaQueries } from "@/test/windowMediaQueries";
import { activityBarWidthPx, orderActivityBarItems } from "./activityBar";
import { LAYOUT_SLOTS, layoutState, standaloneLayoutState } from "./layoutState";
import { layoutService, Parts, standaloneLayoutService } from "./layoutService";
import { rootRelativeLength } from "./layoutTokens";
import { LAYOUT_WIDTH_ATTRIBUTE, viewportOfSize } from "./layoutViewport";
import {
  matchesIdPattern,
  productLayout,
  useProductLayout,
  isViewHiddenByProduct,
} from "./productLayout";
import { isViewHidden, useViewsLayout } from "./viewsLayout";
import { WorkbenchContext } from "./workbenchContext";
import {
  activateWorkbenchScope,
  activeWorkbenchScope,
  createWorkbenchScope,
  holdWorkbenchLayoutKey,
  isActiveWorkbenchScope,
  isActiveWorkbenchScopeForEvent,
  releaseWorkbenchScope,
  useIsActiveWorkbenchScope,
  standaloneWorkbenchScope,
  useActivateWorkbenchOnUse,
  useStandaloneWorkbenchActivation,
  type WorkbenchScope,
  WorkbenchScopeProvider,
} from "./workbenchScope";
import { useViewLocations } from "./viewLocations";

afterEach(() => {
  cleanup();
  localStorage.clear();
  productLayout.set(null);
});

describe("workbench scopes", () => {
  it("tells a mount's React tree when it becomes the active one, and when it stops", () => {
    const first = createWorkbenchScope("/one");
    const second = createWorkbenchScope("/two");
    activateWorkbenchScope(first);
    const { result } = renderHook(() => useIsActiveWorkbenchScope(first));
    expect(result.current).toBe(true);

    act(() => activateWorkbenchScope(second));
    expect(result.current).toBe(false);

    act(() => activateWorkbenchScope(first));
    expect(result.current).toBe(true);
    releaseWorkbenchScope(first);
    releaseWorkbenchScope(second);
  });

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
    expect(isViewHidden({ id: "acme.tools.list" }, {}, productLayout)).toBe(true);
    expect(isViewHidden({ id: "omnigent.inbox.list" }, {}, productLayout)).toBe(false);
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

  it("keeps a hidden phone-width root in the mobile layout while the window is wide", () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalMatchMedia = window.matchMedia;
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1400);
    stubWindowMediaQueries();
    const setRootWidth = installResizableWidth(390);
    const scope = createWorkbenchScope("/hidden-phone");
    const root = document.createElement("div");
    document.body.append(root);
    try {
      act(() => scope.layout.setRoot(root));
      const { result } = renderHook(() => useIsMobileViewport(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <WorkbenchScopeProvider scope={scope}>{children}</WorkbenchScopeProvider>
        ),
      });
      expect(result.current).toBe(true);
      setRootWidth(0);
      expect(scope.layout.getRootViewport()?.mobile).toBe(true);
      expect(result.current).toBe(true);
    } finally {
      scope.layout.setRoot(null);
      root.remove();
      vi.restoreAllMocks();
      vi.stubGlobal("ResizeObserver", originalResizeObserver);
      vi.stubGlobal("matchMedia", originalMatchMedia);
    }
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
      // A width the user set survives hiding too.
      act(() =>
        result.current.handleProps.onKeyDown({
          key: "ArrowRight",
          preventDefault: () => {},
        } as React.KeyboardEvent),
      );
      expect(result.current.width).toBe(340);
      setRootWidth(0);
      setRootWidth(1400);
      expect(result.current.width).toBe(340);
    } finally {
      scope.layout.setRoot(null);
      root.remove();
      vi.restoreAllMocks();
      vi.stubGlobal("ResizeObserver", originalResizeObserver);
    }
  });
});

describe("embeds that share a basename or an id", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keep a second mount on the same key in memory, not in the first mount's document", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = createWorkbenchScope("/same");
    const releaseFirst = holdWorkbenchLayoutKey(first);
    first.state.set(LAYOUT_SLOTS.sidebar, { visible: false });
    const second = createWorkbenchScope("/same");
    const releaseSecond = holdWorkbenchLayoutKey(second);
    expect(second.state.isMemoryOnly()).toBe(true);
    expect(second.state.get(LAYOUT_SLOTS.sidebar)).toBeUndefined();
    second.state.set(LAYOUT_SLOTS.sidebar, { visible: true });
    expect(
      JSON.parse(localStorage.getItem("omnigent:layout-state@embed:/same") ?? "null").state,
    ).toEqual({ [LAYOUT_SLOTS.sidebar]: { visible: false } });
    // Warned once, and it names the id to give.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("workbenchId");
    const third = createWorkbenchScope("/same");
    holdWorkbenchLayoutKey(third);
    expect(third.state.isMemoryOnly()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    releaseSecond();
    releaseFirst();
    releaseWorkbenchScope(third);
  });

  it("warns when a mount is held on a key another live mount took after it was created", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const early = createWorkbenchScope("/late");
    const late = createWorkbenchScope("/late");
    expect(late.state.isMemoryOnly()).toBe(false);
    const releaseEarly = holdWorkbenchLayoutKey(early);
    const releaseLate = holdWorkbenchLayoutKey(late);
    expect(late.state.isMemoryOnly()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    releaseLate();
    releaseEarly();
  });

  it("give each mount with its own id its own document", () => {
    const first = createWorkbenchScope("/ids", "left");
    const second = createWorkbenchScope("/ids", "right");
    const releaseFirst = holdWorkbenchLayoutKey(first);
    const releaseSecond = holdWorkbenchLayoutKey(second);
    expect([first.state.isMemoryOnly(), second.state.isMemoryOnly()]).toEqual([false, false]);
    first.state.set(LAYOUT_SLOTS.sidebar, { visible: false });
    expect(second.state.get(LAYOUT_SLOTS.sidebar)).toBeUndefined();
    expect(localStorage.getItem("omnigent:layout-state@embed:/ids#left")).toContain("visible");
    expect(localStorage.getItem("omnigent:layout-state@embed:/ids#right")).toBeNull();
    releaseFirst();
    releaseSecond();
  });

  it("let a mount created after the holder left keep the key's document", () => {
    const first = createWorkbenchScope("/reused");
    first.state.set(LAYOUT_SLOTS.sidebar, { visible: false });
    holdWorkbenchLayoutKey(first)();
    const again = createWorkbenchScope("/reused");
    expect(again.state.isMemoryOnly()).toBe(false);
    expect(again.state.get(LAYOUT_SLOTS.sidebar)).toEqual({ visible: false });
  });

  it("keep the standalone app's own key and document", () => {
    const embed = createWorkbenchScope("/standalone-check");
    expect(embed.state.getScope()).toBe("embed:/standalone-check");
    expect(standaloneLayoutState.getScope()).toBe("");
  });
});

describe("each mount's product layout", () => {
  afterEach(() => {
    productLayout.set(null);
  });

  it("is its own, and the window's reads the active mount's", () => {
    const first = createWorkbenchScope("/policy-one");
    const second = createWorkbenchScope("/policy-two");
    first.productLayout.set({ hiddenViews: ["acme.one"] });
    second.productLayout.set({ hiddenViews: ["acme.two"] });
    expect(isViewHiddenByProduct("acme.one", first.productLayout)).toBe(true);
    expect(isViewHiddenByProduct("acme.one", second.productLayout)).toBe(false);
    expect(productLayout.get()).toEqual({});
    activateWorkbenchScope(first);
    expect(productLayout.get()).toEqual({ hiddenViews: ["acme.one"] });
    activateWorkbenchScope(second);
    expect(isViewHiddenByProduct("acme.two")).toBe(true);
    expect(isViewHiddenByProduct("acme.one")).toBe(false);
    releaseWorkbenchScope(second);
    expect(productLayout.get()).toEqual({ hiddenViews: ["acme.one"] });
    releaseWorkbenchScope(first);
    expect(productLayout.get()).toEqual({});
  });

  it("tells the window's listeners when the active mount's policy changes or switches", () => {
    const first = createWorkbenchScope("/listen-one");
    const second = createWorkbenchScope("/listen-two");
    const listener = vi.fn();
    const unsubscribe = productLayout.subscribe(listener);
    activateWorkbenchScope(first);
    const switched = listener.mock.calls.length;
    expect(switched).toBeGreaterThan(0);
    first.productLayout.set({ hiddenParts: ["workbench.parts.titlebar"] });
    expect(listener.mock.calls.length).toBe(switched + 1);
    // A change of the mount that isn't active doesn't reach the window.
    second.productLayout.set({ hiddenParts: ["workbench.parts.sidebar"] });
    expect(listener.mock.calls.length).toBe(switched + 1);
    unsubscribe();
    releaseWorkbenchScope(first);
  });

  it("gives a React tree its own mount's policy while another mount is active", () => {
    const shown = createWorkbenchScope("/tree-shown");
    const hidden = createWorkbenchScope("/tree-hidden");
    hidden.productLayout.set({ hiddenParts: [Parts.SIDEBAR_PART] });
    activateWorkbenchScope(shown);
    try {
      const { result } = renderHook(() => useProductLayout(hidden.productLayout));
      expect(result.current.hiddenParts).toEqual([Parts.SIDEBAR_PART]);
      expect(productLayout.get().hiddenParts).toBeUndefined();
    } finally {
      releaseWorkbenchScope(shown);
    }
  });
});

describe("the standalone app's re-activation on use", () => {
  it("takes the window's commands back from an embed when the user uses the standalone app", () => {
    const root = document.createElement("div");
    root.id = "root";
    const control = document.createElement("button");
    root.appendChild(control);
    document.body.appendChild(root);
    const embed = createWorkbenchScope("/embed");
    activateWorkbenchScope(embed);
    renderHook(() => useActivateWorkbenchOnUse(standaloneWorkbenchScope));
    try {
      // The embed is used last, so it still has the window's commands.
      expect(isActiveWorkbenchScope(embed)).toBe(true);
      expect(isActiveWorkbenchScope(standaloneWorkbenchScope)).toBe(false);

      control.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      expect(isActiveWorkbenchScope(standaloneWorkbenchScope)).toBe(true);
      expect(layoutService.getStore()).toBe(standaloneLayoutState);
      expect(isActiveWorkbenchScope(embed)).toBe(false);
    } finally {
      cleanup();
      root.remove();
      releaseWorkbenchScope(embed);
    }
  });

  it("ignores use outside the standalone app's tree", () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const embed = createWorkbenchScope("/embed");
    activateWorkbenchScope(embed);
    renderHook(() => useActivateWorkbenchOnUse(standaloneWorkbenchScope));
    try {
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      expect(isActiveWorkbenchScope(embed)).toBe(true);
    } finally {
      cleanup();
      root.remove();
      outside.remove();
      releaseWorkbenchScope(embed);
    }
  });
});

describe("each mount's Move View picker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens in the active mount only", () => {
    const first = createWorkbenchScope("/move-one");
    const second = createWorkbenchScope("/move-two");
    activateWorkbenchScope(first);
    try {
      activeWorkbenchScope().moveViewPicker.open("acme.view");
      expect(first.moveViewPicker.store.getState()).toMatchObject({
        open: true,
        viewId: "acme.view",
      });
      expect(second.moveViewPicker.store.getState().open).toBe(false);
      first.moveViewPicker.close();
      expect(first.moveViewPicker.store.getState().open).toBe(false);
    } finally {
      releaseWorkbenchScope(first);
    }
  });

  it("refuses in a mount whose product locks its views in place", () => {
    const locked = createWorkbenchScope("/move-locked");
    locked.productLayout.set({ lockViewLocations: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    locked.moveViewPicker.open();
    expect(locked.moveViewPicker.store.getState().open).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("window context keys follow the active mount", () => {
  function wrapperOf(scope: WorkbenchScope) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return <WorkbenchScopeProvider scope={scope}>{children}</WorkbenchScopeProvider>;
    };
  }

  it("publishes only the active mount's keys, and republishes them when it becomes active", () => {
    const shellContext = new WorkbenchContext();
    const first = createWorkbenchScope("/one");
    const second = createWorkbenchScope("/two");
    const firstKeys = { "omnigent.session.hasWorkspace": true };
    const secondKeys = { "omnigent.session.hasTasks": true };
    renderHook(() => useWorkbenchContextKeys(firstKeys, shellContext), {
      wrapper: wrapperOf(first),
    });
    renderHook(() => useWorkbenchContextKeys(secondKeys, shellContext), {
      wrapper: wrapperOf(second),
    });
    try {
      activateWorkbenchScope(first);
      activateWorkbenchScope(second);
      expect(shellContext.snapshot()).toEqual(secondKeys);

      // The first mount's keys reach the window once it is used again, and the second's go.
      activateWorkbenchScope(first);
      expect(shellContext.snapshot()).toEqual(firstKeys);
      releaseWorkbenchScope(first);
      expect(shellContext.snapshot()).toEqual(secondKeys);
    } finally {
      releaseWorkbenchScope(second);
      releaseWorkbenchScope(first);
    }
  });
});

/** A page's embed: its own scope and root (`.omnigent-app`) holding one input. */
function embedOn(parent: HTMLElement, name: string): { scope: WorkbenchScope; input: HTMLElement } {
  const root = document.createElement("div");
  root.className = "omnigent-app";
  const input = document.createElement("input");
  root.appendChild(input);
  parent.appendChild(root);
  const scope = createWorkbenchScope(`/${name}`);
  scope.layout.setRoot(root);
  return { scope, input };
}

describe("the standalone app's activation at mount", () => {
  it("is the active mount when it mounts after an embed, and a later embed takes over", () => {
    const embed = createWorkbenchScope("/mounted-first");
    activateWorkbenchScope(embed);
    const { unmount } = renderHook(() => useStandaloneWorkbenchActivation());
    try {
      expect(isActiveWorkbenchScope(standaloneWorkbenchScope)).toBe(true);
      expect(isActiveWorkbenchScope(embed)).toBe(false);
      activateWorkbenchScope(embed);
      expect(isActiveWorkbenchScope(embed)).toBe(true);
    } finally {
      unmount();
      releaseWorkbenchScope(embed);
    }
  });
});

describe("the key gate in a mount's tree", () => {
  it("activates the mount a key is typed in, so the first key of an inactive mount runs", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const first = embedOn(host, "gate-first");
    const second = embedOn(host, "gate-second");
    activateWorkbenchScope(second.scope);
    try {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
      first.input.dispatchEvent(event);
      expect(isActiveWorkbenchScopeForEvent(first.scope, event)).toBe(true);
      expect(isActiveWorkbenchScope(second.scope)).toBe(false);
    } finally {
      releaseWorkbenchScope(second.scope);
      releaseWorkbenchScope(first.scope);
      host.remove();
    }
  });

  it("doesn't activate the standalone app for a key typed in an embed placed inside its root", () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    const control = document.createElement("button");
    root.appendChild(control);
    const embed = embedOn(root, "inside-root");
    activateWorkbenchScope(embed.scope);
    renderHook(() => useActivateWorkbenchOnUse(standaloneWorkbenchScope));
    try {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
      embed.input.dispatchEvent(event);
      expect(isActiveWorkbenchScopeForEvent(standaloneWorkbenchScope, event)).toBe(false);
      embed.input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      expect(isActiveWorkbenchScope(embed.scope)).toBe(true);
      expect(isActiveWorkbenchScope(standaloneWorkbenchScope)).toBe(false);
      // The standalone app's own controls, inside #root, still take the window's commands.
      control.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      expect(isActiveWorkbenchScope(standaloneWorkbenchScope)).toBe(true);
    } finally {
      releaseWorkbenchScope(embed.scope);
      root.remove();
    }
  });
});

describe("each mount's layout snapshots", () => {
  it("keep their values while another mount with different hidden views is read", () => {
    const first = createWorkbenchScope("/snapshot-first");
    const second = createWorkbenchScope("/snapshot-second");
    first.state.set(LAYOUT_SLOTS.views, { "acme.one": { hidden: true } });
    second.state.set(LAYOUT_SLOTS.views, { "acme.two": { hidden: true } });
    first.state.set(LAYOUT_SLOTS.viewLocations, { "acme.one": "omnigent.inbox" });
    second.state.set(LAYOUT_SLOTS.viewLocations, { "acme.two": "omnigent.inbox" });
    const inMount = (scope: WorkbenchScope) =>
      function Wrapper({ children }: { children: ReactNode }) {
        return <WorkbenchScopeProvider scope={scope}>{children}</WorkbenchScopeProvider>;
      };
    const firstViews = renderHook(() => useViewsLayout(), { wrapper: inMount(first) });
    const firstLocations = renderHook(() => useViewLocations(), { wrapper: inMount(first) });
    const before = [firstViews.result.current, firstLocations.result.current];
    // The other mount's reads come between the first mount's.
    renderHook(() => useViewsLayout(), { wrapper: inMount(second) });
    renderHook(() => useViewLocations(), { wrapper: inMount(second) });
    firstViews.rerender();
    firstLocations.rerender();
    expect(firstViews.result.current).toBe(before[0]);
    expect(firstLocations.result.current).toBe(before[1]);
    expect(Object.keys(firstViews.result.current)).toEqual(["acme.one"]);
  });
});
