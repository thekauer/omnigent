// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ContextKeyService } from "./contextKeys";
import { parseContributions } from "./contributions";
import { MAX_WHEN_DEPTH, MAX_WHEN_LENGTH, parseWhen } from "./when";

const lookup =
  (values: Record<string, unknown>) =>
  (key: string): unknown =>
    values[key];

describe("parseWhen", () => {
  it.each([
    ["view == pub.ext.view", { view: "pub.ext.view" }, true],
    ["view == pub.ext.view", { view: "other" }, false],
    ["view != pub.ext.view", { view: "other" }, true],
    ["view == 'pub.ext.view'", { view: "pub.ext.view" }, true],
    ['mode == "tree"', { mode: "tree" }, true],
    ["mode === tree", { mode: "tree" }, true],
    ["flag", { flag: true }, true],
    ["flag", { flag: 0 }, false],
    ["!flag", {}, true],
    ["!!flag", { flag: "x" }, true],
    ["flag == true", { flag: true }, true],
    ["flag == true", { flag: "true" }, false],
    ["count == 2", { count: 2 }, true],
    ["missing == x", {}, false],
    ["missing != x", {}, true],
    ["a && b", { a: true, b: true }, true],
    ["a && b", { a: true }, false],
    ["a || b", { b: 1 }, true],
    // && binds tighter than ||.
    ["a || b && c", { a: true }, true],
    ["a || b && c", { b: true }, false],
    ["(a || b) && c", { a: true }, false],
    ["!a && b", { b: true }, true],
    [
      "view == pub.ext.view && pub.ext.mode == list",
      { view: "pub.ext.view", "pub.ext.mode": "list" },
      true,
    ],
    ["true", {}, true],
    ["false || x", { x: true }, true],
  ])("%s with %j is %s", (source, values, expected) => {
    expect(parseWhen(source).evaluate(lookup(values))).toBe(expected);
  });

  it("lists the keys it reads", () => {
    expect(parseWhen("view == a && (!b || c != d)").keys).toEqual(["view", "b", "c"]);
  });

  it.each(["", "a &&", "== b", "(a", "a b", "a == 'x", "a || || b", "a == )"])(
    "refuses %j",
    (source) => {
      expect(() => parseWhen(source)).toThrow(SyntaxError);
    },
  );
});

describe("ContextKeyService", () => {
  it("stores values, fires on real changes and removes keys", () => {
    const keys = new ContextKeyService();
    const changed = vi.fn();
    keys.onDidChange(changed);
    keys.set("pub.ext.mode", "tree");
    keys.set("pub.ext.mode", "tree");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(keys.get("pub.ext.mode")).toBe("tree");
    keys.set("list", ["a", 1]);
    expect(Object.isFrozen(keys.get("list"))).toBe(true);
    keys.set("pub.ext.mode", undefined);
    expect(keys.get("pub.ext.mode")).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("refuses bad keys and values", () => {
    const keys = new ContextKeyService();
    expect(() => keys.set("bad key", 1)).toThrow(TypeError);
    expect(() => keys.set(3, 1)).toThrow(TypeError);
    expect(() => keys.set("k", { a: 1 })).toThrow(TypeError);
    expect(() => keys.set("k", Number.NaN)).toThrow(TypeError);
  });

  it("looks up overrides such as `view` first", () => {
    const keys = new ContextKeyService();
    keys.set("view", "global");
    keys.set("mode", "list");
    const read = keys.lookup({ view: "pub.ext.view" });
    expect(read("view")).toBe("pub.ext.view");
    expect(read("mode")).toBe("list");
  });
});

describe("parseContributions", () => {
  it("reads views, commands and view/title menus", () => {
    const { contributions, warnings } = parseContributions("pub.ext", {
      views: {
        "omnigent.rightPanel": [{ id: "pub.ext.view", name: " Changes 2 ", icon: "git-compare" }],
      },
      commands: [
        { command: "pub.ext.toggle", title: "Toggle", icon: "list-tree", toggled: "mode == tree" },
      ],
      menus: {
        "view/title": [
          { command: "pub.ext.toggle", when: "view == pub.ext.view", group: "navigation" },
        ],
      },
    });
    expect(warnings).toEqual([]);
    expect(contributions.views).toEqual([
      { id: "pub.ext.view", name: "Changes 2", icon: "git-compare", order: 0 },
    ]);
    expect(contributions.commands[0]).toMatchObject({
      command: "pub.ext.toggle",
      icon: "list-tree",
    });
    expect(contributions.commands[0].toggled?.evaluate(lookup({ mode: "tree" }))).toBe(true);
    expect(contributions.viewTitleMenu[0].when?.evaluate(lookup({ view: "pub.ext.view" }))).toBe(
      true,
    );
  });

  it("warns about each problem and keeps the rest", () => {
    const { contributions, warnings } = parseContributions("pub.ext", {
      views: {
        "omnigent.rightPanel": [
          { id: "other.ext.view", name: "Not mine" },
          { id: "pub.ext.noname" },
          { id: "pub.ext.ok", name: "OK", icon: "no-such-icon" },
          { id: "pub.ext.ok", name: "Again" },
        ],
        "omnigent.leftPanel": [],
      },
      commands: [{ command: "pub.ext.c" }],
      menus: { "view/title": [{ command: "pub.ext.c", when: "a &&" }], "view/item/context": [] },
    });
    expect(contributions.views.map((view) => [view.id, view.icon])).toEqual([
      ["pub.ext.ok", undefined],
    ]);
    expect(contributions.commands).toEqual([]);
    // An invalid when clause never holds.
    expect(contributions.viewTitleMenu[0].when?.evaluate(() => true)).toBe(false);
    expect(warnings).toHaveLength(8);
  });

  it("accepts a manifest without contributions and refuses a non-object", () => {
    expect(parseContributions("pub.ext", undefined).warnings).toEqual([]);
    expect(parseContributions("pub.ext", []).warnings).toEqual(['"contributes" must be an object']);
  });
});

describe("when clause limits", () => {
  it("refuses clauses that are too long or nested too deep", () => {
    expect(() => parseWhen(`a == ${"x".repeat(MAX_WHEN_LENGTH)}`)).toThrow(/longer than/);
    expect(() =>
      parseWhen(`${"(".repeat(MAX_WHEN_DEPTH + 1)}a${")".repeat(MAX_WHEN_DEPTH + 1)}`),
    ).toThrow(/nested deeper/);
    expect(() => parseWhen(`${"!".repeat(MAX_WHEN_DEPTH + 1)}a`)).toThrow(/nested deeper/);
    expect(
      parseWhen(`${"(".repeat(MAX_WHEN_DEPTH)}a${")".repeat(MAX_WHEN_DEPTH)}`).evaluate(() => true),
    ).toBe(true);
  });

  it("negates a comparison as a whole", () => {
    const clause = parseWhen("!mode == tree");
    expect(clause.evaluate((key) => (key === "mode" ? "tree" : undefined))).toBe(false);
    expect(clause.evaluate((key) => (key === "mode" ? "list" : undefined))).toBe(true);
  });
});

describe("parseContributions: built-in tabs, filters and submenus", () => {
  it("reads a built-in view's tab and filter, and submenus with their entries", () => {
    const { contributions, warnings } = parseContributions(
      "omnigent.x",
      {
        views: {
          "omnigent.rightPanel": [
            {
              id: "omnigent.x.view",
              name: "X",
              builtInTab: "changes",
              filter: { placeholder: "Find" },
            },
          ],
        },
        submenus: [{ id: "omnigent.x.sort", label: "Sort", icon: "arrow-down-up" }],
        menus: {
          "view/title": [
            { submenu: "omnigent.x.sort", group: "filter" },
            { command: "omnigent.x.a", group: "filter", tone: "warning", tooltip: "Careful" },
          ],
          "omnigent.x.sort": [{ command: "omnigent.x.a" }],
        },
      },
      { builtIn: true, builtInTabs: ["changes", "files"] },
    );
    expect(warnings).toEqual([]);
    expect(contributions.views[0]).toMatchObject({
      builtInTab: "changes",
      filter: { placeholder: "Find", ariaLabel: "Find" },
    });
    expect(contributions.submenus).toEqual([
      expect.objectContaining({
        id: "omnigent.x.sort",
        label: "Sort",
        items: [expect.objectContaining({ command: "omnigent.x.a" })],
      }),
    ]);
    expect(contributions.viewTitleMenu).toEqual([
      expect.objectContaining({ submenu: "omnigent.x.sort", command: "", group: "filter" }),
      expect.objectContaining({ command: "omnigent.x.a", tone: "warning", tooltip: "Careful" }),
    ]);
  });

  it("keeps built-in tabs for built-in extensions, and warns about bad entries", () => {
    const { contributions, warnings } = parseContributions("pub.ext", {
      views: {
        "omnigent.rightPanel": [{ id: "pub.ext.v", name: "V", builtInTab: "changes", filter: {} }],
      },
      submenus: [{ id: "pub.ext.s" }],
      menus: {
        "view/title": [{ submenu: "pub.ext.missing" }, { command: "pub.ext.c", tone: "loud" }],
      },
    });
    expect(contributions.views[0].builtInTab).toBeUndefined();
    expect(contributions.views[0].filter).toBeUndefined();
    expect(warnings).toEqual([
      expect.stringContaining('"builtInTab" is for built-in extensions'),
      expect.stringContaining('"filter.placeholder" must be a non-empty string'),
      expect.stringContaining('"label" must be a non-empty string'),
      expect.stringContaining("unknown submenu"),
      expect.stringContaining('"tone" must be "warning"'),
    ]);
  });
});
