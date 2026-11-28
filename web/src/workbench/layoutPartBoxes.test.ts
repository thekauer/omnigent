// A part's box, measured from the page (layout plan L10): the window's parts, an embed's in its root.
import { afterEach, describe, expect, it } from "vitest";

import { LayoutService, type PartController, Parts } from "./layoutService";

function part(visible: boolean): { state: { visible: boolean }; controller: PartController } {
  const state = { visible };
  return {
    state,
    controller: { isVisible: () => state.visible, setHidden: () => {} },
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("LayoutService part boxes", () => {
  it("reads a visible part's box from its shell, else from its element; nothing while hidden", () => {
    const layout = new LayoutService();
    const element = document.createElement("div");
    element.dataset.part = "sidebar";
    element.getBoundingClientRect = () => ({ width: 300, height: 640 }) as DOMRect;
    document.body.append(element);
    try {
      const sidebar = part(true);
      layout.registerPart(Parts.SIDEBAR_PART, sidebar.controller);
      expect(layout.getSize(Parts.SIDEBAR_PART)).toEqual({ width: 300, height: 640 });
      const shellSized = part(true);
      shellSized.controller.getSize = () => ({ width: 111, height: 222 });
      layout.registerPart(Parts.AUXILIARYBAR_PART, shellSized.controller);
      expect(layout.getSize(Parts.AUXILIARYBAR_PART)).toEqual({ width: 111, height: 222 });
      sidebar.state.visible = false;
      expect(layout.getSize(Parts.SIDEBAR_PART)).toBeUndefined();
      expect(layout.getSize(Parts.TITLEBAR_PART)).toBeUndefined();
    } finally {
      element.remove();
    }
  });

  it("finds an embed's parts in its root, and never the embed's from the window", () => {
    const layout = new LayoutService();
    const root = document.createElement("div");
    root.classList.add("omnigent-app");
    const element = document.createElement("div");
    element.dataset.part = "sidebar";
    element.getBoundingClientRect = () => ({ width: 250, height: 500 }) as DOMRect;
    root.append(element);
    document.body.append(root);
    try {
      layout.registerPart(Parts.SIDEBAR_PART, part(true).controller);
      expect(layout.getSize(Parts.SIDEBAR_PART)).toBeUndefined();
      layout.setRoot(root);
      expect(layout.getSize(Parts.SIDEBAR_PART)).toEqual({ width: 250, height: 500 });
    } finally {
      layout.setRoot(null);
      root.remove();
    }
  });
});
