import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationRegistry } from "@/configuration/configurationRegistry";
import { ConfigurationService } from "@/configuration/configurationService";
import { parseConfigurationContributions } from "@/configuration/configurationContributions";
import { SettingsStore } from "@/configuration/settingsStore";
import workbenchManifest from "@/builtinExtensions/omnigent.workbench/package.json";
import { CommandRegistry } from "@/vscodeExtensions/commands";
import { ContextKeyService } from "@/vscodeExtensions/contextKeys";
import {
  ACTIVITY_BAR_LOCATION_SETTING,
  moveActivityBarItem,
  orderActivityBarItems,
  readActivityBarItems,
  setActivityBarItemHidden,
  toggleActivityBarVisibility,
} from "./activityBar";
import {
  FOCUS_ACTIVITY_BAR_COMMAND,
  registerLayoutCommands,
  RESET_LAYOUT_COMMAND,
  TOGGLE_ACTIVITY_BAR_COMMAND,
  viewContainerCommand,
} from "./layoutCommands";
import { LAYOUT_SLOTS, LayoutStateStore } from "./layoutState";
import { LayoutService, Parts } from "./layoutService";
import { CONVERSATIONS_CONTAINER, ViewContainerRegistry } from "./viewContainers";

let store: LayoutStateStore;
beforeEach(() => {
  localStorage.clear();
  store = new LayoutStateStore();
});

function configuration() {
  const service = new ConfigurationService(new ConfigurationRegistry(), new SettingsStore());
  service.addExtension(
    "omnigent.workbench",
    parseConfigurationContributions("omnigent.workbench", workbenchManifest.contributes, {
      builtIn: true,
    }).contributions,
    undefined,
    { builtIn: true },
  );
  return service;
}

describe("the activity bar's items", () => {
  it("orders by the user's order, others after in their own, and moves and hides them", () => {
    const items = ["a", "b", "c", "d"].map((id) => ({ id }));
    expect(
      orderActivityBarItems(items, readActivityBarItems(store)).map((item) => item.id),
    ).toEqual(["a", "b", "c", "d"]);
    moveActivityBarItem(["a", "b", "c", "d"], "d", "b", store);
    expect(readActivityBarItems(store).order).toEqual(["a", "d", "b", "c"]);
    moveActivityBarItem(["a", "d", "b", "c"], "a", undefined, store);
    expect(
      orderActivityBarItems([...items, { id: "e" }], readActivityBarItems(store)).map(
        (item) => item.id,
      ),
    ).toEqual(["d", "b", "c", "a", "e"]);
    setActivityBarItemHidden("b", true, store);
    setActivityBarItemHidden("c", true, store);
    setActivityBarItemHidden("b", false, store);
    expect(readActivityBarItems(store).hidden).toEqual(["c"]);
    store.set(LAYOUT_SLOTS.activityBar, { order: [1, "x", "x"], hidden: "nope" });
    expect(readActivityBarItems(store)).toEqual({ order: ["x"], hidden: [] });
  });

  it("is hidden by default, and the toggle moves it between hidden and default", () => {
    const service = configuration();
    expect(service.getValue(ACTIVITY_BAR_LOCATION_SETTING)).toBe("hidden");
    toggleActivityBarVisibility(service);
    expect(service.getValue(ACTIVITY_BAR_LOCATION_SETTING)).toBe("default");
    service.update(ACTIVITY_BAR_LOCATION_SETTING, "top");
    toggleActivityBarVisibility(service);
    expect(service.getValue(ACTIVITY_BAR_LOCATION_SETTING)).toBe("hidden");
    // A product's or an extension's default may change it (decision 3).
    expect(
      service.registry.getProperty(ACTIVITY_BAR_LOCATION_SETTING)?.schema.defaultOverridable,
    ).toBe(true);
  });
});

describe("the side bar's state in the layout service", () => {
  it("keeps the open state from the first shell's initial value until the last one lets go", async () => {
    const layout = new LayoutService(store);
    const listener = vi.fn();
    layout.onDidChangeSideBar(listener);
    expect(layout.isSideBarOpen(() => false)).toBe(false);
    expect(layout.isSideBarOpen(() => true)).toBe(false);
    layout.setSideBarOpen((open) => !open);
    expect(layout.isSideBarOpen()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    const release = layout.holdSideBarState();
    release();
    // A remount in the same task holds it again first.
    const again = layout.holdSideBarState();
    await Promise.resolve();
    expect(layout.isSideBarOpen(() => false)).toBe(true);
    again();
    await Promise.resolve();
    expect(layout.isSideBarOpen(() => false)).toBe(false);
  });

  it("remembers the active container in the layout state and opens the side bar for it", () => {
    const layout = new LayoutService(store);
    const sideBar = { visible: false };
    layout.registerPart(Parts.SIDEBAR_PART, {
      isVisible: () => sideBar.visible,
      setHidden: (hidden) => {
        sideBar.visible = !hidden;
      },
    });
    expect(layout.getActiveViewContainer()).toBe(CONVERSATIONS_CONTAINER);
    layout.openViewContainer("omnigent.inbox");
    expect(sideBar.visible).toBe(true);
    expect(store.get(LAYOUT_SLOTS.activeViewContainer)).toBe("omnigent.inbox");
    layout.setActiveViewContainer(CONVERSATIONS_CONTAINER);
    expect(store.get(LAYOUT_SLOTS.activeViewContainer)).toBeUndefined();
  });
});

describe("the activity bar's commands and context keys", () => {
  it("toggles and focuses the bar, opens containers, resets the layout, and keeps the keys", async () => {
    const layout = new LayoutService(store);
    const commands = new CommandRegistry();
    const contextKeys = new ContextKeyService();
    const containers = new ViewContainerRegistry({ warn: () => {} });
    const service = configuration();
    const sideBar = { visible: true };
    layout.registerPart(Parts.SIDEBAR_PART, {
      isVisible: () => sideBar.visible,
      setHidden: (hidden) => {
        sideBar.visible = !hidden;
        layout.partChanged(Parts.SIDEBAR_PART);
      },
    });
    const focus = vi.fn();
    layout.registerPart(Parts.ACTIVITYBAR_PART, {
      isVisible: () => true,
      setHidden: () => {},
      focus,
    });
    registerLayoutCommands(commands, layout, {
      contextKeys,
      configuration: service,
      containers,
      store,
    });
    const run = (id: string) => commands.execute(id, [], () => {});
    containers.register({
      id: "omnigent.inbox",
      title: "Inbox",
      icon: undefined,
      location: "sidebar",
      extensionId: "omnigent.inbox",
      builtIn: true,
      order: 0,
    });
    expect(contextKeys.get("activityBarVisible")).toBe(true);
    expect(contextKeys.get("activeViewlet")).toBe(CONVERSATIONS_CONTAINER);
    sideBar.visible = false;
    layout.partChanged(Parts.SIDEBAR_PART);
    expect(contextKeys.get("activeViewlet")).toBeUndefined();
    await run(viewContainerCommand("omnigent.inbox"));
    expect(sideBar.visible).toBe(true);
    expect(contextKeys.get("activeViewlet")).toBe("omnigent.inbox");
    await run(TOGGLE_ACTIVITY_BAR_COMMAND);
    expect(service.getValue(ACTIVITY_BAR_LOCATION_SETTING)).toBe("default");
    await run(FOCUS_ACTIVITY_BAR_COMMAND);
    expect(focus).toHaveBeenCalled();
    setActivityBarItemHidden("omnigent.canvas", true, store);
    sideBar.visible = false;
    layout.partChanged(Parts.SIDEBAR_PART);
    // A desktop window: the side bar opens again (a phone's drawer stays as it is).
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) => ({ matches: query.includes("min-width"), media: query }) as MediaQueryList,
    );
    await run(RESET_LAYOUT_COMMAND);
    expect(store.get(LAYOUT_SLOTS.activityBar)).toBeUndefined();
    expect(layout.getActiveViewContainer()).toBe(CONVERSATIONS_CONTAINER);
    expect(sideBar.visible).toBe(true);
    // Settings stay.
    expect(service.getValue(ACTIVITY_BAR_LOCATION_SETTING)).toBe("default");
  });
});
