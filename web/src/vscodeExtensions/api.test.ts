import type * as omnigent from "omnigent";
import { describe, expect, it, vi } from "vitest";
import { HostProgressLocations } from "@/lib/hostProgress";
import {
  HostReconnectProviderRegistry,
  type ReconnectHost,
  type ReconnectSession,
} from "@/lib/hostReconnectProviders";
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
/** A reconnect session whose progress reports are recorded. */
function reconnectSession(): ReconnectSession & { reports: string[] } {
  const reports: string[] = [];
  return {
    sessionId: "s1",
    wakeSandbox: async () => ({}),
    progress: { report: (value) => reports.push(value.message ?? "") },
    reports,
  };
}

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
  const hostProgress = new HostProgressLocations();
  const services = hostServices({
    commands,
    notifications,
    hostReconnect: { registry, onReconnected },
    hostProgress,
  });
  const handle = createExtensionApi("pub.a", services, logError);
  return {
    api: handle.api,
    handle,
    notifications,
    registry,
    onReconnected,
    logError,
    hostProgress,
  };
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

describe("window.withProgress at a host", () => {
  it("shows the title, then each message, inline at the host, without a notification", async () => {
    const { api, notifications, hostProgress } = setup();
    const running = deferred<number>();
    let progress!: omnigent.Progress<omnigent.ProgressReport>;
    const result = api.window.withProgress(
      { title: "Syncing", location: { hostId: "host-1" } },
      (reporter) => {
        progress = reporter;
        return running.promise;
      },
    );
    expect(hostProgress.get("host-1").progress).toBe("Syncing");
    progress.report({ message: "Copying files" });
    expect(hostProgress.get("host-1").progress).toBe("Copying files");
    running.resolve(7);
    expect(await result).toBe(7);
    expect(hostProgress.get("host-1")).toEqual({ progress: null, failure: null });
    expect(notifications.shown).toEqual([]);
  });

  it("ends on a failure without showing it there, and rejects", async () => {
    const { api, notifications, hostProgress } = setup();
    await expect(
      api.window.withProgress({ title: "T", location: { hostId: "host-1" } }, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(hostProgress.get("host-1")).toEqual({ progress: null, failure: null });
    expect(notifications.shown).toEqual([]);
  });

  it("refuses a host id that is not a non-empty string", async () => {
    const { api } = setup();
    await expect(
      api.window.withProgress({ title: "T", location: { hostId: "" } }, () => 1),
    ).rejects.toThrow("location.hostId");
  });
});

describe("hosts.registerReconnectProvider", () => {
  it("adds a provider that gets plain host data and reports to the host's progress", async () => {
    const { api, registry, notifications, onReconnected } = setup();
    let seen: omnigent.ReconnectHost | undefined;
    api.hosts.registerReconnectProvider({
      canReconnect: (host) => host.name === "my-box",
      async reconnect(host, progress) {
        seen = host;
        progress.report({ message: "Starting..." });
        return { detail: "started it" };
      },
    });
    const selected = registry.select(offlineHost);
    if (!selected || selected instanceof Promise) throw new Error("expected a sync selection");
    expect(selected.id).toBe("pub.a.hostReconnect#1");
    const session = reconnectSession();
    await expect(selected.provider.reconnect(offlineHost, session)).resolves.toEqual({
      detail: "started it",
    });
    expect(seen).toEqual(offlineHost);
    expect(seen).not.toBe(offlineHost);
    expect(Object.isFrozen(seen)).toBe(true);
    expect(session.reports).toEqual(["Starting..."]);
    // Reconnect shows its progress at the host, not as a notification.
    expect(notifications.shown).toEqual([]);
    expect(onReconnected).toHaveBeenCalledOnce();
  });

  it("routes a Node command's progress to the reconnect's", async () => {
    const { api, registry, notifications } = setup(
      nodeRoute([
        { scope: 1, kind: "start", title: "Reconnecting my-box" },
        { scope: 1, kind: "report", message: "Starting machine..." },
        { scope: 1, kind: "report", message: "Starting omni..." },
        { scope: 1, kind: "end" },
      ]),
    );
    api.hosts.registerReconnectProvider({
      canReconnect: () => true,
      reconnect: async () => {
        await api.commands.executeCommand("pub.node.run");
      },
    });
    const selected = registry.select(offlineHost);
    if (!selected || selected instanceof Promise) throw new Error("expected a sync selection");
    const session = reconnectSession();
    await selected.provider.reconnect(offlineHost, session);
    expect(session.reports).toEqual(["Starting machine...", "Starting omni..."]);
    expect(notifications.shown).toEqual([]);
  });

  it("rejects with a failed reconnect's error, without a notification or refresh", async () => {
    const { api, registry, notifications, onReconnected } = setup();
    api.hosts.registerReconnectProvider({
      canReconnect: () => true,
      reconnect: async () => {
        throw new Error("Sign in on the machine first.");
      },
    });
    const selected = registry.select(offlineHost);
    if (!selected || selected instanceof Promise) throw new Error("expected a sync selection");
    await expect(selected.provider.reconnect(offlineHost, reconnectSession())).rejects.toThrow(
      "Sign in on the machine first.",
    );
    expect(notifications.shown).toEqual([]);
    expect(onReconnected).not.toHaveBeenCalled();
  });

  it("joins a second reconnect of the same host, giving it the progress so far and the rest", async () => {
    const { api, registry } = setup();
    const running = deferred();
    let progress!: omnigent.Progress<omnigent.ProgressReport>;
    const reconnect = vi.fn((_host: omnigent.ReconnectHost, reporter: typeof progress) => {
      progress = reporter;
      return running.promise;
    });
    api.hosts.registerReconnectProvider({ canReconnect: () => true, reconnect });
    const selected = registry.select(offlineHost);
    if (!selected || selected instanceof Promise) throw new Error("expected a sync selection");
    const firstSession = reconnectSession();
    const secondSession = reconnectSession();
    const first = selected.provider.reconnect(offlineHost, firstSession);
    progress.report({ message: "Starting machine..." });
    const second = selected.provider.reconnect(offlineHost, secondSession);
    expect(second).toBe(first);
    progress.report({ message: "Starting omni..." });
    running.resolve();
    await first;
    expect(reconnect).toHaveBeenCalledOnce();
    expect(firstSession.reports).toEqual(["Starting machine...", "Starting omni..."]);
    expect(secondSession.reports).toEqual(["Starting machine...", "Starting omni..."]);
  });

  it("shows a running reconnect at its host until it settles, for any session that opens", async () => {
    const { api, registry, hostProgress } = setup();
    const running = deferred();
    let progress!: omnigent.Progress<omnigent.ProgressReport>;
    api.hosts.registerReconnectProvider({
      canReconnect: () => true,
      reconnect: (_host, reporter) => {
        progress = reporter;
        return running.promise;
      },
    });
    const selected = registry.select(offlineHost);
    if (!selected || selected instanceof Promise) throw new Error("expected a sync selection");
    const result = selected.provider.reconnect(offlineHost, reconnectSession());
    expect(hostProgress.get(offlineHost.hostId).progress).toBe("Reconnecting...");
    progress.report({ message: "Starting omni..." });
    expect(hostProgress.get(offlineHost.hostId).progress).toBe("Starting omni...");
    running.resolve();
    await result;
    expect(hostProgress.get(offlineHost.hostId)).toEqual({ progress: null, failure: null });
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
