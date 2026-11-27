import { describe, expect, it, vi } from "vitest";
import { RailViewRegistry } from "@/shell/railViews";
import { CommandRegistry } from "@/vscodeExtensions/commands";
import { ContextKeyService } from "@/vscodeExtensions/contextKeys";
import { parseContributions } from "@/vscodeExtensions/contributions";
import { testViewsService } from "@/vscodeExtensions/testServices";
import {
  CONVERSATIONS_CONTAINER,
  RIGHT_PANEL_CONTAINER,
  ViewContainerRegistry,
} from "./viewContainers";

const quiet = { warn: vi.fn() };

describe("ViewContainerRegistry", () => {
  it("keeps the host's right panel, then built-ins in order, then others by extension id", () => {
    const registry = new ViewContainerRegistry(quiet);
    const base = { icon: undefined, location: "sidebar" as const, order: 0 };
    registry.register({ ...base, id: "zed.view", title: "Z", extensionId: "zed", builtIn: false });
    registry.register({ ...base, id: "b.one", title: "B", extensionId: "b", builtIn: true });
    registry.register({ ...base, id: "acme.x", title: "A", extensionId: "acme", builtIn: false });
    registry.register({ ...base, id: "a.two", title: "A2", extensionId: "a", builtIn: true });
    expect(registry.getSnapshot().containers.map((container) => container.id)).toEqual([
      RIGHT_PANEL_CONTAINER,
      "b.one",
      "a.two",
      "acme.x",
      "zed.view",
    ]);
    expect(registry.at("auxiliarybar").map((container) => container.id)).toEqual([
      RIGHT_PANEL_CONTAINER,
    ]);
  });

  it("refuses a taken id and removes only its own registration", () => {
    const warn = vi.fn();
    const registry = new ViewContainerRegistry({ warn });
    const descriptor = {
      id: "acme.x",
      title: "X",
      icon: undefined,
      location: "sidebar" as const,
      extensionId: "acme",
      builtIn: false,
      order: 0,
    };
    const remove = registry.register(descriptor);
    const refused = registry.register({ ...descriptor, title: "Other" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    refused();
    expect(registry.get("acme.x")?.title).toBe("X");
    remove();
    expect(registry.get("acme.x")).toBeUndefined();
    expect(registry.register({ ...descriptor, id: RIGHT_PANEL_CONTAINER })).toBeTypeOf("function");
    expect(registry.get(RIGHT_PANEL_CONTAINER)?.extensionId).toBe("omnigent");
  });
});

describe("parseContributions: view containers, views and welcome", () => {
  it("reads viewsContainers by location, the views' new fields and viewsWelcome", () => {
    const { contributions, warnings } = parseContributions("acme.tools", {
      viewsContainers: {
        activitybar: [{ id: "acme.tools", title: "Tools", icon: "workflow" }],
        secondarySidebar: [{ id: "acme.tools.side", title: "Side" }],
        panel: [{ id: "acme.tools.bottom", title: "Bottom", icon: "nope" }],
        bottomBar: [{ id: "acme.tools.x", title: "X" }],
      },
      views: {
        "acme.tools": [
          {
            id: "acme.tools.list",
            name: "List",
            when: "acme.tools.ready",
            visibility: "collapsed",
            contextualTitle: "Tools list",
            initialSize: 2,
          },
          { id: "acme.tools.bad", name: "Bad", visibility: "sometimes", initialSize: -1 },
          { id: "acme.tools.react", name: "React", builtInView: "conversationList" },
        ],
      },
      viewsWelcome: [
        { view: "acme.tools.list", contents: "Nothing yet.\n[Add](command:acme.tools.add)" },
        { view: "acme.tools.list" },
      ],
      menus: {
        "viewContainer/title": [
          { command: "acme.tools.add", when: "viewContainer == acme.tools", group: "navigation" },
        ],
      },
    });
    expect(contributions.viewsContainers).toEqual([
      { id: "acme.tools", title: "Tools", icon: "workflow", location: "sidebar", order: 0 },
      { id: "acme.tools.side", title: "Side", icon: undefined, location: "auxiliarybar", order: 1 },
      { id: "acme.tools.bottom", title: "Bottom", icon: undefined, location: "panel", order: 2 },
    ]);
    const [list, bad, react] = contributions.views;
    expect(list).toMatchObject({
      containerId: "acme.tools",
      visibility: "collapsed",
      contextualTitle: "Tools list",
      initialSize: 2,
    });
    expect(list.when?.evaluate((key) => key === "acme.tools.ready")).toBe(true);
    expect(bad.visibility).toBeUndefined();
    expect(bad.initialSize).toBeUndefined();
    // A third-party extension can't name a host component.
    expect(react.builtInView).toBeUndefined();
    expect(contributions.viewsWelcome).toHaveLength(1);
    expect(contributions.viewsWelcome[0]).toMatchObject({ view: "acme.tools.list" });
    expect(contributions.viewContainerTitleMenu[0].command).toBe("acme.tools.add");
    expect(warnings).toEqual([
      expect.stringContaining('"visibility" must be'),
      expect.stringContaining('"initialSize" must be'),
      expect.stringContaining('"builtInView" is for built-in extensions'),
      expect.stringContaining("unknown icon"),
      expect.stringContaining('unknown location "bottomBar"'),
      expect.stringContaining('"contents" must be'),
    ]);
  });

  it("keeps container ids under the extension's and lets built-ins name host views", () => {
    const { contributions, warnings } = parseContributions(
      "omnigent.x",
      {
        viewsContainers: { activitybar: [{ id: "other.x", title: "Theirs" }] },
        views: {
          [CONVERSATIONS_CONTAINER]: [
            { id: "omnigent.x.nav", name: "Nav", builtInView: "navigation" },
            { id: "omnigent.x.no", name: "No", builtInView: "somethingElse" },
          ],
        },
      },
      { builtIn: true },
    );
    expect(contributions.viewsContainers).toEqual([]);
    expect(contributions.views.map((view) => view.builtInView)).toEqual(["navigation", undefined]);
    expect(warnings).toEqual([
      expect.stringContaining("unknown built-in view"),
      expect.stringContaining('"id" must be "omnigent.x" or "omnigent.x.<name>"'),
    ]);
  });
});

describe("ViewsService: containers, when and welcome", () => {
  function setup() {
    const registry = new RailViewRegistry();
    const containers = new ViewContainerRegistry(quiet);
    const contextKeys = new ContextKeyService();
    const commands = new CommandRegistry();
    const views = testViewsService(commands, { registry, containers, contextKeys });
    return { registry, containers, contextKeys, views };
  }

  it("registers an extension's containers and its views in them, refusing unknown ones", () => {
    const { registry, containers, views } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { contributions } = parseContributions("acme.tools", {
      viewsContainers: { activitybar: [{ id: "acme.tools", title: "Tools" }] },
      views: {
        "acme.tools": [{ id: "acme.tools.list", name: "List" }],
        "acme.nowhere": [{ id: "acme.tools.lost", name: "Lost" }],
        [RIGHT_PANEL_CONTAINER]: [{ id: "acme.tools.tab", name: "Tab" }],
      },
    });
    const remove = views.addExtension("acme.tools", contributions);
    expect(containers.get("acme.tools")).toMatchObject({ location: "sidebar", builtIn: false });
    expect(registry.get("acme.tools.list")?.containerId).toBe("acme.tools");
    expect(registry.get("acme.tools.tab")?.containerId).toBe(RIGHT_PANEL_CONTAINER);
    expect(registry.get("acme.tools.lost")).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown view container "acme.nowhere"'),
    );
    remove();
    expect(containers.get("acme.tools")).toBeUndefined();
    expect(registry.get("acme.tools.list")).toBeUndefined();
    warn.mockRestore();
  });

  it("follows the context keys for a view's when, its welcome and its container's title actions", () => {
    const { registry, containers, contextKeys, views } = setup();
    const { contributions } = parseContributions("acme.tools", {
      viewsContainers: { activitybar: [{ id: "acme.tools", title: "Tools" }] },
      views: { "acme.tools": [{ id: "acme.tools.list", name: "List", when: "acme.tools.on" }] },
      viewsWelcome: [
        { view: "acme.tools.list", contents: "Always" },
        { view: "acme.tools.list", contents: "Signed out", when: "!acme.tools.signedIn" },
      ],
      commands: [{ command: "acme.tools.add", title: "Add", icon: "plus" }],
      menus: {
        "viewContainer/title": [
          { command: "acme.tools.add", when: "viewContainer == acme.tools", group: "navigation" },
        ],
      },
    });
    views.addExtension("acme.tools", contributions);
    expect(registry.get("acme.tools.list")?.active).toBe(false);
    expect(registry.get("acme.tools.list")?.welcome.map((block) => block.contents)).toEqual([
      "Always",
      "Signed out",
    ]);
    expect(containers.actionsOf("acme.tools").map((action) => [action.id, action.icon])).toEqual([
      ["acme.tools.add", "plus"],
    ]);
    expect(containers.actionsOf(RIGHT_PANEL_CONTAINER)).toEqual([]);
    contextKeys.set("acme.tools.on", true);
    contextKeys.set("acme.tools.signedIn", true);
    expect(registry.get("acme.tools.list")?.active).toBe(true);
    expect(registry.get("acme.tools.list")?.welcome.map((block) => block.contents)).toEqual([
      "Always",
    ]);
  });

  it("sets view.<id>.visible while a drawn copy of the view is on screen", () => {
    const { registry, contextKeys, views } = setup();
    const { contributions } = parseContributions("acme.tools", {
      views: { [RIGHT_PANEL_CONTAINER]: [{ id: "acme.tools.tab", name: "Tab" }] },
    });
    views.addExtension("acme.tools", contributions);
    const host = registry.get("acme.tools.tab")?.host;
    const first = host?.reportVisible();
    const second = host?.reportVisible();
    expect(contextKeys.get("view.acme.tools.tab.visible")).toBe(true);
    first?.();
    expect(contextKeys.get("view.acme.tools.tab.visible")).toBe(true);
    second?.();
    expect(contextKeys.get("view.acme.tools.tab.visible")).toBeUndefined();
  });
});
