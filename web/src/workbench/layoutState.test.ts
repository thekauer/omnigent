import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LAYOUT_SLOTS,
  LAYOUT_STATE_STORAGE_KEY,
  LEGACY_LAYOUT_STORAGE_KEYS,
  type LayoutStateChange,
  LayoutStateStore,
  readLayoutStateText,
} from "./layoutState";

const stored = () =>
  JSON.parse(localStorage.getItem(LAYOUT_STATE_STORAGE_KEY) ?? "null") as unknown;

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("LayoutStateStore", () => {
  it("carries every old key into its slot once, and removes the old keys", () => {
    const values: Record<string, unknown> = {
      "omnigent:panel-size-preferences": { sidebarWidthPx: 300 },
      "omnigent:sidebar-view": { grouping: "status" },
      "omnigent:collapsed-sidebar-sections": ["Shared"],
      "omnigent:expanded-project-sections": ["demo"],
      "omnigent:collapsed-session-families": ["conv_1"],
    };
    expect(Object.keys(values).sort()).toEqual(Object.keys(LEGACY_LAYOUT_STORAGE_KEYS).sort());
    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
    const store = new LayoutStateStore();
    expect(store.get(LAYOUT_SLOTS.panelSizes)).toEqual({ sidebarWidthPx: 300 });
    expect(store.get(LAYOUT_SLOTS.conversationsView)).toEqual({ grouping: "status" });
    expect(store.get(LAYOUT_SLOTS.collapsedSections)).toEqual(["Shared"]);
    expect(store.get(LAYOUT_SLOTS.expandedProjects)).toEqual(["demo"]);
    expect(store.get(LAYOUT_SLOTS.collapsedFamilies)).toEqual(["conv_1"]);
    for (const key of Object.keys(values)) expect(localStorage.getItem(key)).toBeNull();
    expect(stored()).toMatchObject({ version: 1 });
  });

  it("keeps the document's slot over an old key written later (an older tab)", () => {
    const store = new LayoutStateStore();
    store.set(LAYOUT_SLOTS.collapsedSections, ["Projects"]);
    localStorage.setItem("omnigent:collapsed-sidebar-sections", JSON.stringify(["Shared"]));
    expect(store.get(LAYOUT_SLOTS.collapsedSections)).toEqual(["Projects"]);
    expect(localStorage.getItem("omnigent:collapsed-sidebar-sections")).toBeNull();
  });

  it("keeps the old keys while the document can't be written, and the window its values", () => {
    localStorage.setItem("omnigent:sidebar-view", JSON.stringify({ ordering: "created" }));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    const store = new LayoutStateStore();
    expect(store.get(LAYOUT_SLOTS.conversationsView)).toEqual({ ordering: "created" });
    expect(localStorage.getItem("omnigent:sidebar-view")).not.toBeNull();
    store.set(LAYOUT_SLOTS.sidebar, { visible: false });
    expect(store.get(LAYOUT_SLOTS.sidebar)).toEqual({ visible: false });
    setItem.mockRestore();
    store.set(LAYOUT_SLOTS.collapsedSections, []);
    expect(stored()).toEqual({
      version: 1,
      state: {
        "omnigent.conversations.list.view": { ordering: "created" },
        "workbench.parts.sidebar": { visible: false },
        "omnigent.conversations.list.collapsedSections": [],
      },
    });
  });

  it("sets and removes a slot, and tells its listeners which", () => {
    const store = new LayoutStateStore();
    const changes: LayoutStateChange[] = [];
    store.subscribe((change) => changes.push(change));
    store.set(LAYOUT_SLOTS.sidebar, { visible: false });
    store.set(LAYOUT_SLOTS.sidebar, undefined);
    store.set(LAYOUT_SLOTS.sidebar, undefined);
    expect(store.get(LAYOUT_SLOTS.sidebar)).toBeUndefined();
    expect(changes).toEqual([
      { slots: ["workbench.parts.sidebar"] },
      { slots: ["workbench.parts.sidebar"] },
    ]);
    store.set(LAYOUT_SLOTS.panelSizes, { sidebarWidthPx: 1 });
    store.reset();
    expect(localStorage.getItem(LAYOUT_STATE_STORAGE_KEY)).toBeNull();
    expect(changes.at(-1)).toEqual({});
  });

  it("never overwrites a newer version's document", () => {
    const newer = JSON.stringify({ version: 2, state: { "a.b": 1 } });
    localStorage.setItem(LAYOUT_STATE_STORAGE_KEY, newer);
    const store = new LayoutStateStore();
    store.set(LAYOUT_SLOTS.sidebar, { visible: false });
    expect(store.get(LAYOUT_SLOTS.sidebar)).toEqual({ visible: false });
    expect(localStorage.getItem(LAYOUT_STATE_STORAGE_KEY)).toBe(newer);
  });

  it("reads an unreadable or other-version document as empty", () => {
    for (const raw of [null, "nope", "[]", '{"version":2,"state":{"a":1}}', '{"version":1}']) {
      expect(readLayoutStateText(raw)).toEqual({});
    }
    expect(readLayoutStateText('{"version":1,"state":{"a":1,"__proto__":2}}')).toEqual({ a: 1 });
  });
});
