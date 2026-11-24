import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeOpenSubagentsInPanel } from "@/lib/subagentPanelPreferences";
import {
  openSessionFromView,
  SubagentPanelOpenerContext,
  useOpenSubagentInPanel,
} from "./subagentPanelOpener";

const isMobileMock = vi.fn(() => false);
vi.mock("@/hooks/useIsMobileViewport", () => ({
  useIsMobileViewport: () => isMobileMock(),
}));

function plainClick() {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
  };
}

function renderWithOpener(opener: ((id: string) => boolean) | null) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SubagentPanelOpenerContext.Provider value={opener}>
      {children}
    </SubagentPanelOpenerContext.Provider>
  );
  return renderHook(() => useOpenSubagentInPanel(), { wrapper }).result.current;
}

afterEach(() => {
  localStorage.clear();
  isMobileMock.mockReturnValue(false);
});

describe("useOpenSubagentInPanel", () => {
  it("opens a plain click in the panel when the setting is on", () => {
    writeOpenSubagentsInPanel(true);
    const opener = vi.fn(() => true);
    const openInPanel = renderWithOpener(opener);

    const click = plainClick();
    expect(openInPanel("conv_child", click)).toBe(true);
    expect(opener).toHaveBeenCalledWith("conv_child");
    expect(click.preventDefault).toHaveBeenCalled();
  });

  it("returns the opener's refusal", () => {
    writeOpenSubagentsInPanel(true);
    const openInPanel = renderWithOpener(() => false);

    const click = plainClick();
    expect(openInPanel("conv_child", click)).toBe(false);
    expect(click.preventDefault).not.toHaveBeenCalled();
  });

  it("keeps navigation when the setting is off", () => {
    const opener = vi.fn(() => true);
    const openInPanel = renderWithOpener(opener);

    expect(openInPanel("conv_child", plainClick())).toBe(false);
    expect(opener).not.toHaveBeenCalled();
  });

  it.each([
    ["middle", { button: 1 }],
    ["meta", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
  ])("keeps navigation for a %s click", (_name, modifiers) => {
    writeOpenSubagentsInPanel(true);
    const opener = vi.fn(() => true);
    const openInPanel = renderWithOpener(opener);

    expect(openInPanel("conv_child", { ...plainClick(), ...modifiers })).toBe(false);
    expect(opener).not.toHaveBeenCalled();
  });

  it("keeps navigation on a phone viewport", () => {
    writeOpenSubagentsInPanel(true);
    isMobileMock.mockReturnValue(true);
    const opener = vi.fn(() => true);
    const openInPanel = renderWithOpener(opener);

    expect(openInPanel("conv_child", plainClick())).toBe(false);
    expect(opener).not.toHaveBeenCalled();
  });

  it("keeps navigation outside a surface that provides an opener", () => {
    writeOpenSubagentsInPanel(true);
    const openInPanel = renderWithOpener(null);

    expect(openInPanel("conv_child", plainClick())).toBe(false);
  });
});

// What the Agents view's rows (and graph nodes) do through the workspace: the same
// decision the classic panel's links made with the opener above.
describe("openSessionFromView", () => {
  const open = (
    options: Partial<Parameters<typeof openSessionFromView>[1]> & { refuse?: boolean } = {},
  ) => {
    const opener = vi.fn(() => !options.refuse);
    const navigate = vi.fn();
    openSessionFromView("conv_child", {
      asSubagent: true,
      mobile: false,
      opener,
      navigate,
      ...options,
    });
    return { opener, navigate };
  };

  it("opens a sub-agent as a tab beside the chat when the setting is on", () => {
    writeOpenSubagentsInPanel(true);
    const { opener, navigate } = open();
    expect(opener).toHaveBeenCalledWith("conv_child");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates when the opener refuses, as it does for an ancestor", () => {
    writeOpenSubagentsInPanel(true);
    const { opener, navigate } = open({ refuse: true });
    expect(opener).toHaveBeenCalledWith("conv_child");
    expect(navigate).toHaveBeenCalledWith("conv_child");
  });

  it.each([
    ["the setting is off", false, {}],
    ["on a phone", true, { mobile: true }],
    ["without an opener", true, { opener: null }],
    ["for a plain session", true, { asSubagent: false }],
  ] as const)("navigates %s", (_name, setting, options) => {
    writeOpenSubagentsInPanel(setting);
    const navigate = vi.fn();
    const opener = vi.fn(() => true);
    openSessionFromView("conv_child", {
      asSubagent: true,
      mobile: false,
      opener,
      navigate,
      ...options,
    });
    expect(navigate).toHaveBeenCalledWith("conv_child");
    expect(opener).not.toHaveBeenCalled();
  });
});
