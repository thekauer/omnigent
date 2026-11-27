// The L3 to L5 validation's findings, each held by a test.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { badgeText } from "@/shell/ActivityBar";
import { CommandRegistry } from "@/vscodeExtensions/commands";
import { ContextKeyService } from "@/vscodeExtensions/contextKeys";
import { parseContributions } from "@/vscodeExtensions/contributions";
import { RailViewRegistry } from "@/shell/railViews";
import { ViewsService } from "@/vscodeExtensions/viewsService";
import { resetLayout } from "./layoutCommands";
import { LayoutService } from "./layoutService";
import { LAYOUT_SLOTS, LayoutStateStore } from "./layoutState";
import type { ContributedNavigationEntry } from "./sidebarNavigation";
import { ViewContainerRegistry, viewContainers } from "./viewContainers";
import { ViewContainerTitleActions } from "@/shell/ViewContainerTitleActions";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function service() {
  let entries: readonly ContributedNavigationEntry[] = [];
  const containers = new ViewContainerRegistry({ warn: () => {} });
  const views = new ViewsService({
    registry: new RailViewRegistry(),
    containers,
    contextKeys: new ContextKeyService(),
    executeCommand: (command, args) => new CommandRegistry().execute(command, args, () => {}),
    showError: () => {},
    navigation: { set: (next) => (entries = next) },
  });
  const add = (extensionId: string, contributes: unknown) =>
    views.addExtension(extensionId, parseContributions(extensionId, contributes).contributions);
  return { add, entries: () => entries, containers };
}

describe("navigation entries from other extensions", () => {
  it("can't title another's command, take a reserved id in any case, or repeat a row", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { add, entries } = service();
    add("acme.one", {
      commands: [
        { command: "acme.one.go", title: "Go", icon: "eye" },
        // A host command no manifest of its own declares: not this extension's to title.
        { command: "omnigent.openUsage", title: "Usage" },
      ],
      menus: {
        "sidebar/navigation": [
          { command: "acme.one.go" },
          { command: "Omnigent.NewSession" },
          { command: "omnigent.openUsage2" },
        ],
      },
    });
    add("acme.two", {
      commands: [{ command: "acme.one.go", title: "Impostor" }],
      menus: { "sidebar/navigation": [{ command: "acme.one.go" }] },
    });
    expect(entries().map((entry) => [entry.id, entry.title, entry.extensionId])).toEqual([
      ["acme.one.go", "Go", "acme.one"],
      ["omnigent.openUsage2", "omnigent.openUsage2", "acme.one"],
    ]);
  });
});

describe("View: Reset Layout", () => {
  it("clears the layout's slots, keeps the list's own preferences, and can be undone", () => {
    const store = new LayoutStateStore("test:layout", {});
    store.set(LAYOUT_SLOTS.sidebar, { visible: false });
    store.set(LAYOUT_SLOTS.conversationsView, { order: "custom" });
    store.set(LAYOUT_SLOTS.collapsedSections, ["Projects"]);
    const toast = vi.spyOn(console, "error").mockImplementation(() => {});
    resetLayout(new LayoutService(store), store);
    expect(store.get(LAYOUT_SLOTS.sidebar)).toBeUndefined();
    expect(store.get(LAYOUT_SLOTS.conversationsView)).toEqual({ order: "custom" });
    expect(store.get(LAYOUT_SLOTS.collapsedSections)).toEqual(["Projects"]);
    store.restoreSlots({ [LAYOUT_SLOTS.sidebar]: { visible: false } });
    expect(store.get(LAYOUT_SLOTS.sidebar)).toEqual({ visible: false });
    toast.mockRestore();
  });
});

describe("activity bar badges", () => {
  it("draw at most 99, then 99+", () => {
    expect(badgeText(7)).toBe("7");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
    expect(badgeText(1e21)).toBe("99+");
  });
});

describe("a container's title actions", () => {
  it("draw an icon for an action without one, its title as its name, not as text", () => {
    const run = vi.fn(() => Promise.resolve());
    act(() =>
      viewContainers.setTitleActions(
        new Map([
          [
            "acme.tools",
            [
              {
                id: "acme.tools.refresh",
                title: "Refresh everything now",
                tooltip: undefined,
                icon: undefined,
                toggled: undefined,
                tone: undefined,
                group: "navigation" as const,
                run,
              },
            ],
          ],
        ]),
      ),
    );
    render(<ViewContainerTitleActions containerId="acme.tools" />);
    const button = screen.getByRole("button", { name: "Refresh everything now" });
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.textContent).toBe("");
    act(() => viewContainers.setTitleActions(new Map()));
  });
});
