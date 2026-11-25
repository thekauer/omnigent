// Shared look for the workspace's file trees: the app's font and theme tokens, and rows
// whose names give way before their counts and whose deepest levels stop stepping in.

import type { CSSProperties } from "react";
import "./fileTreeStyle.css";

/** The class the workspace's trees add for the rules in `fileTreeStyle.css`. */
export const WORKSPACE_FILE_TREE_CLASS = "workspace-file-tree";

/**
 * Maps the tree's colors and type onto the app's theme tokens, the `file-tree-*` ones
 * included (`theme/tokens/fileTree.ts`). An override reading an unset token is unset,
 * so the vendored tree's own value applies.
 */
export const FILE_TREE_THEME: CSSProperties = {
  "--trees-font-family-override": "var(--ui-font-family, var(--ui-font-ui))",
  "--trees-font-size-override": "var(--text-ui, 13px)",
  "--trees-bg-override": "var(--background)",
  "--trees-bg-muted-override": "var(--file-tree-hover)",
  "--trees-fg-override": "var(--foreground)",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-accent-override": "var(--primary)",
  "--trees-selected-bg-override": "var(--file-tree-selected)",
  "--trees-selected-fg-override": "var(--file-tree-selected-foreground)",
  "--trees-indent-guide-bg-override": "var(--file-tree-guide)",
  "--trees-focus-ring-color-override": "var(--file-tree-focus-ring)",
  "--trees-border-radius-override": "var(--file-tree-radius)",
  "--trees-git-added-color-override": "var(--file-tree-git-added)",
  "--trees-git-deleted-color-override": "var(--file-tree-git-deleted)",
  "--trees-git-ignored-color-override": "var(--file-tree-git-ignored)",
  "--trees-git-modified-color-override": "var(--file-tree-git-modified)",
  "--trees-git-renamed-color-override": "var(--file-tree-git-renamed)",
  "--trees-git-untracked-color-override": "var(--file-tree-git-untracked)",
  "--trees-level-gap-override": "6px",
  "--trees-padding-inline-override": "8px",
} as CSSProperties;
