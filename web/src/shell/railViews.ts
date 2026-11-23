// Registry of extension views shown as tabs in the classic workspace rail. Each
// view is plain data plus a host-owned tree model; the rail draws the tab and
// the content area itself, so extension code never touches React or the DOM.

import { useSyncExternalStore } from "react";
import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";

/** A view's count badge on its tab, like VS Code's `ViewBadge`. */
export interface RailViewBadge {
  readonly value: number;
  readonly tooltip: string;
}

/** One title-bar button of a view (a `view/title` menu entry with group "navigation"). */
export interface RailViewTitleAction {
  /** The command id; unique within the view. */
  readonly id: string;
  readonly title: string;
  /** A name from the rail icon allowlist (railViewIcons.ts). */
  readonly icon: string | undefined;
  /** Set for toggle commands: the button gets `aria-pressed`. */
  readonly toggled: boolean | undefined;
  readonly run: () => void;
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
}

/** What the rail needs from a tree view; implemented by the extension host. */
export interface RailTreeModel {
  /** Children of `parent`, or the roots; rejects or resolves empty on provider failure. */
  getChildren: (parent: string | undefined) => Promise<readonly RailTreeNode[]>;
  /** Fires when the provider's data changed; the rail reloads what it shows. */
  subscribe: (listener: () => void) => () => void;
  /** Runs the row's `command`, if it has one. */
  runCommand: (handle: string) => void;
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
}

export interface RailViewContribution {
  /** Globally unique view id, such as `publisher.name.view`. */
  readonly id: string;
  readonly extensionId: string;
  readonly name: string;
  /** A name from the rail icon allowlist; unknown names fall back to a generic icon. */
  readonly icon: string | undefined;
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
