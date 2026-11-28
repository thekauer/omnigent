import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmbeddedProvider } from "@/lib/embedded";
import {
  activateWorkbenchScope,
  createWorkbenchScope,
  releaseWorkbenchScope,
  WorkbenchScopeProvider,
  type WorkbenchScope,
} from "@/workbench/workbenchScope";

import { useNewSessionHotkey } from "./useNewSessionHotkey";

const navigate = vi.fn();
vi.mock("@/lib/routing", () => ({ useNavigate: () => navigate }));

const mounted: WorkbenchScope[] = [];

afterEach(() => {
  cleanup();
  for (const scope of mounted.splice(0)) releaseWorkbenchScope(scope);
  document.body.innerHTML = "";
  navigate.mockReset();
});

/** An embed on the page: its own scope, root and the new-session shortcut, bound once. */
function mountEmbed(name: string): HTMLInputElement {
  const root = document.createElement("div");
  const input = document.createElement("input");
  root.appendChild(input);
  document.body.appendChild(root);
  const scope = createWorkbenchScope(`/${name}`);
  scope.layout.setRoot(root);
  mounted.push(scope);
  // As the embed does on mount: the mount last mounted is the one the window's keys reach.
  activateWorkbenchScope(scope);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EmbeddedProvider>
      <WorkbenchScopeProvider scope={scope}>{children}</WorkbenchScopeProvider>
    </EmbeddedProvider>
  );
  renderHook(() => useNewSessionHotkey(true, false), { wrapper });
  return input;
}

function pressNewSession(target: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "O",
    code: "KeyO",
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("window shortcuts on a page with two embeds", () => {
  it("runs only in the active mount, and switches with the mount in use", () => {
    const firstInput = mountEmbed("first");
    const secondInput = mountEmbed("second");
    // The second mount was mounted last, so it is the active one.
    expect(pressNewSession(firstInput).defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(pressNewSession(secondInput).defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);

    // The first mount is used: its own shortcut runs, the second's stops.
    activateWorkbenchScope(mounted[0]!);
    pressNewSession(firstInput);
    expect(navigate).toHaveBeenCalledTimes(2);
    pressNewSession(secondInput);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it("claims a chord only from inside its own mount, even while it is active", () => {
    const firstInput = mountEmbed("first");
    mountEmbed("second");
    activateWorkbenchScope(mounted[0]!);
    // Typed in the active mount's own root only: a host page's key is left alone.
    const host = document.createElement("div");
    document.body.appendChild(host);
    expect(pressNewSession(host).defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(pressNewSession(firstInput).defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/");
  });
});
