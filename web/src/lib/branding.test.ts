import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyDocumentBranding,
  classifyBrandUrl,
  MAX_APP_NAME_LENGTH,
  normalizeAppName,
  readDocumentBrandDefaults,
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

describe("the override's app name", () => {
  it("treats an empty or blank name as unset", () => {
    setBrandOverride({ appName: "" });
    expect(renderHook(() => useBrandOverride()).result.current).toBeNull();
    setBrandOverride({ appName: " \u0007 ", logos: { main: "" } });
    expect(renderHook(() => useAppName()).result.current).toBe("Omnigent");
    expect(resolveBranding(SERVER, { appName: "" }).app_name).toBe("Acme");
  });

  it("strips control characters and caps the length", () => {
    expect(normalizeAppName("Ac\u0000me\u009f\n")).toBe("Acme");
    expect(normalizeAppName("x".repeat(500))).toHaveLength(MAX_APP_NAME_LENGTH);
    expect(normalizeAppName(42)).toBeUndefined();
  });
});

describe("classifyBrandUrl", () => {
  it("tells host paths, inline images, same-origin and cross-origin URLs apart", () => {
    expect(classifyBrandUrl("/v1/branding/logo/main")).toBe("host");
    expect(classifyBrandUrl("//evil.example/logo.svg")).toBe("cross-origin");
    expect(classifyBrandUrl("/\\evil.example/logo.svg")).toBe("cross-origin");
    expect(classifyBrandUrl("blob:http://localhost/abc")).toBe("inline");
    expect(classifyBrandUrl("data:image/png;base64,AAAA")).toBe("inline");
    expect(classifyBrandUrl(`${window.location.origin}/logo.svg`)).toBe("same-origin");
    expect(classifyBrandUrl("https://cdn.example.com/logo.svg")).toBe("cross-origin");
    expect(classifyBrandUrl("javascript:alert(1)")).toBe("cross-origin");
  });
});

describe("applyDocumentBranding", () => {
  function setUpDocument() {
    document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="/favicon.svg">';
    document.title = "Omnigent";
    return readDocumentBrandDefaults();
  }
  const icon = () => document.querySelector<HTMLLinkElement>('link[rel="icon"]');

  it("restores the page's own title and favicon when the branding is cleared", () => {
    const defaults = setUpDocument();
    applyDocumentBranding(
      resolveBranding(SERVER, { appName: "Themed", logos: { favicon: "/t.svg" } }),
      defaults,
    );
    expect(document.title).toBe("Themed");
    expect(icon()?.getAttribute("href")).toBe("/t.svg");
    expect(icon()?.hasAttribute("type")).toBe(false);

    applyDocumentBranding(resolveBranding(SERVER, null), defaults);
    expect(document.title).toBe("Acme");
    expect(icon()?.getAttribute("href")).toBe("/favicon.svg");

    applyDocumentBranding(resolveBranding(null, null), defaults);
    expect(document.title).toBe("Omnigent");
    expect(icon()?.getAttribute("href")).toBe("/favicon.svg");
    expect(icon()?.getAttribute("type")).toBe("image/svg+xml");
  });
});
