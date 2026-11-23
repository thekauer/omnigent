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
import { sanitizeTreeItem } from "./treeView";
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
