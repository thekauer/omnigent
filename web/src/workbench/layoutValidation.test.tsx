// The L6-L8 validation's adversarial cases, each asserting the fixed behaviour.
import { act, cleanup, render, renderHook } from "@testing-library/react";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface ToastOptions {
  readonly toasterId?: string;
  readonly action: { readonly onClick: () => void };
}
const toastCalls: { message: unknown; options: ToastOptions }[] = [];
vi.mock("sonner", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const record = (message: unknown, options?: unknown) =>
    toastCalls.push({ message, options: options as ToastOptions });
  const toast = Object.assign(record, {
    success: record,
    warning: record,
    error: record,
    info: record,
    message: record,
    dismiss: () => {},
  });
  return { ...actual, toast };
});

import { CommandRegistry } from "@/vscodeExtensions/commands";
import { ContextKeyService } from "@/vscodeExtensions/contextKeys";
import { parseContributions } from "@/vscodeExtensions/contributions";
import { ViewsService } from "@/vscodeExtensions/viewsService";
import { sanitizeMarkdown } from "@/configuration/configurationContributions";
import { LayoutService } from "@/workbench/layoutService";
import { LAYOUT_SLOTS, layoutState } from "@/workbench/layoutState";
import { focusedViewId, resetLayout } from "@/workbench/layoutCommands";
import { productLayout } from "@/workbench/productLayout";
import { ViewContainerRegistry, viewContainers } from "@/workbench/viewContainers";
import { generatedContainerId, moveView, viewContainerFor } from "@/workbench/viewLocations";
import {
  activateWorkbenchScope,
  createWorkbenchScope,
  releaseWorkbenchScope,
} from "@/workbench/workbenchScope";
import {
  mergeProductConfigs,
  parseProductSettings,
  PRODUCT_SETTINGS_MAX_CHARS,
} from "@/product/productConfig";
import { registerNavigationCommands, setShellNavigator } from "@/workbench/navigationCommands";
import {
  type ContributedTitleBarEntry,
  MAX_TITLE_BAR_ITEMS_PER_EXTENSION,
  TitleBarItemRegistry,
} from "@/workbench/titleBar";
import { RailViewRegistry, viewsOfContainer } from "@/shell/railViews";
import { useSideBarContainers, ViewContainerViews } from "@/shell/ViewContainerViews";
import { useViewDropTarget } from "@/shell/viewMoves";

const removals: (() => void)[] = [];
beforeEach(() => {
  localStorage.clear();
  layoutState.reset();
  toastCalls.length = 0;
  for (const id of ["acme.tools", "acme.other"]) {
    removals.push(
      viewContainers.register({
        id,
        title: id,
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
  for (const r of removals.splice(0)) r();
  productLayout.set(null);
});

function setup(registry = new RailViewRegistry()) {
  const views = new ViewsService({
    registry,
    containers: new ViewContainerRegistry({ warn: () => {} }),
    contextKeys: new ContextKeyService(),
    executeCommand: async () => undefined,
    showError: () => {},
  });
  const { contributions } = parseContributions("acme.tools", {
    viewsContainers: { activitybar: [{ id: "acme.tools", title: "Tools" }] },
    views: { "acme.tools": [{ id: "acme.tools.list", name: "Things" }] },
  });
  views.addExtension("acme.tools", contributions);
  views.extensionSettled("acme.tools");
  return { registry };
}
const paneIds = (c: HTMLElement) =>
  [...c.querySelectorAll("[data-view]")].map((p) => p.getAttribute("data-view"));

describe("hiddenContainers holds for the container's views wherever they go", () => {
  it("a view of a product-hidden container can't move, and isn't drawn where a move put it", () => {
    const { registry } = setup();
    const view = registry.get("acme.tools.list")!;
    expect(moveView(view, "acme.other")).toBe(true);
    productLayout.set({ hiddenContainers: ["acme.tools"] });
    const other = render(<ViewContainerViews containerId="acme.other" registry={registry} />);
    expect(paneIds(other.container)).toEqual([]);
    expect(moveView(view, generatedContainerId(view.id))).toBe(false);
  });
  it("a forged layout state makes no generated side bar entry for it", () => {
    const { registry } = setup();
    productLayout.set({ hiddenContainers: ["acme.tools"] });
    layoutState.set(LAYOUT_SLOTS.viewLocations, {
      "acme.tools.list": generatedContainerId("acme.tools.list"),
    });
    const { result } = renderHook(() => useSideBarContainers(registry));
    const ids = result.current.map(({ container }) => container.id);
    expect(ids).not.toContain(generatedContainerId("acme.tools.list"));
  });
  it("a view can't move into a container the product removed", () => {
    const { registry } = setup();
    productLayout.set({ hiddenContainers: ["acme.other"] });
    expect(moveView(registry.get("acme.tools.list")!, "acme.other")).toBe(false);
    layoutState.set(LAYOUT_SLOTS.viewLocations, { "acme.tools.list": "acme.other" });
    expect(
      viewContainerFor(registry.get("acme.tools.list")!, { "acme.tools.list": "acme.other" }),
    ).toBe("acme.tools");
  });
  it("a stored move into a container that disappeared falls back", () => {
    const { registry } = setup();
    const view = registry.get("acme.tools.list")!;
    expect(viewContainerFor(view, { "acme.tools.list": "gone.container" })).toBe("acme.tools");
    expect(viewContainerFor(view, { "acme.tools.list": "" } as never)).toBe("acme.tools");
  });
  it("a container's views follow a later change to the product's removed views", () => {
    const { registry } = setup();
    const snapshot = registry.getSnapshot();
    const ids = () => viewsOfContainer(snapshot, "acme.tools").views.map((view) => view.id);
    expect(ids()).toEqual(["acme.tools.list"]);
    productLayout.set({ hiddenViews: ["acme.tools.list"] });
    expect(ids()).toEqual([]);
    productLayout.set(null);
    expect(ids()).toEqual(["acme.tools.list"]);
  });
  it("hiddenViews still wins over a forged views layout", () => {
    const { registry } = setup();
    productLayout.set({ hiddenViews: ["acme.*"] });
    layoutState.set(LAYOUT_SLOTS.views, { "acme.tools.list": { hidden: false } });
    const own = render(<ViewContainerViews containerId="acme.tools" registry={registry} />);
    expect(paneIds(own.container)).toEqual([]);
  });
});

describe("drag from outside", () => {
  it("refuses a foreign drag claiming a view id", () => {
    setup();
    let props!: ReturnType<typeof useViewDropTarget>;
    function T() {
      props = useViewDropTarget(() => "acme.other");
      return null;
    }
    render(<T />);
    const dt = {
      types: ["application/vnd.omnigent.view"],
      getData: () => "acme.tools.list",
      dropEffect: "none",
    };
    let prevented = false;
    act(() =>
      props.onDrop({
        dataTransfer: dt,
        preventDefault: () => (prevented = true),
        stopPropagation: () => {},
      } as unknown as Parameters<typeof props.onDrop>[0]),
    );
    expect(prevented).toBe(false);
    expect(layoutState.get(LAYOUT_SLOTS.viewLocations)).toBeUndefined();
  });
});

const UNSAFE = new Set(["image", "imageReference", "html", "definition"]);
function unsafeNodes(markdown: string): string[] {
  const found: string[] = [];
  const walk = (node: { type: string; children?: unknown[] }) => {
    if (UNSAFE.has(node.type)) found.push(node.type);
    for (const child of node.children ?? []) walk(child as { type: string; children?: unknown[] });
  };
  walk(unified().use(remarkParse).parse(markdown) as { type: string; children?: unknown[] });
  return found;
}

describe("the markdown sanitizer against the re-attack", () => {
  const cases = [
    "!<b>[x](https://evil.example/p.png)",
    "!<span></span>[x](https://evil.example/p.png)",
    "<<img>img src=https://evil.example/p.png>",
    "!<br/>[x][r]\n\n[r]<b>: https://evil.example/q.png",
    "&#33;[x](https://evil.example/e.png)",
    "!\\[x](https://evil.example/n.png)",
    "> [r]: https://evil.example/bq.png\n\n!\\[x][r]",
  ];
  for (const input of cases) {
    it(`leaves no image, tag or definition in ${JSON.stringify(input)}`, () => {
      expect(unsafeNodes(sanitizeMarkdown(input))).toEqual([]);
    });
  }
  it("escapes rather than strips, so stripping can't re-form an image", () => {
    expect(sanitizeMarkdown("!<b>[x](https://evil.example/p.png)")).toBe(
      "\\!\\<b>[x](https://evil.example/p.png)",
    );
    expect(sanitizeMarkdown("<<img>img src=https://evil.example/p.png>")).toBe(
      "\\<\\<img>img src=https://evil.example/p.png>",
    );
  });
  it("keeps code spans as written", () => {
    expect(sanitizeMarkdown("`![code](span)`")).toBe("`![code](span)`");
  });
});

describe("Reset Layout's undo across mounts", () => {
  it("the undo restores the mount that was reset, whichever is active by then, in its own toaster", () => {
    const a = createWorkbenchScope("/a");
    const b = createWorkbenchScope("/b");
    activateWorkbenchScope(a);
    a.state.set(LAYOUT_SLOTS.activityBar, { hidden: ["x"] });
    resetLayout(new LayoutService(layoutState), layoutState);
    expect(a.state.get(LAYOUT_SLOTS.activityBar)).toBeUndefined();
    const call = toastCalls.find((c) => c.message === "Layout reset")!;
    expect(call.options.toasterId).toBe(a.toasterId);
    activateWorkbenchScope(b);
    call.options.action.onClick();
    expect(a.state.get(LAYOUT_SLOTS.activityBar)).toEqual({ hidden: ["x"] });
    expect(b.state.get(LAYOUT_SLOTS.activityBar)).toBeUndefined();
    releaseWorkbenchScope(a);
    releaseWorkbenchScope(b);
  });
});

describe("menus squatting (title bar, navigation)", () => {
  it("another extension's never-shown entry for a command blocks the owner's own", () => {
    const titleBar: ContributedTitleBarEntry[] = [];
    const nav: { extensionId: string; active: boolean }[] = [];
    const views = new ViewsService({
      registry: new RailViewRegistry(),
      containers: new ViewContainerRegistry({ warn: () => {} }),
      contextKeys: new ContextKeyService(),
      executeCommand: async () => undefined,
      showError: () => {},
      titleBar: { set: (e) => titleBar.splice(0, titleBar.length, ...e) },
      navigation: { set: (e) => nav.splice(0, nav.length, ...e) },
    });
    const evil = parseContributions("evil.ext", {
      menus: {
        "titleBar/right": [{ command: "good.ext.run", when: "false" }],
        "sidebar/navigation": [{ command: "good.ext.run", when: "false" }],
      },
    });
    views.addExtension("evil.ext", evil.contributions);
    views.extensionSettled("evil.ext");
    const good = parseContributions("good.ext", {
      commands: [{ command: "good.ext.run", title: "Run" }],
      menus: {
        "titleBar/right": [{ command: "good.ext.run" }],
        "sidebar/navigation": [{ command: "good.ext.run" }],
      },
    });
    views.addExtension("good.ext", good.contributions);
    views.extensionSettled("good.ext");
    expect(titleBar.map((e) => [e.extensionId, e.active])).toEqual([["good.ext", true]]);
    expect(nav.map((e) => [e.extensionId, e.active])).toEqual([["good.ext", true]]);
  });
  it("a title bar entry for another's command doesn't carry its contributor's tooltip", () => {
    const titleBar: ContributedTitleBarEntry[] = [];
    const views = new ViewsService({
      registry: new RailViewRegistry(),
      containers: new ViewContainerRegistry({ warn: () => {} }),
      contextKeys: new ContextKeyService(),
      executeCommand: async () => undefined,
      showError: () => {},
      titleBar: { set: (e) => titleBar.splice(0, titleBar.length, ...e) },
    });
    const evil = parseContributions("evil.ext", {
      menus: {
        "titleBar/right": [
          { command: "workbench.action.resetViewLocations", tooltip: "Open help" },
        ],
      },
    });
    views.addExtension("evil.ext", evil.contributions);
    views.extensionSettled("evil.ext");
    expect(titleBar[0]?.tooltip).toBeUndefined();
  });
  it("a shorter extension id doesn't own a longer loaded extension's commands", () => {
    const titleBar: ContributedTitleBarEntry[] = [];
    const views = new ViewsService({
      registry: new RailViewRegistry(),
      containers: new ViewContainerRegistry({ warn: () => {} }),
      contextKeys: new ContextKeyService(),
      executeCommand: async () => undefined,
      showError: () => {},
      titleBar: { set: (e) => titleBar.splice(0, titleBar.length, ...e) },
    });
    const squatter = parseContributions("acme.tools", {
      commands: [{ command: "acme.tools.admin.run", title: "Click to unlock" }],
      menus: { "titleBar/right": [{ command: "acme.tools.admin.run", tooltip: "Unlock" }] },
    });
    views.addExtension("acme.tools", squatter.contributions);
    views.extensionSettled("acme.tools");
    const owner = parseContributions("acme.tools.admin", {
      commands: [{ command: "acme.tools.admin.run", title: "Run" }],
      menus: {
        "titleBar/right": [{ command: "acme.tools.admin.run", tooltip: "Run it", when: "false" }],
      },
    });
    views.addExtension("acme.tools.admin", owner.contributions);
    views.extensionSettled("acme.tools.admin");
    // The squatter's shown entry draws, but in the owner's words.
    expect(titleBar.map((e) => [e.extensionId, e.title, e.tooltip])).toEqual([
      ["acme.tools", "Run", undefined],
    ]);
  });
  it("an extension's title bar menu entries are capped", () => {
    const titleBar: ContributedTitleBarEntry[] = [];
    const views = new ViewsService({
      registry: new RailViewRegistry(),
      containers: new ViewContainerRegistry({ warn: () => {} }),
      contextKeys: new ContextKeyService(),
      executeCommand: async () => undefined,
      showError: () => {},
      titleBar: { set: (e) => titleBar.splice(0, titleBar.length, ...e) },
    });
    const many = parseContributions("acme.tools", {
      commands: Array.from({ length: 40 }, (_, i) => ({
        command: `acme.tools.c${i}`,
        title: `C${i}`,
      })),
      menus: {
        "titleBar/left": Array.from({ length: 40 }, (_, i) => ({ command: `acme.tools.c${i}` })),
      },
    });
    views.addExtension("acme.tools", many.contributions);
    views.extensionSettled("acme.tools");
    expect(titleBar.length).toBe(MAX_TITLE_BAR_ITEMS_PER_EXTENSION);
  });
  it("a third party's builtInItem is refused", () => {
    const evil = parseContributions("evil.ext", {
      menus: { "titleBar/left": [{ builtInItem: "account" }] },
    });
    expect(evil.contributions.titleBarMenu).toEqual([]);
  });
});

describe("title bar items", () => {
  it("an extension's items are capped", () => {
    const reg = new TitleBarItemRegistry();
    for (let i = 0; i < 5000; i++) {
      const item = reg.create("evil.ext", undefined, "center", i);
      item.text = "x".repeat(1000) + "\n<b>y</b>";
      item.show();
    }
    const center = reg.getSnapshot().get("center")!;
    expect(center.length).toBe(MAX_TITLE_BAR_ITEMS_PER_EXTENSION);
    expect([...center[0]!.text].length).toBeLessThanOrEqual(40);
    // Another extension still gets its own.
    const other = reg.create("good.ext", "x", "center", 0);
    other.text = "ok";
    other.show();
    expect(
      reg
        .getSnapshot()
        .get("center")!
        .some((item) => item.key === "good.ext:x"),
    ).toBe(true);
  });
  it("a stale handle disposed again frees no live item's slot", () => {
    const reg = new TitleBarItemRegistry();
    for (let round = 0; round < 100; round++) {
      const stale = reg.create("evil.ext", `k${round}`, "center", 0);
      stale.dispose();
      const live = reg.create("evil.ext", `k${round}`, "center", 0);
      live.text = "live";
      live.command = "evil.ext.run";
      live.show();
      stale.dispose();
      stale.command = "evil.ext.other";
    }
    for (let extra = 0; extra < 20; extra++) {
      const item = reg.create("evil.ext", `extra${extra}`, "center", 0);
      item.text = "extra";
      item.show();
    }
    const center = reg.getSnapshot().get("center")!;
    expect(center.length).toBe(MAX_TITLE_BAR_ITEMS_PER_EXTENSION);
    expect(center.every((item) => item.command?.command !== "evil.ext.other")).toBe(true);
  });
  it("id collisions across extensions and regions", () => {
    const reg = new TitleBarItemRegistry();
    const a = reg.create("a", "b.x", "left", 0);
    const b = reg.create("a.b", "x", "right", 0);
    expect([a.id, b.id]).toEqual(["a:b.x", "a.b:x"]);
  });
  it("args are copied", () => {
    const reg = new TitleBarItemRegistry();
    const item = reg.create("a", "i", "left", 0);
    const args = [{ n: 1 }];
    item.command = { command: "a.run", title: "", arguments: args } as never;
    args[0]!.n = 2;
    item.text = "t";
    item.show();
    expect(reg.getSnapshot().get("left")![0]!.command!.arguments).toEqual([{ n: 1 }]);
  });
});

describe("L8 product config", () => {
  it("the hidden lists add up across sources, and no source unlocks view locations", () => {
    const merged = mergeProductConfigs([
      { layout: { hiddenViews: ["a"], lockViewLocations: false } },
      undefined,
      {
        layout: {
          hiddenViews: ["b", "c"],
          hiddenParts: ["workbench.parts.sidebar"],
          lockViewLocations: true,
        },
      },
    ]);
    expect(merged.layout!.hiddenViews).toEqual(["a", "b", "c"]);
    expect(merged.layout!.hiddenParts).toEqual(["workbench.parts.sidebar"]);
    expect(merged.layout!.lockViewLocations).toBe(true);
  });
  it("a lock that is invalid and past the budget still locks its key", () => {
    const n = PRODUCT_SETTINGS_MAX_CHARS - 7 - 2 - 2;
    let deep: unknown = 1;
    for (let i = 0; i < 12; i++) deep = [deep];
    const parsed = parseProductSettings(
      { locked: { "a.big": "x".repeat(n), "b.key": deep } },
      "test",
    );
    expect(parsed?.lockedInvalid ?? []).toContain("b.key");
  });
  it("locks past the entry limit still lock their keys; defaults past it go", () => {
    const many = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, index) => [`acme.k${index}`, true]));
    const parsed = parseProductSettings({ locked: many(501), defaults: many(501) }, "test");
    expect(Object.keys(parsed?.locked ?? {})).toHaveLength(500);
    expect(parsed?.lockedInvalid).toEqual(["acme.k500"]);
    expect(Object.keys(parsed?.defaults ?? {})).toHaveLength(500);
    // The server's list of such keys reads back whole.
    const served = parseProductSettings(
      { lockedInvalid: Array.from({ length: 600 }, (_, index) => `acme.k${index}`) },
      "test",
    );
    expect(served?.lockedInvalid).toHaveLength(600);
  });
  it("a navigation entry the product removed doesn't run", () => {
    productLayout.set({ hiddenViews: ["omnigent.openAutomations"] });
    const commands = new CommandRegistry();
    const reg = registerNavigationCommands(commands);
    const nav = vi.fn();
    const restore = setShellNavigator(nav);
    void commands.execute("omnigent.openAutomations", [], () => {});
    expect(nav).not.toHaveBeenCalled();
    restore();
    reg.dispose();
  });
});

describe("Move Focused View", () => {
  it("finds a built-in view by its drawn element", () => {
    const { container } = render(
      <div data-view="omnigent.conversations.list">
        <button type="button">row</button>
      </div>,
    );
    container.querySelector("button")!.focus();
    expect(focusedViewId()).toBe("omnigent.conversations.list");
  });
});
