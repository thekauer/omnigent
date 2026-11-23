import type * as omnigent from "omnigent";
import { describe, expect, it, vi } from "vitest";
import { HostReconnectProviderRegistry, type ReconnectHost } from "@/lib/hostReconnectProviders";
import { createExtensionApi } from "./api";
import { CommandRegistry } from "./commands";
import type { NodeCommandRoute, NodeProgressListener } from "./nodeCommands";
import { hostServices, recordingNotifications } from "./testServices";

const offlineHost: ReconnectHost = {
  hostId: "host-1",
  name: "my-box",
  status: "offline",
  sandboxProvider: null,
  resumable: false,
};
const session = { sessionId: "s1", wakeSandbox: async () => {} };

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** A Node route whose command reports the given progress events, then resolves. */
function nodeRoute(
  events: Parameters<NodeProgressListener>[0][],
  result: unknown = "done",
): NodeCommandRoute {
  return {
    ownerOf: (command) => (command === "pub.node.run" ? "pub.node" : undefined),
    async execute(_command, _args, onProgress) {
      for (const event of events) onProgress(event);
      return result;
    },
  };
}

function setup(node?: NodeCommandRoute, commands = new CommandRegistry(node)) {
  const notifications = recordingNotifications();
  const registry = new HostReconnectProviderRegistry({ report: vi.fn() });
  const onReconnected = vi.fn();
  const logError = vi.fn();
  const services = hostServices({
    commands,
    notifications,
    hostReconnect: { registry, onReconnected },
  });
  const handle = createExtensionApi("pub.a", services, logError);
  return { api: handle.api, handle, notifications, registry, onReconnected, logError };
}

describe("commands API", () => {
  it("registers, runs and disposes a command; deactivation removes leftovers", async () => {
    const commands = new CommandRegistry();
    const { api, handle } = setup(undefined, commands);
    const kept = api.commands.registerCommand("pub.a.double", (value: number) => value * 2);
    expect(await api.commands.executeCommand<number>("pub.a.double", 21)).toBe(42);
    kept.dispose();
    await expect(api.commands.executeCommand("pub.a.double", 1)).rejects.toThrow("not found");

    api.commands.registerCommand("pub.a.left", () => 1);
    handle.dispose();
    expect(commands.has("pub.a.left")).toBe(false);
  });

  it("refuses calls after deactivation", async () => {
    const { api, handle, logError } = setup();
    handle.dispose();
    api.commands.registerCommand("pub.a.late", () => 1).dispose();
    await expect(api.commands.executeCommand("pub.a.late")).rejects.toThrow("deactivated");
    expect(logError).toHaveBeenCalledWith(
      "registerCommand called after the extension was deactivated; ignoring it",
    );
  });

  it("shows a Node command's progress as its own notification when none is open", async () => {
    const { api, notifications } = setup(
      nodeRoute([
        { scope: 7, kind: "start", title: "Node work" },
        { scope: 7, kind: "report", message: "half way" },
        { scope: 7, kind: "end" },
      ]),
    );
    expect(await api.commands.executeCommand("pub.node.run")).toBe("done");
    expect(notifications.shown).toEqual([
      { kind: "progress", title: "Node work", messages: ["half way"], closed: true },
    ]);
  });

  it("closes a Node progress notification the stream left open", async () => {
    const { api, notifications } = setup(nodeRoute([{ scope: 1, kind: "start", title: "T" }]));
    await api.commands.executeCommand("pub.node.run");
    expect(notifications.shown[0]?.closed).toBe(true);
  });

  it("joins a Node command's progress to the extension's open withProgress", async () => {
    const { api, notifications } = setup(
      nodeRoute([
        { scope: 1, kind: "start", title: "ignored" },
        { scope: 1, kind: "report", message: "from node" },
        { scope: 1, kind: "end" },
      ]),
    );
    await api.window.withProgress({ title: "Outer" }, () =>
      api.commands.executeCommand("pub.node.run"),
    );
    expect(notifications.shown).toEqual([
      { kind: "progress", title: "Outer", messages: ["from node"], closed: true },
    ]);
  });
});

describe("window API", () => {
  it("withProgress resolves with the task's value and shows failures", async () => {
    const { api, notifications } = setup();
    expect(await api.window.withProgress({ title: "Count" }, () => 3)).toBe(3);
    await expect(
      api.window.withProgress({ title: "Fail" }, async () => {
        throw new Error("no luck");
      }),
    ).rejects.toThrow("no luck");
    expect(notifications.shown[1]).toMatchObject({ title: "Fail", error: "no luck" });
  });

  it("shows information and error messages", async () => {
    const { api, notifications } = setup();
    await expect(api.window.showInformationMessage("Hi")).resolves.toBeUndefined();
    await api.window.showErrorMessage("Oops");
    expect(notifications.shown.map(({ kind, title }) => [kind, title])).toEqual([
      ["info", "Hi"],
      ["error", "Oops"],
    ]);
  });
});

describe("hosts.registerReconnectProvider", () => {
  it("adds a provider that gets plain host data and a progress notification", async () => {
    const { api, registry, notifications, onReconnected } = setup();
    let seen: omnigent.ReconnectHost | undefined;
    api.hosts.registerReconnectProvider({
      canReconnect: (host) => host.name === "my-box",
      async reconnect(host, progress) {
        seen = host;
        progress.report({ message: "Starting..." });
      },
    });
    const selected = registry.select(offlineHost);
    if (!selected || selected instanceof Promise) throw new Error("expected a sync selection");
    expect(selected.id).toBe("pub.a.hostReconnect#1");
    await selected.provider.reconnect(offlineHost, session);
    expect(seen).toEqual(offlineHost);
    expect(seen).not.toBe(offlineHost);
    expect(Object.isFrozen(seen)).toBe(true);
    expect(notifications.shown).toEqual([
      { kind: "progress", title: "Reconnecting my-box", messages: ["Starting..."], closed: true },
    ]);
    expect(onReconnected).toHaveBeenCalledOnce();
  });

  it("shows a failed reconnect's error and resolves, without refreshing liveness", async () => {
    const { api, registry, notifications, onReconnected } = setup();
    api.hosts.registerReconnectProvider({
      canReconnect: () => true,
      reconnect: async () => {
        throw new Error("Sign in on the machine first.");
      },
    });
    const selected = registry.select(offlineHost);
    if (!selected || selected instanceof Promise) throw new Error("expected a sync selection");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(selected.provider.reconnect(offlineHost, session)).resolves.toBeUndefined();
    info.mockRestore();
    expect(notifications.shown[0]).toMatchObject({ error: "Sign in on the machine first." });
    expect(onReconnected).not.toHaveBeenCalled();
  });

  it("joins a second reconnect of the same host while the first runs", async () => {
    const { api, registry } = setup();
    const running = deferred();
    const reconnect = vi.fn(() => running.promise);
    api.hosts.registerReconnectProvider({ canReconnect: () => true, reconnect });
    const selected = registry.select(offlineHost);
    if (!selected || selected instanceof Promise) throw new Error("expected a sync selection");
    const first = selected.provider.reconnect(offlineHost, session);
    const second = selected.provider.reconnect(offlineHost, session);
    expect(second).toBe(first);
    running.resolve();
    await first;
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it("is unregistered by its Disposable and by deactivation", () => {
    const { api, registry, handle } = setup();
    const provider = { canReconnect: () => true, reconnect: async () => {} };
    api.hosts.registerReconnectProvider(provider).dispose();
    expect(registry.select(offlineHost)).toBeUndefined();
    api.hosts.registerReconnectProvider(provider);
    expect(registry.size).toBe(1);
    handle.dispose();
    expect(registry.size).toBe(0);
  });
});
