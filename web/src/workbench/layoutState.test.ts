import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LAYOUT_SLOTS,
  LAYOUT_STATE_STORAGE_KEY,
  LEGACY_LAYOUT_STORAGE_KEYS,
  type LayoutStateChange,
  LayoutStateStore,
  embedLayoutScope,
  readLayoutStateText,
} from "./layoutState";

const stored = () =>
  JSON.parse(localStorage.getItem(LAYOUT_STATE_STORAGE_KEY) ?? "null") as unknown;

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("LayoutStateStore", () => {
  it("keeps an embed's state apart from the standalone app's, by its scope", () => {
    const store = new LayoutStateStore();
    store.set("slot", "standalone");
    const listener = vi.fn();
    store.subscribe(listener);
    store.setScope(embedLayoutScope("/ml/embed"));
    expect(listener).toHaveBeenCalledWith({});
    expect(store.get("slot")).toBeUndefined();
    store.set("slot", "embedded");
    expect(localStorage.getItem(`${LAYOUT_STATE_STORAGE_KEY}@embed:/ml/embed`)).toContain(
      "embedded",
    );
    // An embed doesn't take the standalone app's old keys.
    localStorage.setItem("omnigent:sidebar-view", JSON.stringify({ grouping: "status" }));
    expect(store.get(LAYOUT_SLOTS.conversationsView)).toBeUndefined();
    store.setScope("");
    expect(store.get("slot")).toBe("standalone");
    expect(embedLayoutScope(undefined)).toBe("embed:/");
  });

  it("prefers an old key written after the migration (a rolled-back build) over the slot", () => {
    localStorage.setItem(
      LAYOUT_STATE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: { [LAYOUT_SLOTS.conversationsView]: { grouping: "a" } },
      }),
    );
    localStorage.setItem("omnigent:sidebar-view", JSON.stringify({ grouping: "b" }));
    const store = new LayoutStateStore();
    expect(store.get(LAYOUT_SLOTS.conversationsView)).toEqual({ grouping: "b" });
    expect(localStorage.getItem("omnigent:sidebar-view")).toBeNull();
  });

  it("warns once when the state can't be stored and lasts for the window only", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    const store = new LayoutStateStore();
    store.set("a", 1);
    store.set("b", 2);
    expect(store.get("b")).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("can't be stored"));
  });

  it("treats a document of a non-integer or infinite version as corrupt, not newer", () => {
    for (const version of ["1e999", "1.5"]) {
      localStorage.setItem(LAYOUT_STATE_STORAGE_KEY, `{"version": ${version}, "state": {}}`);
      const store = new LayoutStateStore();
      store.set("slot", 1);
      expect(stored()).toEqual({ version: 1, state: { slot: 1 } });
    }
  });

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
