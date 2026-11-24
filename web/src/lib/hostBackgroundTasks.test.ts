import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type OmnigentBackgroundTaskKind,
  setOmnigentHostConfig,
  withHostBackgroundTask,
} from "./host";
import { routeQueryBackgroundWorkThroughHost } from "./queryBackgroundTasks";
import { sessionUpdatesSocket } from "./sessionUpdatesSocket";

// The host task the code under test is running inside, as the host's
// `runBackgroundTask` sees it; `null` outside any task.
let currentTask: OmnigentBackgroundTaskKind | null = null;
const runBackgroundTask = vi.fn((kind: OmnigentBackgroundTaskKind, task: () => void) => {
  const previousTask = currentTask;
  currentTask = kind;
  try {
    task();
  } finally {
    currentTask = previousTask;
  }
});

// A real socket can't be opened in jsdom; this transport-level stand-in lets
// the test deliver frames by hand.
class FakeWebSocket {
  static readonly OPEN = 1;
  static latest: FakeWebSocket | null = null;

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor() {
    FakeWebSocket.latest = this;
  }

  send(): void {
    // The watch-set send doesn't affect frame dispatch.
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

function latestSocket(): FakeWebSocket {
  if (!FakeWebSocket.latest) throw new Error("no WebSocket was constructed");
  return FakeWebSocket.latest;
}

beforeAll(() => {
  routeQueryBackgroundWorkThroughHost();
});

beforeEach(() => {
  currentTask = null;
  runBackgroundTask.mockClear();
  setOmnigentHostConfig({ runBackgroundTask });
});

afterEach(() => {
  setOmnigentHostConfig({});
  vi.useRealTimers();
});

describe("withHostBackgroundTask", () => {
  it("runs each call inside a host task of its kind, with the handler's arguments", () => {
    const seen: [OmnigentBackgroundTaskKind | null, number][] = [];
    const handler = withHostBackgroundTask("poll", (value: number) => {
      seen.push([currentTask, value]);
    });
    handler(1);
    handler(2);
    expect(seen).toEqual([
      ["poll", 1],
      ["poll", 2],
    ]);
  });

  it("runs the handler directly without a host, and reaches a host installed later", () => {
    setOmnigentHostConfig({});
    const handler = vi.fn();
    const wrapped = withHostBackgroundTask("focus_refresh", handler);
    wrapped();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(runBackgroundTask).not.toHaveBeenCalled();

    setOmnigentHostConfig({ runBackgroundTask });
    wrapped();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(runBackgroundTask).toHaveBeenCalledWith("focus_refresh", expect.any(Function));
  });
});

describe("session-updates frames", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    sessionUpdatesSocket.stop();
    vi.unstubAllGlobals();
  });

  it("delivers each pushed frame inside its own session_update task", () => {
    const seenIn: (OmnigentBackgroundTaskKind | null)[] = [];
    const unsubscribe = sessionUpdatesSocket.subscribe(() => seenIn.push(currentTask));
    sessionUpdatesSocket.start();
    latestSocket().open();

    latestSocket().emit({ type: "hosts_changed" });
    latestSocket().emit({ type: "removed", ids: ["s1"] });
    unsubscribe();

    expect(seenIn).toEqual(["session_update", "session_update"]);
    expect(runBackgroundTask).toHaveBeenCalledTimes(2);
  });

  it("delivers a heartbeat outside any task", () => {
    const seenIn: (OmnigentBackgroundTaskKind | null)[] = [];
    const unsubscribe = sessionUpdatesSocket.subscribe(() => seenIn.push(currentTask));
    sessionUpdatesSocket.start();
    latestSocket().open();

    latestSocket().emit({ type: "heartbeat" });
    unsubscribe();

    expect(seenIn).toEqual([null]);
    expect(runBackgroundTask).not.toHaveBeenCalled();
  });
});

describe("react-query background refetches", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.mount();
  });

  afterEach(() => {
    queryClient.unmount();
    queryClient.clear();
  });

  it("runs every refetchInterval tick in its own poll task", async () => {
    vi.useFakeTimers();
    const fetchedIn: (OmnigentBackgroundTaskKind | null)[] = [];
    const observer = new QueryObserver(queryClient, {
      queryKey: ["polled"],
      queryFn: () => {
        fetchedIn.push(currentTask);
        return fetchedIn.length;
      },
      refetchInterval: 1_000,
    });
    const unsubscribe = observer.subscribe(() => {});

    await vi.advanceTimersByTimeAsync(2_000);
    unsubscribe();

    // The mount fetch belongs to the subscriber; each tick after it is a poll.
    expect(fetchedIn).toEqual([null, "poll", "poll"]);
    expect(runBackgroundTask.mock.calls.map(([kind]) => kind)).toEqual(["poll", "poll"]);
  });

  it.each([
    {
      kind: "focus_refresh",
      options: { refetchOnWindowFocus: true },
      fire: () => window.dispatchEvent(new Event("visibilitychange")),
    },
    {
      kind: "reconnect_refresh",
      options: { refetchOnReconnect: true },
      fire: () => {
        window.dispatchEvent(new Event("offline"));
        window.dispatchEvent(new Event("online"));
      },
    },
  ])(
    "routes the $kind event through the host and still refetches",
    async ({ kind, options, fire }) => {
      const queryFn = vi.fn(() => "value");
      const observer = new QueryObserver(queryClient, {
        queryKey: [kind],
        queryFn,
        staleTime: 0,
        ...options,
      });
      const unsubscribe = observer.subscribe(() => {});
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

      fire();

      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
      unsubscribe();
      expect(runBackgroundTask.mock.calls.map(([calledKind]) => calledKind)).toEqual([kind]);
    },
  );
});
