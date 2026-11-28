import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import workbenchManifest from "@/builtinExtensions/omnigent.workbench/package.json";
import { parseConfigurationContributions } from "@/configuration/configurationContributions";
import { ConfigurationRegistry } from "@/configuration/configurationRegistry";
import { ConfigurationService } from "@/configuration/configurationService";
import { SettingsStore } from "@/configuration/settingsStore";
import {
  clampSidebarWidth,
  MIN_CHAT_WIDTH_PX,
  useResizableSidebar,
} from "@/hooks/useResizableSidebar";
import { LAYOUT_SLOTS, layoutState } from "./layoutState";
import { measureTokenValue, TOKEN_CONSTRAINTS, validateTokenValue } from "@/theme/validate";
import { standaloneLayoutService } from "./layoutService";
import { invalidateLayoutTokens, LayoutTokens, readLengthToken } from "./layoutTokens";
import { createWorkbenchScope } from "./workbenchScope";
import {
  builtInNavigationEntries,
  NavigationEntries,
  readHiddenNavigationEntries,
  setNavigationEntryHidden,
} from "./sidebarNavigation";
import {
  otherSide,
  readSecondarySideBarDefaultVisibility,
  SECONDARY_SIDE_BAR_AUTO_HIDE_SETTING,
  SIDE_BAR_LOCATION_SETTING,
  useNarrowerThan,
  useSecondarySideBarAutoHideBelow,
  useSideBarLocation,
} from "./sideBars";

function configuration() {
  const service = new ConfigurationService(new ConfigurationRegistry(), new SettingsStore());
  service.addExtension(
    "omnigent.workbench",
    parseConfigurationContributions("omnigent.workbench", workbenchManifest.contributes, {
      builtIn: true,
    }).contributions,
    undefined,
    { builtIn: true },
  );
  return service;
}

beforeEach(() => {
  localStorage.clear();
  layoutState.reset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the side bars' settings", () => {
  it("default to today's layout, and products and extensions may change them", () => {
    const service = configuration();
    const { result } = renderHook(() => ({
      side: useSideBarLocation(service),
      autoHide: useSecondarySideBarAutoHideBelow(service),
    }));
    expect(result.current).toEqual({ side: "left", autoHide: 0 });
    expect(readSecondarySideBarDefaultVisibility(service)).toBe("hidden");
    act(() => {
      service.update(SIDE_BAR_LOCATION_SETTING, "right");
      service.update(SECONDARY_SIDE_BAR_AUTO_HIDE_SETTING, 1180);
    });
    expect(result.current).toEqual({ side: "right", autoHide: 1180 });
    expect(otherSide(result.current.side)).toBe("left");
    for (const key of [SIDE_BAR_LOCATION_SETTING, SECONDARY_SIDE_BAR_AUTO_HIDE_SETTING]) {
      expect(service.registry.getProperty(key)?.schema.defaultOverridable).toBe(true);
    }
  });

  it("tells when the window is narrower than the auto-hide width", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    const { result, rerender } = renderHook(({ below }) => useNarrowerThan(below), {
      initialProps: { below: 1180 },
    });
    expect(result.current).toBe(true);
    rerender({ below: 0 });
    expect(result.current).toBe(false);
    rerender({ below: 900 });
    expect(result.current).toBe(false);
  });
});

describe("the layout tokens", () => {
  it("measure a token on the theme root, falling back where nothing is laid out", () => {
    invalidateLayoutTokens();
    expect(readLengthToken(LayoutTokens.sidebarWidth, () => 320, standaloneLayoutService)).toBe(
      320,
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 264,
    } as DOMRect);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ width: "264px" } as CSSStyleDeclaration);
    invalidateLayoutTokens();
    expect(readLengthToken(LayoutTokens.sidebarWidth, () => 320, standaloneLayoutService)).toBe(
      264,
    );
    const probe = document.querySelector<HTMLElement>("[data-layout-token-probe]");
    expect(probe?.style.width).toBe("var(--ui-sidebar-width)");
    expect(probe?.getAttribute("aria-hidden")).toBe("true");
  });

  it("measure on the caller's mount's root, not the active mount's", () => {
    // The embed is not the active mount: its token must still be measured on its own root.
    const scope = createWorkbenchScope("/tokens");
    const embedRoot = document.createElement("div");
    document.body.append(embedRoot);
    act(() => scope.layout.setRoot(embedRoot));
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      width: "264px",
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 264,
      height: 600,
    } as DOMRect);
    try {
      invalidateLayoutTokens();
      expect(readLengthToken(LayoutTokens.sidebarWidth, () => 320, scope.layout)).toBe(264);
      expect(embedRoot.querySelector("[data-layout-token-probe]")).not.toBeNull();
    } finally {
      act(() => scope.layout.setRoot(null));
      embedRoot.remove();
      vi.restoreAllMocks();
    }
  });

  it("size the side bar from its tokens, mirrored on the right, and reset on double-click", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1600);
    invalidateLayoutTokens();
    function Edge({ side }: { side: "left" | "right" }) {
      const { width, handleProps } = useResizableSidebar(side);
      return <div data-testid="edge" data-width={width} {...handleProps} />;
    }
    const { rerender } = render(<Edge side="left" />);
    const edge = () => screen.getByTestId("edge");
    expect(edge()).toHaveAttribute("data-width", "320");
    fireEvent.mouseDown(edge());
    fireEvent.mouseMove(window, { clientX: 400 });
    fireEvent.mouseUp(window);
    expect(edge()).toHaveAttribute("data-width", "400");
    rerender(<Edge side="right" />);
    fireEvent.mouseDown(edge());
    // On the right, the width is the pointer's distance from the window's right edge.
    fireEvent.mouseMove(window, { clientX: 1300 });
    fireEvent.mouseUp(window);
    expect(edge()).toHaveAttribute("data-width", "300");
    fireEvent.doubleClick(edge());
    expect(edge()).toHaveAttribute("data-width", "320");
  });

  it("measure a drag from the side bar's own edge, past an activity bar beside it", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1600);
    invalidateLayoutTokens();
    function Aside({ side }: { side: "left" | "right" }) {
      const { width, handleProps } = useResizableSidebar(side);
      return (
        <aside data-testid="aside">
          <div data-testid="edge" data-width={width} {...handleProps} />
        </aside>
      );
    }
    const { rerender } = render(<Aside side="left" />);
    const aside = screen.getByTestId("aside");
    // The side bar starts after a 48px activity bar.
    aside.getBoundingClientRect = () => ({ left: 48, right: 368 }) as DOMRect;
    fireEvent.mouseDown(screen.getByTestId("edge"));
    fireEvent.mouseMove(window, { clientX: 448 });
    fireEvent.mouseUp(window);
    expect(screen.getByTestId("edge")).toHaveAttribute("data-width", "400");
    rerender(<Aside side="right" />);
    screen.getByTestId("aside").getBoundingClientRect = () =>
      ({ left: 1232, right: 1552 }) as DOMRect;
    fireEvent.mouseDown(screen.getByTestId("edge"));
    fireEvent.mouseMove(window, { clientX: 1252 });
    fireEvent.mouseUp(window);
    expect(screen.getByTestId("edge")).toHaveAttribute("data-width", "300");
  });
});

describe("the side bar's width clamp", () => {
  it("keeps the chat's minimum, and never lets the floor pass the ceiling", () => {
    // A floor past the window: the side bar stops where the chat's minimum starts.
    expect(clampSidebarWidth(500, 10_000, 720, 1440)).toBe(720);
    expect(clampSidebarWidth(500, 10_000, 10_000, 1440)).toBe(1440 - MIN_CHAT_WIDTH_PX);
    // The activity bar beside the side bar shares the window.
    expect(clampSidebarWidth(2000, 220, 10_000, 1440, 48)).toBe(1440 - 48 - MIN_CHAT_WIDTH_PX);
    expect(clampSidebarWidth(100, 220, 720, 1440)).toBe(220);
  });
});

describe("the layout tokens' values", () => {
  it("take viewport units, as a theme sizes a side bar against the window", () => {
    const context = { isKnownToken: () => true };
    const check = (id: string, value: string) =>
      validateTokenValue("length", value, context, TOKEN_CONSTRAINTS[id]).ok;
    expect(check("ui-sidebar-width", "clamp(220px, 20vw, 280px)")).toBe(true);
    expect(check("ui-auxiliarybar-max-width", "min(720px, 50vw)")).toBe(true);
    expect(check("ui-sidebar-max-width", "150vw")).toBe(false);
    // A width past any window can't push the chat off the screen.
    expect(check("ui-sidebar-min-width", "10000px")).toBe(false);
    // A calc() with vw is checked when its value resolves (vw taken at a 4000px window at most).
    const measure = (id: string, value: string) =>
      measureTokenValue(id, "length", value, () => undefined).ok;
    expect(measure("ui-sidebar-min-width", "calc(100vw + 400px)")).toBe(false);
    expect(measure("ui-auxiliarybar-max-width", "calc(50vw + 100px)")).toBe(true);
    // Other lengths stay off the window's size.
    expect(check("ui-header-height", "5vh")).toBe(false);
  });
});

describe("the side bar's navigation entries", () => {
  it("are the sessions container's sidebar/navigation menu, gated by when", () => {
    const entries = builtInNavigationEntries();
    expect(entries.map((entry) => entry.id)).toEqual([
      NavigationEntries.newSession,
      NavigationEntries.automations,
      NavigationEntries.workflows,
      NavigationEntries.inbox,
      NavigationEntries.canvas,
      NavigationEntries.extensionPages,
      NavigationEntries.usage,
    ]);
    const canvas = entries.find((entry) => entry.id === NavigationEntries.canvas)!;
    expect(canvas.when?.evaluate((key) => key === "omnigent.serverFeature.canvas")).toBe(true);
    expect(entries[0]).toMatchObject({ title: "New session", icon: "message-circle-plus" });
  });

  it("hide and show by id in the layout state", () => {
    setNavigationEntryHidden(NavigationEntries.newSession, true);
    setNavigationEntryHidden(NavigationEntries.usage, true);
    setNavigationEntryHidden(NavigationEntries.usage, false);
    expect(readHiddenNavigationEntries()).toEqual([NavigationEntries.newSession]);
    // A show is a stored choice, so a default hiding the entry can't undo it.
    setNavigationEntryHidden(NavigationEntries.newSession, false);
    expect(readHiddenNavigationEntries()).toEqual([]);
    expect(layoutState.get(LAYOUT_SLOTS.hiddenNavigationEntries)).toEqual({
      [NavigationEntries.newSession]: false,
      [NavigationEntries.usage]: false,
    });
  });
});
