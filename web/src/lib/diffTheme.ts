// The syntax theme diffs render with, and the colours every diff shares. A
// colour the theme doesn't define keeps the diff's own default.

import { registerCustomTheme } from "@pierre/diffs";
import { useMemo } from "react";
import {
  registeredSyntaxThemes,
  shikiThemeNames,
  SYNTAX_THEME_NAMES,
  type SyntaxThemeNames,
  useSyntaxThemeNames,
} from "./syntaxTheme";

/** The `theme` option a diff starts with (worker pools): the default pair. */
export const DIFF_SYNTAX_THEME = SYNTAX_THEME_NAMES;

const registeredWithDiffs = new Set<string>();

/** The pair as a diff's `theme` option, its registered themes registered with diffs. */
export function diffSyntaxTheme(names: SyntaxThemeNames): SyntaxThemeNames {
  for (const theme of registeredSyntaxThemes(names)) {
    const name = theme.name ?? "";
    if (registeredWithDiffs.has(name)) continue;
    registeredWithDiffs.add(name);
    registerCustomTheme(name, () => Promise.resolve(theme));
  }
  return shikiThemeNames(names);
}

/** The `theme` option for every diff: the syntax themes the tokens name, live. */
export function useDiffSyntaxTheme(): SyntaxThemeNames {
  const names = useSyntaxThemeNames();
  return useMemo(() => diffSyntaxTheme(names), [names]);
}

/**
 * The colours every diff takes from the `diff-*` theme tokens
 * (`theme/tokens/diff.ts`): the added and deleted base colours, line numbers and
 * changed-word tints. An unset token leaves the diff's own colour, since an
 * override reading an unset variable is unset too.
 */
export const DIFF_TOKEN_CSS = `
  :host {
    --diffs-addition-color-override: var(--diff-addition-base);
    --diffs-deletion-color-override: var(--diff-deletion-base);
    --diffs-fg-number-override: var(--diff-number-text);
    --diffs-fg-number-addition-override: var(--diff-addition-text);
    --diffs-fg-number-deletion-override: var(--diff-deletion-text);
    --diffs-bg-addition-emphasis-override: rgb(from var(--diffs-addition-base) r g b / var(--diff-word-mix));
    --diffs-bg-deletion-emphasis-override: rgb(from var(--diffs-deletion-base) r g b / var(--diff-word-mix));
  }
`;

/**
 * {@link DIFF_TOKEN_CSS} plus the tints of the workspace's diffs: line and gutter
 * mixes, hover, the text selection and selected lines.
 */
export const DIFF_PALETTE_CSS = `${DIFF_TOKEN_CSS}
  [data-line], [data-no-newline] {
    --mix-light: calc(100% - var(--diff-line-mix, var(--diff-line-mix-light, 12%)));
    --mix-dark: calc(100% - var(--diff-line-mix, var(--diff-line-mix-dark, 20%)));
  }
  [data-gutter-buffer], [data-column-number] {
    --mix-light: calc(100% - var(--diff-gutter-mix, var(--diff-gutter-mix-light, 9%)));
    --mix-dark: calc(100% - var(--diff-gutter-mix, var(--diff-gutter-mix-dark, 15%)));
  }
  [data-selected-line] { background-color: var(--code-selected-line, var(--sidebar-active)); }
  [data-column-number][data-selected-line], [data-gutter-buffer][data-selected-line] {
    color: var(--sidebar-active-foreground);
    box-shadow: inset -3px 0 var(--sidebar-active-foreground);
  }
  [data-line]::selection, [data-line] span::selection {
    background: var(--code-selection, var(--selection-background));
  }
  @media (pointer: fine) {
    [data-hovered] {
      --diffs-computed-hovered-line-bg: light-dark(
        color-mix(in lab, var(--diffs-computed-editor-active-line-bg) calc(100% - var(--diff-hover-mix, var(--diff-hover-mix-light, 3%))), var(--diffs-hover-mix-target)),
        color-mix(in lab, var(--diffs-computed-editor-active-line-bg) calc(100% - var(--diff-hover-mix, var(--diff-hover-mix-dark, 9%))), var(--diffs-hover-mix-target))
      );
    }
  }
`;
