// Registry of extension views shown as tabs in the classic workspace rail. Each
// view is plain data plus a host-owned tree model; the rail draws the tab and
// the content area itself, so extension code never touches React or the DOM.

import { useMemo, useSyncExternalStore } from "react";
import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";

/** A view's count badge on its tab, like VS Code's `ViewBadge`. */
export interface RailViewBadge {
  readonly value: number;
  readonly tooltip: string;
}

/** One entry of a title action's submenu. */
export interface RailViewMenuItem {
  /** The command id. */
  readonly id: string;
  readonly title: string;
  readonly icon: string | undefined;
  readonly toggled: boolean | undefined;
  /** Resolves once the command finished; a failure is shown by the host. */
  readonly run: () => Promise<void>;
}

/**
 * One button of a view: a `view/title` menu entry in group "navigation" (the
 * title bar) or "filter" (next to the view's filter field), or a submenu.
 */
export interface RailViewTitleAction {
  /** The command or submenu id; unique within the view. */
  readonly id: string;
  readonly title: string;
  /** The button's tooltip; defaults to the title. */
  readonly tooltip: string | undefined;
  /** A name from the rail icon allowlist (railViewIcons.ts). */
  readonly icon: string | undefined;
  /** Set for toggle commands: the button gets `aria-pressed`. */
  readonly toggled: boolean | undefined;
  readonly tone: "warning" | undefined;
  readonly group: "navigation" | "filter";
  /** Resolves once the command finished; a failure is shown by the host. */
  readonly run: () => Promise<void>;
  /** A submenu's entries; the button opens them instead of running a command. */
  readonly items?: readonly RailViewMenuItem[];
}

export type RailTreeItemStatus = "added" | "modified" | "deleted";
export type RailTreeItemCollapsible = "none" | "collapsed" | "expanded";
export type RailTreeDecorationTone = "added" | "removed" | "muted";

/** One resolved tree row, as plain data. */
export interface RailTreeNode {
  /** Stable within the view: expand state is keyed by it. */
  readonly handle: string;
  readonly label: string;
  readonly description: string | undefined;
  readonly tooltip: string | undefined;
  /** Workspace path of the file or folder the row stands for. */
  readonly resourcePath: string | undefined;
  /** "file" and "folder" use the file icon resolver; other names come from the allowlist. */
  readonly icon: string | undefined;
  readonly decoration:
    | {
        readonly text: string | undefined;
        readonly parts: readonly {
          readonly text: string;
          readonly tone?: RailTreeDecorationTone;
        }[];
        readonly title: string | undefined;
      }
    | undefined;
  readonly status: RailTreeItemStatus | undefined;
  readonly collapsible: RailTreeItemCollapsible;
  readonly hasCommand: boolean;
  readonly contextValue: string | undefined;
  /** Bytes of the resource, drawn like the Changes list's file size. */
  readonly size: number | undefined;
}

/** What the rail needs from a tree view; implemented by the extension host. */
export interface RailTreeModel {
  /** Children of `parent`, or the roots; rejects or resolves empty on provider failure. */
  getChildren: (parent: string | undefined) => Promise<readonly RailTreeNode[]>;
  /** Fires when the provider's data changed; the rail reloads what it shows. */
  subscribe: (listener: () => void) => () => void;
  /** Runs the row's `command`, if it has one. */
  runCommand: (handle: string) => void;
  /**
   * The chat session whose workspace the provider's data is for, when the host
   * knows; a view drawn for another session waits instead of showing it.
   */
  dataSessionId?: () => string | undefined;
}

export type RailViewNotice = "agentAsleep" | "sandboxOffline" | "sandboxStarting";

export interface RailViewTag {
  readonly text: string;
  readonly tooltip: string | undefined;
  readonly icon: string | undefined;
}

/** What a drawn view can ask of the host that owns it; set by the extension host. */
export interface RailViewHost {
  /** The filter text kept for `sessionId`. */
  getFilter: (sessionId: string | undefined) => string;
  setFilter: (sessionId: string | undefined, text: string) => void;
  /** The view is on screen until the returned function is called. */
  reportVisible: () => () => void;
  /** Runs a command a message link names. */
  runCommand: (command: string) => void;
}

export interface RailViewFilter {
  readonly placeholder: string;
  readonly ariaLabel: string;
}

export interface RailViewState {
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly badge: RailViewBadge | undefined;
  readonly message: string | undefined;
  /** True until the contributing extension finished activating. */
  readonly loading: boolean;
  readonly actions: readonly RailViewTitleAction[];
  readonly tree: RailTreeModel | undefined;
  /** Set when the contributing extension failed to activate. */
  readonly error: string | undefined;
  readonly messageSeverity: "info" | "error" | undefined;
  readonly notice: RailViewNotice | undefined;
  readonly tag: RailViewTag | undefined;
  readonly host: RailViewHost | undefined;
}

export interface RailViewContribution {
  /** Globally unique view id, such as `publisher.name.view`. */
  readonly id: string;
  readonly extensionId: string;
  readonly name: string;
  /** A name from the rail icon allowlist; unknown names fall back to a generic icon. */
  readonly icon: string | undefined;
  /** The built-in tab (such as "changes") a built-in extension's view stands in for. */
  readonly builtInTab?: string;
  /** A filter field above the rows. */
  readonly filter?: RailViewFilter;
}

export interface RailView extends RailViewContribution, RailViewState {}

export interface RailViewsSnapshot {
  /** Ordered by extension id, then by manifest order. */
  readonly views: readonly RailView[];
  /** False while extensions that may contribute views are still loading. */
  readonly settled: boolean;
}

export interface RailViewHandle {
  update: (patch: Partial<RailViewState>) => void;
  dispose: () => void;
}

const INITIAL_STATE: RailViewState = {
  title: undefined,
  description: undefined,
  badge: undefined,
  message: undefined,
  loading: true,
  actions: [],
  tree: undefined,
  error: undefined,
  messageSeverity: undefined,
  notice: undefined,
  tag: undefined,
  host: undefined,
};

interface Entry {
  view: RailView;
  /** Manifest order within the extension. */
  order: number;
}

export class RailViewRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private pendingLoads = 0;
  private snapshot: RailViewsSnapshot = { views: [], settled: true };

  getSnapshot = (): RailViewsSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get(viewId: string): RailView | undefined {
    return this.entries.get(viewId)?.view;
  }

  /** Adds a view; a duplicate id throws. */
  register(contribution: RailViewContribution, order = 0): RailViewHandle {
    if (this.entries.has(contribution.id)) {
      throw new Error(`view '${contribution.id}' is already registered`);
    }
    const entry: Entry = {
      view: Object.freeze({ ...INITIAL_STATE, ...contribution }),
      order,
    };
    this.entries.set(contribution.id, entry);
    this.publish();
    let disposed = false;
    return {
      update: (patch) => {
        if (disposed) return;
        // Skip no-op updates, so badge or message sets that change nothing do not re-render.
        const current = entry.view as unknown as Record<string, unknown>;
        if (Object.entries(patch).every(([key, value]) => Object.is(current[key], value))) {
          return;
        }
        entry.view = Object.freeze({ ...entry.view, ...patch, ...contribution });
        this.publish();
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (this.entries.get(contribution.id) === entry) this.entries.delete(contribution.id);
        this.publish();
      },
    };
  }

  /** Marks views as possibly still arriving; call the result once they have. */
  beginLoading(): () => void {
    this.pendingLoads += 1;
    this.publish();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.pendingLoads -= 1;
      this.publish();
    };
  }

  private publish(): void {
    const views = [...this.entries.values()]
      .sort(
        (left, right) =>
          left.view.extensionId.localeCompare(right.view.extensionId) ||
          left.order - right.order ||
          left.view.id.localeCompare(right.view.id),
      )
      .map((entry) => entry.view);
    this.snapshot = Object.freeze({
      views: Object.freeze(views),
      settled: this.pendingLoads === 0,
    });
    for (const listener of [...this.listeners]) listener();
  }
}

/** The window's rail views. */
export const railViews = new RailViewRegistry();

export function useRailViews(registry: RailViewRegistry = railViews): RailViewsSnapshot {
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
}

/**
 * The registered view ids, one per line, and whether loading settled: enough to
 * validate a stored tab, without re-rendering when a view's badge or message changes.
 */
export function useRailViewIds(registry: RailViewRegistry = railViews): {
  ids: readonly string[];
  settled: boolean;
} {
  const key = useSyncExternalStore(registry.subscribe, () => {
    const snapshot = registry.getSnapshot();
    return `${snapshot.settled ? "1" : "0"}${snapshot.views.map((view) => `\n${view.id}`).join("")}`;
  });
  return useMemo(() => {
    const [settled, ...ids] = key.split("\n");
    return { ids, settled: settled === "1" };
  }, [key]);
}

/** The view that stands in for a built-in tab, if a built-in extension registered one. */
export function builtInTabView(
  views: readonly RailView[],
  tab: string | null,
): RailView | undefined {
  return tab === null ? undefined : views.find((view) => view.builtInTab === tab);
}

/** A status of the changed-files API in tree-item terms. */
export function railStatusOf(status: WorkspaceChangedFile["status"]): RailTreeItemStatus {
  return status === "created" ? "added" : status;
}

/** A tree-item status in the changed-files terms the classic rows draw. */
export function changedStatusOf(
  status: RailTreeItemStatus | undefined,
): WorkspaceChangedFile["status"] | undefined {
  return status === "added" ? "created" : status;
}
