import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "@/vscodeExtensions/commands";
import { ContextKeyService } from "@/vscodeExtensions/contextKeys";
import { parseContributions } from "@/vscodeExtensions/contributions";
import { testViewsService } from "@/vscodeExtensions/testServices";
import {
  MOVE_VIEW_COMMAND,
  RESET_VIEW_LOCATIONS_COMMAND,
  registerLayoutCommands,
} from "@/workbench/layoutCommands";
import { LayoutService } from "@/workbench/layoutService";
import { LAYOUT_SLOTS, layoutState } from "@/workbench/layoutState";
import {
  NAVIGATION_PATHS,
  registerNavigationCommands,
  setNavigationHandler,
  setShellNavigator,
} from "@/workbench/navigationCommands";
import { productLayout } from "@/workbench/productLayout";
import { NavigationEntries } from "@/workbench/sidebarNavigation";
import {
  RIGHT_PANEL_CONTAINER,
  ViewContainerRegistry,
  viewContainers,
} from "@/workbench/viewContainers";
import { generatedContainerId } from "@/workbench/viewLocations";
import { moveViewDestinations } from "./MoveViewPicker";
import { RailViewRegistry, railViews, useRailViews } from "./railViews";
import { RailTabStripMenu } from "./RailTabStripMenu";
import { ContainerViewsMenu, useSideBarContainers, ViewContainerViews } from "./ViewContainerViews";
import { useViewDropTarget, viewDragProps } from "./viewMoves";

function fakeDataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    effectAllowed: "all",
    dropEffect: "none",
  } as unknown as DataTransfer;
}

const removals: (() => void)[] = [];

beforeEach(() => {
  localStorage.clear();
  layoutState.reset();
  // The containers the moves go to are the window's, as the shell reads them.
  for (const id of ["acme.tools", "acme.other"]) {
    removals.push(
      viewContainers.register({
        id,
        title: id === "acme.tools" ? "Tools" : "Other",
        icon: undefined,
        location: "sidebar",
        extensionId: id,
        builtIn: false,
        order: 0,
      }),
    );
  }
});
afterEach(() => {
  cleanup();
  for (const remove of removals.splice(0)) remove();
  productLayout.set(null);
});

function setup(
  contributed: unknown[] = [{ id: "acme.tools.list", name: "Things", icon: "list" }],
  registry: RailViewRegistry = new RailViewRegistry(),
) {
  const containers = new ViewContainerRegistry({ warn: () => {} });
  const views = testViewsService(new CommandRegistry(), {
    registry,
    contextKeys: new ContextKeyService(),
    containers,
  });
  const { contributions } = parseContributions("acme.tools", {
    viewsContainers: { activitybar: [{ id: "acme.tools", title: "Tools" }] },
    views: { "acme.tools": contributed },
  });
  const removal = views.addExtension("acme.tools", contributions);
  views.extensionSettled("acme.tools");
  return { registry, removal };
}

function paneIds(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("[data-view]")].map((pane) =>
    pane.getAttribute("data-view"),
  );
}

describe("moving views", () => {
  it("draws a moved view in the container it was moved to, not in its own", () => {
    const { registry } = setup();
    const own = render(<ViewContainerViews containerId="acme.tools" registry={registry} />);
    const other = render(<ViewContainerViews containerId="acme.other" registry={registry} />);
    expect(paneIds(own.container)).toEqual(["acme.tools.list"]);
    act(() => layoutState.set(LAYOUT_SLOTS.viewLocations, { "acme.tools.list": "acme.other" }));
    expect(paneIds(own.container)).toEqual([]);
    expect(paneIds(other.container)).toEqual(["acme.tools.list"]);
  });

  it("lists a new side bar entry while a view is in it, and draws the view there", () => {
    const { registry } = setup();
    const { result } = renderHook(() => useSideBarContainers(registry));
    const entry = generatedContainerId("acme.tools.list");
    act(() => layoutState.set(LAYOUT_SLOTS.viewLocations, { "acme.tools.list": entry }));
    const ids = result.current.map(({ container }) => container.id);
    // The tools container is empty now: it leaves the list; the new entry has the view's name.
    expect(ids).not.toContain("acme.tools");
    expect(result.current.find(({ container }) => container.id === entry)?.container.title).toBe(
      "Things",
    );
    const { container } = render(<ViewContainerViews containerId={entry} registry={registry} />);
    expect(paneIds(container)).toEqual(["acme.tools.list"]);
  });

  it("draws a tree view moved to the secondary side bar as one of the rail's views", () => {
    const { registry } = setup();
    const { result } = renderHook(() => useRailViews(registry));
    expect(result.current.views.map((view) => view.id)).toEqual([]);
    act(() =>
      layoutState.set(LAYOUT_SLOTS.viewLocations, { "acme.tools.list": RIGHT_PANEL_CONTAINER }),
    );
    expect(result.current.views.map((view) => view.id)).toEqual(["acme.tools.list"]);
  });

  it("hides a view from its pane header's right-click menu, never the container's last", async () => {
    const { registry } = setup([
      { id: "acme.tools.list", name: "Things" },
      { id: "acme.tools.more", name: "More" },
    ]);
    render(<ViewContainerViews containerId="acme.tools" registry={registry} />);
    const header = screen
      .getByRole("button", { name: "Things" })
      .closest("[data-slot=view-title]")!;
    expect(header).toHaveAttribute("draggable", "true");
    fireEvent.contextMenu(header);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Hide ‘Things’" }));
    expect(layoutState.get(LAYOUT_SLOTS.views)).toEqual({ "acme.tools.list": { hidden: true } });
    // More is the last one shown: its Hide is off.
    const more = screen.getByRole("button", { name: "More" }).closest("[data-slot=view-title]")!;
    fireEvent.contextMenu(more);
    expect(await screen.findByRole("menuitem", { name: "Hide ‘More’" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("moves a dropped view into the container its target names, shown even if it was hidden", () => {
    // The moves read the window's views.
    const { registry, removal } = setup(undefined, railViews);
    layoutState.set(LAYOUT_SLOTS.views, { "acme.tools.list": { hidden: true } });
    function Target() {
      const drop = useViewDropTarget(() => "acme.other");
      return <div data-testid="target" {...drop} />;
    }
    render(<Target />);
    const source = document.createElement("div");
    document.body.append(source);
    const dataTransfer = fakeDataTransfer();
    // The drag starts on a view's header (its props), then lands on the target.
    const props = viewDragProps(registry.get("acme.tools.list")!, productLayout);
    act(() => props.onDragStart?.({ dataTransfer, stopPropagation: () => {} } as never));
    const target = screen.getByTestId("target");
    fireEvent.dragOver(target, { dataTransfer });
    expect(target).toHaveAttribute("data-view-drop-target");
    fireEvent.drop(target, { dataTransfer });
    expect(layoutState.get(LAYOUT_SLOTS.viewLocations)).toEqual({
      "acme.tools.list": "acme.other",
    });
    expect(layoutState.get(LAYOUT_SLOTS.views)).toBeUndefined();
    removal();
    source.remove();
  });

  it("offers no menu and no drag under the product's lockViewLocations", () => {
    productLayout.set({ lockViewLocations: true });
    const { registry } = setup();
    render(<ViewContainerViews containerId="acme.tools" registry={registry} />);
    const header = screen
      .getByRole("button", { name: "Things" })
      .closest("[data-slot=view-title]")!;
    expect(header).not.toHaveAttribute("draggable");
    fireEvent.contextMenu(header);
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("lists the destinations: the side bar's other containers, a new entry, the rail", () => {
    const view = {
      id: "acme.tools.list",
      extensionId: "acme.tools",
      name: "Things",
      icon: undefined,
    };
    const sideBar = ["acme.tools", "acme.other"].map((id) => viewContainers.get(id)!);
    expect(
      moveViewDestinations(view, "acme.tools", sideBar).map((item) => [item.group, item.label]),
    ).toEqual([
      ["Side Bar", "Other"],
      ["Side Bar", "New Side Bar Entry"],
      ["Secondary Side Bar", "Secondary Side Bar"],
    ]);
    // A host component's view stays in side bars.
    expect(
      moveViewDestinations({ ...view, builtInView: "inboxList" }, "acme.tools", sideBar).map(
        (item) => item.label,
      ),
    ).toEqual(["Other", "New Side Bar Entry"]);
  });
});

describe("the menus that list views", () => {
  it("names the right panel tab the menu opened on, from the menu's own event", async () => {
    const { registry } = setup();
    act(() =>
      layoutState.set(LAYOUT_SLOTS.viewLocations, { "acme.tools.list": RIGHT_PANEL_CONTAINER }),
    );
    function Strip() {
      const { views } = useRailViews(registry);
      return (
        <RailTabStripMenu views={views}>
          <div role="toolbar">
            <button type="button" data-workspace-tab="ext:acme.tools.list">
              tab
            </button>
          </div>
        </RailTabStripMenu>
      );
    }
    render(<Strip />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "tab" }));
    expect(await screen.findByRole("menuitem", { name: "Hide ‘Things’" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "Things" })).toBeChecked();
  });

  it("lists the side bar container's views, and leaves a link's own menu alone", async () => {
    const { registry } = setup();
    render(
      <ContainerViewsMenu containerId="acme.tools" registry={registry}>
        <div data-testid="header">
          <a href="/">home</a>
        </div>
      </ContainerViewsMenu>,
    );
    fireEvent.contextMenu(screen.getByRole("link", { name: "home" }));
    expect(screen.queryByTestId("view-container-menu")).toBeNull();
    fireEvent.contextMenu(screen.getByTestId("header"));
    const item = await screen.findByRole("menuitemcheckbox", { name: "Things" });
    // The last view shown can't be hidden.
    expect(item).toHaveAttribute("aria-disabled", "true");
  });
});

describe("the view commands", () => {
  it("opens Move View for the view given, and resets every view's location", async () => {
    const commands = new CommandRegistry();
    const openMoveView = vi.fn();
    const registration = registerLayoutCommands(commands, new LayoutService(), {
      openMoveView,
      containers: new ViewContainerRegistry({ warn: () => {} }),
    });
    await commands.execute(MOVE_VIEW_COMMAND, ["acme.tools.list"], () => {});
    await commands.execute(MOVE_VIEW_COMMAND, [], () => {});
    expect(openMoveView.mock.calls).toEqual([["acme.tools.list"], [undefined]]);
    layoutState.set(LAYOUT_SLOTS.viewLocations, { "acme.tools.list": "acme.other" });
    await commands.execute(RESET_VIEW_LOCATIONS_COMMAND, [], () => {});
    expect(layoutState.get(LAYOUT_SLOTS.viewLocations)).toBeUndefined();
    registration.dispose();
  });

  it("runs New session and Canvas as their rows do while the side bar sets them", async () => {
    const commands = new CommandRegistry();
    const registration = registerNavigationCommands(commands);
    const navigate = vi.fn();
    const removeNavigator = setShellNavigator(navigate);
    await commands.execute(NavigationEntries.canvas, [], () => {});
    expect(navigate).toHaveBeenLastCalledWith(NAVIGATION_PATHS[NavigationEntries.canvas]);
    const switchTab = vi.fn();
    const removeHandlers = [
      setNavigationHandler(NavigationEntries.newSession, (go) => {
        switchTab("mine");
        go("/");
      }),
      setNavigationHandler(NavigationEntries.canvas, (go) => go("/canvas?canvas=acme")),
    ];
    await commands.execute(NavigationEntries.newSession, [], () => {});
    expect(switchTab).toHaveBeenCalledWith("mine");
    expect(navigate).toHaveBeenLastCalledWith("/");
    await commands.execute(NavigationEntries.canvas, [], () => {});
    expect(navigate).toHaveBeenLastCalledWith("/canvas?canvas=acme");
    for (const remove of removeHandlers) remove();
    removeNavigator();
    registration.dispose();
  });
});
