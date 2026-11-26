// The working indicator's style variants: Otto with the rotating shimmer by default, the
// square pulse or dots in its place, and the static or cycling verbs.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkingIndicator } from "@/pages/ChatPage";
import { useChatStore } from "@/store/chatStore";
import { themeService } from "@/theme/themeService";

import { WORKING_CYCLE_MS, WORKING_CYCLE_VERBS } from "./chatBubbleParts";

const row = () => screen.getByTestId("working-indicator");

beforeEach(() => {
  useChatStore.setState({ sessionStatus: "running", status: "idle", blockedOn: null });
});

afterEach(() => {
  themeService.setVariant("workingIndicator", null);
  themeService.setVariant("workingVerbs", null);
  useChatStore.setState({ sessionStatus: "idle", blockedOn: null });
  vi.useRealTimers();
  cleanup();
});

describe("working indicator variants", () => {
  it("shows Otto and the shimmer by default", () => {
    render(<WorkingIndicator />);
    expect(row().querySelector(".otto-working")).not.toBeNull();
    expect(row().querySelector("[data-working-indicator]")).toBeNull();
  });

  it("swaps Otto for the square pulse or the dots, keeping the label", () => {
    act(() => themeService.setVariant("workingIndicator", "square-pulse"));
    const { rerender } = render(<WorkingIndicator />);
    expect(row().querySelector(".otto-working")).toBeNull();
    expect(row().querySelector(".ui-working-pulse")).not.toBeNull();
    expect(row().querySelector(".ui-working-verb")?.textContent).toMatch(/…$/);
    act(() => themeService.setVariant("workingIndicator", "dots"));
    rerender(<WorkingIndicator />);
    expect(row().querySelectorAll(".ui-working-dots > span")).toHaveLength(3);
    // The row stays hidden from assistive technology; the status region speaks.
    expect(row()).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Working…");
  });

  it("cycles the design's three verbs every 2.6s, or holds Working only", () => {
    vi.useFakeTimers();
    act(() => themeService.setVariant("workingVerbs", "cycle"));
    render(<WorkingIndicator />);
    expect(row()).toHaveTextContent(WORKING_CYCLE_VERBS[0]);
    act(() => vi.advanceTimersByTime(WORKING_CYCLE_MS));
    expect(row()).toHaveTextContent(WORKING_CYCLE_VERBS[1]);
    act(() => vi.advanceTimersByTime(WORKING_CYCLE_MS));
    expect(row()).toHaveTextContent(WORKING_CYCLE_VERBS[2]);
    act(() => themeService.setVariant("workingVerbs", "static"));
    act(() => vi.advanceTimersByTime(WORKING_CYCLE_MS * 3));
    expect(row()).toHaveTextContent("Working…");
  });

  it("holds the first cycling verb under reduced motion", () => {
    vi.useFakeTimers();
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...matchMedia(query),
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as typeof window.matchMedia;
    try {
      act(() => themeService.setVariant("workingVerbs", "cycle"));
      render(<WorkingIndicator />);
      expect(row()).toHaveTextContent(WORKING_CYCLE_VERBS[0]);
      act(() => vi.advanceTimersByTime(WORKING_CYCLE_MS * 2));
      expect(row()).toHaveTextContent(WORKING_CYCLE_VERBS[0]);
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  it("shows a block reason whatever the verbs", () => {
    act(() => themeService.setVariant("workingVerbs", "cycle"));
    useChatStore.setState({ blockedOn: "permission prompt" });
    render(<WorkingIndicator />);
    expect(row()).toHaveTextContent("Waiting for your approval");
  });
});
