import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  resolveBranding,
  setBrandOverride,
  useAppName,
  useBrandOverride,
  useLogoUrl,
} from "./branding";
import type { Branding } from "./capabilities";

const SERVER: Branding = {
  app_name: "Acme",
  heading: null,
  logos: { main: "/logo.svg", loading: null, favicon: "/favicon.svg" },
  powered_by: true,
};

afterEach(() => setBrandOverride(null));

describe("resolveBranding", () => {
  it("keeps the server's branding without an override", () => {
    expect(resolveBranding(SERVER, null)).toBe(SERVER);
    expect(resolveBranding(null, null).app_name).toBeNull();
  });

  it("puts the override's keys over the server's", () => {
    expect(
      resolveBranding(SERVER, { appName: "Themed", logos: { favicon: "/themed.svg" } }),
    ).toEqual({
      ...SERVER,
      app_name: "Themed",
      logos: { main: "/logo.svg", loading: null, favicon: "/themed.svg" },
    });
    expect(resolveBranding(null, { logos: { main: "/themed.svg" } }).logos.main).toBe(
      "/themed.svg",
    );
  });
});

describe("the brand override", () => {
  it("drives the app name and logos live", () => {
    const { result } = renderHook(() => ({
      name: useAppName(),
      logo: useLogoUrl("loading"),
      override: useBrandOverride(),
    }));
    expect(result.current).toEqual({ name: "Omnigent", logo: null, override: null });
    act(() => setBrandOverride({ appName: "Themed", logos: { main: "/themed.svg" } }));
    expect(result.current.name).toBe("Themed");
    expect(result.current.logo).toBe("/themed.svg");
    act(() => setBrandOverride(null));
    expect(result.current.name).toBe("Omnigent");
  });
});
