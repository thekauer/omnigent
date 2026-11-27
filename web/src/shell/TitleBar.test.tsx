import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  titleBarItems,
} from "@/workbench/titleBar";
import { TitleBar } from "./TitleBar";

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
  for (const key of [COMMAND_CENTER_SETTING, LAYOUT_CONTROL_SETTING]) {
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
    act(() => item.dispose());
  });
});
