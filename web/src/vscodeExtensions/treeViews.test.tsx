import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type * as omnigent from "omnigent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionRailView } from "@/shell/extensionViews/ExtensionRailView";
import { clearExpandStates } from "@/shell/extensionViews/treeRows";
import { RailViewRegistry } from "@/shell/railViews";
import { EventEmitter } from "./base";
import { CommandRegistry } from "./commands";
import { ContextKeyService } from "./contextKeys";
import { parseContributions } from "./contributions";
import { createTreeViewModel, sanitizeTreeItem } from "./treeView";
import { testViewsService } from "./testServices";
import { ViewsService } from "./viewsService";

const VIEW = "pub.ext.changes";
const CONTRIBUTES = {
  views: { "omnigent.rightPanel": [{ id: VIEW, name: "Changes 2", icon: "git-compare" }] },
  commands: [
    { command: "pub.ext.asTree", title: "View as Tree", icon: "list-tree" },
    { command: "pub.ext.asList", title: "View as List", icon: "list" },
    { command: "pub.ext.refresh", title: "Refresh", icon: "refresh-cw" },
    { command: "pub.ext.pin", title: "Pin", icon: "check", toggled: "pub.ext.pinned" },
  ],
  menus: {
    "view/title": [
      {
        command: "pub.ext.asTree",
        when: `view == ${VIEW} && pub.ext.mode == list`,
        group: "navigation",
      },
      {
        command: "pub.ext.asList",
        when: `view == ${VIEW} && pub.ext.mode == tree`,
        group: "navigation",
      },
      { command: "pub.ext.refresh", when: `view == ${VIEW}`, group: "navigation" },
      { command: "pub.ext.pin", when: `view == ${VIEW}`, group: "navigation" },
      { command: "pub.ext.hidden", when: `view == ${VIEW}`, group: "1_more" },
      { command: "pub.ext.refresh", when: "view == other.view", group: "navigation" },
    ],
  },
};

interface Node {
  id: string;
  label: string;
  folder?: boolean;
  path?: string;
  description?: string;
  status?: "added" | "modified" | "deleted";
  children?: Node[];
}

function setup() {
  const registry = new RailViewRegistry();
  const contextKeys = new ContextKeyService();
  const commands = new CommandRegistry();
  const errors: string[] = [];
  const views = new ViewsService({
    registry,
    contextKeys,
    executeCommand: (command, args) => commands.execute(command, args, () => {}),
    showError: (message) => errors.push(message),
  });
  const { contributions } = parseContributions("pub.ext", CONTRIBUTES);
  views.addExtension("pub.ext", contributions);
  views.extensionSettled("pub.ext");
  const changed = new EventEmitter<void>();
  let roots: Node[] = [];
  const provider: omnigent.TreeDataProvider<Node> = {
    onDidChangeTreeData: changed.event,
    getChildren: (element) => Promise.resolve(element ? (element.children ?? []) : roots),
    getTreeItem: (node) => ({
      id: node.id,
      label: node.label,
      description: node.description,
      resourceUri: node.path ? { path: node.path } : undefined,
      iconPath: node.folder ? "folder" : "file",
      gitStatus: node.status,
      collapsibleState: node.folder ? 2 : 0,
      decoration: node.folder
        ? undefined
        : {
            parts: [{ text: "+3", tone: "added" }, { text: " " }, { text: "−1", tone: "removed" }],
            title: "3 lines added, 1 removed",
          },
      command: node.folder ? undefined : { command: "pub.ext.open", arguments: [node.path] },
    }),
  };
  const logError = vi.fn();
  const tree = views.createTreeView("pub.ext", VIEW, { treeDataProvider: provider }, logError);
  const setRoots = (next: Node[]) => {
    roots = next;
    changed.fire();
  };
  const ui = (conversationId = "conv_a") => (
    <QueryClientProvider client={new QueryClient()}>
      <ExtensionRailView
        viewId={VIEW}
        settled
        conversationId={conversationId}
        registry={registry}
      />
    </QueryClientProvider>
  );
  return { registry, contextKeys, commands, views, tree, setRoots, ui, errors, logError };
}

const FLAT: Node[] = [
  { id: "a", label: "a.ts", path: "src/a.ts", description: "src", status: "added" },
  { id: "b", label: "b.ts", path: "src/b.ts", description: "src", status: "deleted" },
];
const TREE: Node[] = [
  {
    id: "src",
    label: "src",
    folder: true,
    path: "src",
    status: "added",
    children: [
      { id: "a", label: "a.ts", path: "src/a.ts", status: "added" },
      { id: "b", label: "b.ts", path: "src/b.ts", status: "modified" },
    ],
  },
];

afterEach(() => {
  cleanup();
  clearExpandStates();
});

describe("view/title actions", () => {
  it("follow `when` clauses and context keys, inline group only", () => {
    const { registry, contextKeys } = setup();
    const ids = () => registry.get(VIEW)!.actions.map((action) => action.id);
    expect(ids()).toEqual(["pub.ext.refresh", "pub.ext.pin"]);
    contextKeys.set("pub.ext.mode", "list");
    expect(ids()).toEqual(["pub.ext.asTree", "pub.ext.refresh", "pub.ext.pin"]);
    contextKeys.set("pub.ext.mode", "tree");
    expect(ids()).toEqual(["pub.ext.asList", "pub.ext.refresh", "pub.ext.pin"]);
  });

  it("render as buttons with aria-pressed for toggles, and run their command", async () => {
    const { contextKeys, commands, ui } = setup();
    const ran = vi.fn();
    commands.register("pub.ext", "pub.ext.pin", ran);
    contextKeys.set("pub.ext.mode", "list");
    render(ui());
    const pin = screen.getByRole("button", { name: "Pin" });
    expect(pin).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "View as Tree" })).not.toHaveAttribute(
      "aria-pressed",
    );
    act(() => contextKeys.set("pub.ext.pinned", true));
    expect(screen.getByRole("button", { name: "Pin" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() => expect(ran).toHaveBeenCalledOnce());
    act(() => contextKeys.set("pub.ext.mode", "tree"));
    expect(screen.queryByRole("button", { name: "View as Tree" })).toBeNull();
    expect(screen.getByRole("button", { name: "View as List" })).toBeInTheDocument();
  });

  it("shows a failing action's error", async () => {
    const { registry, errors } = setup();
    registry
      .get(VIEW)!
      .actions.find((action) => action.id === "pub.ext.refresh")!
      .run();
    await waitFor(() => expect(errors).toEqual(["Refresh: command 'pub.ext.refresh' not found"]));
  });
});

describe("tree view host", () => {
  it("renders the provider's rows as the Changes list, with decorations", async () => {
    const { setRoots, ui } = setup();
    setRoots(FLAT);
    render(ui());
    await screen.findByText("a.ts");
    const a = screen.getByRole("button", { name: "src/a.ts" });
    expect(a).toHaveTextContent("a.tssrc");
    expect(screen.getAllByLabelText("3 lines added, 1 removed")).toHaveLength(2);
    expect(screen.getAllByTitle("Added")[0]).toHaveTextContent("A");
    expect(screen.getByTitle("Deleted")).toHaveTextContent("D");
    expect(screen.getByRole("heading", { name: "Changes 2" })).toBeInTheDocument();
  });

  it("renders folders like the Files tree, and keeps expand state per session", async () => {
    const { setRoots, ui } = setup();
    setRoots(TREE);
    const view = render(ui("conv_a"));
    const folder = await screen.findByRole("button", { name: "src/" });
    expect(folder).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    fireEvent.click(folder);
    await waitFor(() => expect(screen.queryByText("a.ts")).toBeNull());
    // Another session has its own expand state; the first keeps its own.
    view.rerender(ui("conv_b"));
    await screen.findByText("a.ts");
    view.rerender(ui("conv_a"));
    await screen.findByRole("button", { name: "src/" });
    await waitFor(() => expect(screen.queryByText("a.ts")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "src/" }));
    await screen.findByText("a.ts");
  });

  it("runs a row's command on click", async () => {
    const { commands, setRoots, ui } = setup();
    const opened = vi.fn();
    commands.register("pub.ext", "pub.ext.open", opened);
    setRoots(FLAT);
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "src/a.ts" }));
    await waitFor(() => expect(opened).toHaveBeenCalledWith("src/a.ts"));
  });

  it("reloads on onDidChangeTreeData, keeping collapsed folders collapsed", async () => {
    const { setRoots, ui } = setup();
    setRoots(TREE);
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "src/" }));
    await waitFor(() => expect(screen.queryByText("a.ts")).toBeNull());
    act(() => setRoots([...TREE, { id: "c", label: "c.md", path: "c.md", status: "modified" }]));
    await screen.findByText("c.md");
    expect(screen.queryByText("a.ts")).toBeNull();
    act(() => setRoots(FLAT));
    await screen.findByRole("button", { name: "src/b.ts" });
    expect(screen.queryByText("c.md")).toBeNull();
  });

  it("shows the view's message, title and the no-provider state", async () => {
    const { tree, setRoots, ui } = setup();
    setRoots([]);
    tree.message = "No workspace changes yet";
    tree.title = "Changed";
    tree.description = "2 repos";
    render(ui());
    expect(await screen.findByText("No workspace changes yet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Changed" })).toBeInTheDocument();
    expect(screen.getByText("2 repos")).toBeInTheDocument();
    act(() => tree.dispose());
    expect(
      screen.getByText("There is no data provider registered that can provide view data."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Changes 2" })).toBeInTheDocument();
  });

  it("sets the tab badge from the view's badge", () => {
    const { registry, tree } = setup();
    tree.badge = { value: 3.7, tooltip: "3 changed files" };
    expect(registry.get(VIEW)?.badge).toEqual({ value: 3, tooltip: "3 changed files" });
    tree.badge = undefined;
    expect(registry.get(VIEW)?.badge).toBeUndefined();
  });

  it("refuses views it does not own and a second tree view", () => {
    const { views } = setup();
    const provider = { getChildren: () => [], getTreeItem: () => ({}) };
    expect(() =>
      views.createTreeView("other.ext", VIEW, { treeDataProvider: provider }, vi.fn()),
    ).toThrow(/not|no view/);
    expect(() =>
      views.createTreeView("pub.ext", "pub.ext.missing", { treeDataProvider: provider }, vi.fn()),
    ).toThrow(/no view/);
    expect(() =>
      views.createTreeView("pub.ext", VIEW, { treeDataProvider: provider }, vi.fn()),
    ).toThrow(/already/);
  });

  it("logs a failing provider and shows no rows", async () => {
    const registry = new RailViewRegistry();
    const views = new ViewsService({
      registry,
      contextKeys: new ContextKeyService(),
      executeCommand: () => Promise.resolve(),
      showError: () => {},
    });
    views.addExtension("pub.ext", parseContributions("pub.ext", CONTRIBUTES).contributions);
    const logError = vi.fn();
    views.createTreeView(
      "pub.ext",
      VIEW,
      {
        treeDataProvider: {
          getChildren: () => {
            throw new Error("boom");
          },
          getTreeItem: () => ({}),
        },
      },
      logError,
    );
    expect(await registry.get(VIEW)!.tree!.getChildren(undefined)).toEqual([]);
    expect(logError).toHaveBeenCalledWith(
      `tree view ${VIEW}: getChildren failed`,
      expect.objectContaining({ message: "boom" }),
    );
  });
});

describe("sanitizeTreeItem", () => {
  it("caps text, checks icons and statuses, and derives labels from the resource", () => {
    const { node, command } = sanitizeTreeItem(
      {
        resourceUri: { path: "web/src/app.ts" },
        description: true,
        tooltip: "t".repeat(600),
        iconPath: "javascript:alert(1)",
        gitStatus: "renamed" as never,
        collapsibleState: 7 as never,
        decoration: { parts: [{ text: "x".repeat(40), tone: "loud" as never }] },
        command: { command: "pub.ext.open", arguments: ["web/src/app.ts"] },
      },
      "h",
    );
    expect(node).toMatchObject({
      handle: "h",
      label: "app.ts",
      description: "web/src",
      resourcePath: "web/src/app.ts",
      icon: undefined,
      status: undefined,
      collapsible: "none",
      hasCommand: true,
    });
    expect(node.tooltip).toHaveLength(500);
    expect(node.decoration?.parts).toEqual([{ text: "x".repeat(24) }]);
    expect(command).toEqual({ command: "pub.ext.open", args: ["web/src/app.ts"] });
    expect(Object.isFrozen(node)).toBe(true);
  });

  it("keeps allowlisted icons and the file and folder icons", () => {
    for (const icon of ["file", "folder", "git-branch"]) {
      expect(sanitizeTreeItem({ label: "x", iconPath: icon }, "h").node.icon).toBe(icon);
    }
  });
});

describe("view filter, submenus, notices and visibility", () => {
  const RICH_VIEW = "pub.rich.view";
  const RICH = {
    views: {
      "omnigent.rightPanel": [
        {
          id: RICH_VIEW,
          name: "Rich",
          filter: { placeholder: "Find things", ariaLabel: "Search things" },
        },
      ],
    },
    commands: [
      {
        command: "pub.rich.a",
        title: "Alpha",
        icon: "arrow-down-a-z",
        toggled: "pub.rich.sort == a",
      },
      { command: "pub.rich.b", title: "Beta", icon: "file-type", toggled: "pub.rich.sort == b" },
      { command: "pub.rich.show", title: "Show", icon: "eye" },
    ],
    submenus: [
      { id: "pub.rich.sortBy", label: "Sort", icon: "arrow-down-up", tooltip: "Sort things" },
    ],
    menus: {
      "view/title": [
        { submenu: "pub.rich.sortBy", group: "filter" },
        {
          command: "pub.rich.show",
          group: "filter",
          tone: "warning",
          tooltip: "Hidden: ${pub.rich.hiddenCount}",
        },
      ],
      "pub.rich.sortBy": [{ command: "pub.rich.a" }, { command: "pub.rich.b" }],
    },
  };

  function richSetup() {
    const registry = new RailViewRegistry();
    const contextKeys = new ContextKeyService();
    const commands = new CommandRegistry();
    const workspace = {
      activeSessionId: "s1" as string | undefined,
      changed: new EventEmitter<unknown>(),
    };
    const shown = vi.fn();
    const views = new ViewsService({
      registry,
      contextKeys,
      executeCommand: (command, args) => commands.execute(command, args, () => {}),
      showError: () => {},
      workspace: {
        get activeSessionId() {
          return workspace.activeSessionId;
        },
        onDidChangeChangedFiles: workspace.changed.event,
      },
      onViewShown: shown,
    });
    const { contributions, warnings } = parseContributions("pub.rich", RICH);
    expect(warnings).toEqual([]);
    views.addExtension("pub.rich", contributions);
    views.extensionSettled("pub.rich");
    let roots = ["one", "two"];
    const changed = new EventEmitter<void>();
    const tree: omnigent.TreeView<string> = views.createTreeView<string>(
      "pub.rich",
      RICH_VIEW,
      {
        treeDataProvider: {
          onDidChangeTreeData: changed.event,
          getChildren: (): string[] => roots.filter((root) => root.includes(tree.filter)),
          getTreeItem: (label: string) => ({
            label,
            collapsibleState: 0,
            command: { command: "pub.rich.open" },
          }),
        },
      },
      vi.fn(),
    );
    const ui = (conversationId = "s1", visible = true) => (
      <QueryClientProvider client={new QueryClient()}>
        <ExtensionRailView
          viewId={RICH_VIEW}
          settled
          conversationId={conversationId}
          registry={registry}
          visible={visible}
        />
      </QueryClientProvider>
    );
    return {
      registry,
      contextKeys,
      commands,
      workspace,
      tree,
      changed,
      ui,
      shown,
      setRoots: (next: string[]) => {
        roots = next;
        changed.fire();
      },
    };
  }

  it("fills a menu tooltip's ${context key} references from the context keys", () => {
    const { registry, contextKeys } = richSetup();
    const tooltip = () =>
      registry.get(RICH_VIEW)?.actions.find((action) => action.id === "pub.rich.show")?.tooltip;
    expect(tooltip()).toBe("Hidden: ");
    contextKeys.set("pub.rich.hiddenCount", 3);
    expect(tooltip()).toBe("Hidden: 3");
  });

  it("keeps the filter text per session and tells the extension", async () => {
    const { tree, ui, workspace, changed } = richSetup();
    const seen: string[] = [];
    tree.onDidChangeFilter((text) => {
      seen.push(text);
      changed.fire();
    });
    const { rerender } = render(ui("s1"));
    const search = await screen.findByRole("searchbox", { name: "Search things" });
    expect(search).toHaveAttribute("placeholder", "Find things");
    fireEvent.change(search, { target: { value: "tw" } });
    expect(tree.filter).toBe("tw");
    await waitFor(() => expect(screen.queryByText("one")).toBeNull());
    expect(screen.getByText("two")).toBeInTheDocument();
    // Another session on screen: its own (empty) filter.
    workspace.activeSessionId = "s2";
    workspace.changed.fire(undefined);
    rerender(ui("s2"));
    expect(tree.filter).toBe("");
    expect(await screen.findByText("one")).toBeInTheDocument();
    workspace.activeSessionId = "s1";
    workspace.changed.fire(undefined);
    rerender(ui("s1"));
    expect(tree.filter).toBe("tw");
    expect(screen.getByRole("searchbox", { name: "Search things" })).toHaveValue("tw");
    expect(seen).toEqual(["tw", "", "tw"]);
  });

  it("draws a submenu of toggles as a button naming the toggled entry, and runs a pick", async () => {
    const { contextKeys, commands, ui } = richSetup();
    const ranB = vi.fn();
    commands.register("pub.rich", "pub.rich.b", ranB);
    contextKeys.set("pub.rich.sort", "a");
    render(ui());
    const sort = await screen.findByRole("button", { name: "Sort: Alpha" });
    expect(sort).toHaveTextContent("Alpha");
    expect(sort.querySelector(".lucide-arrow-down-up")).not.toBeNull();
    fireEvent.pointerDown(sort, { button: 0, ctrlKey: false });
    const beta = await screen.findByRole("menuitemradio", { name: "Beta" });
    expect(screen.getByRole("menuitemradio", { name: "Alpha" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(beta);
    await waitFor(() => expect(ranB).toHaveBeenCalledOnce());
    act(() => contextKeys.set("pub.rich.sort", "b"));
    expect(screen.getByRole("button", { name: "Sort: Beta" })).toBeInTheDocument();
  });

  it("draws filter-group buttons next to the field, in the warning tone with their tooltip", async () => {
    const { ui, contextKeys } = richSetup();
    contextKeys.set("pub.rich.hiddenCount", 2);
    render(ui());
    const show = await screen.findByRole("button", { name: "Show" });
    expect(show).toHaveClass("text-warning");
    const search = screen.getByRole("searchbox");
    expect(search.compareDocumentPosition(show) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.pointerMove(show, { pointerType: "mouse" });
    fireEvent.focus(show);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Hidden: 2");
  });

  it("draws command links in messages, error messages, notices and the title tag", async () => {
    const { tree, commands, ui } = richSetup();
    const ran = vi.fn();
    commands.register("pub.rich", "pub.rich.show", ran);
    render(ui());
    act(() => {
      tree.message = "3 hidden. [Click to show](command:pub.rich.show) now";
    });
    const link = await screen.findByRole("button", { name: "Click to show" });
    expect(link.parentElement).toHaveTextContent("3 hidden. Click to show now");
    fireEvent.click(link);
    await waitFor(() => expect(ran).toHaveBeenCalledOnce());
    act(() => {
      tree.message = "Failed to load: boom";
      tree.messageSeverity = "error";
    });
    expect(await screen.findByText("Failed to load: boom")).toHaveClass("text-destructive");
    act(() => {
      tree.notice = "agentAsleep";
    });
    expect(await screen.findByText(/agent is asleep/i)).toBeInTheDocument();
    expect(screen.queryByText("Failed to load: boom")).toBeNull();
    expect(screen.queryByText("one")).toBeNull();
    act(() => {
      tree.notice = "bogus" as never;
      tree.tag = { text: "Asleep", icon: "moon", tooltip: "Served by the host" };
    });
    expect(tree.notice).toBeUndefined();
    expect(await screen.findByTestId("extension-view-tag")).toHaveTextContent("Asleep");
  });

  it("reports visibility while a drawn copy is on screen, and tells the host", async () => {
    const { tree, ui, shown } = richSetup();
    const events: boolean[] = [];
    tree.onDidChangeVisibility(({ visible }) => events.push(visible));
    expect(tree.visible).toBe(false);
    const { rerender, unmount } = render(ui("s1", false));
    expect(tree.visible).toBe(false);
    rerender(ui("s1", true));
    expect(tree.visible).toBe(true);
    expect(shown).toHaveBeenCalledWith(RICH_VIEW);
    unmount();
    expect(tree.visible).toBe(false);
    expect(events).toEqual([true, false]);
  });

  it("reloads once for a burst of changes", async () => {
    const { setRoots, ui, registry } = richSetup();
    render(ui());
    await screen.findByText("one");
    const model = registry.get(RICH_VIEW)!.tree!;
    const getChildren = vi.spyOn(model, "getChildren");
    act(() => {
      setRoots(["x"]);
      setRoots(["y"]);
      setRoots(["z"]);
    });
    expect(await screen.findByText("z")).toBeInTheDocument();
    expect(getChildren).toHaveBeenCalledTimes(1);
  });
});

describe("extension view errors", () => {
  it("shows a failed extension's view as an error, not the no-provider text", () => {
    const registry = new RailViewRegistry();
    const views = testViewsService(new CommandRegistry(), { registry });
    const { contributions } = parseContributions("pub.bad", {
      views: { "omnigent.rightPanel": [{ id: "pub.bad.view", name: "Bad" }] },
    });
    views.addExtension("pub.bad", contributions);
    views.extensionSettled("pub.bad", "activation failed");
    render(
      <ExtensionRailView viewId="pub.bad.view" settled conversationId="s1" registry={registry} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Bad could not be loaded");
  });
});

describe("tree handles", () => {
  it("drops handles of earlier root loads, keeping the one before for rows still on screen", async () => {
    let generation = 0;
    const ran = vi.fn();
    const commands = new CommandRegistry();
    commands.register("pub.ext", "pub.ext.open", ran);
    const { model } = createTreeViewModel<string>(
      {
        getChildren: (element) => (element ? [] : [`root-${generation}`]),
        getTreeItem: (label) => ({
          id: label,
          label,
          command: { command: "pub.ext.open", arguments: [label] },
        }),
      },
      {
        executeCommand: (command, args) => commands.execute(command, args, () => {}),
        logError: vi.fn(),
      },
    );
    const first = await model.getChildren(undefined);
    generation = 1;
    await model.getChildren(undefined);
    // A row of the previous load still runs while the new one is on screen.
    model.runCommand(first[0].handle);
    await waitFor(() => expect(ran).toHaveBeenCalledWith("root-0"));
    generation = 2;
    await model.getChildren(undefined);
    model.runCommand(first[0].handle);
    expect(await model.getChildren(first[0].handle)).toEqual([]);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(ran).toHaveBeenCalledTimes(1);
  });
});
