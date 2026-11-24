import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { GitBranch } from "lucide-react";
import { RunnerOfflineError, type WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";
import { RunnerAsleepHint } from "./RunnerAsleepHint";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChangedFileDiffstat, ChangedFileRow, FileGroupHeader } from "./ChangedFileRow";
import { groupChangedFiles } from "./changedFilesOrder";
import {
  type VirtualRowPlacement,
  VirtualSessionRows,
  virtualRowStyle,
} from "./VirtualSessionRows";

export type { ChangedSort } from "@/lib/changedSort";
import type { ChangedSort } from "@/lib/changedSort";

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

// Space between rows, in px (Tailwind `gap-0.5`).
const ROW_GAP_PX = 2;

function FileListItem({
  file,
  placement,
  isDeleted,
  onFileSelect,
  conversationId,
}: {
  file: WorkspaceChangedFile;
  placement: VirtualRowPlacement;
  isDeleted: boolean;
  onFileSelect: (path: string) => void;
  conversationId: string | undefined;
}) {
  const displayPath =
    file.repository_root && file.path.startsWith(`${file.repository_root}/`)
      ? file.path.slice(file.repository_root.length + 1)
      : file.path;
  const slash = displayPath.lastIndexOf("/");
  const dir = slash > 0 ? displayPath.slice(0, slash) : "";

  return (
    <li
      ref={placement.measureRef}
      data-index={placement.index}
      style={virtualRowStyle(placement.top)}
    >
      <ChangedFileRow
        path={file.path}
        name={file.name}
        dir={dir}
        status={file.status}
        isDeleted={isDeleted}
        diffstat={
          <ChangedFileDiffstat linesAdded={file.lines_added} linesRemoved={file.lines_removed} />
        }
        bytes={file.bytes}
        onFileSelect={onFileSelect}
        conversationId={conversationId}
      />
    </li>
  );
}

function RepositoryFileGroup({
  root,
  children,
  count,
}: {
  root: string;
  children: ReactNode;
  count: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const name = root || "Other files";
  return (
    <li>
      <div role="group" aria-label={name}>
        <FileGroupHeader
          label={name}
          icon={root ? <GitBranch className="size-3.5 shrink-0 text-muted-foreground" /> : null}
          count={count}
          ariaLabel={`${name}, ${count} changed files`}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
        />
        {!collapsed && children}
      </div>
    </li>
  );
}

/** One group's rows, windowed against the panel's scroller so only rows near the viewport mount. */
function ChangedFileRows({
  files,
  scrollElementRef,
  onFileSelect,
  conversationId,
}: {
  files: WorkspaceChangedFile[];
  scrollElementRef: RefObject<HTMLElement | null>;
  onFileSelect: (path: string) => void;
  conversationId: string | undefined;
}) {
  const rows = useMemo(() => files.map((file) => ({ id: file.path, file })), [files]);
  return (
    <VirtualSessionRows
      items={rows}
      scrollElementRef={scrollElementRef}
      revealId={null}
      gap={ROW_GAP_PX}
      renderRow={({ file }, placement) => (
        <FileListItem
          key={file.path}
          file={file}
          placement={placement}
          isDeleted={file.status === "deleted"}
          onFileSelect={onFileSelect}
          conversationId={conversationId}
        />
      )}
    />
  );
}

export function FlatFileList({
  files,
  isLoading,
  isError,
  error,
  onFileSelect,
  showHidden,
  onShowHidden,
  searchQuery,
  sort,
  conversationId,
  runnerWentOffline = false,
  scrollParentRef,
}: {
  files: WorkspaceChangedFile[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onFileSelect: (path: string) => void;
  showHidden: boolean;
  onShowHidden: () => void;
  searchQuery: string;
  sort: ChangedSort;
  /** Session ID used to fetch file content for downloads. */
  conversationId: string | undefined;
  /**
   * The runner went offline after being connected (session status
   * "failed", e.g. host restarted) — show the reconnect hint. When the
   * session simply hasn't started yet (a new session also 503s) this is
   * false and we fall through to the normal empty state instead.
   */
  runnerWentOffline?: boolean;
  /**
   * The scroll container the list lives in (FilesPanel's `<section>`), which
   * rows are windowed against. When omitted (tests, stories), the list
   * provides its own scroll container.
   */
  scrollParentRef?: RefObject<HTMLElement | null>;
}) {
  const ownScrollRef = useRef<HTMLDivElement>(null);
  const scrollElementRef = scrollParentRef ?? ownScrollRef;
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
  // Memoized so a re-render with unchanged files (a refetch, a store tick)
  // doesn't refilter and re-sort a list that can hold thousands of rows.
  const visibleFiles = useMemo(
    () =>
      (files ?? []).filter(
        (f) => showHidden || !f.path.split("/").some((seg) => seg.startsWith(".")),
      ),
    [files, showHidden],
  );
  const sortedGroups = useMemo(() => groupChangedFiles(visibleFiles, sort), [visibleFiles, sort]);
  // Filtering keeps the sorted order, so typing a search never re-sorts.
  const groups = useMemo(
    () =>
      normalizedSearchQuery.length === 0
        ? sortedGroups
        : sortedGroups
            .map(({ root, files: groupFiles }) => ({
              root,
              files: groupFiles.filter(
                (f) =>
                  f.name.toLowerCase().includes(normalizedSearchQuery) ||
                  f.path.toLowerCase().includes(normalizedSearchQuery),
              ),
            }))
            .filter((group) => group.files.length > 0),
    [sortedGroups, normalizedSearchQuery],
  );
  if (isLoading) {
    return <p className="px-2 py-1 text-muted-foreground text-sm">Loading…</p>;
  }
  if (isError) {
    // Runner not connected. If it went offline after being up (host
    // restarted), guide the user to send a message to reconnect. If the
    // session just hasn't started, it isn't "asleep" — show the empty
    // state rather than alarm the user.
    if (error instanceof RunnerOfflineError) {
      if (runnerWentOffline) return <RunnerAsleepHint />;
      return <p className="px-2 py-1 text-muted-foreground text-sm">No workspace changes yet</p>;
    }
    return (
      <p className="px-2 py-1 text-destructive text-sm">
        Failed to load: {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  if (!files || files.length === 0) {
    return <p className="px-2 py-1 text-muted-foreground text-sm">No workspace changes yet</p>;
  }
  const grouped = files.some((file) => file.repository_root);
  const hiddenCount = files.length - visibleFiles.length;
  if (visibleFiles.length === 0) {
    return (
      <p className="px-2 py-1 text-muted-foreground text-sm">
        All changes are in hidden files.{" "}
        <button
          type="button"
          className="cursor-pointer underline hover:text-foreground"
          onClick={onShowHidden}
        >
          Click to show
        </button>
      </p>
    );
  }
  if (groups.length === 0) {
    return (
      <p className="px-2 py-1 text-muted-foreground text-sm">
        No changed files match "{searchQuery.trim()}"
      </p>
    );
  }
  const list = (
    <>
      {hiddenCount > 0 && (
        <p className="px-2 py-1 text-muted-foreground text-sm">
          {hiddenCount} file{hiddenCount === 1 ? "" : "s"} hidden.{" "}
          <button
            type="button"
            className="cursor-pointer underline hover:text-foreground"
            onClick={onShowHidden}
          >
            Click to show
          </button>
        </p>
      )}
      <TooltipProvider>
        {grouped ? (
          <ul className="flex flex-col gap-0.5">
            {groups.map(({ root, files: groupFiles }) => (
              <RepositoryFileGroup
                key={`${conversationId}/${root}`}
                root={root}
                count={groupFiles.length}
              >
                <ChangedFileRows
                  files={groupFiles}
                  scrollElementRef={scrollElementRef}
                  onFileSelect={onFileSelect}
                  conversationId={conversationId}
                />
              </RepositoryFileGroup>
            ))}
          </ul>
        ) : (
          <ChangedFileRows
            files={groups[0].files}
            scrollElementRef={scrollElementRef}
            onFileSelect={onFileSelect}
            conversationId={conversationId}
          />
        )}
      </TooltipProvider>
    </>
  );
  return scrollParentRef ? (
    list
  ) : (
    <div ref={ownScrollRef} className="h-full overflow-y-auto">
      {list}
    </div>
  );
}
