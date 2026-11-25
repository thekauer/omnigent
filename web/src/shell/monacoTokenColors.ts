// The Monaco colours theme tokens set: line numbers and the diff's inserted and removed
// washes. Monaco writes the syntax theme's colours as `--vscode-*` variables, so a
// token can only replace one by declaring the variable itself, and only while the token
// has a value (an unset token would leave the variable invalid, not Monaco's colour).
// So the rules are written per set token, into one stylesheet that follows the tokens.

import { getEmbedScopeRoot } from "@/lib/host";
import { readThemeTokens, subscribeThemeTokens } from "@/theme/tokenValues";

const STYLE_ID = "omnigent-monaco-token-colors";

// A changed line's wash mixes its base colour as the diffs do (`diff-line-mix`).
const mixed = (base: string, mix: string, mode: "light" | "dark") =>
  `color-mix(in srgb, var(--${base}) var(--diff-${mix}-mix, var(--diff-${mix}-mix-${mode})), transparent)`;
const word = (base: string) => `rgb(from var(--${base}) r g b / var(--diff-word-mix, 0.3))`;

type Rule = readonly [variable: string, light: string, dark?: string];

/** The `--vscode-*` variables each token sets, by token. */
export const MONACO_TOKEN_VARIABLES: Readonly<Record<string, readonly Rule[]>> = {
  "viewer-gutter-foreground": [
    ["--vscode-editorLineNumber-foreground", "var(--viewer-gutter-foreground)"],
  ],
  "viewer-gutter-active-foreground": [
    ["--vscode-editorLineNumber-activeForeground", "var(--viewer-gutter-active-foreground)"],
  ],
  "diff-addition-base": [
    [
      "--vscode-diffEditor-insertedLineBackground",
      mixed("diff-addition-base", "line", "light"),
      mixed("diff-addition-base", "line", "dark"),
    ],
    [
      "--vscode-diffEditorGutter-insertedLineBackground",
      mixed("diff-addition-base", "gutter", "light"),
      mixed("diff-addition-base", "gutter", "dark"),
    ],
    ["--vscode-diffEditor-insertedTextBackground", word("diff-addition-base")],
  ],
  "diff-deletion-base": [
    [
      "--vscode-diffEditor-removedLineBackground",
      mixed("diff-deletion-base", "line", "light"),
      mixed("diff-deletion-base", "line", "dark"),
    ],
    [
      "--vscode-diffEditorGutter-removedLineBackground",
      mixed("diff-deletion-base", "gutter", "light"),
      mixed("diff-deletion-base", "gutter", "dark"),
    ],
    ["--vscode-diffEditor-removedTextBackground", word("diff-deletion-base")],
  ],
};

const TOKEN_IDS = Object.keys(MONACO_TOKEN_VARIABLES);

/**
 * The stylesheet for the tokens that have a value in `values`; empty when none has.
 *
 * @param scope The selector Monaco's editors sit under (`html`, or the embed's root).
 */
export function monacoTokenColorsCss(
  values: Readonly<Record<string, string>>,
  scope: string,
): string {
  const light: string[] = [];
  const dark: string[] = [];
  for (const id of TOKEN_IDS) {
    if (!values[id]) continue;
    for (const [variable, lightValue, darkValue] of MONACO_TOKEN_VARIABLES[id]) {
      light.push(`${variable}: ${lightValue};`);
      if (darkValue) dark.push(`${variable}: ${darkValue};`);
    }
  }
  const editors = (prefix: string) =>
    [".monaco-editor", ".monaco-diff-editor", ".monaco-component"]
      .map((editor) => `${prefix} ${editor}`)
      .join(", ");
  const blocks: string[] = [];
  if (light.length > 0) blocks.push(`${editors(scope)} { ${light.join(" ")} }`);
  // Standalone the theme root is <html> itself.
  const darkScope = scope === "html" ? "html.dark" : `${scope} .dark`;
  if (dark.length > 0) blocks.push(`${editors(darkScope)} { ${dark.join(" ")} }`);
  return blocks.join("\n");
}

let installed = false;

/** Keeps the stylesheet in step with the tokens, from the first Monaco editor on. */
export function installMonacoTokenColors(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const update = () => {
    const scope = getEmbedScopeRoot() ? ".omnigent-app" : "html";
    const css = monacoTokenColorsCss(readThemeTokens(TOKEN_IDS), scope);
    const existing = document.getElementById(STYLE_ID);
    if ((existing?.textContent ?? "") === css) return;
    if (!css) {
      existing?.remove();
      return;
    }
    const style = existing ?? document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    if (!existing) document.head.append(style);
  };
  subscribeThemeTokens(update);
  update();
}
