import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { CapabilitiesProvider } from "@/lib/CapabilitiesContext";
import { FALLBACK_SERVER_INFO, type ServerInfo } from "@/lib/capabilities";
import { themeService } from "@/theme/themeService";
import { COLOR_THEME_ENTRY, SETTINGS_JSON_ENTRY } from "./catalog/appearance";
import { FLOATING_COMPOSER_SHORTCUT_ENTRY } from "./catalog/general";
import type { SettingsAvailability } from "./catalog/types";
import { useSettingsAvailability } from "./useSettingsAvailability";

vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => false }));

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).omnigentDesktop;
});

/** A desktop shell with the shortcut calls, answering whether it takes the panel's id. */
function renderAvailability(flag: boolean, floatingComposerShortcut: boolean) {
  const getDesktopFeatures = vi.fn().mockResolvedValue({ floatingComposerShortcut });
  (window as unknown as Record<string, unknown>).omnigentDesktop = {
    kind: "electron",
    getGlobalShortcut: vi.fn(),
    setGlobalShortcut: vi.fn(),
    getDesktopFeatures,
  };
  const info: ServerInfo = {
    ...FALLBACK_SERVER_INFO,
    features: { ...FALLBACK_SERVER_INFO.features, floating_composer: flag },
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <CapabilitiesProvider info={info}>{children}</CapabilitiesProvider>
  );
  return { getDesktopFeatures, ...renderHook(() => useSettingsAvailability(), { wrapper }) };
}

const listsNewAgentRow = (availability: SettingsAvailability) =>
  FLOATING_COMPOSER_SHORTCUT_ENTRY.available?.(availability) === true;

it("lists the New Agent row once a shell that takes its id answers, with floating_composer on", async () => {
  const { result, getDesktopFeatures } = renderAvailability(true, true);

  // Until the shell answers, search leaves the row out, as the page does.
  expect(listsNewAgentRow(result.current)).toBe(false);
  await waitFor(() => expect(listsNewAgentRow(result.current)).toBe(true));
  expect(getDesktopFeatures).toHaveBeenCalledOnce();
});

it("leaves the New Agent row out on a shell that would save the show shortcut instead", async () => {
  const { result, getDesktopFeatures } = renderAvailability(true, false);

  await waitFor(() => expect(getDesktopFeatures).toHaveBeenCalled());
  await act(async () => {});

  expect(listsNewAgentRow(result.current)).toBe(false);
  expect(result.current.globalShortcut).toBe(true);
});

it("leaves the New Agent row out, without asking the shell, while floating_composer is off", async () => {
  const { result, getDesktopFeatures } = renderAvailability(false, true);
  await act(async () => {});

  expect(listsNewAgentRow(result.current)).toBe(false);
  expect(getDesktopFeatures).not.toHaveBeenCalled();
});

it("leaves the theme rows out of search as the product hides them", () => {
  const { result } = renderAvailability(false, false);
  const listed = () =>
    [COLOR_THEME_ENTRY, SETTINGS_JSON_ENTRY]
      .filter((entry) => entry.available?.(result.current) !== false)
      .map((entry) => entry.id);
  expect(listed()).toEqual(["color-theme", "settings-json"]);
  act(() => themeService.setProductPolicy({ hidePicker: true }));
  expect(listed()).toEqual(["settings-json"]);
  act(() => themeService.setProductPolicy({ hideCustomizations: true }));
  expect(listed()).toEqual(["color-theme"]);
  act(() => themeService.setProductPolicy({ hidePicker: true, hideCustomizations: true }));
  expect(listed()).toEqual([]);
  act(() => themeService.setProductPolicy(null));
  expect(listed()).toEqual(["color-theme", "settings-json"]);
});
