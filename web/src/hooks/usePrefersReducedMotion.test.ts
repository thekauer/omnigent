import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePrefersReducedMotion", () => {
  it("subscribes with addEventListener where the MediaQueryList has it", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener, removeEventListener }));

    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
    expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("falls back to addListener on an old MediaQueryList (Safari before 14)", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addListener, removeListener }));

    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    expect(addListener).toHaveBeenCalledWith(expect.any(Function));
    unmount();
    expect(removeListener).toHaveBeenCalledWith(expect.any(Function));
  });

  it("reads the query without subscribing when the list has neither method", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));

    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
    unmount();
  });
});
