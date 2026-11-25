import type * as omnigent from "omnigent";
import { describe, expect, it, vi } from "vitest";
import { OMNIGENT_API_EXPORT_NAMES, createExtensionApi } from "./api";
import { getExtensionApi } from "./apiRegistry";
import { EventEmitter } from "./base";
import {
  ACTIVATION_TIMEOUT_MS,
  ExtensionHost,
  LOAD_TIMEOUT_MS,
  type ExtensionDescription,
} from "./host";
import { SessionHeaderItemRegistry } from "./sessionHeaderItems";
import { SessionsService, type SessionSourceState } from "./sessionsService";
import { hostServices } from "./testServices";
import { OMNIGENT_API_EXPORTS } from "../../vite.omnigentExtensions";

function fakeSource(initial: Partial<SessionSourceState> = {}) {
  let state: SessionSourceState = {
    sessionId: null,
    totalCostUsd: null,
    costHidden: false,
    usageByModel: null,
    ...initial,
  };
  const listeners = new Set<() => void>();
  return {
    source: {
      getState: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    set(patch: Partial<SessionSourceState>) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
  };
}

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

function setup(modules: Record<string, unknown>, initial?: Partial<SessionSourceState>) {
  const headerItems = new SessionHeaderItemRegistry();
  const store = fakeSource(initial);
  const sessions = new SessionsService(store.source);
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const host = new ExtensionHost({
    services: hostServices({ headerItems, sessions }),
    importModule: async (url) => {
      if (!(url in modules)) throw new Error(`no module at ${url}`);
      const module = modules[url];
      return typeof module === "function" ? (module as () => unknown)() : module;
    },
    whenStartupFinished: () => Promise.resolve(),
    console: log,
  });
  return { host, headerItems, store, sessions, log };
}

function describeExtension(
  id: string,
  activationEvents: string[] = ["onStartupFinished"],
): ExtensionDescription {
  return { id, version: "1.0.0", activationEvents, entryUrl: `/ext/${id}.js` };
}

describe("ExtensionHost", () => {
  it("activates with a context and disposes subscriptions on deactivate", async () => {
    const disposed = vi.fn();
    const deactivate = vi.fn();
    let context: omnigent.ExtensionContext | undefined;
    const { host } = setup({
      "/ext/pub.a.js": {
        activate: (ctx: omnigent.ExtensionContext) => {
          context = ctx;
          ctx.subscriptions.push({ dispose: disposed });
        },
        deactivate,
      },
    });
    await host.start([describeExtension("pub.a")]);
    expect(host.isActive("pub.a")).toBe(true);
    expect(context?.extension).toEqual({ id: "pub.a", version: "1.0.0" });

    await host.deactivate("pub.a");
    expect(deactivate).toHaveBeenCalledOnce();
    expect(disposed).toHaveBeenCalledOnce();
    expect(host.isActive("pub.a")).toBe(false);
  });

  it("registers the extension's API before importing its entry", async () => {
    let seen: unknown;
    const { host } = setup({
      "/ext/pub.a.js": () => {
        seen = getExtensionApi("pub.a");
        return { activate: () => {} };
      },
    });
    await host.start([describeExtension("pub.a")]);
    expect(seen).toBeDefined();
    await host.deactivate("pub.a");
    expect(() => getExtensionApi("pub.a")).toThrow(/no API registered/);
  });

  it("isolates an extension whose activate throws or whose entry fails to load", async () => {
    const good = vi.fn();
    const { host, headerItems, log } = setup({
      "/ext/pub.throws.js": {
        activate: () => {
          const api = getExtensionApi("pub.throws");
          const item = api.window.createSessionHeaderItem("x");
          item.text = "leaked";
          item.show();
          throw new Error("boom");
        },
      },
      "/ext/pub.rejects.js": { activate: () => Promise.reject(new Error("async boom")) },
      "/ext/pub.noactivate.js": {},
      "/ext/pub.good.js": { activate: good },
    });
    await host.start([
      describeExtension("pub.throws"),
      describeExtension("pub.rejects"),
      describeExtension("pub.missing"),
      describeExtension("pub.noactivate"),
      describeExtension("pub.good"),
    ]);
    expect(good).toHaveBeenCalledOnce();
    expect(host.isActive("pub.good")).toBe(true);
    for (const id of ["pub.throws", "pub.rejects", "pub.missing", "pub.noactivate"]) {
      expect(host.isActive(id)).toBe(false);
      expect(
        log.error.mock.calls.some(([message]) =>
          String(message).startsWith(`[omnigent-extensions] ${id}: `),
        ),
      ).toBe(true);
    }
    // What a failed activation created is cleaned up.
    expect(headerItems.getSnapshot()).toEqual([]);
  });

  it("fails a hanging activate after the timeout without blocking others", async () => {
    vi.useFakeTimers();
    try {
      let finishHang!: () => void;
      const lateDeactivate = vi.fn();
      const lateDisposed = vi.fn();
      const good = vi.fn();
      const { host, headerItems, log } = setup({
        "/ext/pub.hang.js": {
          activate: (ctx: omnigent.ExtensionContext) => {
            // Like a real entry, it holds the API it imported.
            const api = getExtensionApi("pub.hang");
            return new Promise<void>((resolve) => {
              finishHang = () => {
                const item = api.window.createSessionHeaderItem("late");
                item.text = "late";
                item.show();
                ctx.subscriptions.push({ dispose: lateDisposed });
                resolve();
              };
            });
          },
          deactivate: lateDeactivate,
        },
        "/ext/pub.good.js": { activate: good },
      });
      const started = host.start([describeExtension("pub.hang"), describeExtension("pub.good")]);
      await vi.advanceTimersByTimeAsync(0);
      expect(good).toHaveBeenCalledOnce();
      expect(host.isActive("pub.good")).toBe(true);

      await vi.advanceTimersByTimeAsync(ACTIVATION_TIMEOUT_MS);
      await started;
      expect(host.isActive("pub.hang")).toBe(false);
      expect(log.error).toHaveBeenCalledWith(
        `[omnigent-extensions] pub.hang: activate timed out after ${ACTIVATION_TIMEOUT_MS}ms`,
        undefined,
      );

      finishHang();
      // The timed-out instance is already inert: the late item never shows.
      expect(headerItems.getSnapshot()).toEqual([]);
      await vi.advanceTimersByTimeAsync(0);
      expect(lateDeactivate).toHaveBeenCalledOnce();
      expect(lateDisposed).toHaveBeenCalledOnce();
      expect(headerItems.getSnapshot()).toEqual([]);
      expect(host.isActive("pub.hang")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a hanging load (top-level await) without blocking start or others", async () => {
    vi.useFakeTimers();
    try {
      const good = vi.fn();
      const { host, log } = setup({
        // Like an entry whose top-level await never settles.
        "/ext/pub.hangload.js": () => new Promise<never>(() => {}),
        "/ext/pub.good.js": { activate: good },
      });
      let startDone = false;
      const started = host
        .start([
          describeExtension("pub.hangload", ["*"]),
          describeExtension("pub.good", ["onStartupFinished"]),
        ])
        .then(() => {
          startDone = true;
        });
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
      expect(startDone).toBe(false);
      expect(good).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await started;
      expect(startDone).toBe(true);
      expect(good).toHaveBeenCalledOnce();
      expect(host.isActive("pub.hangload")).toBe(false);
      expect(log.error).toHaveBeenCalledWith(
        `[omnigent-extensions] pub.hangload: failed to load /ext/pub.hangload.js: timed out after ${LOAD_TIMEOUT_MS}ms`,
        undefined,
      );
      expect(() => getExtensionApi("pub.hangload")).toThrow(/no API registered/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a slow load its own budget, longer than activate's", async () => {
    vi.useFakeTimers();
    try {
      const activate = vi.fn();
      const { host } = setup({
        // Module requests queued behind a busy page's API calls.
        "/ext/pub.slowload.js": () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ activate }), (ACTIVATION_TIMEOUT_MS + LOAD_TIMEOUT_MS) / 2);
          }),
      });
      const activation = host.activate(describeExtension("pub.slowload"));
      await vi.advanceTimersByTimeAsync((ACTIVATION_TIMEOUT_MS + LOAD_TIMEOUT_MS) / 2);
      expect(await activation).toBe("activated");
      expect(activate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not activate an id again while its timed-out activation is pending", async () => {
    vi.useFakeTimers();
    try {
      let finishHang!: () => void;
      let calls = 0;
      const { host, log } = setup({
        "/ext/pub.hang.js": {
          activate: () => {
            calls += 1;
            if (calls > 1) return undefined;
            return new Promise<void>((resolve) => {
              finishHang = resolve;
            });
          },
        },
      });
      const first = host.activate(describeExtension("pub.hang"));
      await vi.advanceTimersByTimeAsync(ACTIVATION_TIMEOUT_MS);
      expect(await first).toBe("failed");

      expect(await host.activate(describeExtension("pub.hang"))).toBe("skipped");
      expect(calls).toBe(1);
      expect(log.warn).toHaveBeenCalledWith(
        "[omnigent-extensions] pub.hang: its previous activation is still being torn down; not activating it",
      );

      // Even once the late one has been cleaned up, its cached entry module is
      // bound to the dead API, so the id stays refused for this page.
      finishHang();
      await vi.advanceTimersByTimeAsync(0);
      expect(await host.activate(describeExtension("pub.hang"))).toBe("skipped");
      expect(calls).toBe(1);
      expect(host.isActive("pub.hang")).toBe(false);
      expect(log.warn).toHaveBeenLastCalledWith(
        expect.stringContaining("pub.hang: it was already activated once in this page"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not activate an id while its deactivate is pending, nor after it", async () => {
    let finishDeactivate!: () => void;
    const activate = vi.fn();
    const imported = vi.fn();
    const { host, log } = setup({
      "/ext/pub.a.js": () => {
        imported();
        return {
          activate,
          deactivate: () =>
            new Promise<void>((resolve) => {
              finishDeactivate = resolve;
            }),
        };
      },
    });
    expect(await host.activate(describeExtension("pub.a"))).toBe("activated");
    const deactivation = host.deactivate("pub.a");
    expect(await host.activate(describeExtension("pub.a"))).toBe("skipped");
    expect(log.warn).toHaveBeenLastCalledWith(
      "[omnigent-extensions] pub.a: its previous activation is still being torn down; not activating it",
    );
    finishDeactivate();
    await deactivation;
    expect(await host.activate(describeExtension("pub.a"))).toBe("skipped");
    expect(log.warn).toHaveBeenLastCalledWith(
      expect.stringContaining("reload the page to activate it again"),
    );
    expect(imported).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledOnce();
    expect(host.isActive("pub.a")).toBe(false);
  });

  it("cancels pending activations on dispose and cleans up a late finish", async () => {
    let finishActivate!: () => void;
    const lateDeactivate = vi.fn();
    const { host, headerItems } = setup({
      "/ext/pub.slow.js": {
        activate: () => {
          const item = getExtensionApi("pub.slow").window.createSessionHeaderItem("x");
          item.text = "slow";
          item.show();
          return new Promise<void>((resolve) => {
            finishActivate = resolve;
          });
        },
        deactivate: lateDeactivate,
      },
    });
    const activation = host.activate(describeExtension("pub.slow"));
    await flush();
    expect(headerItems.getSnapshot()).toHaveLength(1);

    await host.dispose();
    expect(await activation).toBe("skipped");
    expect(host.isActive("pub.slow")).toBe(false);
    expect(headerItems.getSnapshot()).toEqual([]);
    expect(() => getExtensionApi("pub.slow")).toThrow(/no API registered/);

    finishActivate();
    await flush();
    expect(lateDeactivate).toHaveBeenCalledOnce();
    expect(host.isActive("pub.slow")).toBe(false);
    expect(await host.activate(describeExtension("pub.other"))).toBe("skipped");
  });

  it("leaves a late activation's API inert after its cleanup", async () => {
    vi.useFakeTimers();
    try {
      let finishHang!: () => void;
      let api!: typeof omnigent;
      const { host, headerItems, store, log } = setup({
        "/ext/pub.hang.js": {
          activate: () => {
            api = getExtensionApi("pub.hang");
            return new Promise<void>((resolve) => {
              finishHang = resolve;
            });
          },
        },
      });
      const activation = host.activate(describeExtension("pub.hang"));
      await vi.advanceTimersByTimeAsync(ACTIVATION_TIMEOUT_MS);
      expect(await activation).toBe("failed");
      finishHang();
      await vi.advanceTimersByTimeAsync(0);
      log.error.mockClear();

      // Calls through the API it kept, after cleanup, do nothing.
      const item = api.window.createSessionHeaderItem("after");
      item.text = "after";
      item.show();
      expect(headerItems.getSnapshot()).toEqual([]);
      const listener = vi.fn();
      const subscription = api.sessions.onDidChangeActiveSession(listener);
      const usage = vi.fn();
      api.sessions.onDidChangeUsage(usage);
      store.set({ sessionId: "s1", totalCostUsd: 1 });
      await vi.advanceTimersByTimeAsync(0);
      expect(listener).not.toHaveBeenCalled();
      expect(usage).not.toHaveBeenCalled();
      expect(() => subscription.dispose()).not.toThrow();
      expect(log.error.mock.calls.map(([message]) => message)).toEqual([
        "[omnigent-extensions] pub.hang: createSessionHeaderItem called after the extension was deactivated; ignoring it",
        "[omnigent-extensions] pub.hang: onDidChangeActiveSession called after the extension was deactivated; ignoring it",
        "[omnigent-extensions] pub.hang: onDidChangeUsage called after the extension was deactivated; ignoring it",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("activates only supported activation events and warns about the rest", async () => {
    const star = vi.fn();
    const startup = vi.fn();
    const other = vi.fn();
    const { host, log } = setup({
      "/ext/pub.star.js": { activate: star },
      "/ext/pub.startup.js": { activate: startup },
      "/ext/pub.other.js": { activate: other },
    });
    await host.start([
      describeExtension("pub.star", ["*"]),
      describeExtension("pub.startup", ["onStartupFinished", "onCommand:x"]),
      describeExtension("pub.other", ["onView:x"]),
    ]);
    expect(star).toHaveBeenCalledOnce();
    expect(startup).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('"onCommand:x"'));
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("pub.other: no supported activation event"),
    );
  });

  it("contributes a declarative extension (no activation events) without activating or warning", async () => {
    const activate = vi.fn();
    const { host, log } = setup({ "/ext/pub.themes.js": { activate } });
    await host.start([describeExtension("pub.themes", [])]);
    expect(activate).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("runs * extensions before waiting for startup", async () => {
    const order: string[] = [];
    let finishStartup!: () => void;
    const headerItems = new SessionHeaderItemRegistry();
    const host = new ExtensionHost({
      services: hostServices({ headerItems, sessions: new SessionsService(fakeSource().source) }),
      importModule: async (url) => ({ activate: () => order.push(url) }),
      whenStartupFinished: () =>
        new Promise((resolve) => {
          finishStartup = resolve;
        }),
      console: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    });
    const started = host.start([
      describeExtension("pub.late", ["onStartupFinished"]),
      describeExtension("pub.eager", ["*"]),
    ]);
    await flush();
    expect(order).toEqual(["/ext/pub.eager.js"]);
    finishStartup();
    await started;
    expect(order).toEqual(["/ext/pub.eager.js", "/ext/pub.late.js"]);
  });

  it("starts loading onStartupFinished entries at once and activates them after startup", async () => {
    const imported: string[] = [];
    const activate = vi.fn();
    let finishStartup!: () => void;
    const host = new ExtensionHost({
      services: hostServices(),
      importModule: async (url) => {
        imported.push(url);
        return { activate };
      },
      whenStartupFinished: () =>
        new Promise((resolve) => {
          finishStartup = resolve;
        }),
      console: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    });
    const started = host.start([describeExtension("pub.late", ["onStartupFinished"])]);
    await flush();
    expect(imported).toEqual(["/ext/pub.late.js"]);
    expect(activate).not.toHaveBeenCalled();
    finishStartup();
    await started;
    expect(activate).toHaveBeenCalledOnce();
    expect(host.isActive("pub.late")).toBe(true);
  });

  it("never calls activate on an entry that finishes loading after its load timed out", async () => {
    vi.useFakeTimers();
    try {
      const activate = vi.fn();
      const { host } = setup({
        "/ext/pub.lateload.js": () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ activate }), LOAD_TIMEOUT_MS + 1000);
          }),
      });
      const activation = host.activate(describeExtension("pub.lateload"));
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
      expect(await activation).toBe("failed");
      await vi.advanceTimersByTimeAsync(2000);
      expect(activate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never calls activate on an entry that finishes loading after the host was disposed", async () => {
    let finishLoad!: (module: unknown) => void;
    const activate = vi.fn();
    const { host } = setup({
      "/ext/pub.disposedload.js": () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
    });
    const activation = host.activate(describeExtension("pub.disposedload"));
    await flush();
    await host.dispose();
    expect(await activation).toBe("skipped");
    finishLoad({ activate });
    await flush();
    expect(activate).not.toHaveBeenCalled();
  });

  it("keeps a throwing listener from breaking other extensions", async () => {
    const seenByGood: (string | undefined)[] = [];
    const { host, store, log } = setup({
      "/ext/pub.bad.js": {
        activate: () => {
          getExtensionApi("pub.bad").sessions.onDidChangeActiveSession(() => {
            throw new Error("listener boom");
          });
        },
      },
      "/ext/pub.good.js": {
        activate: () => {
          getExtensionApi("pub.good").sessions.onDidChangeActiveSession((session) =>
            seenByGood.push(session?.id),
          );
        },
      },
    });
    await host.start([describeExtension("pub.bad"), describeExtension("pub.good")]);
    store.set({ sessionId: "s1" });
    await flush();
    expect(seenByGood).toEqual(["s1"]);
    expect(log.error).toHaveBeenCalledWith(
      "[omnigent-extensions] pub.bad: onDidChangeActiveSession listener threw",
      expect.objectContaining({ message: "listener boom" }),
    );
  });

  it("logs a host event listener's rejected non-native thenable", async () => {
    const error = new Error("zone rejection");
    const thenable = {
      then(_onFulfilled: unknown, onRejected?: (reason: unknown) => void) {
        onRejected?.(error);
        return thenable;
      },
    };
    const { host, store, log } = setup({
      "/ext/pub.zone.js": {
        activate: () => {
          getExtensionApi("pub.zone").sessions.onDidChangeActiveSession(() => thenable);
        },
      },
    });
    await host.start([describeExtension("pub.zone")]);
    store.set({ sessionId: "s1" });
    await flush();
    expect(log.error).toHaveBeenCalledWith(
      "[omnigent-extensions] pub.zone: onDidChangeActiveSession listener rejected",
      error,
    );
  });

  it("removes listeners and header items an extension did not dispose itself", async () => {
    const listener = vi.fn();
    const { host, headerItems, store } = setup({
      "/ext/pub.a.js": {
        activate: () => {
          const api = getExtensionApi("pub.a");
          api.sessions.onDidChangeUsage(listener);
          const item = api.window.createSessionHeaderItem(api.SessionHeaderItemAlignment.Right, 5);
          item.text = "hi";
          item.show();
        },
      },
    });
    await host.start([describeExtension("pub.a")]);
    expect(headerItems.getSnapshot()).toEqual([
      expect.objectContaining({ key: "pub.a.item1", alignment: 2, priority: 5 }),
    ]);
    await host.deactivate("pub.a");
    expect(headerItems.getSnapshot()).toEqual([]);
    store.set({ sessionId: "s1" });
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("createExtensionApi", () => {
  it("exposes exactly the names the dev plugin re-exports", () => {
    const sessions = new SessionsService(fakeSource().source);
    const { api } = createExtensionApi("pub.a", hostServices({ sessions }), vi.fn());
    expect(Object.keys(api).sort()).toEqual([...OMNIGENT_API_EXPORT_NAMES].sort());
    expect([...OMNIGENT_API_EXPORTS]).toEqual([...OMNIGENT_API_EXPORT_NAMES]);
  });

  it("does not call an extension's listener once it is disposed mid-delivery", () => {
    const emitter = new EventEmitter<omnigent.Session | undefined>();
    const usage = new EventEmitter<omnigent.SessionUsage>();
    const sessions = {
      activeSession: undefined,
      activeSessionUsage: undefined,
      onDidChangeActiveSession: emitter.event,
      onDidChangeUsage: usage.event,
    } as unknown as SessionsService;
    const handle = createExtensionApi("pub.a", hostServices({ sessions }), vi.fn());
    const second = vi.fn();
    // The first listener tears the extension down while the event is being delivered.
    handle.api.sessions.onDidChangeActiveSession(() => handle.dispose());
    handle.api.sessions.onDidChangeActiveSession(second);
    emitter.fire({ id: "s1" });
    expect(second).not.toHaveBeenCalled();
  });

  it("registers no header item once disposed", () => {
    const headerItems = new SessionHeaderItemRegistry();
    const create = vi.spyOn(headerItems, "create");
    const logError = vi.fn();
    const handle = createExtensionApi(
      "pub.a",
      hostServices({ headerItems, sessions: new SessionsService(fakeSource().source) }),
      logError,
    );
    handle.dispose();
    const item = handle.api.window.createSessionHeaderItem(
      "cost",
      handle.api.SessionHeaderItemAlignment.Right,
      3,
    );
    expect(create).not.toHaveBeenCalled();
    expect(item).toMatchObject({ id: "pub.a.cost", alignment: 2, priority: 3 });
    item.text = "x";
    item.show();
    item.dispose();
    expect(headerItems.getSnapshot()).toEqual([]);
    expect(logError).toHaveBeenCalledWith(
      "createSessionHeaderItem called after the extension was deactivated; ignoring it",
    );
  });

  it("reports errors from extension-created emitters against the extension", () => {
    const logError = vi.fn();
    const { api } = createExtensionApi("pub.a", hostServices(), logError);
    const emitter = new api.EventEmitter<number>();
    const after = vi.fn();
    emitter.event(() => {
      throw new Error("boom");
    });
    emitter.event(after);
    emitter.fire(1);
    expect(after).toHaveBeenCalledWith(1);
    expect(logError).toHaveBeenCalledWith("EventEmitter listener threw", expect.any(Error));
  });
});
