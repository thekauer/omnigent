// The theme settings quick picks in ⌘K (theming plan M10b): "Color Theme: Select Option…" and
// "Preferences: Select Style Variant…" open a page of options or variants, each opening a page
// of its values; a choice writes the settings document and Back returns to the options. A
// product's locks grey a row out, and hideCustomizations withdraws the commands.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_EXTENSION_ID, fixtureThemeExtension } from "@/test/themeFixtures";
import { readStoredSettings, SETTINGS_STORAGE_KEY } from "@/theme/settingsDocument";
import { themeService } from "@/theme/themeService";

import { CommandContextProvider } from "./commandContext";
import { QuickPickCommandPalette } from "./QuickPickCommandPalette";

vi.mock("@/lib/routing", () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/", search: "", hash: "", state: null, key: "default" }),
}));
vi.mock("@/lib/CapabilitiesContext", () => ({
  useServerInfo: () => ({ session_search_scope: true }),
}));
vi.mock("@/hooks/useConversations", () => ({
  useConversations: () => ({ data: { pages: [] }, isFetching: false }),
  useSessionSearch: () => ({ isFetching: false }),
  useProjects: () => ({ data: [] }),
}));

const DARK = `${FIXTURE_EXTENSION_ID}/full-dark`;
const SCOPE = `[${FIXTURE_EXTENSION_ID}/fixture]`;

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <CommandContextProvider session={null} view="other" workspaceTab={null} filePath={null}>
      <QuickPickCommandPalette
        open={open}
        onOpenChange={setOpen}
        onToggleLeftSidebar={vi.fn()}
        onToggleRightSidebar={vi.fn()}
      />
    </CommandContextProvider>
  );
}

const input = () => screen.getByRole("combobox");
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
const press = (key: string) => fireEvent.keyDown(input(), { key });
const heading = () =>
  document.querySelector('[data-slot="quick-pick-heading"]')?.textContent ?? null;
const row = (name: RegExp) => screen.getByRole("option", { name });
const values = () => readStoredSettings(localStorage.getItem(SETTINGS_STORAGE_KEY)).values;

let removeExtension: () => void = () => {};

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  removeExtension = themeService.addExtension(fixtureThemeExtension());
  themeService.markStarted();
  themeService.select(DARK);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>,
  );
});

afterEach(() => {
  cleanup();
  themeService.setProductPolicy(null);
  themeService.select(null);
  removeExtension();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function openCommand(query: string, label: RegExp, title: string) {
  type(query);
  await screen.findByRole("option", { name: label });
  // The query may rank another row first: make this one active.
  fireEvent.click(row(label));
  await waitFor(() => expect(heading()).toBe(title));
}

describe("theme settings quick picks", () => {
  it("chooses a theme option on its own page, and goes back to the options", async () => {
    await openCommand("select option", /Color Theme: Select Option…/, "Color Theme: Select Option");
    expect(row(/Accent/).textContent).toContain("Orange");
    fireEvent.click(row(/Accent/));
    await waitFor(() => expect(heading()).toBe("Accent"));
    fireEvent.click(row(/Lava/));
    await waitFor(() => expect(heading()).toBe("Color Theme: Select Option"));
    expect(values()).toEqual({ "omnigent.themeOptions": { [SCOPE]: { accent: "lava" } } });
    expect(row(/Accent/).textContent).toContain("Lava");
    expect(themeService.getActive()?.options[0]?.value).toBe("lava");
  });

  it("chooses a style variant, Theme default removing it", async () => {
    await openCommand(
      "style variant",
      /Preferences: Select Style Variant…/,
      "Preferences: Select Style Variant",
    );
    expect(row(/^Density/).textContent).toContain("Theme default (Compact)");
    fireEvent.click(row(/^Density/));
    await waitFor(() => expect(heading()).toBe("Density"));
    fireEvent.click(row(/Comfortable/));
    await waitFor(() => expect(heading()).toBe("Preferences: Select Style Variant"));
    expect(values()).toEqual({ "omnigent.style.density": "comfortable" });
    fireEvent.click(row(/^Density/));
    await waitFor(() => expect(heading()).toBe("Density"));
    fireEvent.click(row(/Theme default/));
    await waitFor(() => expect(heading()).toBe("Preferences: Select Style Variant"));
    expect(values()).toEqual({});
  });

  it("goes back from a value page to the options, then to the root", async () => {
    await openCommand(
      "style variant",
      /Preferences: Select Style Variant…/,
      "Preferences: Select Style Variant",
    );
    fireEvent.click(row(/^Header/));
    await waitFor(() => expect(heading()).toBe("Header"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(heading()).toBe("Preferences: Select Style Variant"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(heading()).toBeNull());
    press("Escape");
  });

  it("greys out what the product locks, saying so", async () => {
    themeService.setProductPolicy({
      lockedOptions: { accent: "lava" },
      lockedVariants: { header: "solid" },
    });
    await openCommand("select option", /Color Theme: Select Option…/, "Color Theme: Select Option");
    expect(row(/Accent/).textContent).toContain("Lava · Set by product");
    expect(row(/Accent/).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row(/Accent/));
    expect(heading()).toBe("Color Theme: Select Option");
    expect(row(/Corners/).getAttribute("aria-disabled")).not.toBe("true");
  });

  it("is withdrawn under hideCustomizations", async () => {
    themeService.setProductPolicy({ hideCustomizations: true });
    type("style variant");
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: /Select Style Variant/ })).toBeNull(),
    );
    type("settings json");
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: /Open Settings \(JSON\)/ })).toBeNull(),
    );
  });

  it("greys the values out while the settings JSON doesn't parse", async () => {
    themeService.saveSettingsText('{ "omnigent.style.header": ');
    await openCommand(
      "style variant",
      /Preferences: Select Style Variant…/,
      "Preferences: Select Style Variant",
    );
    expect(row(/^Header/).getAttribute("aria-disabled")).toBe("true");
  });
});
