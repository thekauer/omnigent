// The layout's read side for extensions (`window.layout`, layout plan L10): plain-data reads, change
// events that report only changes, coalesced layout events, the active mount's values, errors and
// disposal, and the typings that declare them.
import type * as omnigent from "omnigent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONVERSATIONS_CONTAINER } from "@/workbench/viewContainers";
import {
  layoutService,
  LayoutService,
  type PartController,
  PART_IDS,
  Parts,
  setActiveLayoutService,
} from "@/workbench/layoutService";
import { LayoutStateStore } from "@/workbench/layoutState";
import typings from "./omnigent.d.ts?raw";
import { createExtensionApi, type HostServices } from "./api";
import { LAYOUT_EVENT_DELAY_MS } from "./layoutEvents";
import { hostServices } from "./testServices";

let storeCount = 0;
/** A layout service with its own, memory-only-by-key state (no other test's document). */
function mount(): LayoutService {
  storeCount += 1;
  return new LayoutService(new LayoutStateStore(`omnigent:layout-api-test-${storeCount}`));
}

/** A part the shell draws: visible or not, with a box the service reports. */
function part(visible: boolean, size?: omnigent.PartSize) {
  const state = { visible };
  const controller: PartController = {
    isVisible: () => state.visible,
    setHidden: (hidden) => {
      state.visible = !hidden;
    },
    ...(size ? { getSize: () => size } : {}),
  };
  return { state, controller };
}

/** An embed root of a given box: the parts are laid out in it, so its width picks the layout. */
function rootOf(width: number, height = 800): HTMLElement {
  const root = document.createElement("div");
  root.getBoundingClientRect = () => ({ width, height }) as DOMRect;
  return root;
}

function setup(layout: LayoutService, overrides: Partial<HostServices> = {}) {
  const logError = vi.fn();
  const handle = createExtensionApi("acme.tools", hostServices({ layout, ...overrides }), logError);
  return { api: handle.api, handle, logError };
}

/** Records every event of a window.layout listener, as a list of its payloads. */
function recorder<T>(subscribe: (listener: (event: T) => void) => omnigent.Disposable) {
  const seen: T[] = [];
  const subscription = subscribe((event) => seen.push(event));
  return { seen, subscription };
}

afterEach(() => {
  setActiveLayoutService(null);
  vi.useRealTimers();
});

beforeEach(() => {
  localStorage.clear();
});

describe("window.layout reads", () => {
  it("reads the parts on screen, their boxes and the side bar's side as plain data", () => {
    const layout = mount();
    layout.registerPart(Parts.SIDEBAR_PART, part(true, { width: 320, height: 700 }).controller);
    const { api } = setup(layout);
    expect(Object.isFrozen(api.window.layout)).toBe(true);
    expect(api.window.layout.isPartVisible(Parts.SIDEBAR_PART)).toBe(true);
    expect(api.window.layout.isPartVisible(Parts.TITLEBAR_PART)).toBe(false);
    // Reserved parts and unknown ids are never on screen.
    expect(api.window.layout.isPartVisible(Parts.PANEL_PART)).toBe(false);
    expect(api.window.layout.isPartVisible("workbench.parts.editor" as never)).toBe(false);
    const size = api.window.layout.getPartSize(Parts.SIDEBAR_PART);
    expect(size).toEqual({ width: 320, height: 700 });
    expect(structuredClone(size)).toEqual(size);
    expect(Object.isFrozen(size)).toBe(true);
    expect(api.window.layout.getPartSize(Parts.TITLEBAR_PART)).toBeUndefined();
    expect(api.window.layout.getPartSize("workbench.parts.editor" as never)).toBeUndefined();
    expect(api.window.layout.sideBarLocation).toBe("left");
  });

  it("measures a visible part's element when its shell gives no size, and none while hidden", () => {
    const layout = mount();
    const element = document.createElement("div");
    element.dataset.part = "auxiliarybar";
    element.getBoundingClientRect = () => ({ width: 410, height: 640 }) as DOMRect;
    document.body.append(element);
    try {
      const state = { visible: true };
      layout.registerPart(Parts.AUXILIARYBAR_PART, {
        isVisible: () => state.visible,
        setHidden: () => {},
      });
      const { api } = setup(layout);
      expect(api.window.layout.getPartSize(Parts.AUXILIARYBAR_PART)).toEqual({
        width: 410,
        height: 640,
      });
      state.visible = false;
      expect(api.window.layout.getPartSize(Parts.AUXILIARYBAR_PART)).toBeUndefined();
    } finally {
      element.remove();
    }
  });

  it("names the view container the side bar shows, undefined while the side bar is hidden", () => {
    const layout = mount();
    const sidebar = part(true);
    layout.registerPart(Parts.SIDEBAR_PART, sidebar.controller);
    const { api } = setup(layout);
    expect(api.window.layout.activeViewContainer).toBe(CONVERSATIONS_CONTAINER);
    layout.setActiveViewContainer("acme.tools.panel");
    expect(api.window.layout.activeViewContainer).toBe("acme.tools.panel");
    sidebar.state.visible = false;
    expect(api.window.layout.activeViewContainer).toBeUndefined();
  });

  it("names the width class of the layout on screen: phone, band or desktop", () => {
    const layout = mount();
    const { api } = setup(layout);
    layout.setRoot(rootOf(390));
    expect(api.window.layout.width).toBe("phone");
    layout.setRoot(rootOf(700));
    expect(api.window.layout.width).toBe("band");
    layout.setRoot(rootOf(1200));
    expect(api.window.layout.width).toBe("desktop");
  });

  it("names the side bar's location from the layout, `right` when it sits on the right", () => {
    const layout = mount();
    const { api } = setup(layout);
    expect(api.window.layout.sideBarLocation).toBe("left");
    // The location is the layout's (today's default); a right location reads as right.
    const withRight = new LayoutService(new LayoutStateStore("omnigent:layout-api-test-right"));
    Object.defineProperty(withRight, "getLocation", {
      value: (id: string) => (id === Parts.SIDEBAR_PART ? "right" : "center"),
    });
    expect(setup(withRight).api.window.layout.sideBarLocation).toBe("right");
  });
});

describe("window.layout events", () => {
  it("fires a part's visibility once per real change, with the part and its new visibility", () => {
    const layout = mount();
    const sidebar = part(true);
    layout.registerPart(Parts.SIDEBAR_PART, sidebar.controller);
    const { api } = setup(layout);
    const { seen } = recorder((listener) => api.window.layout.onDidChangePartVisibility(listener));
    sidebar.state.visible = false;
    layout.partChanged(Parts.SIDEBAR_PART);
    layout.partChanged(Parts.SIDEBAR_PART);
    sidebar.state.visible = true;
    layout.partChanged(Parts.SIDEBAR_PART);
    expect(seen).toEqual([
      { part: Parts.SIDEBAR_PART, visible: false },
      { part: Parts.SIDEBAR_PART, visible: true },
    ]);
  });

  it("fires the active view container when the side bar shows another or is hidden or shown", () => {
    const layout = mount();
    const sidebar = part(true);
    layout.registerPart(Parts.SIDEBAR_PART, sidebar.controller);
    const { api } = setup(layout);
    const { seen } = recorder((listener) =>
      api.window.layout.onDidChangeActiveViewContainer(listener),
    );
    layout.setActiveViewContainer("acme.tools.panel");
    layout.setActiveViewContainer("acme.tools.panel");
    sidebar.state.visible = false;
    layout.partChanged(Parts.SIDEBAR_PART);
    // Another container while hidden changes nothing a reader sees.
    layout.setActiveViewContainer("acme.tools.other");
    sidebar.state.visible = true;
    layout.partChanged(Parts.SIDEBAR_PART);
    expect(seen).toEqual(["acme.tools.panel", undefined, "acme.tools.other"]);
  });

  it("coalesces layout changes: a drag reports once per delay, and a change that reverts reports none", () => {
    vi.useFakeTimers();
    const layout = mount();
    let width = 320;
    const sidebar = part(true);
    layout.registerPart(Parts.SIDEBAR_PART, {
      ...sidebar.controller,
      getSize: () => ({ width, height: 700 }),
    });
    const { api } = setup(layout);
    const { seen } = recorder((listener) => api.window.layout.onDidChangeLayout(listener));
    // A drag: many changes in one delay.
    for (const next of [330, 340, 350, 360]) {
      width = next;
      layout.partChanged(Parts.SIDEBAR_PART);
    }
    expect(seen).toHaveLength(0);
    vi.advanceTimersByTime(LAYOUT_EVENT_DELAY_MS);
    expect(seen).toHaveLength(1);
    // A change and its undo inside one delay: the layout is what it was.
    width = 400;
    layout.partChanged(Parts.SIDEBAR_PART);
    width = 360;
    layout.partChanged(Parts.SIDEBAR_PART);
    vi.advanceTimersByTime(LAYOUT_EVENT_DELAY_MS);
    expect(seen).toHaveLength(1);
    // The next change after the delay reports again.
    width = 420;
    layout.partChanged(Parts.SIDEBAR_PART);
    vi.advanceTimersByTime(LAYOUT_EVENT_DELAY_MS);
    expect(seen).toHaveLength(2);
  });

  it("reports a layout change when the width class changes, not for a same-width resize", () => {
    vi.useFakeTimers();
    const layout = mount();
    const { api } = setup(layout);
    const { seen } = recorder((listener) => api.window.layout.onDidChangeLayout(listener));
    layout.setRoot(rootOf(1200));
    vi.advanceTimersByTime(LAYOUT_EVENT_DELAY_MS);
    expect(seen).toHaveLength(0);
    layout.setRoot(rootOf(390));
    vi.advanceTimersByTime(LAYOUT_EVENT_DELAY_MS);
    expect(seen).toHaveLength(1);
    expect(api.window.layout.width).toBe("phone");
  });

  it("logs a throwing listener against the extension, and the others still hear", () => {
    const layout = mount();
    const sidebar = part(true);
    layout.registerPart(Parts.SIDEBAR_PART, sidebar.controller);
    const { api, logError } = setup(layout);
    const failure = new Error("boom");
    api.window.layout.onDidChangePartVisibility(() => {
      throw failure;
    });
    const { seen } = recorder((listener) => api.window.layout.onDidChangePartVisibility(listener));
    sidebar.state.visible = false;
    layout.partChanged(Parts.SIDEBAR_PART);
    expect(logError).toHaveBeenCalledWith("onDidChangePartVisibility listener threw", failure);
    expect(seen).toEqual([{ part: Parts.SIDEBAR_PART, visible: false }]);
  });

  it("logs a rejecting async listener against the extension", async () => {
    const layout = mount();
    const sidebar = part(true);
    layout.registerPart(Parts.SIDEBAR_PART, sidebar.controller);
    const { api, logError } = setup(layout);
    const failure = new Error("late");
    api.window.layout.onDidChangePartVisibility(async () => {
      throw failure;
    });
    sidebar.state.visible = false;
    layout.partChanged(Parts.SIDEBAR_PART);
    await vi.waitFor(() =>
      expect(logError).toHaveBeenCalledWith("onDidChangePartVisibility listener rejected", failure),
    );
  });

  it("stops at deactivation: no listener hears later changes, a pending layout event is dropped", () => {
    vi.useFakeTimers();
    const layout = mount();
    const sidebar = part(true);
    layout.registerPart(Parts.SIDEBAR_PART, sidebar.controller);
    const { api, handle, logError } = setup(layout);
    const visibility = vi.fn();
    const containers = vi.fn();
    const layoutChanged = vi.fn();
    api.window.layout.onDidChangePartVisibility(visibility);
    api.window.layout.onDidChangeActiveViewContainer(containers);
    api.window.layout.onDidChangeLayout(layoutChanged);
    layout.setRoot(rootOf(390));
    handle.dispose();
    sidebar.state.visible = false;
    layout.partChanged(Parts.SIDEBAR_PART);
    layout.setActiveViewContainer("acme.tools.panel");
    vi.advanceTimersByTime(LAYOUT_EVENT_DELAY_MS);
    expect(visibility).not.toHaveBeenCalled();
    expect(containers).not.toHaveBeenCalled();
    expect(layoutChanged).not.toHaveBeenCalled();
    // A subscription after deactivation is refused, as the other events are.
    api.window.layout.onDidChangeLayout(layoutChanged);
    expect(logError).toHaveBeenCalledWith(
      "onDidChangeLayout called after the extension was deactivated; ignoring it",
    );
  });

  it("releases a subscription through its Disposable", () => {
    const layout = mount();
    const sidebar = part(true);
    layout.registerPart(Parts.SIDEBAR_PART, sidebar.controller);
    const { api } = setup(layout);
    const listener = vi.fn();
    const subscription = api.window.layout.onDidChangePartVisibility(listener);
    subscription.dispose();
    sidebar.state.visible = false;
    layout.partChanged(Parts.SIDEBAR_PART);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("window.layout follows the active mount", () => {
  it("reads and fires for the mount last activated, reporting only what differs", () => {
    vi.useFakeTimers();
    const first = mount();
    const second = mount();
    // The first app: its side bar on the conversations, no title bar.
    first.registerPart(Parts.SIDEBAR_PART, part(true, { width: 320, height: 700 }).controller);
    // The second: the same side bar, a title bar and another container.
    second.registerPart(Parts.SIDEBAR_PART, part(true, { width: 320, height: 700 }).controller);
    second.registerPart(Parts.TITLEBAR_PART, part(true).controller);
    second.setActiveViewContainer("acme.tools.panel");
    setActiveLayoutService(first);
    const { api } = setup(layoutService);
    const visibility = recorder((listener) =>
      api.window.layout.onDidChangePartVisibility(listener),
    );
    const containers = recorder((listener) =>
      api.window.layout.onDidChangeActiveViewContainer(listener),
    );
    const layoutChanged = recorder((listener) => api.window.layout.onDidChangeLayout(listener));
    expect(api.window.layout.isPartVisible(Parts.TITLEBAR_PART)).toBe(false);

    setActiveLayoutService(second);
    expect(api.window.layout.isPartVisible(Parts.TITLEBAR_PART)).toBe(true);
    expect(api.window.layout.activeViewContainer).toBe("acme.tools.panel");
    // Only the title bar differs, and the container; the side bar's box is the same.
    expect(visibility.seen).toEqual([{ part: Parts.TITLEBAR_PART, visible: true }]);
    expect(containers.seen).toEqual(["acme.tools.panel"]);
    vi.advanceTimersByTime(LAYOUT_EVENT_DELAY_MS);
    expect(layoutChanged.seen).toHaveLength(0);

    // A switch to a mount with another side bar box reports the layout once.
    const third = mount();
    third.registerPart(Parts.SIDEBAR_PART, part(true, { width: 400, height: 700 }).controller);
    setActiveLayoutService(third);
    vi.advanceTimersByTime(LAYOUT_EVENT_DELAY_MS);
    expect(layoutChanged.seen).toHaveLength(1);
    expect(api.window.layout.getPartSize(Parts.SIDEBAR_PART)).toEqual({ width: 400, height: 700 });
    // The third app has no title bar: that one change is reported, the side bar's is not.
    expect(visibility.seen).toEqual([
      { part: Parts.TITLEBAR_PART, visible: true },
      { part: Parts.TITLEBAR_PART, visible: false },
    ]);
  });

  it("names the width class of the mount last activated", () => {
    const first = mount();
    const second = mount();
    first.setRoot(rootOf(390));
    second.setRoot(rootOf(1200));
    setActiveLayoutService(first);
    const { api } = setup(layoutService);
    expect(api.window.layout.width).toBe("phone");
    setActiveLayoutService(second);
    expect(api.window.layout.width).toBe("desktop");
  });
});

describe("window.layout typings", () => {
  it("declares the reads and events the API implements, and the parts the workbench draws", () => {
    const { api } = setup(mount());
    expect(typings).toContain("export const layout: WindowLayout;");
    // The member names of the interface are the implementation's own.
    const members = typings.match(/export interface WindowLayout \{([\s\S]*?)\n {2}\}/)?.[1];
    expect(members).toBeDefined();
    const declared = [...(members ?? "").matchAll(/^ {4}(?:readonly )?(\w+)[(:]/gm)].map(
      (match) => match[1],
    );
    expect(declared.sort()).toEqual(Object.getOwnPropertyNames(api.window.layout).sort());
    // The part ids are the service's.
    const union = typings.match(/export type WorkbenchPart =([^;]+);/)?.[1] ?? "";
    const ids = [...union.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(ids.sort()).toEqual([...PART_IDS].sort());
  });

  it("types the reads the way the implementation returns them", () => {
    const { api } = setup(mount());
    const typed: omnigent.WindowLayout = api.window.layout;
    const side: "left" | "right" = typed.sideBarLocation;
    const width: omnigent.LayoutWidth = typed.width;
    expect([side, width]).toEqual(["left", "desktop"]);
  });
});
