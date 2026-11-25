import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readThemePalette } from "@/lib/themePalette";
import { commitThemePalette } from "@/store/themePalette";
import { FIXTURE_EXTENSION_ID, fixtureThemeExtension } from "@/test/themeFixtures";
import { themeService } from "@/theme/themeService";
import { useThemeModePreviewStore } from "@/store/themeModePreview";
import {
  closeThemePicker,
  openThemePicker,
  replaceThemePicker,
  useThemePickerStore,
} from "@/store/themePicker";

const { ThemePicker } = await import("./ThemePicker");

function renderPicker() {
  const view = render(
    <ThemeProvider>
      <TooltipProvider>
        <ThemePicker />
      </TooltipProvider>
    </ThemeProvider>,
  );
  act(() => openThemePicker());
  return Object.assign(screen.getByRole("combobox", { name: "Select theme" }), {
    unmount: view.unmount,
  });
}

function isDarkShown(): boolean {
  return document.documentElement.classList.contains("dark");
}

function savedMode(): string | null {
  return localStorage.getItem("web-theme");
}

/** Opens the Appearance page and highlights Dark, waiting for its preview. */
async function previewDark() {
  const input = renderPicker();
  await userEvent.keyboard("{ArrowDown}{Enter}");
  const appearance = screen.getByRole("combobox", { name: "Select appearance" });
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  expect(activeOption(appearance)).toHaveTextContent("Dark");
  await waitFor(() => expect(isDarkShown()).toBe(true));
  expect(savedMode()).toBeNull();
  return { input, appearance };
}

function dataTheme(): string | null {
  return document.documentElement.getAttribute("data-theme");
}

function activeOption(input: HTMLElement): HTMLElement | null {
  const id = input.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
}

function optionLabels(): string[] {
  return within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .map((option) => {
      return option.querySelector("[data-slot=quick-pick-label]")?.textContent ?? "";
    });
}

const FIXTURE_DARK = `${FIXTURE_EXTENSION_ID}/full-dark`;
const FIXTURE_STOCK = `${FIXTURE_EXTENSION_ID}/vscode-dark`;

/** The fixture extension's themes in the window's theme service; returns their removal. */
function addFixtureThemes(): () => void {
  let remove: () => void = () => {};
  act(() => {
    remove = themeService.addExtension(fixtureThemeExtension());
  });
  return () => act(() => remove());
}

function runtimeStyle(): string {
  return document.getElementById("omnigent-theme-runtime")?.textContent ?? "";
}

beforeEach(() => {
  localStorage.clear();
  themeService.select(null);
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  cleanup();
  useThemePickerStore.setState({ open: false, replaced: false });
  useThemeModePreviewStore.setState({ mode: null });
  document.documentElement.classList.remove("dark", "light");
});

describe("ThemePicker", () => {
  it("lists the current theme, Appearance, then the other palettes", () => {
    renderPicker();
    expect(optionLabels()).toEqual([
      "Omnigent Default",
      "Appearance",
      "Dracula",
      "GitHub",
      "Catppuccin",
      "Gruvbox",
      "Solarized",
      "Nord",
      "Custom",
    ]);
    expect(screen.getByText("Themes")).toBeVisible();
    expect(screen.getByRole("option", { name: /Appearance/ })).toHaveTextContent("System");
  });

  it("offers Omnigent Default and names the current palette when another is committed", () => {
    act(() => commitThemePalette("nord"));
    renderPicker();
    expect(optionLabels().slice(0, 3)).toEqual(["Current theme", "Appearance", "Omnigent Default"]);
    expect(screen.getByRole("option", { name: /Current theme/ })).toHaveTextContent(
      "Nord · System",
    );
    expect(screen.getByRole("option", { name: /^Nord/ })).toHaveTextContent("Current");
  });

  it("previews highlighted palettes and restores the committed one on Escape", async () => {
    const input = renderPicker();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(activeOption(input)).toHaveTextContent("GitHub");
    await waitFor(() => expect(dataTheme()).toBe("github"));
    await userEvent.hover(screen.getByRole("option", { name: /^Nord/ }));
    await waitFor(() => expect(dataTheme()).toBe("nord"));
    // A row that isn't a palette shows the committed one.
    await userEvent.hover(screen.getByRole("option", { name: /Appearance/ }));
    await waitFor(() => expect(dataTheme()).toBeNull());
    await userEvent.hover(screen.getByRole("option", { name: /^Dracula/ }));
    await waitFor(() => expect(dataTheme()).toBe("dracula"));

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(dataTheme()).toBeNull();
    expect(readThemePalette()).toBe("omni");
    expect(themeService.getChoice()).toBe("omni");
  });

  it("closes and reverts its preview when the route changes", async () => {
    let navigate: (to: string) => void = () => {};
    function Navigator() {
      navigate = useNavigate();
      return null;
    }
    render(
      <MemoryRouter initialEntries={["/a"]}>
        <ThemeProvider>
          <TooltipProvider>
            <Navigator />
            <ThemePicker />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    act(() => openThemePicker());
    const input = screen.getByRole("combobox", { name: "Select theme" });
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(activeOption(input)).toHaveTextContent("GitHub");
    await waitFor(() => expect(dataTheme()).toBe("github"));
    act(() => navigate("/b"));
    await waitFor(() => expect(useThemePickerStore.getState().open).toBe(false));
    await waitFor(() => expect(dataTheme()).toBeNull());
    expect(themeService.getChoice()).toBe("omni");
  });

  it("keeps the previewed palette after a filter moves the highlight", async () => {
    const input = renderPicker();
    await userEvent.type(input, "catpp");
    expect(activeOption(input)).toHaveTextContent("Catppuccin");
    await waitFor(() => expect(dataTheme()).toBe("catppuccin"));
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(dataTheme()).toBe("catppuccin");
    expect(readThemePalette()).toBe("catppuccin");
    expect(themeService.getChoice()).toBe("catppuccin");
  });

  describe("contributed themes", () => {
    let removeFixture: () => void;
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      removeFixture = addFixtureThemes();
    });
    afterEach(() => {
      act(() => themeService.select(null));
      removeFixture();
      warn.mockRestore();
    });

    it("lists them after the built-in themes, grouped under their extension, a family as one", () => {
      renderPicker();
      expect(optionLabels()).toEqual([
        "Omnigent Default",
        "Appearance",
        "Dracula",
        "GitHub",
        "Catppuccin",
        "Gruvbox",
        "Solarized",
        "Nord",
        "Custom",
        "Fixture Light / Fixture Dark",
        "Fixture Invalid",
        "Stock Dark (VS Code)",
      ]);
      expect(screen.getByText("Fixture themes")).toBeVisible();
      // A single-mode theme says which mode it forces.
      expect(screen.getByRole("option", { name: /Stock Dark/ })).toHaveTextContent("Dark only");
      expect(screen.getByRole("option", { name: /Fixture Light/ })).not.toHaveTextContent("only");
    });

    it("shows each theme's swatch from its resolved colours", () => {
      renderPicker();
      const family = screen.getByRole("option", { name: /Fixture Light/ });
      // Light mode: the light member's background, and its accent option's default primary.
      const chip = family.querySelector("span[style]") as HTMLElement;
      expect(chip.style.backgroundColor).toBe("rgb(255, 255, 255)");
      expect((chip.querySelector("span[style]") as HTMLElement).style.backgroundColor).toBe(
        "rgb(211, 84, 0)",
      );
    });

    it("previews a contributed theme live, reverts it on Escape and keeps it on Enter", async () => {
      const input = renderPicker();
      await userEvent.type(input, "Fixture Light");
      expect(activeOption(input)).toHaveTextContent("Fixture Light / Fixture Dark");
      await waitFor(() => expect(runtimeStyle()).toContain("#ffffff"));
      expect(document.documentElement.getAttribute("data-omni-theme")).toBe(FIXTURE_DARK);
      // Nothing stored while previewing.
      expect(localStorage.getItem("omnigent:ui-theme-palette")).toBeNull();
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(runtimeStyle()).not.toContain("#ffffff");
      expect(themeService.getChoice()).toBe("omni");

      const again = renderPicker();
      await userEvent.type(again, "Stock Dark");
      await waitFor(() => expect(runtimeStyle()).toContain("#1f1f1f"));
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(themeService.getChoice()).toBe(FIXTURE_STOCK);
      expect(localStorage.getItem("omnigent:ui-theme-palette")).toBe(JSON.stringify(FIXTURE_STOCK));
    });

    it("lists a chosen theme whose extension is missing as unavailable, and keeps the choice", () => {
      act(() => themeService.select(FIXTURE_DARK));
      removeFixture();
      removeFixture = () => {};
      themeService.markStarted();
      renderPicker();
      const row = screen.getByRole("option", { name: /^Fixture Dark/ });
      expect(row).toHaveTextContent("Unavailable");
      expect(row).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByRole("option", { name: /Current theme/ })).toHaveTextContent(
        "Unavailable",
      );
      expect(themeService.getChoice()).toBe(FIXTURE_DARK);
    });
  });

  it("changes the mode from the Appearance page and returns to the themes", async () => {
    const input = renderPicker();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    const appearance = screen.getByRole("combobox", { name: "Select appearance" });
    expect(appearance).toHaveAttribute("placeholder", "Select appearance…");
    expect(activeOption(appearance)).toHaveTextContent("System");
    expect(activeOption(appearance)).toHaveTextContent("Current");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    const themes = screen.getByRole("combobox", { name: "Select theme" });
    expect(themes).toBe(input);
    expect(activeOption(themes)).toHaveTextContent("Appearance");
    expect(activeOption(themes)).toHaveTextContent("Dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("reopens on the themes page after closing from the Appearance page", async () => {
    renderPicker();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    act(() => closeThemePicker());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    act(() => openThemePicker());
    expect(screen.getByRole("combobox", { name: "Select theme" })).toBeInTheDocument();
  });

  it("goes at once when another dialog takes its place, reverting the preview, and reopens as usual", async () => {
    await previewDark();
    act(() => replaceThemePicker());
    // No exit animation to wait for: nothing of the picker is left to take keys.
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(isDarkShown()).toBe(false));
    expect(savedMode()).toBeNull();
    act(() => openThemePicker());
    expect(screen.getByRole("combobox", { name: "Select theme" })).toBeInTheDocument();
  });

  it("leaves a closed picker alone when another dialog opens", () => {
    act(() => replaceThemePicker());
    expect(useThemePickerStore.getState()).toEqual({ open: false, replaced: false });
    renderPicker();
    act(() => closeThemePicker());
    // An ordinary close keeps the picker mounted for its exit, not replaced.
    expect(useThemePickerStore.getState().replaced).toBe(false);
  });

  describe("appearance preview", () => {
    it.each([
      ["Escape", "{Escape}"],
      ["Backspace in the empty query", "{Backspace}"],
    ])(
      "previews the highlighted appearance without saving it, and %s goes back reverting it",
      async (_input, keys) => {
        await previewDark();
        await userEvent.keyboard("{ArrowUp}");
        await waitFor(() => expect(isDarkShown()).toBe(false));
        await userEvent.keyboard("{ArrowDown}");
        await waitFor(() => expect(isDarkShown()).toBe(true));

        await userEvent.keyboard(keys);
        expect(screen.getByRole("combobox", { name: "Select theme" })).toBeInTheDocument();
        expect(isDarkShown()).toBe(false);
        expect(savedMode()).toBeNull();
        expect(useThemeModePreviewStore.getState().mode).toBeNull();
      },
    );

    it("saves the highlighted appearance on Enter", async () => {
      await previewDark();
      await userEvent.keyboard("{Enter}");
      expect(screen.getByRole("combobox", { name: "Select theme" })).toBeInTheDocument();
      expect(isDarkShown()).toBe(true);
      expect(savedMode()).toBe("dark");
      expect(useThemeModePreviewStore.getState().mode).toBeNull();
      // Escape from the themes page now keeps the saved appearance.
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(isDarkShown()).toBe(true);
    });

    it("previews again after a saved appearance on a second visit to the page", async () => {
      await previewDark();
      await userEvent.keyboard("{Enter}");
      await userEvent.keyboard("{Enter}");
      const appearance = screen.getByRole("combobox", { name: "Select appearance" });
      expect(activeOption(appearance)).toHaveTextContent("Dark");
      await userEvent.keyboard("{ArrowUp}");
      expect(activeOption(appearance)).toHaveTextContent("Light");
      await waitFor(() => expect(isDarkShown()).toBe(false));
      await userEvent.keyboard("{Escape}");
      expect(isDarkShown()).toBe(true);
      expect(savedMode()).toBe("dark");
    });

    it("reverts when the picker closes from the Appearance page", async () => {
      await previewDark();
      act(() => closeThemePicker());
      expect(isDarkShown()).toBe(false);
      expect(useThemeModePreviewStore.getState().mode).toBeNull();
    });

    it("reverts when the picker unmounts mid-preview", async () => {
      const { input } = await previewDark();
      act(() => input.unmount());
      expect(useThemeModePreviewStore.getState().mode).toBeNull();
    });

    it("reverts while the window is in the background and previews again on return", async () => {
      await previewDark();
      act(() => {
        window.dispatchEvent(new Event("blur"));
      });
      expect(isDarkShown()).toBe(false);
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() => expect(isDarkShown()).toBe(true));
      expect(savedMode()).toBeNull();
    });

    it("keeps the last preview while a filter matches nothing", async () => {
      await previewDark();
      await userEvent.keyboard("zzz");
      expect(screen.getAllByText("No matching appearance").length).toBeGreaterThan(0);
      expect(isDarkShown()).toBe(true);
      await userEvent.keyboard("{Backspace}{Backspace}{Backspace}");
      await userEvent.keyboard("lig");
      await waitFor(() => expect(isDarkShown()).toBe(false));
    });

    it("reveals the latest saved appearance after another window changes it mid-preview", async () => {
      await previewDark();
      act(() => {
        localStorage.setItem("web-theme", "light");
        window.dispatchEvent(new StorageEvent("storage", { key: "web-theme", newValue: "light" }));
      });
      // The preview stays on top of the newly saved appearance.
      expect(isDarkShown()).toBe(true);
      await userEvent.keyboard("{Escape}");
      expect(isDarkShown()).toBe(false);
      expect(document.documentElement).toHaveClass("light");
      expect(useThemeModePreviewStore.getState().mode).toBeNull();
      act(() => closeThemePicker());
      expect(useThemeModePreviewStore.getState().mode).toBeNull();
      expect(document.documentElement).toHaveClass("light");
    });
  });
});
