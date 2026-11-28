// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "@/vscodeExtensions/commands";
import { ContextKeyService } from "@/vscodeExtensions/contextKeys";
import {
  CLOSE_AUXILIARY_BAR_COMMAND,
  CLOSE_SIDEBAR_COMMAND,
  registerLayoutCommands,
  TOGGLE_AUXILIARY_BAR_COMMAND,
  TOGGLE_SIDEBAR_COMMAND,
} from "./layoutCommands";
import {
  isPart,
  LayoutService,
  PART_IDS,
  type PartController,
  partHook,
  Parts,
} from "./layoutService";

function part(initial: boolean, withToggle = false) {
  const state = { visible: initial };
  const controller: PartController & { toggle?: () => void } = {
    isVisible: () => state.visible,
    setHidden: vi.fn((hidden: boolean) => {
      state.visible = !hidden;
    }),
    ...(withToggle ? { toggle: vi.fn(() => (state.visible = !state.visible)) } : {}),
  };
  return { state, controller };
}

describe("LayoutService", () => {
  it("names VS Code's parts, with a data-part hook each", () => {
    expect(PART_IDS.map(partHook)).toEqual([
      "titlebar",
      "activitybar",
      "sidebar",
      "main",
      "auxiliarybar",
      "panel",
      "statusbar",
    ]);
    expect(isPart("workbench.parts.sidebar")).toBe(true);
    expect(isPart("workbench.parts.editor")).toBe(false);
  });

  it("answers for a part through its controller, and a part nothing draws is hidden", () => {
    const layout = new LayoutService();
    expect(layout.isVisible(Parts.TITLEBAR_PART)).toBe(false);
    layout.setPartHidden(false, Parts.TITLEBAR_PART);
    expect(layout.hasPart(Parts.TITLEBAR_PART)).toBe(false);
    const sidebar = part(true);
    const remove = layout.registerPart(Parts.SIDEBAR_PART, sidebar.controller);
    expect(layout.isVisible(Parts.SIDEBAR_PART)).toBe(true);
    layout.setPartHidden(true, Parts.SIDEBAR_PART);
    expect(sidebar.controller.setHidden).toHaveBeenCalledWith(true);
    layout.togglePart(Parts.SIDEBAR_PART);
    expect(sidebar.state.visible).toBe(true);
    expect(layout.getLocation(Parts.SIDEBAR_PART)).toBe("left");
    expect(layout.getLocation(Parts.AUXILIARYBAR_PART)).toBe("right");
    remove();
    expect(layout.isVisible(Parts.SIDEBAR_PART)).toBe(false);
  });

  it("uses the shell's own toggle when it gives one", () => {
    const layout = new LayoutService();
    const sidebar = part(true, true);
    layout.registerPart(Parts.SIDEBAR_PART, sidebar.controller);
    layout.togglePart(Parts.SIDEBAR_PART);
    expect(sidebar.controller.toggle).toHaveBeenCalledOnce();
    expect(sidebar.controller.setHidden).not.toHaveBeenCalled();
  });

  it("fires a visibility change only when it changes, and a layout change on every report", () => {
    const layout = new LayoutService();
    const visibility = vi.fn();
    const changes = vi.fn();
    layout.onDidChangePartVisibility(visibility);
    layout.onDidChangeLayout(changes);
    const sidebar = part(true);
    const remove = layout.registerPart(Parts.SIDEBAR_PART, sidebar.controller);
    layout.partChanged(Parts.SIDEBAR_PART);
    sidebar.state.visible = false;
    layout.partChanged(Parts.SIDEBAR_PART);
    remove();
    expect(visibility.mock.calls).toEqual([
      [{ part: Parts.SIDEBAR_PART, visible: true }],
      [{ part: Parts.SIDEBAR_PART, visible: false }],
    ]);
    expect(changes).toHaveBeenCalledTimes(4);
  });

  it("keeps a later registration when an earlier one is removed (a remount)", () => {
    const layout = new LayoutService();
    const first = layout.registerPart(Parts.MAIN_PART, part(true).controller);
    layout.registerPart(Parts.MAIN_PART, part(true).controller);
    first();
    expect(layout.isVisible(Parts.MAIN_PART)).toBe(true);
  });
});

describe("layout commands", () => {
  it("toggles and closes the side bars under VS Code's ids and the palette's old ones", async () => {
    const layout = new LayoutService();
    const commands = new CommandRegistry();
    const contextKeys = new ContextKeyService();
    const disposable = registerLayoutCommands(commands, layout, contextKeys);
    const sidebar = part(true);
    const auxiliary = part(false);
    layout.registerPart(Parts.SIDEBAR_PART, sidebar.controller);
    layout.registerPart(Parts.AUXILIARYBAR_PART, auxiliary.controller);
    expect(contextKeys.get("sideBarVisible")).toBe(true);
    expect(contextKeys.get("auxiliaryBarVisible")).toBe(false);
    await commands.execute(TOGGLE_SIDEBAR_COMMAND, [], () => {});
    layout.partChanged(Parts.SIDEBAR_PART);
    expect(sidebar.state.visible).toBe(false);
    expect(contextKeys.get("sideBarVisible")).toBe(false);
    await commands.execute("toggle-left-sidebar", [], () => {});
    expect(sidebar.state.visible).toBe(true);
    await commands.execute(CLOSE_SIDEBAR_COMMAND, [], () => {});
    expect(sidebar.state.visible).toBe(false);
    await commands.execute(TOGGLE_AUXILIARY_BAR_COMMAND, [], () => {});
    expect(auxiliary.state.visible).toBe(true);
    await commands.execute("toggle-right-sidebar", [], () => {});
    expect(auxiliary.state.visible).toBe(false);
    // Closing a closed bar does nothing (the shell's toggle would open it).
    await commands.execute(CLOSE_AUXILIARY_BAR_COMMAND, [], () => {});
    expect(auxiliary.controller.setHidden).toHaveBeenCalledTimes(2);
    disposable.dispose();
    expect(commands.has(TOGGLE_SIDEBAR_COMMAND)).toBe(false);
  });
});

describe("LayoutService root removal", () => {
  it("drops the root's layout when the root is removed, and tells the viewport listeners", () => {
    const layout = new LayoutService();
    // A phone-width embed root, as a DOM element the service can measure and mark.
    const root = {
      getBoundingClientRect: () => ({ width: 390, height: 800 }),
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    } as unknown as HTMLElement;
    layout.setRoot(root);
    expect(layout.getRootViewport()?.mobile).toBe(true);
    const onViewport = vi.fn();
    layout.onDidChangeViewport(onViewport);
    layout.setRoot(null);
    expect(layout.getRootViewport()).toBeNull();
    expect(layout.getRootSize()).toEqual({ width: 0, height: 0 });
    expect(onViewport).toHaveBeenCalledTimes(1);
  });
});

describe("LayoutService part boxes", () => {
  it("reports whether the shell maximized a part, false when it doesn't", () => {
    const layout = new LayoutService();
    const auxiliary = part(true);
    expect(layout.isMaximized(Parts.AUXILIARYBAR_PART)).toBe(false);
    layout.registerPart(Parts.AUXILIARYBAR_PART, {
      ...auxiliary.controller,
      isMaximized: () => true,
    });
    expect(layout.isMaximized(Parts.AUXILIARYBAR_PART)).toBe(true);
  });
});
