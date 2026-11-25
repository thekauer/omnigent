// The rows of a changed-files list: a file row (icon, name, folder subtitle,
// diffstat, A/M/D and the size that hover swaps for copy and download), its
// diffstat, and a repository group's heading. The Changes tab draws them.
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";
import { cn } from "@/lib/utils";
import {
  ROW_ACTION_SIZE_CLASS,
  ROW_META_SLOT_CLASS,
  ROW_STATUS_SLOT_CLASS,
  formatBytes,
  gitStatusLabel,
  gitStatusLetter,
} from "./fileStatusUtils";
import { CopyPathButton } from "./CopyPathButton";
import { FileDownloadButton } from "./FileDownloadButton";
import { useRevealMenu } from "./RevealInFileManager";
import { useCursorTooltip } from "./useCursorTooltip";
import { WorkspaceFileIcon } from "./WorkspaceFileIcon";

/** A changed file's `+N −M`, or nothing when both counts are zero or unknown. */
export function ChangedFileDiffstat({
  linesAdded,
  linesRemoved,
}: {
  linesAdded: number | null;
  linesRemoved: number | null;
}) {
  if ((linesAdded ?? 0) === 0 && (linesRemoved ?? 0) === 0) return null;
  return (
    <span
      className="font-mono text-[10px]"
      aria-label={[
        linesAdded !== null && `${linesAdded} lines added`,
        linesRemoved !== null && `${linesRemoved} removed`,
      ]
        .filter(Boolean)
        .join(", ")}
    >
      {linesAdded !== null && <span className="text-(--diff-stat-added)">+{linesAdded}</span>}
      {linesAdded !== null && linesRemoved !== null && " "}
      {linesRemoved !== null && <span className="text-destructive">&minus;{linesRemoved}</span>}
    </span>
  );
}

/**
 * One row of the changed-files list: icon, name, directory subtitle, diffstat,
 * status letter, and the size that hover swaps for the copy/download actions.
 */
export function ChangedFileRow({
  path,
  name,
  dir,
  status,
  isDeleted,
  diffstat,
  bytes,
  onFileSelect,
  conversationId,
}: {
  path: string;
  name: string;
  /** The muted directory subtitle; empty for none. */
  dir: string;
  /** Drawn as the A/M/D letter; the column stays empty without one. */
  status: WorkspaceChangedFile["status"] | undefined;
  isDeleted: boolean;
  /** Content of the fixed diffstat column. */
  diffstat: ReactNode;
  bytes: number | null;
  onFileSelect: (path: string) => void;
  conversationId: string | undefined;
}) {
  const { handlers, tooltip } = useCursorTooltip(path);
  const reveal = useRevealMenu(isDeleted ? null : path);
  const hasDownload = !isDeleted && Boolean(conversationId);

  return (
    <>
      <div
        onContextMenu={reveal.onContextMenu}
        className={cn(
          "group flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 pr-1 pl-2",
          isDeleted ? "opacity-50" : "hover:bg-muted",
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1.5 text-left"
          onClick={() => onFileSelect(path)}
          aria-label={path}
        >
          <WorkspaceFileIcon path={path} className="self-center" />
          <span className={cn("truncate text-ui", isDeleted && "line-through")} {...handlers}>
            {name}
          </span>
          {dir && <span className="truncate text-muted-foreground text-sm">{dir}</span>}
        </button>
        {/* Fixed-width and always rendered: a variable diffstat ("+7 −1" vs
            "+1204 −318") would otherwise shift the copy button and status
            letter to a different x on every row. */}
        <span className={cn("flex shrink-0 items-center justify-end", ROW_META_SLOT_CLASS)}>
          {diffstat}
        </span>
        <span className={cn("flex shrink-0 items-center justify-center", ROW_STATUS_SLOT_CLASS)}>
          {status && (
            <span
              className={cn(
                "rounded px-1 py-0.5 font-mono text-[10px]",
                isDeleted
                  ? "bg-destructive/10 text-destructive"
                  : status === "created"
                    ? "bg-(--ui-success-tone)/10 text-(--ui-success-text)"
                    : "bg-(--ui-warning-tone)/10 text-(--ui-warning-text-soft)",
              )}
              title={gitStatusLabel(status)}
            >
              {gitStatusLetter(status)}
            </span>
          )}
        </span>
        {/* File size at rest, replaced by copy/download actions on hover; the
            same far-right slot used by the Files tree. */}
        <span
          className={cn("relative flex shrink-0 items-center justify-end", ROW_META_SLOT_CLASS)}
        >
          {bytes !== null && !isDeleted && (
            <span className="text-muted-foreground text-sm group-hover:invisible">
              {formatBytes(bytes)}
            </span>
          )}
          <span className="absolute inset-0 flex items-center justify-end gap-1">
            {hasDownload && conversationId ? (
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
    </>
  );
}

/** A collapsible group heading of the changed-files list, such as one repository. */
export function FileGroupHeader({
  label,
  icon,
  count,
  ariaLabel,
  collapsed,
  onToggle,
}: {
  label: string;
  icon: ReactNode;
  /** Trailing muted text, such as the group's file count. */
  count: ReactNode;
  ariaLabel: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-ui hover:bg-muted"
      aria-expanded={!collapsed}
      aria-label={ariaLabel}
      onClick={onToggle}
    >
      <Chevron className="size-3.5 shrink-0" />
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-muted-foreground text-sm">{count}</span>
    </button>
  );
}
