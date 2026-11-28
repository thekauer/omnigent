import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import workbenchManifest from "@/builtinExtensions/omnigent.workbench/package.json";
import { configurationService } from "@/configuration/configurationService";
import { parseContributions } from "@/vscodeExtensions/contributions";
import { layoutService, Parts } from "@/workbench/layoutService";
import {
  COMMAND_CENTER_SETTING,
  contributedTitleBarEntries,
  LAYOUT_CONTROL_SETTING,
  TITLE_BAR_VISIBLE_SETTING,
  titleBarItems,
} from "@/workbench/titleBar";
import { TitleBar, useFoldedTitleBarItems } from "./TitleBar";

let removeConfiguration = () => {};
beforeAll(() => {
  const { contributions } = parseContributions(
    "omnigent.workbench",
    workbenchManifest.contributes,
    { builtIn: true },
  );
  removeConfiguration = configurationService.addExtension(
    "omnigent.workbench",
    contributions.configuration,
    console,
    { builtIn: true },
  );
});
afterAll(() => removeConfiguration());
afterEach(() => {
  cleanup();
  contributedTitleBarEntries.set([]);
  for (const key of [COMMAND_CENTER_SETTING, LAYOUT_CONTROL_SETTING, TITLE_BAR_VISIBLE_SETTING]) {
    configurationService.update(key, undefined, "memory");
  }
});

function draw(onOpenCommandCenter = vi.fn()) {
  render(
    <MemoryRouter>
      <TitleBar onOpenCommandCenter={onOpenCommandCenter} />
    </MemoryRouter>,
  );
  return onOpenCommandCenter;
}

function region(name: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-slot="titlebar-${name}"]`)!;
}

describe("TitleBar", () => {
  it("is the titlebar part with its regions and built-in items", () => {
    const open = draw();
    expect(document.querySelector('[data-part="titlebar"]')).not.toBeNull();
    expect(region("left").querySelector('[data-titlebar-item="brand"]')).not.toBeNull();
    fireEvent.click(within(region("center")).getByRole("button", { name: /Search or run/ }));
    expect(open).toHaveBeenCalledOnce();
    expect(region("right").querySelector('[data-titlebar-item="layoutControls"]')).not.toBeNull();
  });

  it("is a labeled region with labeled regions, not a second banner", () => {
    draw();
    expect(screen.queryByRole("banner")).toBeNull();
    const bar = screen.getByRole("region", { name: "Title bar" });
    expect(
      within(bar)
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-label")),
    ).toEqual(["Title bar start", "Title bar center", "Title bar end"]);
  });

  it("truncates long titles and text inside regions that clip", () => {
    act(() =>
      contributedTitleBarEntries.set([
        {
          region: "left",
          command: "acme.tools.long",
          builtInItem: undefined,
          title: "A very long title ".repeat(10),
          icon: undefined,
          tooltip: undefined,
          when: undefined,
          extensionId: "acme.tools",
          active: true,
        },
      ]),
    );
    draw();
    expect(region("left").className).toContain("overflow-x-clip");
    const title = within(region("left")).getByText(/A very long title/);
    expect(title.className).toContain("truncate");
  });

  it("leaves out the command center and the layout controls when their settings are off", () => {
    configurationService.update(COMMAND_CENTER_SETTING, false, "memory");
    configurationService.update(LAYOUT_CONTROL_SETTING, false, "memory");
    draw();
    expect(document.querySelector('[data-titlebar-item="commandCenter"]')).toBeNull();
    expect(document.querySelector('[data-titlebar-item="layoutControls"]')).toBeNull();
  });

  it("toggles the side bars from its layout controls", () => {
    const state = { visible: true };
    const remove = layoutService.registerPart(Parts.SIDEBAR_PART, {
      isVisible: () => state.visible,
      setHidden: (hidden) => {
        state.visible = !hidden;
      },
    });
    draw();
    const toggle = screen.getByRole("button", { name: "Toggle Primary Side Bar" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(state.visible).toBe(false);
    remove();
  });

  it("draws other extensions' command entries whose when holds, and text items", () => {
    act(() =>
      contributedTitleBarEntries.set([
        {
          region: "left",
          command: "acme.tools.run",
          builtInItem: undefined,
          title: "Run tools",
          icon: "play",
          tooltip: undefined,
          when: undefined,
          extensionId: "acme.tools",
          active: true,
        },
        {
          region: "left",
          command: "acme.tools.off",
          builtInItem: undefined,
          title: "Off",
          icon: undefined,
          tooltip: undefined,
          when: undefined,
          extensionId: "acme.tools",
          active: false,
        },
      ]),
    );
    const item = titleBarItems.create("acme.tools", "cost", "right", 0);
    draw();
    act(() => {
      item.text = "$1.20";
      item.show();
    });
    expect(within(region("left")).getByRole("button", { name: "Run tools" })).toBeInTheDocument();
    expect(within(region("left")).queryByRole("button", { name: "Off" })).toBeNull();
    expect(within(region("right")).getByText("$1.20")).toBeInTheDocument();
    expect(
      region("right").querySelector('[data-titlebar-text-item="acme.tools:cost"]'),
    ).not.toBeNull();
    act(() => item.dispose());
  });

  it("folds its actionable items for a phone's menu, only while the bar is on", () => {
    const entry = {
      region: "right" as const,
      command: "acme.tools.run",
      builtInItem: undefined,
      title: "Run tools",
      icon: "play",
      tooltip: undefined,
      when: undefined,
      extensionId: "acme.tools",
      active: true,
    };
    act(() =>
      contributedTitleBarEntries.set([
        entry,
        { ...entry, region: "left", command: "acme.tools.off", title: "Off", active: false },
      ]),
    );
    const action = titleBarItems.create("acme.tools", "cost", "left", 0);
    const label = titleBarItems.create("acme.tools", "label", "left", 0);
    act(() => {
      action.text = "$1.20";
      action.command = "acme.tools.cost";
      action.show();
      label.text = "Read only";
      label.show();
    });
    const { result } = renderHook(() => useFoldedTitleBarItems());
    expect(result.current).toEqual([]);
    act(() => configurationService.update(TITLE_BAR_VISIBLE_SETTING, true, "memory"));
    // Region by region: the text item with a command (left), then the command entry (right).
    expect(result.current.map((item) => item.label)).toEqual(["$1.20", "Run tools"]);
    act(() => {
      action.dispose();
      label.dispose();
    });
  });
});
