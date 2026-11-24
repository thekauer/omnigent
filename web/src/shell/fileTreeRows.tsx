// The rows of the Files tree, shared by the host's tree view (the built-in Files
// and Changes tabs draw their folders and files with them): VS Code-style
// indentation and guides, a file row, a folder row and a folder search result.
import { ChevronRightIcon, FolderIcon, FolderOpenIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";
import { cn } from "@/lib/utils";
import { CopyPathButton } from "./CopyPathButton";
import { FileDownloadButton } from "./FileDownloadButton";
import {
  ROW_ACTION_SIZE_CLASS,
  ROW_META_SLOT_CLASS,
  ROW_STATUS_SLOT_CLASS,
  formatBytes,
  gitStatusLabel,
  gitStatusLetter,
} from "./fileStatusUtils";
import { useRevealMenu } from "./RevealInFileManager";
import { useCursorTooltip } from "./useCursorTooltip";
import { WorkspaceFileIcon } from "./WorkspaceFileIcon";

// VS Code–style indentation: folder chevron and file icon share the same x
// at each depth. GUIDE_OFFSET centers the indent-guide line under the chevron.
const INDENT_STEP = 16;
const BASE_PAD = 8;
const GUIDE_OFFSET = 7;
export const indentFor = (depth: number) => depth * INDENT_STEP + BASE_PAD;

// One vertical guide line per ancestor level; the row must be `relative`.
export function IndentGuides({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  return (
    <>
      {Array.from({ length: depth }, (_, level) => indentFor(level) + GUIDE_OFFSET).map((left) => (
        <span
          key={left}
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-border transition-opacity group-hover:opacity-0"
          style={{ left: `${left}px` }}
        />
      ))}
    </>
  );
}

/** A muted line in the tree, such as "Loading…" under a folder, indented to its depth. */
export function TreePlaceholderRow({ depth, text }: { depth: number; text: string }) {
  return (
    <p
      className="relative py-1 pr-2 text-muted-foreground text-sm"
      style={{ paddingLeft: `${indentFor(depth)}px` }}
    >
      <IndentGuides depth={depth} />
      {text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// FileRowItem — shared file-row shell used by both tree and search modes
// ---------------------------------------------------------------------------

/**
 * Renders a single file list item with icon, label, optional status badge,
 * optional file size, and a hover download button.
 *
 * Used by both SearchResultRow (flat search results, full-path label with
 * rtl truncation) and TreeFileRow (tree leaf nodes, filename-only label
 * with depth-based indentation).  Keeping the DOM structure in one place
 * prevents the two views from drifting apart over time.
 */
export function FileRowItem({
  path,
  displayLabel,
  labelIsPath = false,
  depth = 0,
  fileStatus,
  bytes,
  meta,
  diffstat,
  onFileSelect,
  conversationId,
  highlighted = false,
}: {
  /** Canonical workspace-relative path, used for the download button and title. */
  path: string;
  /** Text shown in the label span — full path for search results, filename for tree. */
  displayLabel: string;
  /** When true the label uses rtl truncation and wraps content in <bdi>. */
  labelIsPath?: boolean;
  /** Tree depth (0 = root). Drives left indentation and indent guides; search
   *  results pass 0 for a flat, guide-less list. The file icon sits in the
   *  same column as a folder's chevron at this depth. */
  depth?: number;
  fileStatus: WorkspaceChangedFile["status"] | undefined;
  bytes: number | null;
  /** Drawn at rest in the trailing column instead of the byte size. */
  meta?: ReactNode;
  /** Drawn before the status letter in a fixed column, as the Changes list's diffstat. */
  diffstat?: ReactNode;
  onFileSelect: (path: string) => void;
  conversationId: string | undefined;
  /** Briefly flash this row, as when it is revealed. */
  highlighted?: boolean;
}) {
  const isDeleted = fileStatus === "deleted";
  const fileColorClass =
    fileStatus === "created"
      ? "text-green-500 dark:text-green-400"
      : fileStatus === "modified"
        ? "text-amber-500 dark:text-amber-400"
        : undefined;
  const { handlers, tooltip } = useCursorTooltip(path);
  const reveal = useRevealMenu(isDeleted ? null : path);

  return (
    <li className="list-none">
      <div
        onContextMenu={reveal.onContextMenu}
        className={cn(
          "group relative flex w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-1",
          isDeleted ? "opacity-50" : "hover:bg-muted",
          highlighted && "animate-user-msg-flash",
        )}
        style={{ paddingLeft: `${indentFor(depth)}px` }}
      >
        <IndentGuides depth={depth} />
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          onClick={() => !isDeleted && onFileSelect(path)}
          disabled={isDeleted}
        >
          <WorkspaceFileIcon path={path} />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-ui",
              labelIsPath && "[direction:rtl]",
              isDeleted && "line-through",
              fileColorClass,
            )}
            {...handlers}
          >
            {labelIsPath ? <bdi>{displayLabel}</bdi> : displayLabel}
          </span>
          {diffstat !== undefined && (
            <span className={cn("flex shrink-0 items-center justify-end", ROW_META_SLOT_CLASS)}>
              {diffstat}
            </span>
          )}
          {fileStatus && (
            // Centred in the shared status column so the A/M/D badge lands in
            // the same x as a directory row's dirty dot.
            <span
              className={cn("flex shrink-0 items-center justify-center", ROW_STATUS_SLOT_CLASS)}
            >
              <span
                className={cn(
                  "rounded px-1 py-0.5 font-mono text-[10px]",
                  isDeleted
                    ? "bg-destructive/10 text-destructive"
                    : fileStatus === "created"
                      ? "bg-green-500/10 text-green-600 dark:text-green-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                )}
                title={gitStatusLabel(fileStatus)}
              >
                {gitStatusLetter(fileStatus)}
              </span>
            </span>
          )}
        </button>
        {/* One trailing column, always rendered so every row (directories
            included) shares it: metadata at rest, the copy/download pair on
            hover. */}
        <span
          className={cn("relative flex shrink-0 items-center justify-end", ROW_META_SLOT_CLASS)}
        >
          {meta !== undefined
            ? meta
            : bytes !== null &&
              !isDeleted && (
                <span className="text-muted-foreground text-sm group-hover:invisible">
                  {formatBytes(bytes)}
                </span>
              )}
          <span className="absolute inset-0 flex items-center justify-end gap-1">
            {!isDeleted && conversationId ? (
              <FileDownloadButton conversationId={conversationId} path={path} />
            ) : (
              <span className={cn("shrink-0", ROW_ACTION_SIZE_CLASS)} aria-hidden />
            )}
            <CopyPathButton path={path} revealOnHover />
          </span>
        </span>
        {reveal.menu}
      </div>
      {tooltip}
    </li>
  );
}

// ---------------------------------------------------------------------------
// SearchDirRow — flat directory row used in search-results mode
// ---------------------------------------------------------------------------

/**
 * A matched directory in search results. Clicking it reveals the folder in the
 * tree (expands it and its ancestors, exits search) rather than opening a file
 * — folders have nothing to show in the viewer. The full path is shown with
 * rtl truncation and a trailing "/" so it reads as a directory.
 */
export function SearchDirRow({
  path,
  label = path,
  onRevealDir,
}: {
  /** The folder's path, for the copy button and the reveal menu. */
  path: string;
  /** The path shown, relative to the folder browsed. */
  label?: string;
  onRevealDir: (path: string) => void;
}) {
  const reveal = useRevealMenu(path, true);
  return (
    <li className="list-none">
      <div
        onContextMenu={reveal.onContextMenu}
        className="group relative flex w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-1 pl-2 hover:bg-muted"
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          onClick={() => onRevealDir(path)}
        >
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-ui [direction:rtl]">
            <bdi>{label}/</bdi>
          </span>
        </button>
        <span
          className={cn("relative flex shrink-0 items-center justify-end", ROW_META_SLOT_CLASS)}
        >
          <span className="absolute inset-0 flex items-center justify-end gap-0.5">
            <span className={cn("shrink-0", ROW_ACTION_SIZE_CLASS)} aria-hidden />
            <CopyPathButton path={path} label="Copy folder path" revealOnHover />
          </span>
        </span>
        {reveal.menu}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// FolderRowItem
// ---------------------------------------------------------------------------

/** One directory header row: folder icon (a chevron on hover), name, change dot, copy button. */
export function FolderRowItem({
  name,
  path,
  depth,
  open,
  status,
  onToggle,
  onNavigate,
  highlighted = false,
}: {
  name: string;
  /** Workspace path, for the copy button and the reveal menu. */
  path: string;
  depth: number;
  open: boolean;
  /** Strongest change status of anything inside, drawn as a colored dot. */
  status: WorkspaceChangedFile["status"] | undefined;
  onToggle: () => void;
  onNavigate?: () => void;
  /** Briefly flash this row, as when a folder is revealed from search. */
  highlighted?: boolean;
}) {
  const reveal = useRevealMenu(path, true);
  const dirStatus = status;
  const dirDotClass =
    dirStatus === "created"
      ? "text-green-500 dark:text-green-400"
      : dirStatus === "modified"
        ? "text-amber-500 dark:text-amber-400"
        : dirStatus === "deleted"
          ? "text-destructive"
          : undefined;

  return (
    // The row is a div so the copy control can remain a sibling of the folder
    // toggle rather than nesting one button inside another.
    <div
      onContextMenu={reveal.onContextMenu}
      className={cn(
        "group relative flex w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-1 hover:bg-muted",
        // Reveal flash: reuse the chat nav-jump ring pulse so a folder opened
        // from search catches the eye briefly, then settles.
        highlighted && "animate-user-msg-flash",
      )}
      style={{ paddingLeft: `${indentFor(depth)}px` }}
    >
      <IndentGuides depth={depth} />
      <button
        type="button"
        className="group/folder flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        onClick={onToggle}
        onDoubleClick={onNavigate}
        aria-expanded={open}
      >
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
          <span className="flex transition-opacity group-hover/folder:opacity-0 group-focus-visible/folder:opacity-0">
            {open ? (
              <FolderOpenIcon className="size-3.5 text-muted-foreground" />
            ) : (
              <FolderIcon className="size-3.5 text-muted-foreground" />
            )}
          </span>
          <ChevronRightIcon
            className={cn(
              "absolute size-3.5 text-muted-foreground opacity-0 transition-[transform,opacity] group-hover/folder:opacity-100 group-focus-visible/folder:opacity-100",
              open && "rotate-90",
            )}
          />
        </span>
        <span className={cn("min-w-0 flex-1 truncate text-ui", dirDotClass)}>{name}/</span>
        {dirStatus && (
          <span
            className={cn("flex shrink-0 items-center justify-center", ROW_STATUS_SLOT_CLASS)}
            aria-hidden
          >
            <span className={cn("text-[8px] leading-none", dirDotClass)}>●</span>
          </span>
        )}
      </button>
      {/* The same trailing column as a file row. A folder has no size and
          nothing to download, so the column shows only the copy button — with
          the download's footprint reserved beside it so that button lands in
          the same x as every file row's. */}
      <span className={cn("relative flex shrink-0 items-center justify-end", ROW_META_SLOT_CLASS)}>
        <span className="absolute inset-0 flex items-center justify-end gap-1">
          <span className={cn("shrink-0", ROW_ACTION_SIZE_CLASS)} aria-hidden />
          <CopyPathButton path={path} label="Copy folder path" revealOnHover />
        </span>
      </span>
      {reveal.menu}
    </div>
  );
}
