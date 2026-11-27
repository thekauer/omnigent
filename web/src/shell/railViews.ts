// Registry of extension views shown as tabs in the classic workspace rail. Each
// view is plain data plus a host-owned tree model; the rail draws the tab and
// the content area itself, so extension code never touches React or the DOM.

import type * as omnigent from "omnigent";
import { useMemo, useSyncExternalStore } from "react";
import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";
import type { WhenClause } from "@/vscodeExtensions/when";
import { RIGHT_PANEL_CONTAINER, viewContainers } from "@/workbench/viewContainers";
import {
  containerLocation,
  useViewLocations,
  type ViewLocations,
  viewContainerFor,
} from "@/workbench/viewLocations";
import { isViewHidden, useViewsLayout } from "@/workbench/viewsLayout";

/** A view's count badge on its tab, like VS Code's `ViewBadge`. */
export interface RailViewBadge {
  readonly value: number;
  readonly tooltip: string;
  /** Drawn instead of `value`. */
  readonly label?: string;
  readonly tone?: "success" | "muted";
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
  /**
   * A control the host draws itself: the filter's fields toggle, or the Open
   * In menu for the view's location.
   */
  readonly kind?: "filterFields" | "openIn";
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
export type RailAgentState =
  "launching" | "working" | "awaiting" | "done" | "failed" | "disconnected" | "idle" | "other";

export interface RailAgentStatus {
  readonly state: RailAgentState;
  readonly label: string;
  readonly detail: string | undefined;
}
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
          readonly tooltip?: string;
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
  /** `[start, end)` ranges of `label` to mark. */
  readonly highlights: readonly (readonly [number, number])[] | undefined;
  /** The line of the resource a text-match row stands for. */
  readonly line: number | undefined;
  /** The row's accessible name. */
  readonly accessibleLabel: string | undefined;
  /** The chat session a session row stands for. */
  readonly sessionId: string | undefined;
  /** An agent's icon: its name and harness. */
  readonly agentIcon: { readonly agent: string; readonly harness: string | null } | undefined;
  /** An agent's status, for a session row. */
  readonly agentStatus: RailAgentStatus | undefined;
}

/** `TreeView.reveal`, for the drawn tree: expand the ancestors, then scroll to and mark the row. */
export interface RailRevealRequest {
  readonly handle: string;
  /** From the root down; each is expanded. */
  readonly ancestors: readonly string[];
  readonly select: boolean;
  readonly focus: boolean;
  /** Levels to expand below the row (0 for none). */
  readonly expand: number;
}

/** What the rail needs from a tree view; implemented by the extension host. */
export interface RailTreeModel {
  /** The reveal waiting for `sessionId`'s tree, removed as it is taken. */
  takeReveal?: (sessionId: string | undefined) => RailRevealRequest | undefined;
  /** Fires when a reveal is waiting. */
  subscribeReveal?: (listener: () => void) => () => void;
  /** The rows the user selected, by handle. */
  select?: (handles: readonly string[]) => void;
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
  /** Runs a command a message link or a plan's content names, with JSON arguments. */
  runCommand: (command: string, args?: readonly unknown[]) => void;
  /** The search input's value kept for `sessionId`. */
  getSearchInput: (sessionId: string | undefined) => RailSearchInputValue;
  setSearchInput: (sessionId: string | undefined, value: RailSearchInputValue) => void;
  /** The user submitted the search input. */
  acceptSearchInput: (sessionId: string | undefined) => void;
  /** The filter's extra field values kept for `sessionId`. */
  getFilterFields: (sessionId: string | undefined) => Readonly<Record<string, string>>;
  setFilterFields: (
    sessionId: string | undefined,
    fields: Readonly<Record<string, string>>,
  ) => void;
  /** The user picked a folder in the location bar (an absolute path). */
  navigate: (sessionId: string | undefined, path: string) => void;
}

/** The folder a view browses (`TreeView.location`), absolute paths. */
export interface RailViewLocation {
  readonly path: string;
  readonly root: string;
  readonly error: string | undefined;
}

export interface RailSearchInputValue {
  readonly query: string;
  readonly options: Readonly<Record<string, boolean>>;
  readonly fields: Readonly<Record<string, string>>;
}

/** A view's query form, as its contribution describes it. */
export interface RailSearchInput {
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly submitTitle: string;
  readonly options: readonly { readonly id: string; readonly title: string }[];
  readonly fields: readonly {
    readonly id: string;
    readonly label: string;
    readonly placeholder: string | undefined;
  }[];
  readonly fieldsToggle: { readonly title: string; readonly ariaLabel: string } | undefined;
  readonly fieldsHint: string | undefined;
  readonly hint: string | undefined;
}

export interface RailViewFilter {
  readonly placeholder: string;
  readonly ariaLabel: string;
  /** Extra text fields under the filter, shown by its fields toggle. */
  readonly fields?: readonly {
    readonly id: string;
    readonly label: string;
    readonly placeholder: string | undefined;
  }[];
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
  /** Shown under the search input as an alert; submitting does nothing while set. */
  readonly searchValidation: string | undefined;
  /** Whether the search input can be submitted. */
  readonly searchEnabled: boolean;
  readonly presentation: "tree" | "graph";
  /** A plan view's content (`window.createPlanView`), checked plain data the host draws. */
  readonly plan: omnigent.PlanViewContent | undefined;
  /**
   * The last plan content published for each session, latest last, so a pane whose
   * session is not the one on screen (a grid cell not in front) draws its own.
   */
  readonly planBySession: ReadonlyMap<string, omnigent.PlanViewContent>;
  /** A pull request view's content (`window.createPullRequestView`), checked plain data. */
  readonly pullRequests: omnigent.PullRequestViewContent | undefined;
  /** The last pull request content published for each session, latest last. */
  readonly pullRequestsBySession: ReadonlyMap<string, omnigent.PullRequestViewContent>;
  /** Running tasks the view shows progress for, latest last. */
  readonly progress: readonly RailViewProgress[];
  /** The folder the view browses, drawn as its location bar. */
  readonly location: RailViewLocation | undefined;
  /** Bumped when the extension set the filter text, so a drawn field shows it. */
  readonly filterRevision: number;
  /** Whether the view's `when` holds under the current context keys. */
  readonly active: boolean;
  /** The view's empty state (`contributes.viewsWelcome`) whose `when` holds, in order. */
  readonly welcome: readonly RailViewWelcome[];
}

/** One welcome block: lines of text with `[text](command:id)` links. */
export interface RailViewWelcome {
  readonly contents: string;
}

/** A task shown as progress in a view, while the chat session it started in is on screen. */
export interface RailViewProgress {
  readonly title: string;
  readonly sessionId: string | undefined;
}

export interface RailViewContribution {
  /** Globally unique view id, such as `publisher.name.view`. */
  readonly id: string;
  readonly extensionId: string;
  readonly name: string;
  /** The view container it is in; the classic rail's when unset. */
  readonly containerId?: string;
  /** Shown only while this holds (`contributes.views[].when`). */
  readonly when?: WhenClause;
  readonly visibility?: "visible" | "collapsed" | "hidden";
  readonly contextualTitle?: string;
  readonly initialSize?: number;
  /** The host component drawn as the view's body (a built-in extension's `builtInView`). */
  readonly builtInView?: string;
  /** A name from the rail icon allowlist; unknown names fall back to a generic icon. */
  readonly icon: string | undefined;
  /** The built-in tab (such as "changes") a built-in extension's view stands in for. */
  readonly builtInTab?: string;
  /** A filter field above the rows. */
  readonly filter?: RailViewFilter;
  /** A query form in place of the title bar. */
  readonly searchInput?: RailSearchInput;
  /** The title bar is the location bar (`TreeView.location`). */
  readonly locationBar?: boolean;
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
  searchValidation: undefined,
  searchEnabled: true,
  presentation: "tree",
  plan: undefined,
  planBySession: new Map(),
  pullRequests: undefined,
  pullRequestsBySession: new Map(),
  progress: [],
  location: undefined,
  filterRevision: 0,
  active: true,
  welcome: [],
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

/**
 * Whether an extension view gets a tab in the classic rail: its `when` holds and it isn't
 * hidden (by its `visibility`, or by the user in the layout state's `hidden`).
 */
export function hasRailTab(
  view: RailView,
  hidden: (view: RailView) => boolean = (candidate) => candidate.visibility === "hidden",
): boolean {
  return view.builtInTab === undefined && view.active && !hidden(view);
}

/** The container a view is in: where the user moved it (`locations`), else its own. */
export function viewContainerOf(
  view: RailViewContribution,
  locations: ViewLocations = NO_LOCATIONS,
): string {
  return viewContainerFor(view, locations);
}

const NO_LOCATIONS: ViewLocations = Object.freeze({});

const containerSnapshots = new WeakMap<
  RailViewsSnapshot,
  WeakMap<ViewLocations, Map<string, RailViewsSnapshot>>
>();

/**
 * The snapshot's views of `container` (every view for `null`) with the user's moves, the same
 * object per snapshot and moves.
 */
export function viewsOfContainer(
  snapshot: RailViewsSnapshot,
  container: string | null,
  locations: ViewLocations = NO_LOCATIONS,
): RailViewsSnapshot {
  if (container === null) return snapshot;
  let byLocations = containerSnapshots.get(snapshot);
  if (!byLocations) {
    byLocations = new WeakMap();
    containerSnapshots.set(snapshot, byLocations);
  }
  let byContainer = byLocations.get(locations);
  if (!byContainer) {
    byContainer = new Map();
    byLocations.set(locations, byContainer);
  }
  let filtered = byContainer.get(container);
  if (!filtered) {
    // The classic rail draws every secondary side bar container's views as its tabs.
    const drawnHere = (view: RailViewContribution) => {
      const containerId = viewContainerOf(view, locations);
      return (
        containerId === container ||
        (container === RIGHT_PANEL_CONTAINER &&
          containerLocation(containerId, viewContainers) === "auxiliarybar")
      );
    };
    filtered = Object.freeze({
      views: Object.freeze(snapshot.views.filter(drawnHere)),
      settled: snapshot.settled,
    });
    byContainer.set(container, filtered);
  }
  return filtered;
}

/** The views of `container` (the classic rail's by default; `null` for every view). */
export function useRailViews(
  registry: RailViewRegistry = railViews,
  container: string | null = RIGHT_PANEL_CONTAINER,
): RailViewsSnapshot {
  const snapshot = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );
  const locations = useViewLocations();
  return viewsOfContainer(snapshot, container, locations);
}

/**
 * The rail's view ids (built-in tabs' and the extension views that have a tab), and whether
 * loading settled: enough to validate a stored tab, without re-rendering when a view's badge
 * or message changes.
 */
export function useRailViewIds(registry: RailViewRegistry = railViews): {
  ids: readonly string[];
  settled: boolean;
} {
  const layout = useViewsLayout();
  const locations = useViewLocations();
  const key = useSyncExternalStore(registry.subscribe, () => {
    const snapshot = viewsOfContainer(registry.getSnapshot(), RIGHT_PANEL_CONTAINER, locations);
    // Built-in tabs' views always count; an extension tab only while it has a tab.
    const ids = snapshot.views
      .filter(
        (view) =>
          view.builtInTab !== undefined ||
          hasRailTab(view, (candidate) => isViewHidden(candidate, layout)),
      )
      .map((view) => `\n${view.id}`);
    return `${snapshot.settled ? "1" : "0"}${ids.join("")}`;
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
