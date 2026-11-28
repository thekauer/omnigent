import { beforeEach, describe, expect, it, vi } from "vitest";
import { builtInTabWhen } from "@/builtinExtensions/builtInTabWhen";
import { LAYOUT_SLOTS, LayoutStateStore } from "./layoutState";
import { isViewCollapsed, isViewHidden, readViewsLayout, updateViewLayout } from "./viewsLayout";
import { ProductLayoutPolicy } from "./productLayout";

const NO_POLICY = new ProductLayoutPolicy();
import {
  serverFeatureKeys,
  WorkbenchContext,
  WorkbenchContextKeys,
  whenHolds,
} from "./workbenchContext";

describe("WorkbenchContext", () => {
  it("fires the changed keys only and removes a key set to undefined", () => {
    const context = new WorkbenchContext();
    const listener = vi.fn();
    context.subscribe(listener);
    context.update({ a: true, b: 1 });
    context.update({ a: true, b: 2 });
    context.update({ a: undefined });
    expect(listener.mock.calls.map(([keys]) => keys)).toEqual([["a", "b"], ["b"], ["a"]]);
    expect(context.snapshot()).toEqual({ b: 2 });
  });

  it("gates the built-in rail tabs by their manifests' when clauses", () => {
    const keys = (values: Record<string, boolean>) => ({
      ...serverFeatureKeys({ workspace_content_search: values.search, workflows: false }),
      [WorkbenchContextKeys.sessionHasWorkspace]: values.workspace ?? false,
      [WorkbenchContextKeys.sessionHasTasks]: values.tasks ?? false,
    });
    const available = (tab: string, values: Record<string, boolean>) =>
      whenHolds(builtInTabWhen(tab), keys(values));
    for (const tab of ["files", "changes", "github"]) {
      expect(available(tab, { workspace: true })).toBe(true);
      expect(available(tab, { workspace: false })).toBe(false);
    }
    expect(available("content-search", { workspace: true, search: false })).toBe(false);
    expect(available("content-search", { workspace: true, search: true })).toBe(true);
    expect(available("tasks", { tasks: true })).toBe(true);
    expect(available("tasks", { workspace: true })).toBe(false);
    // The Agents view has no when clause: always available.
    expect(builtInTabWhen("subagents")).toBeUndefined();
  });

  it("names only the server features that are on", () => {
    expect(serverFeatureKeys({ canvas: true, usage_page: false, "bad key": true })).toEqual({
      "omnigent.serverFeature.canvas": true,
    });
  });
});

describe("views layout", () => {
  let store: LayoutStateStore;
  beforeEach(() => {
    localStorage.clear();
    store = new LayoutStateStore();
  });

  it("keeps the user's collapse and hide over the contribution's visibility", () => {
    const view = { id: "acme.view", visibility: "collapsed" };
    expect(isViewCollapsed(view, readViewsLayout(store, NO_POLICY))).toBe(true);
    updateViewLayout("acme.view", { collapsed: false }, store, NO_POLICY);
    expect(isViewCollapsed(view, readViewsLayout(store, NO_POLICY))).toBe(false);
    expect(
      isViewHidden(
        { id: "acme.view", visibility: "hidden" },
        readViewsLayout(store, NO_POLICY),
        NO_POLICY,
        [],
      ),
    ).toBe(true);
    updateViewLayout("acme.view", { hidden: false }, store, NO_POLICY);
    expect(store.get(LAYOUT_SLOTS.views)).toEqual({
      "acme.view": { collapsed: false, hidden: false },
    });
    updateViewLayout("acme.view", { collapsed: undefined, hidden: undefined }, store, NO_POLICY);
    expect(store.get(LAYOUT_SLOTS.views)).toBeUndefined();
  });

  it("drops malformed stored entries", () => {
    store.set(LAYOUT_SLOTS.views, { a: { collapsed: "yes" }, b: null, c: { hidden: true } });
    expect(readViewsLayout(store, NO_POLICY)).toEqual({ c: { hidden: true } });
  });
});
