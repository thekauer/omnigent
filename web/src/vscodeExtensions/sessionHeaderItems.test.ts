// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  MAX_HEADER_ITEM_TEXT_LENGTH,
  MAX_HEADER_ITEM_TOOLTIP_LENGTH,
  SessionHeaderItemAlignment,
  SessionHeaderItemRegistry,
  boundText,
} from "./sessionHeaderItems";

const { Left, Right } = SessionHeaderItemAlignment;

function keys(registry: SessionHeaderItemRegistry): string[] {
  return registry.getSnapshot().map((item) => item.key);
}

describe("SessionHeaderItemRegistry", () => {
  it("shows an item only after show() and once it has text", () => {
    const registry = new SessionHeaderItemRegistry();
    const item = registry.create("pub.ext", "cost", Right, 1);
    expect(item.id).toBe("pub.ext.cost");
    item.show();
    expect(keys(registry)).toEqual([]);
    item.text = "$1.00";
    expect(registry.getSnapshot()).toEqual([
      expect.objectContaining({ key: "pub.ext.cost", text: "$1.00", tooltip: undefined }),
    ]);
  });

  it("publishes text and tooltip updates, hide, show and dispose", () => {
    const registry = new SessionHeaderItemRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const item = registry.create("pub.ext", "cost", undefined, undefined);
    item.text = "a";
    // Hidden: changes are not published.
    expect(listener).not.toHaveBeenCalled();
    item.show();
    item.tooltip = "Tip";
    expect(registry.getSnapshot()[0]).toMatchObject({ text: "a", tooltip: "Tip" });
    const before = registry.getSnapshot();
    item.text = "a";
    expect(registry.getSnapshot()).toBe(before);
    item.hide();
    expect(keys(registry)).toEqual([]);
    item.show();
    item.dispose();
    expect(keys(registry)).toEqual([]);
    const calls = listener.mock.calls.length;
    item.text = "after dispose";
    item.show();
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it("bounds text and tooltip length on the host side", () => {
    const registry = new SessionHeaderItemRegistry();
    const item = registry.create("pub.ext", "long", Left, 0);
    item.text = `${"x".repeat(100)}\nsecond line`;
    item.tooltip = "y".repeat(500);
    item.show();
    const [snapshot] = registry.getSnapshot();
    expect(Array.from(snapshot!.text)).toHaveLength(MAX_HEADER_ITEM_TEXT_LENGTH);
    expect(snapshot!.text.endsWith("…")).toBe(true);
    expect(snapshot!.tooltip).toHaveLength(MAX_HEADER_ITEM_TOOLTIP_LENGTH);
  });

  it("orders by alignment, then priority toward each edge, then id", () => {
    const registry = new SessionHeaderItemRegistry();
    const make = (id: string, alignment: number, priority?: number) => {
      const item = registry.create("pub.ext", id, alignment, priority);
      item.text = id;
      item.show();
    };
    make("rightLow", Right, 1);
    make("rightHigh", Right, 10);
    make("leftLow", Left, 1);
    make("leftHigh", Left, 10);
    make("rightB", Right, 5);
    make("rightA", Right, 5);
    // Left group: higher priority further left. Right group: higher priority
    // closer to the anchor on the right.
    expect(keys(registry)).toEqual([
      "pub.ext.leftHigh",
      "pub.ext.leftLow",
      "pub.ext.rightLow",
      "pub.ext.rightA",
      "pub.ext.rightB",
      "pub.ext.rightHigh",
    ]);
  });

  it("generates ids for the alignment overload and de-duplicates ids", () => {
    const registry = new SessionHeaderItemRegistry();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(registry.create("pub.ext", undefined, Left, 0).id).toBe("pub.ext.item1");
    registry.create("pub.ext", "same", Left, 0);
    expect(registry.create("pub.ext", "same", Left, 0).id).toBe("pub.ext.same#2");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("boundText", () => {
  it("counts code points, so an emoji is never split", () => {
    expect(boundText("\u{1F600}".repeat(3), 2)).toBe("\u{1F600}…");
    expect(boundText("  a  b ", 10)).toBe("a b");
  });
});
