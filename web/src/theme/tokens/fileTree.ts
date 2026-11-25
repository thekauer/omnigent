// File tree tokens, bridged onto the vendored tree's `--trees-*-override` variables by
// components/file-tree/fileTreeStyle.ts (the vendored file-tree.css stays untouched).
//
// The git status colours default to the vendored tree's own, as `light-dark()` pairs:
// the tree picks them by its colour scheme.

import { type TailwindColor, tw } from "./tailwindPalette.ts";
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
    id: "file-tree-row-active",
    description:
      "The open file's row in the list-style file trees (the pull request's changed files).",
    default: { light: "var(--muted)" },
  },
  {
    id: "file-tree-review-added",
    description:
      "Added files' names and added line counts in the Changes review's tree (`success`).",
    default: { light: "var(--success)" },
  },
  {
    id: "file-tree-review-deleted",
    description:
      "Deleted files' names and deleted line counts in the Changes review's tree (`destructive`).",
    default: { light: "var(--destructive)" },
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

  // The Files tab's own rows (shell/fileTreeRows.tsx): added and modified files.
  {
    id: "file-tree-status-added",
    description: "Added files' names and dots in the Files tab's rows.",
    default: { light: tw("green-500"), dark: tw("green-400") },
  },
  {
    id: "file-tree-status-modified",
    description: "Modified files' names and dots in the Files tab's rows.",
    default: { light: tw("amber-500"), dark: tw("amber-400") },
  },
  // File-type icons outside the vendored tree (shell/WorkspaceFileIcon.tsx), per group.
  ...(
    [
      ["pdf", "PDF files", "orange-500", "orange-400"],
      ["document", "documents", "blue-500", "blue-400"],
      ["spreadsheet", "spreadsheets", "lime-600", "lime-400"],
      ["presentation", "presentations", "yellow-500", "yellow-400"],
      ["archive", "archives", "amber-700", "amber-500"],
      ["code", "code, JSON and databases", "purple-500", "purple-400"],
      ["image", "images", "pink-500", "pink-400"],
      ["media", "video and audio", "indigo-500", "indigo-400"],
    ] as const satisfies readonly (readonly [string, string, TailwindColor, TailwindColor])[]
  ).map(([group, what, light, dark]) => ({
    id: `file-tree-icon-${group}`,
    description: `The file-type icon of ${what} outside the file trees.`,
    default: { light: tw(light), dark: tw(dark) },
  })),
]);
