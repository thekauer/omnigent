// ensureMonacoThemes syncs the Shiki bridge on every call: a theme another caller loaded
// (and had not synced yet) must still reach Monaco before the editor names it.

import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  loaded: new Set<string>(["github-light", "github-dark"]),
  sync: vi.fn(),
}));

vi.mock("@monaco-editor/react", () => ({ loader: { config: () => {} } }));
vi.mock("monaco-editor/esm/vs/editor/editor.api.js", () => ({}));
vi.mock("monaco-editor/esm/vs/editor/edcore.main.js", () => ({}));
vi.mock("./monacoTokenColors", () => ({ installMonacoTokenColors: () => {} }));
vi.mock("./monacoShikiBridge", () => ({ createShikiMonacoBridge: () => ({ sync: h.sync }) }));
vi.mock("shiki", () => ({
  createHighlighter: async () => ({
    getLoadedThemes: () => [...h.loaded],
    loadTheme: async (...themes: (string | { name: string })[]) => {
      for (const theme of themes) h.loaded.add(typeof theme === "string" ? theme : theme.name);
    },
  }),
}));

const { ensureMonacoThemes } = await import("./monacoSetup");

describe("ensureMonacoThemes", () => {
  it("syncs the bridge on every call, also when the pair was already loaded", async () => {
    await ensureMonacoThemes({ light: "github-light", dark: "github-dark" });
    expect(h.sync).toHaveBeenCalledTimes(1);
    await ensureMonacoThemes({ light: "github-light", dark: "github-dark" });
    expect(h.sync).toHaveBeenCalledTimes(2);
    // A pair loaded behind the bridge's back (another caller's load) still syncs.
    h.loaded.add("nord");
    await ensureMonacoThemes({ light: "github-light", dark: "nord" });
    expect(h.sync).toHaveBeenCalledTimes(3);
  });
});
