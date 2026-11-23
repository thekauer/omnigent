import type * as omnigent from "omnigent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";
import { MAX_EXTENSION_STATE_BYTES, readExtensionState } from "@/lib/sessionWorkspaceState";
import { RailViewRegistry } from "@/shell/railViews";
import { WorkspaceBridge } from "@/shell/workspaceBridge";
import { getExtensionApi } from "./apiRegistry";
import {
  OPEN_FILE_COMMAND,
  REFRESH_CHANGED_FILES_COMMAND,
  SET_CONTEXT_COMMAND,
  registerBuiltInCommands,
} from "./builtinCommands";
import { CommandRegistry } from "./commands";
import { ContextKeyService } from "./contextKeys";
import { ExtensionHost } from "./host";
import { createWorkspaceState, sessionExtensionStateStore } from "./memento";
import { SessionsService } from "./sessionsService";
import { hostServices, testViewsService } from "./testServices";
import { WorkspaceService } from "./workspaceService";

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

function changed(path: string, status: WorkspaceChangedFile["status"]): WorkspaceChangedFile {
  return {
    path,
    name: path.split("/").at(-1)!,
    repository_root: path.startsWith("repo/") ? "repo" : undefined,
    status,
    bytes: 10,
    modified_at: 1,
    lines_added: 2,
    lines_removed: null,
  };
}

afterEach(() => localStorage.clear());

describe("context.workspaceState", () => {
  it("is scoped to the active chat session", async () => {
    let session: string | undefined = "s1";
    const memento = createWorkspaceState("pub.ext", sessionExtensionStateStore, () => session);
    expect(memento.get("mode", "list")).toBe("list");
    await memento.update("mode", "tree");
    await memento.update("nested", { a: [1, 2] });
    expect(memento.get("mode")).toBe("tree");
    expect(memento.keys()).toEqual(["mode", "nested"]);
    // `get` returns a copy.
    memento.get<{ a: number[] }>("nested")!.a.push(3);
    expect(memento.get("nested")).toEqual({ a: [1, 2] });
    session = "s2";
    expect(memento.get("mode")).toBeUndefined();
    expect(memento.keys()).toEqual([]);
    session = "s1";
    await memento.update("mode", undefined);
    expect(memento.keys()).toEqual(["nested"]);
    expect(readExtensionState("s1", "pub.ext")).toEqual({ nested: { a: [1, 2] } });
  });

  it("rejects without a session, over the caps, and for bad keys", async () => {
    let session: string | undefined;
    const memento = createWorkspaceState("pub.ext", sessionExtensionStateStore, () => session);
    await expect(memento.update("mode", "tree")).rejects.toThrow(/no chat session/);
    session = "s1";
    await expect(memento.update("big", "x".repeat(MAX_EXTENSION_STATE_BYTES))).rejects.toThrow(
      RangeError,
    );
    await expect(memento.update("", 1)).rejects.toThrow(TypeError);
    await expect(memento.update("loop", { toJSON: () => 1n })).rejects.toThrow(TypeError);
    expect(memento.keys()).toEqual([]);
  });

  it("is passed to activate, bound to the host's active session", async () => {
    const store = { sessionId: "s1" as string | null };
    const sessions = new SessionsService({
      getState: () => ({
        sessionId: store.sessionId,
        totalCostUsd: null,
        costHidden: false,
        usageByModel: null,
      }),
      subscribe: () => () => {},
    });
    let context: omnigent.ExtensionContext | undefined;
    const host = new ExtensionHost({
      services: hostServices({ sessions }),
      importModule: () =>
        Promise.resolve({
          activate: (received: omnigent.ExtensionContext) => {
            context = received;
          },
        }),
      console: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    });
    await host.start([
      { id: "pub.ext", version: "1.0.0", activationEvents: ["*"], entryUrl: "/ext.js" },
    ]);
    await context!.workspaceState.update("mode", "tree");
    expect(readExtensionState("s1", "pub.ext")).toEqual({ mode: "tree" });
  });
});

describe("workspace.getChangedFiles and onDidChangeChangedFiles", () => {
  it("serve frozen plain copies and fire on changes and session switches", async () => {
    const bridge = new WorkspaceBridge();
    const service = new WorkspaceService(bridge);
    const events: omnigent.ChangedFilesChangeEvent[] = [];
    service.onDidChangeChangedFiles((event) => events.push(event));
    expect(service.getChangedFiles()).toBeUndefined();
    const files = [changed("repo/a.ts", "created"), changed("b.md", "deleted")];
    bridge.publishChangedFiles("s1", files);
    // A burst is coalesced into one event.
    bridge.publishChangedFiles("s1", files);
    await flush();
    expect(events).toHaveLength(1);
    expect(events[0].sessionId).toBe("s1");
    expect(events[0].files).toEqual([
      {
        path: "repo/a.ts",
        name: "a.ts",
        repositoryRoot: "repo",
        status: "added",
        bytes: 10,
        modifiedAt: 1,
        linesAdded: 2,
        linesRemoved: null,
      },
      expect.objectContaining({ path: "b.md", repositoryRoot: undefined, status: "deleted" }),
    ]);
    expect(Object.isFrozen(service.getChangedFiles())).toBe(true);
    expect(Object.isFrozen(service.getChangedFiles()![0])).toBe(true);
    bridge.publishChangedFiles("s2", undefined);
    await flush();
    expect(events.at(-1)).toEqual({ sessionId: "s2", files: undefined });
    bridge.publishChangedFiles("s2", undefined, "502 Bad Gateway");
    await flush();
    expect(events.at(-1)).toEqual({ sessionId: "s2", files: undefined, error: "502 Bad Gateway" });
    expect(service.changedFilesError).toBe("502 Bad Gateway");
    bridge.publishChangedFiles(null, []);
    await flush();
    expect(service.changedFilesError).toBeUndefined();
    expect(service.getChangedFiles()).toBeUndefined();
    service.dispose();
  });

  it("reach extensions through the API and stop after deactivation", async () => {
    const bridge = new WorkspaceBridge();
    const workspace = new WorkspaceService(bridge);
    const seen: (readonly omnigent.ChangedFile[] | undefined)[] = [];
    const host = new ExtensionHost({
      services: hostServices({ workspace }),
      importModule: () =>
        Promise.resolve({
          activate: () => {
            getExtensionApi("pub.ext").workspace.onDidChangeChangedFiles((event) =>
              seen.push(event.files),
            );
          },
        }),
      console: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    });
    await host.start([
      { id: "pub.ext", version: "1.0.0", activationEvents: ["*"], entryUrl: "/ext.js" },
    ]);
    bridge.publishChangedFiles("s1", [changed("a.ts", "modified")]);
    await flush();
    expect(seen.map((files) => files?.map((file) => file.path))).toEqual([["a.ts"]]);
    await host.deactivate("pub.ext");
    bridge.publishChangedFiles("s1", []);
    await flush();
    expect(seen).toHaveLength(1);
  });
});

describe("built-in commands", () => {
  it("set context keys, open files and refresh changed files through the bridge", async () => {
    const commands = new CommandRegistry();
    const contextKeys = new ContextKeyService();
    const bridge = new WorkspaceBridge();
    const registration = registerBuiltInCommands(commands, { contextKeys, workspace: bridge });
    const run = (id: string, ...args: unknown[]) => commands.execute(id, args, () => {});
    await expect(run(OPEN_FILE_COMMAND, "a.ts")).rejects.toThrow(/no workspace/);
    const openFile = vi.fn();
    const refreshChangedFiles = vi.fn(() => Promise.resolve());
    const unregister = bridge.registerActions({ openFile, refreshChangedFiles });
    await run(SET_CONTEXT_COMMAND, "pub.ext.mode", "tree");
    expect(contextKeys.get("pub.ext.mode")).toBe("tree");
    await run(OPEN_FILE_COMMAND, "src/a.ts");
    expect(openFile).toHaveBeenCalledWith("src/a.ts");
    await expect(run(OPEN_FILE_COMMAND, 3)).rejects.toThrow(TypeError);
    await run(REFRESH_CHANGED_FILES_COMMAND);
    expect(refreshChangedFiles).toHaveBeenCalledOnce();
    await expect(run(SET_CONTEXT_COMMAND, "bad key", 1)).rejects.toThrow(TypeError);
    // Extensions cannot take over a built-in id.
    expect(() => commands.register("pub.ext", SET_CONTEXT_COMMAND, () => {})).toThrow(/exists/);
    unregister();
    registration.dispose();
    expect(commands.has(OPEN_FILE_COMMAND)).toBe(false);
  });
});

describe("contributed views through the host", () => {
  it("register before activation, stop loading after it, and back createTreeView", async () => {
    const registry = new RailViewRegistry();
    const commands = new CommandRegistry();
    const views = testViewsService(commands, { registry });
    let release!: () => void;
    const host = new ExtensionHost({
      services: hostServices({ commands, views }),
      importModule: () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              activate: () => {
                const api = getExtensionApi("pub.ext");
                api.window.createTreeView("pub.ext.view", {
                  treeDataProvider: {
                    getChildren: () => ["one"],
                    getTreeItem: (label: string) => ({
                      label,
                      collapsibleState: api.TreeItemCollapsibleState.None,
                    }),
                  },
                });
              },
            });
        }),
      console: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    });
    const started = host.start([
      {
        id: "pub.ext",
        version: "1.0.0",
        activationEvents: ["*"],
        entryUrl: "/ext.js",
        contributes: {
          views: { "omnigent.rightPanel": [{ id: "pub.ext.view", name: "View" }] },
        },
      },
    ]);
    expect(registry.get("pub.ext.view")).toMatchObject({ name: "View", loading: true });
    release();
    await started;
    const view = registry.get("pub.ext.view")!;
    expect(view.loading).toBe(false);
    expect((await view.tree!.getChildren(undefined)).map((node) => node.label)).toEqual(["one"]);
    // Deactivation disposes the tree view; the contributed view stays.
    await host.deactivate("pub.ext");
    expect(registry.get("pub.ext.view")?.tree).toBeUndefined();
    await host.dispose();
    expect(registry.get("pub.ext.view")).toBeUndefined();
  });
});
