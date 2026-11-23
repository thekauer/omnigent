// The icons extension views may name, by lucide's kebab-case names. An allowlist
// keeps the bundle to these icons and lets the host refuse anything else.

import {
  BotIcon,
  CheckIcon,
  EyeIcon,
  FileDiffIcon,
  FileIcon,
  FilesIcon,
  FolderIcon,
  FolderTreeIcon,
  GitBranchIcon,
  GitCompareIcon,
  GitPullRequestIcon,
  ListChecksIcon,
  ListIcon,
  ListTreeIcon,
  type LucideIcon,
  PuzzleIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";

export const RAIL_VIEW_ICONS: Readonly<Record<string, LucideIcon>> = Object.freeze({
  bot: BotIcon,
  check: CheckIcon,
  eye: EyeIcon,
  "file-diff": FileDiffIcon,
  file: FileIcon,
  files: FilesIcon,
  folder: FolderIcon,
  "folder-tree": FolderTreeIcon,
  "git-branch": GitBranchIcon,
  "git-compare": GitCompareIcon,
  "git-pull-request": GitPullRequestIcon,
  "list-checks": ListChecksIcon,
  list: ListIcon,
  "list-tree": ListTreeIcon,
  puzzle: PuzzleIcon,
  "refresh-cw": RefreshCwIcon,
  search: SearchIcon,
});

/** Shown for a view whose icon is missing or not on the allowlist. */
export const DEFAULT_RAIL_VIEW_ICON: LucideIcon = PuzzleIcon;

export function isRailViewIconName(name: unknown): name is string {
  return typeof name === "string" && Object.hasOwn(RAIL_VIEW_ICONS, name);
}

export function railViewIcon(name: string | undefined): LucideIcon | undefined {
  return isRailViewIconName(name) ? RAIL_VIEW_ICONS[name] : undefined;
}
