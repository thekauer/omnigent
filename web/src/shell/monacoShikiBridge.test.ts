// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { type BridgedHighlighter, createShikiMonacoBridge } from "./monacoShikiBridge";

function fakes() {
  const themes = ["github-light", "github-dark"];
  const languages: string[] = [];
  const highlighter = {
    getLoadedThemes: () => [...themes],
    getLoadedLanguages: () => [...languages],
    getTheme: (name: string) => ({
      name,
      type: name.endsWith("dark") ? "dark" : "light",
      colors: {},
      tokenColors: [{ scope: "keyword", settings: { foreground: "#ff00aa" } }],
    }),
    setTheme: vi.fn(() => ({ colorMap: ["#000000", "#ff00aa"] })),
    getLanguage: () => ({
      tokenizeLine2: () => ({
        // One token at 0, foreground index 1 (bits 15-23).
        tokens: new Uint32Array([0, 1 << 15]),
        ruleStack: null,
        stoppedEarly: false,
      }),
    }),
  } as unknown as BridgedHighlighter;
  const providers = new Map<string, { tokenize: (line: string, state: unknown) => unknown }>();
  const nativeSetTheme = vi.fn();
  const monaco = {
    editor: {
      setTheme: nativeSetTheme,
      create: vi.fn(() => "editor"),
      defineTheme: vi.fn(),
    },
    languages: {
      getLanguages: () => languages.map((id) => ({ id })),
      setTokensProvider: vi.fn(
        (id: string, provider: { tokenize: (line: string, state: unknown) => unknown }) => {
          providers.set(id, provider);
        },
      ),
    },
  };
  return { themes, languages, highlighter, monaco, nativeSetTheme, providers };
}

describe("createShikiMonacoBridge", () => {
  it("wraps setTheme and create once, and keeps the theme across syncs", () => {
    const f = fakes();
    const bridge = createShikiMonacoBridge(f.highlighter, f.monaco as never);
    const wrapped = f.monaco.editor.setTheme;
    expect(f.monaco.editor.defineTheme).toHaveBeenCalledTimes(2);
    // The first loaded theme, once, as shikiToMonaco's first call did.
    expect(f.nativeSetTheme).toHaveBeenCalledTimes(1);
    f.monaco.editor.setTheme("github-dark");
    expect(f.nativeSetTheme).toHaveBeenLastCalledWith("github-dark");

    f.themes.push("registered-1-fixture");
    f.languages.push("python");
    bridge.sync();
    bridge.sync();
    expect(f.monaco.editor.setTheme).toBe(wrapped);
    // Only the new theme is defined; the global theme isn't reset.
    expect(f.monaco.editor.defineTheme).toHaveBeenCalledTimes(3);
    expect(f.nativeSetTheme).toHaveBeenCalledTimes(2);
    expect(f.monaco.languages.setTokensProvider).toHaveBeenCalledTimes(1);

    const provider = f.providers.get("python");
    expect(provider?.tokenize("def", { ruleStack: null })).toMatchObject({
      tokens: [{ startIndex: 0, scopes: "keyword" }],
    });
  });

  it("keeps the current theme for a name the highlighter hasn't loaded", () => {
    const f = fakes();
    createShikiMonacoBridge(f.highlighter, f.monaco as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    f.monaco.editor.setTheme("registered-9-missing");
    expect(f.nativeSetTheme).toHaveBeenCalledTimes(1);
    expect(f.highlighter.setTheme).toHaveBeenCalledTimes(1);
  });

  it("sets an editor's theme option when it is created", () => {
    const f = fakes();
    createShikiMonacoBridge(f.highlighter, f.monaco as never);
    (f.monaco.editor.create as (...args: unknown[]) => unknown)({}, { theme: "github-dark" });
    expect(f.nativeSetTheme).toHaveBeenLastCalledWith("github-dark");
  });
});
