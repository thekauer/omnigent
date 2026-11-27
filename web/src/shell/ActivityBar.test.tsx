import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommandRegistry } from "@/vscodeExtensions/commands";
import { ContextKeyService } from "@/vscodeExtensions/contextKeys";
import { parseContributions } from "@/vscodeExtensions/contributions";
import { testViewsService } from "@/vscodeExtensions/testServices";
import { LAYOUT_SLOTS, layoutState } from "@/workbench/layoutState";
import { layoutService, Parts } from "@/workbench/layoutService";
import { CONVERSATIONS_CONTAINER, viewContainers } from "@/workbench/viewContainers";
import { ActivityBar } from "./ActivityBar";
import { registerBuiltInViewBadge } from "./builtInViews";
import { railViews } from "./railViews";

const removals: (() => void)[] = [];

function contribute(extensionId: string, contributes: unknown, builtIn = false) {
  const views = testViewsService(new CommandRegistry(), {
    registry: railViews,
    contextKeys: new ContextKeyService(),
    containers: viewContainers,
  });
  const { contributions } = parseContributions(extensionId, contributes, { builtIn });
  removals.push(views.addExtension(extensionId, contributions, { builtIn }));
  views.extensionSettled(extensionId);
  return views;
}

let sideBarOpen = true;
beforeEach(() => {
  localStorage.clear();
  layoutState.reset();
  sideBarOpen = true;
  removals.push(
    layoutService.registerPart(Parts.SIDEBAR_PART, {
      isVisible: () => sideBarOpen,
      setHidden: (hidden) => {
        sideBarOpen = !hidden;
        layoutService.partChanged(Parts.SIDEBAR_PART);
      },
    }),
  );
  contribute(
    "omnigent.conversations",
    {
      viewsContainers: {
        activitybar: [{ id: CONVERSATIONS_CONTAINER, title: "Sessions", icon: "messages-square" }],
      },
      views: {
        [CONVERSATIONS_CONTAINER]: [
          { id: "omnigent.conversations.list", name: "Sessions", builtInView: "conversationList" },
        ],
      },
    },
    true,
  );
  contribute(
    "omnigent.inbox",
    {
      viewsContainers: { activitybar: [{ id: "omnigent.inbox", title: "Inbox", icon: "inbox" }] },
      views: {
        "omnigent.inbox": [{ id: "omnigent.inbox.list", name: "Inbox", builtInView: "inboxList" }],
      },
    },
    true,
  );
  contribute("acme.tools", {
    viewsContainers: { activitybar: [{ id: "acme.tools", title: "Tools" }] },
    views: {
      "acme.tools": [{ id: "acme.tools.list", name: "Tools" }],
      "acme.tools.empty": [],
    },
  });
});

afterEach(() => {
  cleanup();
  for (const remove of removals.splice(0).reverse()) remove();
});

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });

describe("ActivityBar", () => {
  it("lists the side bar's containers that have a view, and switches the side bar to one", () => {
    render(<ActivityBar location="top" />);
    expect(screen.getAllByRole("tab").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Sessions",
      "Inbox",
      "Tools",
    ]);
    expect(tab("Sessions")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(tab("Inbox"));
    expect(layoutService.getActiveViewContainer()).toBe("omnigent.inbox");
    expect(tab("Inbox")).toHaveAttribute("aria-selected", "true");
    expect(tab("Inbox")).toHaveAttribute("data-active", "true");
  });

  it("hides the side bar when the active item is clicked, and shows it again", () => {
    render(<ActivityBar location="top" />);
    fireEvent.click(tab("Sessions"));
    expect(sideBarOpen).toBe(false);
    expect(tab("Sessions")).not.toHaveAttribute("data-active");
    fireEvent.click(tab("Sessions"));
    expect(sideBarOpen).toBe(true);
  });

  it("moves focus with the arrow keys, Home and End", () => {
    render(<ActivityBar location="top" />);
    const [sessions, inbox, tools] = screen.getAllByRole("tab");
    sessions!.focus();
    fireEvent.keyDown(sessions!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(inbox);
    fireEvent.keyDown(inbox!, { key: "End" });
    expect(document.activeElement).toBe(tools);
    fireEvent.keyDown(tools!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(sessions);
    // Only the selected item is in the tab order.
    expect(screen.getAllByRole("tab").map((item) => item.tabIndex)).toEqual([0, -1, -1]);
  });

  it("rolls a built-in view's badge up to its item", () => {
    registerBuiltInViewBadge("inboxList", () => ({ value: 3, tooltip: "3 in the Inbox" }));
    render(<ActivityBar location="top" />);
    expect(tab("Inbox")).toHaveAccessibleName("Inbox (3 in the Inbox)");
    expect(tab("Inbox").querySelector('[data-slot="activitybar-badge"]')).toHaveTextContent("3");
    registerBuiltInViewBadge("inboxList", () => undefined);
  });

  it("reorders by drag and drop and hides an item from its menu, in the layout state", () => {
    render(<ActivityBar location="top" />);
    fireEvent.dragStart(tab("Tools"), { dataTransfer: { setData: () => {}, effectAllowed: "" } });
    fireEvent.dragOver(tab("Sessions"));
    fireEvent.drop(tab("Sessions"));
    expect(screen.getAllByRole("tab").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Tools",
      "Sessions",
      "Inbox",
    ]);
    fireEvent.contextMenu(tab("Inbox"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Inbox" }));
    expect(screen.queryByRole("tab", { name: /^Inbox/ })).toBeNull();
    expect(layoutState.get(LAYOUT_SLOTS.activityBar)).toEqual({
      order: ["acme.tools", CONVERSATIONS_CONTAINER, "omnigent.inbox"],
      hidden: ["omnigent.inbox"],
    });
    act(() => layoutState.reset());
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("keeps a hidden item's place on a move, and hiding the shown container shows another", () => {
    render(<ActivityBar location="top" />);
    fireEvent.click(tab("Inbox"));
    fireEvent.contextMenu(tab("Inbox"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Inbox" }));
    // The Inbox was on screen: the side bar shows the first item left.
    expect(layoutService.getActiveViewContainer()).toBe(CONVERSATIONS_CONTAINER);
    fireEvent.dragStart(tab("Tools"), { dataTransfer: { setData: () => {}, effectAllowed: "" } });
    fireEvent.drop(tab("Sessions"));
    expect(layoutState.get(LAYOUT_SLOTS.activityBar)).toEqual({
      order: ["acme.tools", CONVERSATIONS_CONTAINER, "omnigent.inbox"],
      hidden: ["omnigent.inbox"],
    });
  });
});
