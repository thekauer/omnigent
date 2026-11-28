// The layout's context keys (layout plan L10): VS Code's visibility, maximized and focus keys, the
// title bar's visibility and Omnigent's width class. They follow the active mount.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "@/vscodeExtensions/commands";
import { ContextKeyService } from "@/vscodeExtensions/contextKeys";
import { LayoutStateStore } from "./layoutState";
import { registerLayoutCommands } from "./layoutCommands";
import {
  layoutService,
  LayoutService,
  type PartController,
  Parts,
  setActiveLayoutService,
} from "./layoutService";
import { layoutWidthOf } from "./layoutViewport";

let storeCount = 0;
function mount(): LayoutService {
  storeCount += 1;
  return new LayoutService(new LayoutStateStore(`omnigent:layout-commands-test-${storeCount}`));
}

function part(visible: boolean, extra: Partial<PartController> = {}) {
  const state = { visible, maximized: false };
  const controller: PartController = {
    isVisible: () => state.visible,
    setHidden: (hidden) => {
      state.visible = !hidden;
    },
    isMaximized: () => state.maximized,
    ...extra,
  };
  return { state, controller };
}

/** A drawn part on the page, holding a focusable control (and optionally a view). */
function drawnPart(hook: string, view?: string): { root: HTMLElement; control: HTMLElement } {
  const root = document.createElement("div");
  root.dataset.part = hook;
  const control = document.createElement("button");
  if (view) {
    const section = document.createElement("div");
    section.dataset.view = view;
    section.append(control);
    root.append(section);
  } else {
    root.append(control);
  }
  document.body.append(root);
  return { root, control };
}

/** A root element of a given box, for the width class (the layout's embed root). */
function rootOf(width: number): HTMLElement {
  const root = document.createElement("div");
  root.getBoundingClientRect = () => ({ width, height: 800 }) as DOMRect;
  return root;
}

let disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  setActiveLayoutService(null);
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
});

function commandsWith(layout: LayoutService) {
  const contextKeys = new ContextKeyService();
  const registration = registerLayoutCommands(new CommandRegistry(), layout, { contextKeys });
  disposers.push(() => registration.dispose());
  return contextKeys;
}

describe("titleBarVisible", () => {
  it("follows the title bar part: on screen while the shell draws it and shows it", () => {
    const layout = mount();
    const contextKeys = commandsWith(layout);
    expect(contextKeys.get("titleBarVisible")).toBe(false);
    const titleBar = part(true);
    layout.registerPart(Parts.TITLEBAR_PART, titleBar.controller);
    expect(contextKeys.get("titleBarVisible")).toBe(true);
    titleBar.state.visible = false;
    layout.partChanged(Parts.TITLEBAR_PART);
    expect(contextKeys.get("titleBarVisible")).toBe(false);
  });
});

describe("auxiliaryBarMaximized", () => {
  it("is set while the secondary side bar is shown maximized, and not once it is hidden", () => {
    const layout = mount();
    const contextKeys = commandsWith(layout);
    const auxiliary = part(true);
    layout.registerPart(Parts.AUXILIARYBAR_PART, auxiliary.controller);
    expect(contextKeys.get("auxiliaryBarMaximized")).toBe(false);
    auxiliary.state.maximized = true;
    layout.partChanged(Parts.AUXILIARYBAR_PART);
    expect(contextKeys.get("auxiliaryBarMaximized")).toBe(true);
    auxiliary.state.visible = false;
    layout.partChanged(Parts.AUXILIARYBAR_PART);
    expect(contextKeys.get("auxiliaryBarMaximized")).toBe(false);
  });
});

describe("sideBarFocus and auxiliaryBarFocus", () => {
  it("are set while keyboard focus is inside the part's element, and cleared when it leaves", () => {
    const layout = mount();
    const contextKeys = commandsWith(layout);
    const sidebar = drawnPart("sidebar");
    const auxiliary = drawnPart("auxiliarybar");
    layout.registerPart(Parts.SIDEBAR_PART, part(true).controller);
    layout.registerPart(Parts.AUXILIARYBAR_PART, part(true).controller);
    expect(contextKeys.get("sideBarFocus")).toBe(false);
    sidebar.control.focus();
    expect(contextKeys.get("sideBarFocus")).toBe(true);
    expect(contextKeys.get("auxiliaryBarFocus")).toBe(false);
    auxiliary.control.focus();
    expect(contextKeys.get("sideBarFocus")).toBe(false);
    expect(contextKeys.get("auxiliaryBarFocus")).toBe(true);
    auxiliary.control.blur();
    expect(contextKeys.get("auxiliaryBarFocus")).toBe(false);
  });

  it("follow the active mount: focus in another mount's part is not this one's", () => {
    const first = mount();
    const second = mount();
    const contextKeys = commandsWith(layoutService);
    setActiveLayoutService(first);
    // An embed's root, scoped as its own app's parts are.
    const firstRoot = rootOf(1200);
    firstRoot.classList.add("omnigent-app");
    document.body.append(firstRoot);
    const firstSidebar = document.createElement("div");
    firstSidebar.dataset.part = "sidebar";
    const firstControl = document.createElement("button");
    firstSidebar.append(firstControl);
    firstRoot.append(firstSidebar);
    first.setRoot(firstRoot);
    first.registerPart(Parts.SIDEBAR_PART, part(true).controller);
    second.registerPart(Parts.SIDEBAR_PART, part(true).controller);
    firstControl.focus();
    expect(contextKeys.get("sideBarFocus")).toBe(true);
    // The second app's side bar has no focus; switching to it reads the new active app's focus.
    setActiveLayoutService(second);
    expect(contextKeys.get("sideBarFocus")).toBe(false);
    setActiveLayoutService(first);
    expect(contextKeys.get("sideBarFocus")).toBe(true);
  });
});

describe("focusedView", () => {
  it("names the view keyboard focus is in, and goes when focus leaves it", () => {
    const layout = mount();
    const contextKeys = commandsWith(layout);
    const sidebar = drawnPart("sidebar", "omnigent.tasks");
    layout.registerPart(Parts.SIDEBAR_PART, part(true).controller);
    expect(contextKeys.get("focusedView")).toBeUndefined();
    sidebar.control.focus();
    expect(contextKeys.get("focusedView")).toBe("omnigent.tasks");
    sidebar.control.blur();
    expect(contextKeys.get("focusedView")).toBeUndefined();
  });
});

describe("focusedView in the standalone app", () => {
  it("doesn't name a view of an embed that has the focus", () => {
    const layout = mount();
    const contextKeys = commandsWith(layout);
    const embed = document.createElement("div");
    embed.className = "omnigent-app";
    const section = document.createElement("div");
    section.dataset.view = "acme.embedded";
    const control = document.createElement("button");
    section.append(control);
    embed.append(section);
    document.body.append(embed);
    control.focus();
    expect(contextKeys.get("focusedView")).toBeUndefined();
  });
});

describe("omnigent.layoutWidth", () => {
  it("names the width class of the layout on screen, and follows its changes", () => {
    const layout = mount();
    const contextKeys = commandsWith(layout);
    expect(contextKeys.get("omnigent.layoutWidth")).toBe("desktop");
    layout.setRoot(rootOf(390));
    expect(contextKeys.get("omnigent.layoutWidth")).toBe("phone");
    layout.setRoot(rootOf(700));
    expect(contextKeys.get("omnigent.layoutWidth")).toBe("band");
    layout.setRoot(rootOf(1200));
    expect(contextKeys.get("omnigent.layoutWidth")).toBe("desktop");
  });

  it("maps a viewport to its class: a mobile layout is a phone, a side-by-side one a band", () => {
    expect(layoutWidthOf({ mobile: false, sideBySide: false })).toBe("desktop");
    expect(layoutWidthOf({ mobile: true, sideBySide: false })).toBe("phone");
    expect(layoutWidthOf({ mobile: true, sideBySide: true })).toBe("band");
  });
});

describe("the layout keys follow the active mount", () => {
  it("switch with the mount, and the shell's own keys are the active mount's", () => {
    const first = mount();
    const second = mount();
    const contextKeys = commandsWith(layoutService);
    first.registerPart(Parts.SIDEBAR_PART, part(true).controller);
    first.registerPart(Parts.TITLEBAR_PART, part(false).controller);
    first.setRoot(rootOf(390));
    const secondAuxiliary = part(true, {});
    second.registerPart(Parts.SIDEBAR_PART, part(false).controller);
    second.registerPart(Parts.TITLEBAR_PART, part(true).controller);
    second.registerPart(Parts.AUXILIARYBAR_PART, secondAuxiliary.controller);
    secondAuxiliary.state.maximized = true;
    second.partChanged(Parts.AUXILIARYBAR_PART);

    setActiveLayoutService(first);
    expect(contextKeys.get("sideBarVisible")).toBe(true);
    expect(contextKeys.get("titleBarVisible")).toBe(false);
    expect(contextKeys.get("auxiliaryBarMaximized")).toBe(false);
    expect(contextKeys.get("omnigent.layoutWidth")).toBe("phone");

    setActiveLayoutService(second);
    expect(contextKeys.get("sideBarVisible")).toBe(false);
    expect(contextKeys.get("titleBarVisible")).toBe(true);
    expect(contextKeys.get("auxiliaryBarMaximized")).toBe(true);
    expect(contextKeys.get("omnigent.layoutWidth")).toBe("desktop");
  });
});
