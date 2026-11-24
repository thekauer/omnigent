import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HostProgressLocations, useHostProgress } from "./hostProgress";

describe("HostProgressLocations", () => {
  it("shows the newest open progress per host and forgets a host with nothing to show", () => {
    const locations = new HostProgressLocations();
    const first = locations.begin("host-1", "Reconnecting...");
    const second = locations.begin("host-1", "Syncing");
    expect(locations.get("host-1").progress).toBe("Syncing");
    expect(locations.get("host-2").progress).toBeNull();
    second.end();
    expect(locations.get("host-1").progress).toBe("Reconnecting...");
    first.report("Starting omni...");
    expect(locations.get("host-1").progress).toBe("Starting omni...");
    first.end();
    first.report("late");
    expect(locations.get("host-1")).toEqual({ progress: null, failure: null });
  });

  it("clears a failure only for its owner, or for anyone without one", () => {
    const locations = new HostProgressLocations();
    const owner = {};
    locations.setFailure("host-1", { message: "Reconnect failed", detail: "why" }, owner);
    locations.clearFailure("host-1", {});
    expect(locations.get("host-1").failure).toEqual({ message: "Reconnect failed", detail: "why" });
    locations.clearFailure("host-1", owner);
    expect(locations.get("host-1").failure).toBeNull();
    locations.setFailure("host-1", { message: "Reconnect failed", detail: null }, owner);
    locations.clearFailure("host-1");
    expect(locations.get("host-1").failure).toBeNull();
  });

  it("keeps a snapshot stable until it changes, and survives a throwing listener", () => {
    const locations = new HostProgressLocations();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    locations.subscribe(() => {
      throw new Error("broken listener");
    });
    const heard = vi.fn();
    locations.subscribe(heard);
    const handle = locations.begin("host-1", "A");
    const snapshot = locations.get("host-1");
    expect(locations.get("host-1")).toBe(snapshot);
    handle.report("B");
    expect(locations.get("host-1")).not.toBe(snapshot);
    expect(heard).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("useHostProgress", () => {
  it("rerenders as the host's progress changes", () => {
    const locations = new HostProgressLocations();
    const { result } = renderHook(() => useHostProgress("host-1", locations));
    expect(result.current.progress).toBeNull();
    let handle!: ReturnType<HostProgressLocations["begin"]>;
    act(() => {
      handle = locations.begin("host-1", "Reconnecting...");
    });
    expect(result.current.progress).toBe("Reconnecting...");
    act(() => handle.end());
    expect(result.current.progress).toBeNull();
  });
});
