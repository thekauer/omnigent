// The settings JSON dialog (theming plan M10b), with the Monaco surface replaced by a text
// area: problems as typed, Save storing the text, a malformed text keeping the last good
// values, the product's locks listed, and nothing under hideCustomizations.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openSettingsJsonEditor, useSettingsJsonEditorStore } from "@/store/settingsJsonEditor";
import { themeService } from "@/theme/themeService";

import { SettingsJsonDialog } from "./SettingsJsonDialog";

// With the real overflow widgets node, holding a stand-in for an open hover.
vi.mock("./SettingsJsonEditor", async () => {
  const { OverflowWidgets } = await import("./OverflowWidgets");
  const holdHover = (node: HTMLDivElement | null) => {
    if (node && !node.firstChild) {
      const hover = node.appendChild(document.createElement("div"));
      hover.dataset.testid = "overflow-hover";
    }
  };
  return {
    SettingsJsonEditor: ({
      defaultValue,
      onChange,
    }: {
      defaultValue: string;
      onChange: (text: string) => void;
    }) => (
      <>
        <OverflowWidgets onNode={holdHover} />
        <textarea
          data-testid="settings-json-text"
          defaultValue={defaultValue}
          onChange={(event) => onChange(event.target.value)}
        />
      </>
    ),
  };
});

const text = () => screen.findByTestId("settings-json-text");
const nextTick = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
const problems = () => screen.queryByTestId("settings-json-problems")?.textContent ?? "";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  act(() => useSettingsJsonEditorStore.setState({ open: false }));
  themeService.setProductPolicy(null);
  themeService.resetAppearance();
  vi.restoreAllMocks();
});

describe("SettingsJsonDialog", () => {
  it("checks the text as typed and saves it", async () => {
    render(<SettingsJsonDialog />);
    act(() => openSettingsJsonEditor());
    const area = (await text()) as HTMLTextAreaElement;
    expect(area.value).toBe("{\n}\n");
    expect(screen.getByTestId("settings-json-save")).toBeDisabled();
    fireEvent.change(area, { target: { value: '{ "omnigent.style.header": "chrome" }' } });
    await waitFor(() => expect(problems()).toContain("Ln 1, Col 28: Value is not accepted"));
    expect(screen.getByTestId("settings-json-status")).toHaveTextContent(
      "Unsaved changes, 1 error.",
    );
    fireEvent.change(area, { target: { value: '{ "omnigent.style.header": "solid" }' } });
    await waitFor(() => expect(problems()).toBe(""));
    fireEvent.click(screen.getByTestId("settings-json-save"));
    expect(screen.getByTestId("settings-json-status")).toHaveTextContent("Saved.");
    expect(themeService.getUserVariants()).toEqual({ header: "solid" });
  });

  it("stores a text with syntax errors, keeping the last good values", async () => {
    themeService.saveSettingsText('{ "omnigent.style.header": "solid" }');
    render(<SettingsJsonDialog />);
    act(() => openSettingsJsonEditor());
    fireEvent.change(await text(), { target: { value: '{ "omnigent.style.header": "glass", ' } });
    fireEvent.click(screen.getByTestId("settings-json-save"));
    expect(screen.getByTestId("settings-json-status")).toHaveTextContent(
      "Saved with syntax errors: the last good settings apply until they're fixed.",
    );
    expect(problems()).not.toBe("");
    expect(themeService.getUserVariants()).toEqual({ header: "solid" });
    expect(themeService.getSettingsText()).toBe('{ "omnigent.style.header": "glass", ');
  });

  it("lists a locked key as set by product", async () => {
    themeService.saveSettingsText('{ "omnigent.style.header": "solid" }');
    themeService.setProductPolicy({ lockedVariants: { header: "glass" } });
    render(<SettingsJsonDialog />);
    act(() => openSettingsJsonEditor());
    await text();
    expect(problems()).toContain("Set by product (Glass): this value doesn't apply.");
    expect(screen.getByTestId("settings-json-problems").querySelector("li")).toHaveAttribute(
      "data-severity",
      "info",
    );
  });

  it("stays open for a click in the editor's overflow widgets, and closes for one outside", async () => {
    render(<SettingsJsonDialog />);
    act(() => openSettingsJsonEditor());
    await text();
    const hover = screen.getByTestId("overflow-hover");
    expect(screen.getByTestId("settings-json-dialog").contains(hover)).toBe(false);
    // The dialog listens for outside pointers from the next tick, and dismisses on the click.
    await act(nextTick);
    const clickOn = async (target: Element) => {
      fireEvent.pointerDown(target, { button: 0, pointerType: "mouse" });
      fireEvent.pointerUp(target, { button: 0, pointerType: "mouse" });
      fireEvent.click(target, { button: 0 });
      await act(nextTick);
    };
    await clickOn(hover);
    expect(screen.getByTestId("settings-json-dialog")).toBeInTheDocument();
    await clickOn(document.body);
    await waitFor(() => expect(screen.queryByTestId("settings-json-dialog")).toBeNull());
  });

  it("checks and saves a hostile, deeply nested document", async () => {
    const deep = `{ "omnigent.style.header": "solid", "x": ${"[".repeat(3000)}${"]".repeat(3000)} }`;
    localStorage.setItem(
      "omnigent:ui-settings",
      JSON.stringify({ version: 1, text: deep, values: {} }),
    );
    render(<SettingsJsonDialog />);
    act(() => openSettingsJsonEditor());
    const area = await text();
    expect(problems()).toContain("Ln 1, Col 37: Nested too deeply");
    fireEvent.change(area, { target: { value: `${deep} ` } });
    fireEvent.click(screen.getByTestId("settings-json-save"));
    expect(screen.getByTestId("settings-json-status")).toHaveTextContent("Saved.");
    expect(themeService.getUserVariants()).toEqual({ header: "solid" });
  });

  it("shows nothing under hideCustomizations", () => {
    themeService.setProductPolicy({ hideCustomizations: true });
    render(<SettingsJsonDialog />);
    act(() => openSettingsJsonEditor());
    expect(screen.queryByTestId("settings-json-dialog")).toBeNull();
  });
});
