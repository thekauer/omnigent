import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";
import { useResolvedThemeMode } from "./components/theme/useResolvedThemeMode";
import { MemoryRouter } from "react-router-dom";
import { transform } from "lightningcss";
import { parse, type AtRule, type Rule } from "postcss";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scopeCss } from "../vite.embed.config";
import { OmnigentApp, type ProductConfig } from "./embed";
import { themeService } from "./theme/themeService";
import { getEmbedRoot, getEmbedScopeRoot } from "./lib/host";

// Exercise the embed's real providers and native detection without loading
// routed pages, editors, or terminals unrelated to the window chrome.
vi.mock("./App", () => ({
  default: function ThemeTestApp() {
    const { theme, setTheme } = useTheme();
    const resolved = useResolvedThemeMode();
    return (
      <div className="app-shell">
        <div className="electron-drag-strip" />
        <div className="sidebar-header-row" />
        <div className="traffic-light-clearance" />
        <div className="canvas-workspace" />
        <aside aria-label="Workspace" data-maximized="true">
          <div className="workspace-tab-strip" />
        </aside>
        <button type="button">Header action</button>
        <output aria-label="App theme">
          {theme}:{resolved}
        </output>
        {["light", "dark", "system"].map((mode) => (
          <button type="button" key={mode} onClick={() => setTheme(mode)}>
            Select {mode}
          </button>
        ))}
      </div>
    );
  },
}));

// Keep the backend discovery pending: the root must be marked before it resolves.
const fetcher = () => new Promise<Response>(() => {});

const compiledCss = transform({
  filename: "index.css",
  code: readFileSync("src/index.css"),
  minify: true,
}).code.toString();
const css = parse(scopeCss(compiledCss));
function selectorFor(fragment: string): string {
  let selector = "";
  css.walkRules((rule) => {
    if (
      !selector &&
      rule.selector.includes("[data-electron-mac]") &&
      rule.selector.includes(fragment)
    ) {
      selector = rule.selector;
    }
  });
  expect(selector).not.toBe("");
  return selector;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("macOS Electron embed", () => {
  it.each([
    ["macOS Electron", "Macintosh", true, true],
    ["macOS browser", "Macintosh", false, false],
    ["Windows Electron", "Windows NT 10.0", true, false],
  ])("scopes window chrome correctly in %s", (_name, platform, electron, expected) => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(`Mozilla/5.0 (${platform})`);
    vi.stubGlobal("omnigentDesktop", electron ? { kind: "electron" } : undefined);
    const { container, getByRole } = render(
      <MemoryRouter>
        <OmnigentApp fetcher={fetcher} />
      </MemoryRouter>,
    );
    const scope = container.querySelector(".omnigent-app")!;
    expect(scope.getAttribute("data-electron-mac")).toBe(expected ? "true" : null);
    expect(document.documentElement).not.toHaveAttribute("data-electron-mac");
    // Every desktop app keeps the desktop layout, so the marker isn't macOS-only.
    expect(scope.getAttribute("data-desktop-app")).toBe(electron ? "true" : null);
    expect(document.documentElement).not.toHaveAttribute("data-desktop-app");

    const keyboardScope = getEmbedRoot()!;
    expect(keyboardScope.getAttribute("tabindex")).toBe(electron ? null : "-1");
    if (!electron) {
      keyboardScope.focus();
      expect(document.activeElement).toBe(keyboardScope);
    }

    for (const className of [
      "electron-drag-strip",
      "sidebar-header-row",
      "traffic-light-clearance",
      "canvas-workspace",
      "workspace-tab-strip",
    ]) {
      const selector = selectorFor(`.${className}`);
      expect(selector).not.toContain(":has(");
      expect(scope.querySelector(`.${className}`)!.matches(selector), className).toBe(expected);
    }

    let smoothingSelector = "";
    css.walkDecls("-webkit-font-smoothing", (declaration) => {
      smoothingSelector = (declaration.parent as Rule).selector;
    });
    expect(smoothingSelector).not.toBe("");
    expect(scope.matches(smoothingSelector)).toBe(true);

    const controlsSelector = selectorFor(":is(");
    expect(controlsSelector).not.toContain(":has(");
    expect(getByRole("button", { name: "Header action" }).matches(controlsSelector)).toBe(expected);
    render(createPortal(<div role="menu">Menu</div>, getEmbedRoot()!));
    expect(getByRole("menu").matches(controlsSelector)).toBe(expected);

    scope.querySelector(".app-shell")!.setAttribute("data-sidebar-open", "true");
    expect(
      scope.querySelector(".workspace-tab-strip")!.matches(selectorFor(".workspace-tab-strip")),
    ).toBe(false);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    expect(outside.matches(controlsSelector)).toBe(false);
    outside.remove();
  });
});

describe("embed color scheme", () => {
  // The scope root resolves `color` from the light tokens, so the portal root
  // must re-apply the foreground color for overlays to read dark-mode text.
  it.each([
    ["dark", true],
    ["light", false],
  ])("re-applies the foreground color on the %s portal root", (_name, isDarkMode) => {
    render(
      <MemoryRouter>
        <OmnigentApp fetcher={fetcher} isDarkMode={isDarkMode} />
      </MemoryRouter>,
    );

    const portalRoot = getEmbedRoot()!;
    expect(portalRoot).toHaveClass("text-foreground");
    expect(portalRoot.classList.contains("dark")).toBe(isDarkMode);
  });
});

describe("embedded theme selection", () => {
  function app(isDarkMode: boolean) {
    return (
      <MemoryRouter>
        <OmnigentApp fetcher={fetcher} isDarkMode={isDarkMode} />
      </MemoryRouter>
    );
  }

  it("follows host changes until overridden and restores the stored choice", () => {
    const { getByRole, rerender, unmount } = render(app(true));
    expect(getByRole("status", { name: "App theme" })).toHaveTextContent("system:dark");
    rerender(app(false));
    expect(getEmbedRoot()).not.toHaveClass("dark");
    fireEvent.click(getByRole("button", { name: "Select dark" }));
    expect(getByRole("status", { name: "App theme" })).toHaveTextContent("dark:dark");
    expect(getEmbedRoot()).toHaveClass("dark");
    expect(localStorage.getItem("web-theme")).toBe("dark");
    unmount();

    const restored = render(app(false));
    expect(getEmbedRoot()).toHaveClass("dark");
    fireEvent.click(restored.getByRole("button", { name: "Select light" }));
    restored.rerender(app(true));
    expect(getEmbedRoot()).not.toHaveClass("dark");
    fireEvent.click(restored.getByRole("button", { name: "Select system" }));
    expect(getEmbedRoot()).toHaveClass("dark");
    expect(restored.getByRole("status", { name: "App theme" })).toHaveTextContent("system:dark");
  });

  it("keeps overrides inside the embed while the host document stays dark", () => {
    document.documentElement.className = "dark host-page";
    document.documentElement.style.colorScheme = "dark";
    const { getByRole } = render(app(true));
    fireEvent.click(getByRole("button", { name: "Select light" }));
    expect(getEmbedRoot()).not.toHaveClass("dark");
    expect(getEmbedRoot()).toHaveStyle({ colorScheme: "light" });
    expect(document.documentElement.className).toBe("dark host-page");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    const selector = parse(scopeCss(".control:is(.dark *) { color: white; }")).nodes[0] as Rule;
    const control = getByRole("button", { name: "Select dark" });
    control.classList.add("control");
    expect(control.matches(selector.selector)).toBe(false);
    fireEvent.click(control);
    expect(control.matches(selector.selector)).toBe(true);
  });

  it("follows OS changes in Electron and syncs explicit choices to native chrome", () => {
    const setColorScheme = vi.fn();
    vi.stubGlobal("omnigentDesktop", { kind: "electron", setColorScheme });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listeners = new Set<NonNullable<Parameters<MediaQueryList["addListener"]>[0]>>();
    let systemDark = true;
    vi.spyOn(window, "matchMedia").mockReturnValue({
      ...media,
      get matches() {
        return systemDark;
      },
      addListener: (listener) => {
        if (listener) listeners.add(listener);
      },
      removeListener: (listener) => {
        if (listener) listeners.delete(listener);
      },
    });
    const { getByRole, rerender } = render(app(false));
    expect(getByRole("status", { name: "App theme" })).toHaveTextContent("system:dark");
    expect(setColorScheme).toHaveBeenLastCalledWith("system");
    rerender(app(true));
    act(() => {
      systemDark = false;
      listeners.forEach((listener) =>
        listener.call(media, { matches: false } as MediaQueryListEvent),
      );
    });
    expect(getEmbedRoot()).not.toHaveClass("dark");
    fireEvent.click(getByRole("button", { name: "Select dark" }));
    expect(getEmbedRoot()).toHaveClass("dark");
    expect(setColorScheme).toHaveBeenLastCalledWith("dark");
    fireEvent.click(getByRole("button", { name: "Select system" }));
    expect(getEmbedRoot()).not.toHaveClass("dark");
    expect(setColorScheme).toHaveBeenLastCalledWith("system");
  });
});

describe("embed product theme", () => {
  const style = () => document.getElementById("omnigent-theme-runtime")?.textContent ?? "";
  function app(product: ProductConfig | undefined, isDarkMode = false) {
    return (
      <MemoryRouter>
        <OmnigentApp fetcher={fetcher} isDarkMode={isDarkMode} product={product} />
      </MemoryRouter>
    );
  }

  it("applies the default, locks the mode and tokens over the user's, and clears on unmount", () => {
    const setColorScheme = vi.fn();
    vi.stubGlobal("omnigentDesktop", { kind: "electron", setColorScheme });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(
      "omnigent:ui-color-customizations",
      JSON.stringify({ "ui-radius-base": "12px" }),
    );
    const product: ProductConfig = {
      theme: {
        default: "nord",
        allowed: ["nord", "dracula"],
        lockMode: "dark",
        lockedTokens: { "ui-radius-base": "0px" },
        hidePicker: true,
      },
    };
    const { getByRole, rerender, unmount } = render(app(product));
    expect(themeService.getChoice()).toBe("nord");
    expect(getEmbedRoot()).toHaveAttribute("data-theme", "nord");
    // Dark although the host is light and the user picks light: the native chrome follows.
    expect(getEmbedRoot()).toHaveClass("dark");
    fireEvent.click(getByRole("button", { name: "Select light" }));
    expect(getEmbedRoot()).toHaveClass("dark");
    expect(setColorScheme).toHaveBeenLastCalledWith("dark");
    expect(style()).toContain("--ui-radius-base: 0px");
    expect(style()).not.toContain("12px");
    expect(themeService.getProductPolicy()).toMatchObject({ hidePicker: true });
    expect(() => themeService.select("omni")).toThrow(/not allowed/);

    // A new prop value replaces it; an equal one re-renders without a change.
    rerender(app({ theme: { default: "dracula" } }));
    expect(themeService.getChoice()).toBe("dracula");
    expect(getEmbedRoot()).not.toHaveClass("dark");
    expect(style()).toContain("12px");
    unmount();
    expect(themeService.getProductPolicy()).toBeNull();
    expect(themeService.getChoice()).toBe("omni");
  });

  it("applies it only to the embed's roots, never the host page's, while mounting", () => {
    const observer = new MutationObserver(() => {});
    observer.observe(document.documentElement, { attributes: true });
    const product: ProductConfig = {
      theme: { default: "nord", lockedVariants: { density: "comfortable" } },
    };
    const { unmount } = render(app(product));
    const touched = observer.takeRecords().map((record) => record.attributeName);
    observer.disconnect();

    expect(getEmbedRoot()).toHaveAttribute("data-theme", "nord");
    expect(getEmbedScopeRoot()).toHaveAttribute("data-omni-density", "comfortable");
    expect(touched).not.toContain("data-theme");
    expect(touched).not.toContain("data-omni-density");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    unmount();
  });
});

describe("mobile app embed target scope", () => {
  it.each(["ios", "android", "electron", "browser"])(
    "contains portaled controls without marking the host in %s",
    (kind) => {
      vi.stubGlobal("omnigentNative", kind === "ios" || kind === "android" ? { kind } : undefined);
      vi.stubGlobal("omnigentDesktop", kind === "electron" ? { kind } : undefined);
      const { getByRole } = render(
        <MemoryRouter>
          <OmnigentApp fetcher={fetcher} />
        </MemoryRouter>,
      );
      const root = getEmbedRoot()!;
      render(createPortal(<button type="button">Portaled choice</button>, root));
      const expected = kind === "ios" || kind === "android";
      expect(
        getByRole("button", { name: "Portaled choice" }).closest('[data-mobile-app="true"]') !==
          null,
      ).toBe(expected);
      expect(
        getByRole("button", { name: "Header action" }).closest('[data-mobile-app="true"]') !== null,
      ).toBe(expected);
      expect(document.documentElement).not.toHaveAttribute("data-mobile-app");
    },
  );
});

describe("embed token registrations", () => {
  // `@property` is document-global: registering the theme tokens from the embed would
  // retype the host page's own variables of the same names.
  it("drops the theme tokens' @property rules and keeps other registrations", () => {
    const generated = readFileSync("src/themeTokens.generated.css", "utf8");
    const registered = [...generated.matchAll(/@property (--[\w-]+)/g)].map((match) => match[1]);
    expect(registered).toContain("--ui-elevation");
    expect(registered).toContain("--ui-radius-sm");
    const scoped = parse(
      scopeCss(
        `@layer properties { @supports (not (x: y)) { :root { --ui-elevation: 1; --tw-shadow: 0 0 #0000; } } }\n` +
          `${generated}\n@property --tw-shadow { syntax: "*"; inherits: false; }`,
      ),
    );
    const kept: string[] = [];
    scoped.walkAtRules("property", (rule) => {
      kept.push(rule.params);
    });
    // The internal elevation guard stays registered: its name is Omnigent's own.
    expect(kept).toEqual(["--omnigent-elevation", "--tw-shadow"]);
    // The token declarations themselves stay, scoped onto the embed root.
    let elevation = "";
    scoped.walkDecls("--ui-elevation", (declaration) => {
      elevation ||= `${(declaration.parent as Rule).selector} ${declaration.value}`;
    });
    expect(elevation).toBe(".omnigent-app 1");
    // Tailwind's no-`@property` fallback keeps its own initial values only.
    const fallback = scoped.first as AtRule;
    expect([fallback.name, fallback.toString()]).toEqual([
      "supports",
      "@supports (not (x: y)) { .omnigent-app { --tw-shadow: 0 0 #0000; } }",
    ]);
  });
});

describe("embed mode tests", () => {
  // Standalone `.dark` is on the document root; embedded, on the inner root only.
  function roots(dark: boolean) {
    document.body.innerHTML =
      `<div class="omnigent-app" data-theme="custom" data-custom-translucent-sidebar>` +
      `<div data-omnigent-inner data-theme="custom" data-custom-translucent-sidebar class="${dark ? "dark" : ""}">` +
      `<div class="menu-surface"></div><div class="conversations-sidebar"></div></div></div>`;
    return {
      scope: document.querySelector<HTMLElement>(".omnigent-app")!,
      inner: document.querySelector<HTMLElement>("[data-omnigent-inner]")!,
      menu: document.querySelector<HTMLElement>(".menu-surface")!,
      sidebar: document.querySelector<HTMLElement>(".conversations-sidebar")!,
    };
  }
  const rules = (fragment: string) => {
    const found: string[] = [];
    css.walkRules((rule) => {
      for (const selector of rule.selectors) if (selector.includes(fragment)) found.push(selector);
    });
    return found;
  };
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("tests the mode of a root selector on the inner root, for the app and its portals", () => {
    const light = rules(".menu-surface").filter((selector) => selector.includes(":not(.dark)"));
    expect(light).toEqual([
      ".omnigent-app > :where([data-omnigent-inner]):not(.dark) .menu-surface",
    ]);
    const sidebar = rules(".conversations-sidebar").filter((selector) =>
      selector.includes(":not(.dark)"),
    );
    expect(sidebar.length).toBeGreaterThanOrEqual(3);
    let dom = roots(true);
    for (const selector of [...light, ...sidebar]) {
      expect(dom.menu.matches(selector) || dom.sidebar.matches(selector), selector).toBe(false);
    }
    dom = roots(false);
    expect(dom.menu.matches(light[0]!)).toBe(true);
    for (const selector of sidebar) {
      expect(dom.sidebar.matches(selector), selector).toBe(true);
    }
  });

  it("keeps the weight, the scope root's other conditions and its light fallback", () => {
    const scoped = (selector: string) =>
      (parse(scopeCss(`${selector} { color: red; }`)).nodes[0] as Rule).selector;
    expect(scoped(":root.dark .x")).toBe(".omnigent-app > :where([data-omnigent-inner]).dark .x");
    expect(scoped("html.dark")).toBe(".omnigent-app > :where([data-omnigent-inner]).dark");
    expect(scoped(':root[data-theme="nord"]:not(.dark) .x')).toBe(
      '.omnigent-app[data-theme="nord"] > :where([data-omnigent-inner]):not(.dark) .x',
    );
    // A block for the root itself in light mode stays on the scope root.
    expect(scoped(":root:not(.dark)[data-theme]")).toBe(".omnigent-app:not(.dark)[data-theme]");
    expect(scoped(":root > .dark")).toBe(".omnigent-app > .dark");
    expect(scoped("html[data-electron-mac] .x")).toBe(".omnigent-app[data-electron-mac] .x");
    expect(scoped(".dark .x")).toBe(".omnigent-app .dark .x");
    const { inner } = roots(true);
    expect(inner.matches(scoped(":root.dark"))).toBe(true);
    expect(() => scoped(":root:is(.dark) .x")).toThrow(/tests the theme mode/);
  });

  it("leaves no mode test on the scope root in the scoped stylesheet", () => {
    const wrong: string[] = [];
    css.walkRules((rule) => {
      for (const selector of rule.selectors) {
        const root = selector.match(/^\.omnigent-app((?:\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*)\s/);
        if (root && /\.dark(?![\w-])/.test(root[1]!)) wrong.push(selector);
      }
    });
    expect(wrong).toEqual([]);
  });
});
