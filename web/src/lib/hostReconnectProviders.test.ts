import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAN_RECONNECT_TIMEOUT_MS,
  HostReconnectProviderRegistry,
  SERVER_WAKE_PROVIDER_ID,
  hostReconnectProviders,
  serverWakeReconnectProvider,
  type HostReconnectProvider,
  type ReconnectHost,
} from "./hostReconnectProviders";

const userHost: ReconnectHost = {
  hostId: "host-1",
  name: "my-box",
  status: "offline",
  sandboxProvider: null,
  resumable: false,
};

function provider(canReconnect: HostReconnectProvider["canReconnect"]): HostReconnectProvider {
  return { canReconnect, reconnect: vi.fn(async () => {}) };
}

function setup() {
  const report = vi.fn();
  const registry = new HostReconnectProviderRegistry({ report });
  return { registry, report };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("HostReconnectProviderRegistry", () => {
  it("selects the first provider that can reconnect, in registration order", () => {
    const { registry } = setup();
    const first = provider(() => false);
    const second = provider(() => true);
    const third = provider(() => true);
    registry.register("first", first);
    registry.register("second", second);
    registry.register("third", third);
    expect(registry.select(userHost)).toEqual({ id: "second", provider: second });
  });

  it("answers synchronously while every provider does", () => {
    const { registry } = setup();
    registry.register(
      "sync",
      provider(() => true),
    );
    const selected = registry.select(userHost);
    if (selected instanceof Promise) throw new Error("expected a synchronous answer");
    expect(selected?.id).toBe("sync");
  });

  it("returns undefined when no provider matches, so the default behavior runs", () => {
    const { registry } = setup();
    registry.register(
      "no",
      provider(() => false),
    );
    expect(registry.select(userHost)).toBeUndefined();
  });

  it("awaits async answers and keeps asking the providers after a false one", async () => {
    const { registry } = setup();
    const later = provider(() => true);
    registry.register(
      "async-no",
      provider(async () => false),
    );
    registry.register("later", later);
    await expect(registry.select(userHost)).resolves.toEqual({ id: "later", provider: later });
  });

  it("skips a provider whose canReconnect throws or rejects, and reports it", async () => {
    const { registry, report } = setup();
    const fallback = provider(() => true);
    registry.register(
      "throws",
      provider(() => {
        throw new Error("boom");
      }),
    );
    registry.register(
      "rejects",
      provider(() => Promise.reject(new Error("nope"))),
    );
    registry.register("fallback", fallback);
    await expect(registry.select(userHost)).resolves.toEqual({
      id: "fallback",
      provider: fallback,
    });
    expect(report).toHaveBeenCalledWith("throws", "canReconnect threw", expect.any(Error));
    expect(report).toHaveBeenCalledWith("rejects", "canReconnect rejected", expect.any(Error));
  });

  it("awaits a thenable answer that is not the global Promise", async () => {
    // A page can replace the global Promise; an async function still returns the native one.
    const { registry } = setup();
    const thenable = { then: (resolve: (value: boolean) => void) => resolve(true) };
    const claimed = provider(() => thenable as unknown as Promise<boolean>);
    registry.register("thenable", claimed);
    const selection = registry.select(userHost);
    expect(selection).toBeInstanceOf(Promise);
    await expect(selection).resolves.toEqual({ id: "thenable", provider: claimed });
  });

  it("skips a provider that does not answer within the timeout", async () => {
    vi.useFakeTimers();
    const { registry, report } = setup();
    registry.register(
      "hangs",
      provider(() => new Promise<boolean>(() => {})),
    );
    const selection = registry.select(userHost);
    await vi.advanceTimersByTimeAsync(CAN_RECONNECT_TIMEOUT_MS);
    await expect(selection).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(
      "hangs",
      `canReconnect timed out after ${CAN_RECONNECT_TIMEOUT_MS}ms`,
    );
  });

  it("treats a non-boolean answer as false", () => {
    const { registry } = setup();
    registry.register(
      "odd",
      provider(() => "yes" as unknown as boolean),
    );
    expect(registry.select(userHost)).toBeUndefined();
  });

  it("unregisters a provider", () => {
    const { registry } = setup();
    const unregister = registry.register(
      "one",
      provider(() => true),
    );
    unregister();
    unregister();
    expect(registry.size).toBe(0);
    expect(registry.select(userHost)).toBeUndefined();
  });

  it("warm() asks every provider and ignores answers and failures", async () => {
    const { registry } = setup();
    const answers = [
      vi.fn(() => true),
      vi.fn(async () => false),
      vi.fn(() => {
        throw new Error("boom");
      }),
    ];
    answers.forEach((canReconnect, index) =>
      registry.register(`p${index}`, provider(canReconnect)),
    );
    expect(() => registry.warm(userHost)).not.toThrow();
    for (const canReconnect of answers) expect(canReconnect).toHaveBeenCalledWith(userHost);
  });
});

describe("the window's registry", () => {
  it("has the built-in server wake first", () => {
    const selected = hostReconnectProviders.select({ ...userHost, resumable: true });
    expect(selected).toEqual({
      id: SERVER_WAKE_PROVIDER_ID,
      provider: serverWakeReconnectProvider,
    });
  });

  it("the server wake handles only resumable hosts and runs the session's wake", async () => {
    expect(serverWakeReconnectProvider.canReconnect(userHost)).toBe(false);
    const wakeSandbox = vi.fn(async () => ({ tracked: true }));
    await expect(
      serverWakeReconnectProvider.reconnect(
        { ...userHost, resumable: true },
        { sessionId: "s1", wakeSandbox, progress: { report: () => {} } },
      ),
    ).resolves.toEqual({ tracked: true });
    expect(wakeSandbox).toHaveBeenCalledOnce();
  });
});
