import { describe, expect, it } from "vitest";

import { getToken } from "./tokens/registry";
import { VSCODE_COLOR_ALIASES, VSCODE_COLOR_ALIAS_MAP } from "./vscodeColorAliases";

describe("the VS Code colour aliases", () => {
  it("name each VS Code id once, as VS Code writes its ids", () => {
    const ids = VSCODE_COLOR_ALIASES.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)?$/);
  });

  it("set only colour tokens of the registry (an image token takes a colour too)", () => {
    for (const [id, tokens] of VSCODE_COLOR_ALIASES) {
      expect(tokens.length, id).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(["color", "image"], `${id} -> ${token}`).toContain(getToken(token)?.kind);
      }
    }
  });

  it("map the curated meanings", () => {
    expect(VSCODE_COLOR_ALIAS_MAP.get("editor.background")).toEqual([
      "background",
      "code-bg",
      "viewer-background",
    ]);
    expect(VSCODE_COLOR_ALIAS_MAP.get("sideBar.background")).toEqual([
      "sidebar",
      "sidebar-background",
    ]);
    expect(VSCODE_COLOR_ALIAS_MAP.get("focusBorder")).toEqual(["ring", "sidebar-ring"]);
    expect(VSCODE_COLOR_ALIAS_MAP.get("terminal.ansiBrightWhite")).toEqual([
      "terminal-ansi-bright-white",
    ]);
  });

  it("put the broad ids before the specific ones that share a token", () => {
    const order = new Map(VSCODE_COLOR_ALIASES.map(([id], index) => [id, index]));
    expect(order.get("foreground")!).toBeLessThan(order.get("editor.foreground")!);
    expect(order.get("editorWidget.background")!).toBeLessThan(order.get("menu.background")!);
  });
});
