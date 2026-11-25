import { afterEach, describe, expect, it } from "vitest";

import { installMonacoTokenColors, monacoTokenColorsCss } from "./monacoTokenColors";

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("monacoTokenColorsCss", () => {
  it("writes nothing while no token is set, so Monaco keeps the syntax theme's colours", () => {
    expect(monacoTokenColorsCss({}, "html")).toBe("");
    expect(monacoTokenColorsCss({ "diff-addition-base": "" }, "html")).toBe("");
  });

  it("writes the variables of the set tokens, per mode", () => {
    const css = monacoTokenColorsCss(
      { "diff-addition-base": "#00ff00", "viewer-gutter-foreground": "#123456" },
      "html",
    );
    expect(css).toContain(
      "html .monaco-editor, html .monaco-diff-editor, html .monaco-component {",
    );
    expect(css).toContain("--vscode-editorLineNumber-foreground: var(--viewer-gutter-foreground);");
    expect(css).toContain(
      "--vscode-diffEditor-insertedLineBackground: color-mix(in srgb, var(--diff-addition-base) var(--diff-line-mix, var(--diff-line-mix-light)), transparent);",
    );
    expect(css).toContain("html.dark .monaco-editor");
    expect(css).toContain("var(--diff-line-mix-dark)");
    expect(css).not.toContain("removedLineBackground");
    expect(monacoTokenColorsCss({ "diff-deletion-base": "red" }, ".omnigent-app")).toContain(
      ".omnigent-app .dark .monaco-editor",
    );
  });
});

describe("installMonacoTokenColors", () => {
  it("follows the tokens", async () => {
    installMonacoTokenColors();
    expect(document.getElementById("omnigent-monaco-token-colors")).toBeNull();
    document.documentElement.style.setProperty("--diff-deletion-base", "#ff0000");
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById("omnigent-monaco-token-colors")?.textContent).toContain(
      "removedLineBackground",
    );
    document.documentElement.style.removeProperty("--diff-deletion-base");
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById("omnigent-monaco-token-colors")).toBeNull();
  });
});
