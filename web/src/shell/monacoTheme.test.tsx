// The Monaco theme an editor gets while its syntax theme is registered, re-registered
// and unregistered. Monaco can't mount in jsdom, so a stand-in editor applies its
// `theme` the way the Shiki bridge's setTheme does: through the shared highlighter,
// which throws for a theme it hasn't loaded (what crashed the viewer).

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import type { createHighlighter } from "shiki";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { registerSyntaxTheme, type SyntaxThemeDefinition } from "@/lib/syntaxTheme";

const h = vi.hoisted(() => ({
  highlighter: null as Awaited<ReturnType<typeof createHighlighter>> | null,
  creating: null as Promise<Awaited<ReturnType<typeof createHighlighter>>> | null,
}));

vi.mock("./monacoSetup", async () => {
  const { loadSyntaxThemes, SYNTAX_THEME_NAMES } = await import("@/lib/syntaxTheme");
  const { createHighlighter: create } = await import("shiki");
  // One highlighter, however many callers race for it (as monacoSetup's readyPromise).
  const ready = () => {
    h.creating ??= create({
      themes: [SYNTAX_THEME_NAMES.light, SYNTAX_THEME_NAMES.dark],
      langs: [],
    }).then((highlighter) => (h.highlighter = highlighter));
    return h.creating;
  };
  return {
    resolvedThemeToMonaco: (mode: string, names: { light: string; dark: string }) =>
      mode === "dark" ? names.dark : names.light,
    ensureMonacoThemes: async (names: { light: string; dark: string }) =>
      (await loadSyntaxThemes(await ready(), names)).shikiNames,
  };
});

const { useMonacoTheme } = await import("./monacoTheme");

const FIXTURE: SyntaxThemeDefinition = {
  name: "fixture",
  type: "dark",
  colors: { "editor.background": "#101820", "editor.foreground": "#e0e0e0" },
  tokenColors: [{ scope: "keyword", settings: { foreground: "#ff00aa" } }],
};

function StandInEditor({ theme }: { theme: string }) {
  // Before the highlighter exists, only the default pair is ever passed.
  h.highlighter?.setTheme(theme);
  return <div data-testid="editor" data-theme={theme} />;
}

function Viewer() {
  return <StandInEditor theme={useMonacoTheme("dark")} />;
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <div data-testid="crashed" /> : this.props.children;
  }
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("style");
});

afterAll(() => h.highlighter?.dispose());

describe("useMonacoTheme", () => {
  it("keeps the editor mounted while the active theme is re-registered and unregistered", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let unregister = registerSyntaxTheme(FIXTURE);
    render(
      <Boundary>
        <Viewer />
      </Boundary>,
    );
    const editorTheme = () => screen.getByTestId("editor").dataset.theme;
    expect(editorTheme()).toBe("github-dark");

    act(() => {
      document.documentElement.style.setProperty("--syntax-theme-dark", "fixture");
    });
    await waitFor(() => expect(editorTheme()).toMatch(/^registered-\d+-fixture$/));
    const first = editorTheme();

    // Re-registered: a new Shiki name, passed only once it is loaded.
    act(() => {
      unregister = registerSyntaxTheme(FIXTURE);
    });
    expect(screen.queryByTestId("crashed")).toBeNull();
    await waitFor(() => expect(editorTheme()).not.toBe(first));
    expect(h.highlighter?.getLoadedThemes()).toContain(editorTheme());

    // Unregistered while the token still names it: the default pair, never "fixture".
    act(() => unregister());
    expect(screen.queryByTestId("crashed")).toBeNull();
    await waitFor(() => expect(editorTheme()).toBe("github-dark"));
    expect(screen.queryByTestId("crashed")).toBeNull();
  });
});
