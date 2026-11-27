import type * as omnigent from "omnigent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";
import { MAX_EXTENSION_STATE_BYTES, readExtensionState } from "@/lib/sessionWorkspaceState";
import { RailViewRegistry } from "@/shell/railViews";
import {
  EMPTY_WORKSPACE_STATE,
  type WorkspaceActions,
  WorkspaceBridge,
  type WorkspaceBridgeState,
} from "@/shell/workspaceBridge";
import { parseConfigurationContributions } from "@/configuration/configurationContributions";
import { ConfigurationRegistry } from "@/configuration/configurationRegistry";
import { ConfigurationService } from "@/configuration/configurationService";
import { readStoredSettings, SETTINGS_STORAGE_KEY } from "@/configuration/settingsDocument";
import { SettingsStore } from "@/configuration/settingsStore";
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

/** An active workspace source on `bridge`, as the shell registers one. */
function sourceOn(bridge: WorkspaceBridge, actions?: WorkspaceActions) {
  const source = bridge.createSource();
  source.setActive(true);
  if (actions) source.setActions(actions);
  let state: WorkspaceBridgeState = EMPTY_WORKSPACE_STATE;
  const publish = (
    sessionId: string | null,
    changedFiles: readonly WorkspaceChangedFile[] | undefined,
    error?: string,
    patch: Partial<WorkspaceBridgeState> = {},
  ) => {
    state = { ...state, sessionId, changedFiles, error, ...patch };
    if (error === undefined) delete (state as { error?: string }).error;
    source.update(state);
  };
  return { source, publish, state: () => state };
}

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

  it("stores a key named __proto__ like any other", async () => {
    const memento = createWorkspaceState("pub.ext", sessionExtensionStateStore, () => "s1");
    await memento.update("__proto__", { polluted: true });
    expect(memento.keys()).toEqual(["__proto__"]);
    expect(memento.get("__proto__")).toEqual({ polluted: true });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
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
    const { publish } = sourceOn(bridge);
    const service = new WorkspaceService(bridge);
    const events: omnigent.ChangedFilesChangeEvent[] = [];
    service.onDidChangeChangedFiles((event) => events.push(event));
    expect(service.getChangedFiles()).toBeUndefined();
    const files = [changed("repo/a.ts", "created"), changed("b.md", "deleted")];
    publish("s1", files);
    // A burst is coalesced into one event.
    publish("s1", files);
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
    publish("s2", undefined);
    await flush();
    expect(events.at(-1)).toEqual({
      sessionId: "s2",
      files: undefined,
      availability: "available",
      servedFromHost: false,
    });
    publish("s2", undefined, "502 Bad Gateway");
    await flush();
    expect(events.at(-1)).toEqual({
      sessionId: "s2",
      files: undefined,
      error: "502 Bad Gateway",
      availability: "available",
      servedFromHost: false,
    });
    expect(service.changedFilesError).toBe("502 Bad Gateway");
    publish("s2", undefined, undefined, { availability: "agentAsleep", servedFromHost: true });
    await flush();
    expect(events.at(-1)).toMatchObject({ availability: "agentAsleep", servedFromHost: true });
    expect(service.availability).toBe("agentAsleep");
    expect(service.servedFromHost).toBe(true);
    publish(null, []);
    await flush();
    expect(service.changedFilesError).toBeUndefined();
    expect(service.getChangedFiles()).toBeUndefined();
    service.dispose();
  });

  it("reach extensions through the API and stop after deactivation", async () => {
    const bridge = new WorkspaceBridge();
    const { publish } = sourceOn(bridge);
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
    publish("s1", [changed("a.ts", "modified")]);
    await flush();
    expect(seen.map((files) => files?.map((file) => file.path))).toEqual([["a.ts"]]);
    await host.deactivate("pub.ext");
    publish("s1", []);
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
    const { source } = sourceOn(bridge, { openFile, refreshChangedFiles, updateSettings: vi.fn() });
    const unregister = () => source.dispose();
    await run(SET_CONTEXT_COMMAND, "pub.ext.mode", "tree");
    expect(contextKeys.get("pub.ext.mode")).toBe("tree");
    await run(OPEN_FILE_COMMAND, "src/a.ts");
    expect(openFile).toHaveBeenCalledWith("src/a.ts");
    await expect(run(OPEN_FILE_COMMAND, 3)).rejects.toThrow(TypeError);
    await run(REFRESH_CHANGED_FILES_COMMAND);
    expect(refreshChangedFiles).toHaveBeenCalledOnce();
    await expect(run(SET_CONTEXT_COMMAND, "bad key", 1)).rejects.toThrow(TypeError);
    // Extensions cannot take over a built-in id.
    expect(() => commands.register("pub.ext", SET_CONTEXT_COMMAND, () => {})).toThrow(
      /must start with the extension id/,
    );
    expect(() => commands.register("pub.ext", OPEN_FILE_COMMAND, () => {})).toThrow(/reserved/);
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

describe("workspaces on screen", () => {
  it("follows the latest activated source, so a selected grid cell's files reach extensions", async () => {
    const bridge = new WorkspaceBridge();
    const shellOpen = vi.fn();
    const cellOpen = vi.fn();
    const shell = sourceOn(bridge, {
      openFile: shellOpen,
      refreshChangedFiles: () => Promise.resolve(),
      updateSettings: vi.fn(),
    });
    shell.publish("shell", [changed("a.ts", "modified")]);
    const cell = bridge.createSource();
    cell.update({ ...EMPTY_WORKSPACE_STATE, sessionId: "cell", changedFiles: [] });
    cell.setActions({
      openFile: cellOpen,
      refreshChangedFiles: () => Promise.resolve(),
      updateSettings: vi.fn(),
    });
    const service = new WorkspaceService(bridge);
    expect(service.activeSessionId).toBe("shell");
    cell.setActive(true);
    await flush();
    expect(service.activeSessionId).toBe("cell");
    expect(service.getChangedFiles()).toEqual([]);
    bridge.openFile("x.ts");
    expect(cellOpen).toHaveBeenCalledWith("x.ts");
    // An update to a source behind the front one changes nothing on screen.
    shell.publish("shell", []);
    await flush();
    expect(service.activeSessionId).toBe("cell");
    cell.setActive(false);
    await flush();
    expect(service.activeSessionId).toBe("shell");
    bridge.openFile("y.ts");
    expect(shellOpen).toHaveBeenCalledWith("y.ts");
    service.dispose();
  });

  it("keeps workspaceState with the workspace on screen", async () => {
    const bridge = new WorkspaceBridge();
    const shell = sourceOn(bridge);
    shell.publish("s1", []);
    const workspace = new WorkspaceService(bridge);
    let context: omnigent.ExtensionContext | undefined;
    const host = new ExtensionHost({
      services: hostServices({ workspace }),
      importModule: () =>
        Promise.resolve({ activate: (ctx: omnigent.ExtensionContext) => void (context = ctx) }),
      console: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    });
    await host.start([
      { id: "pub.ext", version: "1.0.0", activationEvents: ["*"], entryUrl: "/e.js" },
    ]);
    await context!.workspaceState.update("mode", "tree");
    shell.publish("s2", []);
    await flush();
    expect(context!.workspaceState.get("mode")).toBeUndefined();
    shell.publish("s1", []);
    await flush();
    expect(context!.workspaceState.get("mode")).toBe("tree");
    await host.dispose();
  });
});

describe("workspace.getConfiguration", () => {
  it("reads and updates the workspace's file settings, and reports what changed", async () => {
    const bridge = new WorkspaceBridge();
    const updateSettings = vi.fn();
    const { publish, state } = sourceOn(bridge, {
      openFile: vi.fn(),
      refreshChangedFiles: () => Promise.resolve(),
      updateSettings,
    });
    publish("s1", []);
    const service = new WorkspaceService(bridge);
    const files = service.getConfiguration("omnigent.files");
    expect(files.get("sortOrder")).toBe("alpha");
    expect(files.get("showHidden")).toBe(true);
    expect(files.has("sortOrder")).toBe(true);
    expect(files.has("nope")).toBe(false);
    expect(files.get("nope", 7)).toBe(7);
    expect(service.getConfiguration().get("omnigent.files.sortOrder")).toBe("alpha");
    expect(service.settingValues()).toEqual({
      "omnigent.files.sortOrder": "alpha",
      "omnigent.files.showHidden": true,
    });
    await files.update("sortOrder", "size");
    expect(updateSettings).toHaveBeenCalledWith({ sortOrder: "size" });
    await expect(files.update("sortOrder", "sideways")).rejects.toThrow(TypeError);
    await expect(files.update("showHidden", "yes")).rejects.toThrow(TypeError);
    await expect(files.update("nope", 1)).rejects.toThrow(/unknown setting/);
    const changes: omnigent.ConfigurationChangeEvent[] = [];
    service.onDidChangeConfiguration((event) => changes.push(event));
    publish("s1", [], undefined, { settings: { ...state().settings, showHidden: false } });
    await flush();
    expect(changes).toHaveLength(1);
    expect(changes[0].affectsConfiguration("omnigent.files")).toBe(true);
    expect(changes[0].affectsConfiguration("omnigent.files.showHidden")).toBe(true);
    expect(changes[0].affectsConfiguration("omnigent.files.sortOrder")).toBe(false);
    service.dispose();
  });
});

describe("workspace.getConfiguration over the configuration registry", () => {
  afterEach(() => localStorage.clear());

  it("reads, inspects and writes an extension's contributed settings", async () => {
    localStorage.clear();
    const configuration = new ConfigurationService(
      new ConfigurationRegistry(),
      new SettingsStore(),
    );
    const workspace = new WorkspaceService(new WorkspaceBridge(), configuration);
    const changes: string[] = [];
    let api: typeof omnigent | undefined;
    const host = new ExtensionHost({
      services: hostServices({ workspace, configuration }),
      importModule: () =>
        Promise.resolve({
          activate: () => {
            api = getExtensionApi("pub.ext");
            api.workspace.onDidChangeConfiguration((event) => {
              if (event.affectsConfiguration("pub.ext.mode")) changes.push("mode");
              if (event.affectsConfiguration("omnigent.files")) changes.push("files");
            });
          },
        }),
      console: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    });
    await host.start([
      {
        id: "pub.ext",
        version: "1.0.0",
        activationEvents: ["*"],
        entryUrl: "/ext.js",
        contributes: {
          configuration: {
            title: "Ext",
            properties: {
              "pub.ext.mode": { type: "string", enum: ["a", "b"], default: "a" },
              "pub.ext.count": { type: "integer", default: 1 },
            },
          },
        },
      },
    ]);
    const settings = api!.workspace.getConfiguration("pub.ext");
    expect(settings.get("mode")).toBe("a");
    expect(settings.has("mode")).toBe(true);
    expect(settings.inspect("mode")).toEqual({ key: "pub.ext.mode", defaultValue: "a" });
    expect(workspace.settingValues()).toMatchObject({ "pub.ext.mode": "a", "pub.ext.count": 1 });
    await settings.update("mode", "b");
    expect(settings.get("mode")).toBe("b");
    expect(settings.inspect("mode")).toMatchObject({ globalValue: "b" });
    expect(readStoredSettings(localStorage.getItem(SETTINGS_STORAGE_KEY)).text).toContain(
      '"pub.ext.mode": "b"',
    );
    expect(changes).toEqual(["mode"]);
    await expect(settings.update("mode", "c")).rejects.toThrow(/invalid value for pub\.ext\.mode/);
    await expect(settings.update("unknown", 1)).rejects.toThrow(/unknown setting/);
    // Another's settings (here the host's theme) are the user's, not this extension's.
    configuration.addExtension(
      "omnigent.themes",
      parseConfigurationContributions(
        "omnigent.themes",
        { configuration: { properties: { "omnigent.style.header": { type: "string" } } } },
        { builtIn: true },
      ).contributions,
    );
    await expect(
      api!.workspace.getConfiguration().update("omnigent.style.header", "solid"),
    ).rejects.toThrow(/not a setting of pub\.ext/);
    expect(api!.workspace.getConfiguration().get("omnigent.style.header")).toBeUndefined();
    // The user's settings JSON wins over the default; a wrong value there doesn't apply.
    new SettingsStore().saveText('{ "pub.ext.count": "many" }');
    configuration.reload();
    expect(settings.get("count")).toBe(1);
    expect(settings.get("mode")).toBe("a");
    expect(changes).toEqual(["mode", "mode"]);
    await host.dispose();
    // Its settings go with it.
    expect(configuration.has("pub.ext.mode")).toBe(false);
    workspace.dispose();
  });
});
