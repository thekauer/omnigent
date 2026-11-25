// File tree tokens, bridged onto the vendored tree's `--trees-*-override` variables by
// components/file-tree/fileTreeStyle.ts (the vendored file-tree.css stays untouched).
//
// The git status colours default to the vendored tree's own, as `light-dark()` pairs:
// the tree picks them by its colour scheme.

import { defineTokens } from "./types.ts";

const UNSET = {};

export const FILE_TREE_TOKENS = defineTokens("fileTree", [
  {
    id: "file-tree-hover",
    description: "A file tree row under the pointer.",
    default: { light: "var(--muted)" },
  },
  {
    id: "file-tree-selected",
    description: "The selected file tree row.",
    default: { light: "var(--sidebar-active, var(--accent))" },
  },
  {
    id: "file-tree-selected-foreground",
    default: UNSET,
    description: "The selected row's text. Unset: the tree's text colour.",
  },
  {
    id: "file-tree-guide",
    default: UNSET,
    description: "The indent guides. Unset: the muted text colour at 25%.",
  },
  {
    id: "file-tree-focus-ring",
    description: "The focused row's ring.",
    default: { light: "var(--ring)" },
  },
  {
    id: "file-tree-radius",
    kind: "length",
    description: "A row's corner radius, ui-radius-md.",
    default: { light: "var(--ui-radius-md)" },
  },
  ...(
    [
      ["added", "#16a994", "#00cab1"],
      ["deleted", "#ff2e3f", "#ff6762"],
      ["ignored", "#adadb1", "#4a4a4e"],
      ["modified", "#1ca1c7", "#08c0ef"],
      ["renamed", "#d5a910", "#ffd452"],
      ["untracked", "#16a994", "#00cab1"],
    ] as const
  ).map(([status, light, dark]) => ({
    id: `file-tree-git-${status}`,
    description: `Git status colour of ${status} files.`,
    default: { light: `light-dark(${light}, ${dark})` },
  })),
]);
