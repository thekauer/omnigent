import { cleanup, fireEvent, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EmbeddedProvider } from "@/lib/embedded";
import { standaloneLayoutService } from "@/workbench/layoutService";
import { useDismissOnEscape } from "./useDismissOnEscape";

afterEach(() => {
  cleanup();
  standaloneLayoutService.setRoot(null);
  document.body.replaceChildren();
});

it("embedded, leaves host Escape untouched and dismisses for Escape inside the app", () => {
  document.body.innerHTML = '<div id="app"><button>In app</button></div><button>Host</button>';
  standaloneLayoutService.setRoot(document.getElementById("app"));
  const dismiss = vi.fn();
  renderHook(() => useDismissOnEscape(true, dismiss), { wrapper: EmbeddedProvider });

  expect(fireEvent.keyDown(screen.getByRole("button", { name: "Host" }), { key: "Escape" })).toBe(
    true,
  );
  expect(dismiss).not.toHaveBeenCalled();

  expect(fireEvent.keyDown(screen.getByRole("button", { name: "In app" }), { key: "Escape" })).toBe(
    false,
  );
  expect(dismiss).toHaveBeenCalledTimes(1);
});
