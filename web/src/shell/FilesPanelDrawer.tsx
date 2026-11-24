// Right-side push panel that hosts the working-folder file tree.
// Triggered from `SessionRail`'s files card (or the mobile FAB).
//
// Layout contract matches `ExecutionLogsPanel` / `TerminalsPanel`:
//
//   - **Mobile (`< md`)**: fixed full-screen overlay. Slides in from
//     the right via `translate-x`.
//   - **Desktop (`md+`)**: static flex sibling with a resize handle
//     on its left edge. Width is set inline via `useResizablePanel`.
//
// The drawer renders the existing `FilesPanel` in its full-screen
// mode (the `onClose` prop switches it to that layout) so the
// drawer doesn't duplicate the panel's header chrome; for Changes it
// renders the built-in Changes extension's view with a close button.

import { useEffect, useRef } from "react";

import { useResizablePanel } from "@/hooks/useResizablePanel";
import { cn } from "@/lib/utils";
import { ExtensionRailView, MissingBuiltInView } from "./extensionViews/ExtensionRailView";
import { FilesPanel } from "./FilesPanel";
import { builtInTabView, useRailViews } from "./railViews";
import type { ChangedSort } from "@/lib/changedSort";

interface FilesPanelDrawerProps {
  open: boolean;
  onClose: () => void;
  /**
   * File-select callback. Selecting a file inside the drawer
   * routes to the FileViewer in AppShell; AppShell is responsible
   * for closing this drawer in response.
   */
  onFileSelect: (path: string) => void;
  /**
   * Which scope the drawer renders: false = full folder tree, true = the
   * Changes tab's view. Fixed by the FAB entry that opened it (Files vs
   * Changes); the drawer has no in-panel scope switch.
   */
  flatView: boolean;
  /** The session shown, for the Changes view's per-session state. */
  conversationId?: string;
  /**
   * Lifted hidden-files toggle state. Lifted to AppShell so the
   * eye-icon choice survives inline→drawer transitions.
   */
  showHidden: boolean;
  onShowHiddenChange: (showHidden: boolean) => void;
  /**
   * Lifted changed-files sort order. Lifted to AppShell so the choice
   * stays in sync with the FileViewer's prev/next navigation order.
   */
  sort: ChangedSort;
  onSortChange: (sort: ChangedSort) => void;
}

export function FilesPanelDrawer({
  open,
  onClose,
  onFileSelect,
  flatView,
  showHidden,
  onShowHiddenChange,
  sort,
  onSortChange,
  conversationId,
}: FilesPanelDrawerProps) {
  const { panelWidth, handleProps, isDesktop } = useResizablePanel(open);
  const { views, settled } = useRailViews();
  const changesView = builtInTabView(views, "changes");
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (ref.current) {
      if (open) {
        ref.current.removeAttribute("inert");
      } else {
        ref.current.setAttribute("inert", "");
      }
    }
  }, [open]);

  return (
    <aside
      ref={ref}
      data-testid="files-panel-drawer"
      data-state={open ? "open" : "closed"}
      data-flat-view={flatView}
      // It closes on Escape, so page-wide Escape shortcuts leave keys inside it alone.
      data-escape-owner={open ? "" : undefined}
      style={{ width: panelWidth }}
      className={cn(
        "flex flex-col overflow-hidden bg-card transition-[translate,border-color,border-width] duration-150 ease-out",
        "fixed inset-0 z-50",
        open ? "translate-x-0 shadow-lg" : "translate-x-full shadow-none",
        "md:relative md:inset-auto md:z-auto md:shadow-none md:translate-x-0 md:shrink-0",
        open ? "md:border-border md:border-l" : "md:w-0 md:border-l-0",
      )}
      aria-hidden={!open}
      data-collapsed={!open || undefined}
    >
      {isDesktop && (
        <div
          {...handleProps}
          className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
        />
      )}
      {/* FilesPanel switches to its full-screen layout when `onClose`
          is set: it owns the header (title + X close button) and
          fills the parent's height. Mount it only while open so the
          folder tree initializes from the latest inline-panel state. */}
      {open && flatView && changesView && (
        <ExtensionRailView
          viewId={changesView.id}
          settled={settled}
          conversationId={conversationId}
          onClose={onClose}
          closeLabel="Close files"
        />
      )}
      {open && flatView && !changesView && settled && <MissingBuiltInView label="Changes" />}
      {open && !flatView && (
        <FilesPanel
          onFileSelect={onFileSelect}
          showHidden={showHidden}
          onShowHiddenChange={onShowHiddenChange}
          sort={sort}
          onSortChange={onSortChange}
          onClose={onClose}
        />
      )}
    </aside>
  );
}
