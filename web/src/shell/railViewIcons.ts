// The icons extension views may name, by lucide's kebab-case names. An allowlist
// keeps the bundle to these icons and lets the host refuse anything else.

import {
  ArrowDownAZIcon,
  ArrowDownUpIcon,
  ArrowDownWideNarrowIcon,
  BookOpenIcon,
  BotIcon,
  CheckIcon,
  Code2Icon,
  CompassIcon,
  EyeIcon,
  EyeOffIcon,
  FileClockIcon,
  FileDiffIcon,
  FileIcon,
  FilesIcon,
  FileTextIcon,
  FileTypeIcon,
  FilterIcon,
  FlaskConicalIcon,
  FolderIcon,
  FolderTreeIcon,
  GitBranchIcon,
  GitCompareIcon,
  GitPullRequestIcon,
  ListChecksIcon,
  ListIcon,
  ListTreeIcon,
  type LucideIcon,
  MoonIcon,
  NetworkIcon,
  PuzzleIcon,
  RefreshCwIcon,
  ScanSearchIcon,
  SearchIcon,
  WorkflowIcon,
} from "lucide-react";

export const RAIL_VIEW_ICONS: Readonly<Record<string, LucideIcon>> = Object.freeze({
  "arrow-down-a-z": ArrowDownAZIcon,
  "arrow-down-up": ArrowDownUpIcon,
  "arrow-down-wide-narrow": ArrowDownWideNarrowIcon,
  "book-open": BookOpenIcon,
  bot: BotIcon,
  check: CheckIcon,
  code: Code2Icon,
  compass: CompassIcon,
  eye: EyeIcon,
  "eye-off": EyeOffIcon,
  "file-clock": FileClockIcon,
  "file-text": FileTextIcon,
  "file-type": FileTypeIcon,
  filter: FilterIcon,
  "flask-conical": FlaskConicalIcon,
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
  moon: MoonIcon,
  network: NetworkIcon,
  puzzle: PuzzleIcon,
  "refresh-cw": RefreshCwIcon,
  "scan-search": ScanSearchIcon,
  search: SearchIcon,
  workflow: WorkflowIcon,
});

/** Shown for a view whose icon is missing or not on the allowlist. */
export const DEFAULT_RAIL_VIEW_ICON: LucideIcon = PuzzleIcon;

export function isRailViewIconName(name: unknown): name is string {
  return typeof name === "string" && Object.hasOwn(RAIL_VIEW_ICONS, name);
}

export function railViewIcon(name: string | undefined): LucideIcon | undefined {
  return isRailViewIconName(name) ? RAIL_VIEW_ICONS[name] : undefined;
}
