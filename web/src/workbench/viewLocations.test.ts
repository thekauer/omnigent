import { beforeEach, describe, expect, it } from "vitest";
import { LAYOUT_SLOTS, LayoutStateStore } from "./layoutState";
import { ProductLayoutPolicy } from "./productLayout";
import {
  HOST_CONTAINER_OWNER,
  RIGHT_PANEL_CONTAINER,
  ViewContainerRegistry,
} from "./viewContainers";
import {
  canMoveView,
  generatedContainerId,
  generatedContainers,
  isViewMoved,
  moveView,
  readViewLocations,
  resetViewLocations,
  viewContainerFor,
} from "./viewLocations";
import { readViewsLayout, updateViewLayout } from "./viewsLayout";

const tree = { id: "acme.tools.list", name: "Things", icon: "list", containerId: "acme.tools" };
const builtIn = {
  id: "omnigent.inbox.list",
  name: "Inbox",
  containerId: "omnigent.inbox",
  builtInView: "inboxList",
};
const railTab = { id: "omnigent.files.view", name: "Files", builtInTab: "files" };

function setup() {
  const store = new LayoutStateStore("test:layout-state", {});
  const policy = new ProductLayoutPolicy();
  const registry = new ViewContainerRegistry({ warn: () => {} });
  for (const [id, location] of [
    ["acme.tools", "sidebar"],
    ["omnigent.inbox", "sidebar"],
    ["acme.panel", "auxiliarybar"],
  ] as const) {
    registry.register({
      id,
      title: id,
      icon: undefined,
      location,
      extensionId: id,
      builtIn: false,
      order: 0,
    });
  }
  return { store, policy, registry, options: { store, policy, registry } };
}

beforeEach(() => localStorage.clear());

describe("view locations", () => {
  it("moves a view to another container, kept in the layout state, and back", () => {
    const { store, registry, options } = setup();
    expect(moveView(tree, "omnigent.inbox", options)).toBe(true);
    expect(store.get(LAYOUT_SLOTS.viewLocations)).toEqual({ "acme.tools.list": "omnigent.inbox" });
    const locations = readViewLocations(store);
    expect(viewContainerFor(tree, locations, registry)).toBe("omnigent.inbox");
    expect(isViewMoved(tree, locations, registry)).toBe(true);
    // Its own container again drops the move.
    expect(moveView(tree, "acme.tools", options)).toBe(true);
    expect(store.get(LAYOUT_SLOTS.viewLocations)).toBeUndefined();
  });

  it("moves a tree view to the secondary side bar, a host component's view only to side bars", () => {
    const { options } = setup();
    expect(moveView(tree, RIGHT_PANEL_CONTAINER, options)).toBe(true);
    expect(moveView(builtIn, "acme.panel", options)).toBe(false);
    expect(moveView(builtIn, "acme.tools", options)).toBe(true);
  });

  it("never moves a rail tab's built-in view, nor to a container that isn't there", () => {
    const { options } = setup();
    expect(canMoveView(railTab)).toBe(false);
    expect(moveView(railTab, "acme.tools", options)).toBe(false);
    expect(moveView(tree, "acme.gone", options)).toBe(false);
  });

  it("falls back to the view's own container when the stored one went away or can't draw it", () => {
    const { store, registry } = setup();
    store.set(LAYOUT_SLOTS.viewLocations, {
      "acme.tools.list": "acme.gone",
      "omnigent.inbox.list": "acme.panel",
      "omnigent.files.view": "acme.tools",
    });
    const locations = readViewLocations(store);
    expect(viewContainerFor(tree, locations, registry)).toBe("acme.tools");
    expect(viewContainerFor(builtIn, locations, registry)).toBe("omnigent.inbox");
    expect(viewContainerFor(railTab, locations, registry)).toBe(RIGHT_PANEL_CONTAINER);
  });

  it("keeps only well-formed stored moves", () => {
    const { store } = setup();
    store.set(LAYOUT_SLOTS.viewLocations, { a: "b", c: 3, d: "" });
    expect(readViewLocations(store)).toEqual({ a: "b" });
    store.set(LAYOUT_SLOTS.viewLocations, ["a"]);
    expect(readViewLocations(store)).toEqual({});
  });

  it("makes a side bar entry for a view moved to a new one, titled by it while it is there", () => {
    const { registry, options, store } = setup();
    expect(moveView(tree, generatedContainerId(tree.id), options)).toBe(true);
    expect(moveView(builtIn, generatedContainerId(tree.id), options)).toBe(true);
    const views = [builtIn, tree];
    const entries = generatedContainers(views, readViewLocations(store), registry);
    expect(entries).toEqual([
      {
        id: generatedContainerId(tree.id),
        title: "Things",
        icon: "list",
        location: "sidebar",
        extensionId: HOST_CONTAINER_OWNER,
        builtIn: false,
        order: 0,
      },
    ]);
    // Its first view gone back, the entry stays while another view is in it.
    moveView(tree, "acme.tools", options);
    expect(generatedContainers(views, readViewLocations(store), registry)[0]?.title).toBe("Inbox");
    moveView(builtIn, "omnigent.inbox", options);
    expect(generatedContainers(views, readViewLocations(store), registry)).toEqual([]);
  });

  it("resets every view's location", () => {
    const { store, options } = setup();
    moveView(tree, "omnigent.inbox", options);
    resetViewLocations(store);
    expect(store.get(LAYOUT_SLOTS.viewLocations)).toBeUndefined();
  });

  it("keeps every view in place while the product locks view locations", () => {
    const { store, policy, registry, options } = setup();
    moveView(tree, "omnigent.inbox", options);
    updateViewLayout(builtIn.id, { hidden: true }, store, policy);
    policy.set({ lockViewLocations: true });
    expect(canMoveView(tree, policy)).toBe(false);
    expect(moveView(tree, "acme.tools", options)).toBe(false);
    // The user's moves and hidden views don't apply, and hiding is refused.
    expect(viewContainerFor(tree, readViewLocations(store, policy), registry)).toBe("acme.tools");
    expect(readViewsLayout(store, policy)[builtIn.id]?.hidden).toBeUndefined();
    expect(updateViewLayout(tree.id, { hidden: true }, store, policy)).toBe(false);
    expect(updateViewLayout(tree.id, { collapsed: true }, store, policy)).toBe(true);
    // Lifted, they are back.
    policy.set(null);
    expect(viewContainerFor(tree, readViewLocations(store, policy), registry)).toBe(
      "omnigent.inbox",
    );
    expect(readViewsLayout(store, policy)[builtIn.id]?.hidden).toBe(true);
  });
});
