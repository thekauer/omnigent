import { describe, expect, it, vi } from "vitest";
import { createExtensionApi } from "@/vscodeExtensions/api";
import { parseContributions } from "@/vscodeExtensions/contributions";
import { hostServices } from "@/vscodeExtensions/testServices";
import {
  builtInTitleBarEntries,
  compareTitleBarEntries,
  TitleBarItemRegistry,
  titleBarItemCommandOf,
} from "./titleBar";

describe("the title bar's menus", () => {
  it("are the built-in workbench extension's items, by region, gated by their settings", () => {
    expect(
      builtInTitleBarEntries().map((entry) => [
        entry.region,
        entry.builtInItem,
        entry.when?.source,
      ]),
    ).toEqual([
      ["left", "brand", undefined],
      ["center", "commandCenter", "config.window.commandCenter"],
      ["right", "layoutControls", "config.workbench.layoutControl.enabled"],
      ["right", "account", undefined],
    ]);
  });

  it("parse an extension's command entries per region; builtInItem is a built-in's only", () => {
    const { contributions, warnings } = parseContributions("acme.tools", {
      menus: {
        "titleBar/left": [{ command: "acme.tools.run", when: "acme.on" }],
        "titleBar/right": [{ builtInItem: "brand" }, { command: "acme.tools.other" }],
      },
    });
    expect(contributions.titleBarMenu.map((item) => [item.region, item.command])).toEqual([
      ["left", "acme.tools.run"],
      ["right", "acme.tools.other"],
    ]);
    expect(warnings.join("\n")).toContain('"builtInItem" is for built-in extensions');
    const builtIn = parseContributions(
      "omnigent.workbench",
      { menus: { "titleBar/left": [{ builtInItem: "nope" }] } },
      { builtIn: true },
    );
    expect(builtIn.contributions.titleBarMenu).toEqual([]);
    expect(builtIn.warnings.join("\n")).toContain('unknown "builtInItem"');
  });
});

describe("title bar items", () => {
  it("keep their region, text and command, shown in priority order", () => {
    const registry = new TitleBarItemRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const low = registry.create("acme.tools", "low", "center", 1);
    const high = registry.create("acme.tools", "high", "center", 5);
    const elsewhere = registry.create("acme.tools", undefined, "nowhere", undefined);
    expect(elsewhere.region).toBe("right");
    low.text = "Low";
    high.text = "High";
    high.command = { command: "acme.tools.run", arguments: [1] };
    low.show();
    high.show();
    expect(
      registry
        .getSnapshot()
        .get("center")!
        .map((item) => [item.text, item.command?.command]),
    ).toEqual([
      ["High", "acme.tools.run"],
      ["Low", undefined],
    ]);
    high.dispose();
    expect(
      registry
        .getSnapshot()
        .get("center")!
        .map((item) => item.text),
    ).toEqual(["Low"]);
    expect(listener).toHaveBeenCalled();
  });

  it("are unique across the regions, so each keeps its own command", () => {
    const registry = new TitleBarItemRegistry();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const left = registry.create("acme.tools", "x", "left", 0);
    const right = registry.create("acme.tools", "x", "right", 0);
    expect(left.id).not.toBe(right.id);
    for (const [item, command] of [
      [left, "acme.left"],
      [right, "acme.right"],
    ] as const) {
      item.text = command;
      item.command = command;
      item.show();
    }
    left.dispose();
    expect(registry.getSnapshot().get("right")?.[0]?.command?.command).toBe("acme.right");
    vi.restoreAllMocks();
  });

  it("order contributed buttons by group, navigation first, then @order", () => {
    const sorted = [
      { group: "z" },
      { group: undefined },
      { group: "navigation@2" },
      { group: "navigation@1" },
    ].sort(compareTitleBarEntries);
    expect(sorted.map((entry) => entry.group)).toEqual([
      "navigation@1",
      "navigation@2",
      "z",
      undefined,
    ]);
  });

  it("take a command id or a Command, and drop anything else", () => {
    expect(titleBarItemCommandOf("acme.run")).toEqual({ command: "acme.run", arguments: [] });
    expect(titleBarItemCommandOf({ command: "acme.run", arguments: ["a"] })).toEqual({
      command: "acme.run",
      arguments: ["a"],
    });
    expect(titleBarItemCommandOf("")).toBeUndefined();
    expect(titleBarItemCommandOf({ arguments: [] })).toBeUndefined();
    expect(titleBarItemCommandOf(3)).toBeUndefined();
  });

  it("are what window.createTitleBarItem makes, removed when the extension stops", () => {
    const titleBarItems = new TitleBarItemRegistry();
    const services = hostServices({ titleBarItems });
    const handle = createExtensionApi("acme.tools", services, vi.fn());
    const item = handle.api.window.createTitleBarItem("cost", "left", 2);
    expect(item.id).toBe("acme.tools:cost");
    item.text = "$1.20";
    item.show();
    expect(titleBarItems.getSnapshot().get("left")?.[0]?.text).toBe("$1.20");
    handle.dispose();
    expect(titleBarItems.getSnapshot().get("left")).toBeUndefined();
  });
});
