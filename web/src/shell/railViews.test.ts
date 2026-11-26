// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ARIA_MOD_KEY } from "@/components/KeyboardShortcut";
import {
  BUILT_IN_RAIL_TABS,
  extensionRailTab,
  TAB_BADGE_BASE,
  extensionRailTabViewId,
  isExtensionRailTab,
  isRailTab,
} from "./railTabs";
import { DEFAULT_RAIL_VIEW_ICON, RAIL_VIEW_ICONS } from "./railViewIcons";
import { changedStatusOf, RailViewRegistry, railStatusOf } from "./railViews";
import { resolveWorkspaceActiveView } from "./workspaceActiveView";
import {
  WORKSPACE_PANEL_TABS,
  railTabDescriptor,
  workspacePanelTabPresentation,
  type WorkspacePanelTab,
  type WorkspacePanelTabContext,
} from "./workspacePanelTabs";

const CONTEXT: WorkspacePanelTabContext = {
  pending: false,
  showFilesPanel: true,
  showGithubTab: true,
  showTasksTab: true,
  showContentSearch: true,
  digit: "7",
  digitAriaShortcut: "Control+7",
};

describe("rail tab ids", () => {
  it("keeps the built-in ids and accepts ext:<view id>", () => {
    for (const tab of BUILT_IN_RAIL_TABS) expect(isRailTab(tab)).toBe(true);
    expect(extensionRailTab("pub.ext.view")).toBe("ext:pub.ext.view");
    expect(isRailTab("ext:pub.ext.view")).toBe(true);
    expect(extensionRailTabViewId("ext:pub.ext.view")).toBe("pub.ext.view");
    expect(extensionRailTabViewId("files")).toBeNull();
  });

  it.each(["", "ext:", "ext:bad id", "ext:../x", "ext:-x", "unknown", 3, null])(
    "drops %j",
    (value) => {
      expect(isRailTab(value)).toBe(false);
      expect(isExtensionRailTab(value)).toBe(false);
    },
  );
});

describe("RailViewRegistry", () => {
  const view = (id: string, extensionId: string) => ({
    id,
    extensionId,
    name: id,
    icon: undefined,
  });

  it("orders views by extension, then manifest order", () => {
    const registry = new RailViewRegistry();
    registry.register(view("b.ext.second", "b.ext"), 1);
    registry.register(view("b.ext.first", "b.ext"), 0);
    registry.register(view("a.ext.only", "a.ext"), 0);
    expect(registry.getSnapshot().views.map((entry) => entry.id)).toEqual([
      "a.ext.only",
      "b.ext.first",
      "b.ext.second",
    ]);
  });

  it("publishes updates and removal, and refuses duplicates", () => {
    const registry = new RailViewRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const handle = registry.register(view("a.ext.v", "a.ext"));
    expect(registry.get("a.ext.v")?.loading).toBe(true);
    expect(() => registry.register(view("a.ext.v", "a.ext"))).toThrow(/already registered/);
    handle.update({ loading: false, badge: { value: 2, tooltip: "2 things" } });
    expect(registry.get("a.ext.v")).toMatchObject({ loading: false, badge: { value: 2 } });
    // The contribution itself cannot be changed through an update.
    handle.update({ name: "renamed" } as never);
    expect(registry.get("a.ext.v")?.name).toBe("a.ext.v");
    handle.dispose();
    handle.update({ loading: true });
    expect(registry.get("a.ext.v")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("is settled only once every loader finished", () => {
    const registry = new RailViewRegistry();
    expect(registry.getSnapshot().settled).toBe(true);
    const first = registry.beginLoading();
    const second = registry.beginLoading();
    expect(registry.getSnapshot().settled).toBe(false);
    first();
    first();
    expect(registry.getSnapshot().settled).toBe(false);
    second();
    expect(registry.getSnapshot().settled).toBe(true);
  });
});

describe("railTabDescriptor", () => {
  it("returns the built-in descriptors unchanged", () => {
    for (const tab of Object.keys(WORKSPACE_PANEL_TABS) as WorkspacePanelTab[]) {
      expect(railTabDescriptor(tab, [])).toBe(WORKSPACE_PANEL_TABS[tab]);
    }
  });

  it("describes a registered extension view with its icon and badge", () => {
    const registry = new RailViewRegistry();
    const handle = registry.register({
      id: "a.ext.v",
      extensionId: "a.ext",
      name: "Changes 2",
      icon: "git-compare",
    });
    const views = () => registry.getSnapshot().views;
    expect(railTabDescriptor("ext:a.ext.unknown", views())).toBeNull();
    let presentation = workspacePanelTabPresentation(
      railTabDescriptor("ext:a.ext.v", views())!,
      CONTEXT,
    );
    expect(presentation).toMatchObject({
      label: "Changes 2",
      icon: RAIL_VIEW_ICONS["git-compare"],
      ariaLabel: "Changes 2",
      tooltipShortcut: "7",
      ariaKeyShortcuts: "Control+7",
      badge: null,
    });
    handle.update({ badge: { value: 4, tooltip: "4 changed files" } });
    presentation = workspacePanelTabPresentation(
      railTabDescriptor("ext:a.ext.v", views())!,
      CONTEXT,
    );
    expect(presentation?.ariaLabel).toBe("Changes 2 4 changed files");
    expect(presentation?.badge).toEqual({ text: 4, className: "sr-only" });
  });

  it("falls back to the default icon", () => {
    const registry = new RailViewRegistry();
    registry.register({ id: "a.ext.v", extensionId: "a.ext", name: "V", icon: "nope" });
    expect(railTabDescriptor("ext:a.ext.v", registry.getSnapshot().views)?.icon).toBe(
      DEFAULT_RAIL_VIEW_ICON,
    );
  });
});

describe("resolveWorkspaceActiveView with an extension tab", () => {
  const availability = {
    terminalPresent: () => true,
    showBrowserTab: true,
    showGithubTab: true,
    showTasksTab: true,
    showContentSearch: true,
    hasAgentTree: true,
    mobile: false,
  };
  const selection = {
    selectedFilePath: null,
    selectedTerminalKey: null,
    selectedBrowserId: null,
    selectedSideChatId: null,
  };

  it("shows the extension page for an ext: tab and nothing else changes", () => {
    expect(
      resolveWorkspaceActiveView({ ...selection, rightRailTab: "ext:a.ext.v" }, availability),
    ).toMatchObject({ scope: "extension", extensionViewId: "a.ext.v" });
    expect(
      resolveWorkspaceActiveView({ ...selection, rightRailTab: "files" }, availability),
    ).toMatchObject({ scope: "files", extensionViewId: null });
  });

  it("shows the built-in view of the Changes tab, or the extension page without one", () => {
    expect(
      resolveWorkspaceActiveView(
        { ...selection, rightRailTab: "changes" },
        {
          ...availability,
          builtInTabViewId: (tab) => (tab === "changes" ? "omnigent.changes.view" : undefined),
        },
      ),
    ).toMatchObject({ scope: "extension", extensionViewId: "omnigent.changes.view" });
    expect(
      resolveWorkspaceActiveView({ ...selection, rightRailTab: "changes" }, availability),
    ).toMatchObject({ scope: "extension", extensionViewId: null });
  });

  it("takes a built-in tab's label, icon and badge from the view standing in for it", () => {
    const registry = new RailViewRegistry();
    const handle = registry.register({
      id: "omnigent.changes.view",
      extensionId: "omnigent.changes",
      name: "Changes",
      icon: "file-diff",
      builtInTab: "changes",
    });
    handle.update({ badge: { value: 3, tooltip: "3 changed" } });
    const descriptor = railTabDescriptor("changes", registry.getSnapshot().views)!;
    expect(workspacePanelTabPresentation(descriptor, CONTEXT)).toMatchObject({
      label: "Changes",
      icon: RAIL_VIEW_ICONS["file-diff"],
      ariaLabel: "Changes 3 changed",
      badge: { text: 3, className: "sr-only" },
    });
    // Its visibility stays the built-in tab's.
    expect(
      workspacePanelTabPresentation(descriptor, { ...CONTEXT, showFilesPanel: false }),
    ).toBeNull();
    handle.update({ badge: undefined });
    expect(
      workspacePanelTabPresentation(
        railTabDescriptor("changes", registry.getSnapshot().views)!,
        CONTEXT,
      ),
    ).toMatchObject({ ariaLabel: "Changes", badge: null });
  });

  it("badges Agents from its view: the total, or working/total in the success tone", () => {
    const registry = new RailViewRegistry();
    const handle = registry.register({
      id: "omnigent.agents.view",
      extensionId: "omnigent.agents",
      name: "Agents",
      icon: "bot",
      builtInTab: "subagents",
    });
    const presentation = () =>
      workspacePanelTabPresentation(
        railTabDescriptor("subagents", registry.getSnapshot().views)!,
        CONTEXT,
      );
    handle.update({ badge: { value: 2, tooltip: "2", tone: "muted" } });
    expect(presentation()).toMatchObject({
      label: "Agents",
      icon: RAIL_VIEW_ICONS.bot,
      ariaLabel: "Agents 2",
      badge: { text: 2, className: `${TAB_BADGE_BASE} sr-only text-muted-foreground` },
    });
    handle.update({ badge: { value: 3, tooltip: "1/3", label: "1/3", tone: "success" } });
    expect(presentation()).toMatchObject({
      ariaLabel: "Agents 1/3",
      badge: { text: "1/3", className: `${TAB_BADGE_BASE} sr-only text-success` },
    });
  });

  it("keeps Content search's ⌘⇧F in its tooltip when its view stands in for it", () => {
    const registry = new RailViewRegistry();
    registry.register({
      id: "omnigent.content-search.view",
      extensionId: "omnigent.content-search",
      name: "Content search",
      icon: "search",
      builtInTab: "content-search",
    });
    const descriptor = railTabDescriptor("content-search", registry.getSnapshot().views)!;
    expect(workspacePanelTabPresentation(descriptor, CONTEXT)).toMatchObject({
      label: "Content search",
      icon: RAIL_VIEW_ICONS.search,
      tooltipShortcut: WORKSPACE_PANEL_TABS["content-search"].tooltipShortcut!(CONTEXT),
      ariaKeyShortcuts: `${ARIA_MOD_KEY}+Shift+F Control+7`,
    });
    expect(
      workspacePanelTabPresentation(descriptor, { ...CONTEXT, showContentSearch: false }),
    ).toBeNull();
  });

  it("skips updates that change nothing", () => {
    const registry = new RailViewRegistry();
    const listener = vi.fn();
    const handle = registry.register({
      id: "a.b.c",
      extensionId: "a.b",
      name: "C",
      icon: undefined,
    });
    registry.subscribe(listener);
    handle.update({ message: undefined, loading: true });
    expect(listener).not.toHaveBeenCalled();
    handle.update({ message: "x" });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("keeps an open file in front of the extension page", () => {
    expect(
      resolveWorkspaceActiveView(
        { ...selection, rightRailTab: "ext:a.ext.v", selectedFilePath: "a.ts" },
        availability,
      ),
    ).toMatchObject({ scope: "extension", filePath: "a.ts" });
  });
});

describe("tree item statuses", () => {
  it("maps between the changed-files and tree-item names", () => {
    expect(railStatusOf("created")).toBe("added");
    expect(railStatusOf("deleted")).toBe("deleted");
    expect(changedStatusOf("added")).toBe("created");
    expect(changedStatusOf(undefined)).toBeUndefined();
  });
});
