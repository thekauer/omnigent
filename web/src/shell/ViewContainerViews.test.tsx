import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type * as omnigent from "omnigent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommandRegistry } from "@/vscodeExtensions/commands";
import { ContextKeyService } from "@/vscodeExtensions/contextKeys";
import { parseContributions } from "@/vscodeExtensions/contributions";
import { testViewsService } from "@/vscodeExtensions/testServices";
import { LAYOUT_SLOTS, layoutState } from "@/workbench/layoutState";
import { CONVERSATIONS_CONTAINER, ViewContainerRegistry } from "@/workbench/viewContainers";
import { builtInViewComponent, registerBuiltInView } from "./builtInViews";
import { hasRailTab, RailViewRegistry, useRailViewIds } from "./railViews";
import { useWorkbenchContextKeys } from "./useWorkbenchParts";
import { updateViewLayout } from "@/workbench/viewsLayout";
import { WorkbenchContext } from "@/workbench/workbenchContext";
import { ViewContainerViews } from "./ViewContainerViews";

beforeEach(() => {
  localStorage.clear();
  layoutState.reset();
});
afterEach(cleanup);

function setup(contributes: unknown, extensionId = "acme.tools") {
  const registry = new RailViewRegistry();
  const contextKeys = new ContextKeyService();
  const containers = new ViewContainerRegistry({ warn: () => {} });
  const views = testViewsService(new CommandRegistry(), { registry, contextKeys, containers });
  const { contributions } = parseContributions(extensionId, contributes);
  views.addExtension(extensionId, contributions);
  views.extensionSettled(extensionId);
  return { registry, contextKeys, views, containers };
}

describe("ViewContainerViews", () => {
  it("draws a built-in container's views from its manifest before the host registered them", () => {
    const removeNavigation = registerBuiltInView("navigation", () => <nav>primary nav</nav>);
    const removeList = registerBuiltInView("conversationList", () => <ul aria-label="sessions" />);
    render(
      <ViewContainerViews
        containerId={CONVERSATIONS_CONTAINER}
        registry={new RailViewRegistry()}
      />,
    );
    // In manifest order, with no wrapper of their own.
    const container = screen.getByText("primary nav").parentElement!;
    expect([...container.children].map((child) => child.tagName)).toEqual(["NAV", "UL"]);
    removeNavigation();
    removeList();
  });

  it("stacks a contributed view as a pane its header collapses, kept in the layout state", async () => {
    const { registry, views } = setup({
      viewsContainers: { activitybar: [{ id: "acme.tools", title: "Tools" }] },
      views: { "acme.tools": [{ id: "acme.tools.list", name: "Things" }] },
    });
    const provider: omnigent.TreeDataProvider<string> = {
      getChildren: (element) => Promise.resolve(element ? [] : ["one"]),
      getTreeItem: (label) => ({ id: label, label }),
    };
    views.createTreeView("acme.tools", "acme.tools.list", { treeDataProvider: provider }, () => {});
    render(<ViewContainerViews containerId="acme.tools" registry={registry} />);
    await screen.findByText("one");
    const header = screen.getByRole("button", { name: "Things" });
    expect(header).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(header);
    await waitFor(() => expect(screen.queryByText("one")).toBeNull());
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(layoutState.get(LAYOUT_SLOTS.views)).toEqual({ "acme.tools.list": { collapsed: true } });
  });

  it("draws the container's own extension's views before others'", () => {
    const { registry, views, containers } = setup(
      {
        viewsContainers: { activitybar: [{ id: "zed.tools", title: "Tools" }] },
        views: { "zed.tools": [{ id: "zed.tools.own", name: "Own" }] },
      },
      "zed.tools",
    );
    const { contributions } = parseContributions("acme.extra", {
      views: { "zed.tools": [{ id: "acme.extra.guest", name: "Guest" }] },
    });
    views.addExtension("acme.extra", contributions);
    const { container } = render(
      <ViewContainerViews containerId="zed.tools" registry={registry} containers={containers} />,
    );
    expect(
      [...container.querySelectorAll("[data-view]")].map((pane) => pane.getAttribute("data-view")),
    ).toEqual(["zed.tools.own", "acme.extra.guest"]);
  });

  it("leaves out a view whose when doesn't hold or that is hidden, and draws its welcome", async () => {
    const { registry, contextKeys } = setup({
      viewsContainers: { activitybar: [{ id: "acme.tools", title: "Tools" }] },
      views: {
        "acme.tools": [
          { id: "acme.tools.gated", name: "Gated", when: "acme.tools.on" },
          { id: "acme.tools.hidden", name: "Hidden", visibility: "hidden" },
          { id: "acme.tools.empty", name: "Empty" },
        ],
      },
      viewsWelcome: [
        {
          view: "acme.tools.empty",
          contents: "No tools yet.\n[Add a tool](command:acme.tools.add)",
        },
      ],
    });
    render(<ViewContainerViews containerId="acme.tools" registry={registry} />);
    expect(screen.queryByRole("button", { name: "Gated" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hidden" })).toBeNull();
    expect(screen.getByText("No tools yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a tool" })).toBeInTheDocument();
    act(() => contextKeys.set("acme.tools.on", true));
    expect(await screen.findByRole("button", { name: "Gated" })).toBeInTheDocument();
  });
});

describe("the rail's extension tabs and the shell's context keys", () => {
  it("validates a stored tab only while its view has a tab (when, hidden)", () => {
    const { registry, contextKeys } = setup({
      views: {
        "omnigent.rightPanel": [
          { id: "acme.tools.gated", name: "Gated", when: "acme.tools.on" },
          { id: "acme.tools.plain", name: "Plain" },
        ],
      },
    });
    const { result } = renderHook(() => useRailViewIds(registry));
    expect(result.current.ids).toEqual(["acme.tools.plain"]);
    act(() => contextKeys.set("acme.tools.on", true));
    expect(result.current.ids).toEqual(["acme.tools.gated", "acme.tools.plain"]);
    act(() => updateViewLayout("acme.tools.plain", { hidden: true }));
    expect(result.current.ids).toEqual(["acme.tools.gated"]);
    expect(hasRailTab(registry.get("acme.tools.plain")!)).toBe(true);
  });

  it("publishes the shell's keys while mounted and removes them on unmount", () => {
    const context = new WorkbenchContext();
    const { rerender, unmount } = renderHook(
      ({ values }) => useWorkbenchContextKeys(values, context),
      { initialProps: { values: { a: true, b: 1 } as Record<string, boolean | number> } },
    );
    expect(context.snapshot()).toEqual({ a: true, b: 1 });
    rerender({ values: { b: 2 } });
    expect(context.snapshot()).toEqual({ b: 2 });
    unmount();
    expect(context.snapshot()).toEqual({});
  });

  it("memoizes a built-in view's component", () => {
    let renders = 0;
    const remove = registerBuiltInView("inboxList", () => {
      renders += 1;
      return null;
    });
    const Drawn = builtInViewComponent("inboxList")!;
    const view = { id: "omnigent.x.list", extensionId: "omnigent.x", name: "X", icon: undefined };
    const { rerender } = render(<Drawn view={view} />);
    rerender(<Drawn view={view} />);
    expect(renders).toBe(1);
    remove();
    expect(builtInViewComponent("inboxList")).toBeUndefined();
  });
});
