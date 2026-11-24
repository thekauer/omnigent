// Window-wide views: registers the views extensions contribute in the rail's view
// registry, keeps each view's title actions in step with the context keys, keeps
// each view's filter text per chat session, and backs `window.createTreeView`.
import type * as omnigent from "omnigent";
import type {
  RailViewBadge,
  RailViewHandle,
  RailViewHost,
  RailViewMenuItem,
  RailViewNotice,
  RailViewRegistry,
  RailViewTag,
  RailViewTitleAction,
} from "@/shell/railViews";
import { isRailViewIconName } from "@/shell/railViewIcons";
import { EventEmitter } from "./base";
import { errorText } from "./progress";
import type { ContextKeyService } from "./contextKeys";
import type {
  CommandContribution,
  ExtensionContributions,
  MenuItemContribution,
  SubmenuContribution,
} from "./contributions";
import { createTreeViewModel } from "./treeView";

const MAX_VIEW_TEXT = 200;
const MAX_MESSAGE = 500;
const MAX_FILTER = 500;
/** Filter texts kept per view, most recently used last. */
const MAX_FILTER_SESSIONS = 100;
const NOTICES = new Set<RailViewNotice>(["agentAsleep", "sandboxOffline", "sandboxStarting"]);

/** The part of the workspace service views follow: the session on screen. */
export interface ViewsWorkspace {
  readonly activeSessionId: string | undefined;
  readonly onDidChangeChangedFiles: omnigent.Event<unknown>;
}

export interface ViewsServiceOptions {
  registry: RailViewRegistry;
  contextKeys: ContextKeyService;
  /** Runs a command with JSON arguments (the window's command registry). */
  executeCommand: (command: string, args: readonly unknown[]) => Promise<unknown>;
  /** Shows a failed title action, as VS Code shows a failed command. */
  showError: (message: string) => void;
  /** The workspace on screen; views keep their filter text per its session. */
  workspace?: ViewsWorkspace;
  /** Called whenever a view comes on screen, for host-side refreshes. */
  onViewShown?: (viewId: string) => void;
}

interface TreeViewEntry {
  readonly owner: object;
  readonly visibility: EventEmitter<omnigent.TreeViewVisibilityChangeEvent>;
  readonly filterChanged: EventEmitter<string>;
  /** The filter text last delivered, to fire only on a real change. */
  lastFilter: string;
  /** Tells the drawn tree to reload, as when the workspace on screen changed. */
  readonly refresh: () => void;
}

interface ViewEntry {
  readonly extensionId: string;
  readonly handle: RailViewHandle;
  /** JSON of the actions last published, to skip no-op updates. */
  actionsKey: string;
  tree: TreeViewEntry | undefined;
  /** How many drawn copies of the view are on screen. */
  shown: number;
  /** Filter text per chat session ("" key without one). */
  readonly filters: Map<string, string>;
}

function badgeOf(value: unknown): RailViewBadge | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { value: count, tooltip } = value as { value?: unknown; tooltip?: unknown };
  if (typeof count !== "number" || !Number.isFinite(count)) return undefined;
  return Object.freeze({
    value: Math.max(0, Math.floor(count)),
    tooltip: typeof tooltip === "string" ? tooltip.slice(0, MAX_VIEW_TEXT) : "",
  });
}

function textOf(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function tagOf(value: unknown): RailViewTag | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { text, tooltip, icon } = value as { text?: unknown; tooltip?: unknown; icon?: unknown };
  const label = textOf(text, 40);
  if (!label) return undefined;
  return Object.freeze({
    text: label,
    tooltip: textOf(tooltip, MAX_VIEW_TEXT),
    icon: isRailViewIconName(icon) ? icon : undefined,
  });
}

const sessionKey = (sessionId: string | undefined) => sessionId ?? "";

const CONTEXT_REFERENCE = /\$\{([A-Za-z0-9_.:-]{1,128})\}/g;

/** A menu tooltip with each `${context key}` replaced by the key's value, so it can name counts. */
function interpolate(
  text: string | undefined,
  lookup: (key: string) => unknown,
): string | undefined {
  if (text === undefined) return undefined;
  return text
    .replace(CONTEXT_REFERENCE, (_, key: string) => {
      const value = lookup(key);
      return value === undefined || value === null ? "" : String(value);
    })
    .slice(0, MAX_VIEW_TEXT);
}

export class ViewsService {
  private readonly options: ViewsServiceOptions;
  private readonly views = new Map<string, ViewEntry>();
  private readonly commandInfo = new Map<string, CommandContribution>();
  private readonly menus: { extensionId: string; item: MenuItemContribution }[] = [];
  private readonly submenus = new Map<string, SubmenuContribution>();
  private readonly unsubscribe: () => void;
  private workspaceSession: string | undefined;

  constructor(options: ViewsServiceOptions) {
    this.options = options;
    const subscription = options.contextKeys.onDidChange(() => this.refreshActions());
    this.workspaceSession = options.workspace?.activeSessionId;
    const workspaceSubscription = options.workspace?.onDidChangeChangedFiles(() =>
      this.workspaceChanged(),
    );
    this.unsubscribe = () => {
      subscription.dispose();
      workspaceSubscription?.dispose();
    };
  }

  private currentSession(): string | undefined {
    return this.options.workspace?.activeSessionId;
  }

  /** Another workspace came on screen: filters follow it, and drawn trees re-check their data. */
  private workspaceChanged(): void {
    const session = this.currentSession();
    if (session === this.workspaceSession) return;
    this.workspaceSession = session;
    for (const entry of this.views.values()) {
      const tree = entry.tree;
      if (!tree) continue;
      const filter = entry.filters.get(sessionKey(session)) ?? "";
      if (filter !== tree.lastFilter) {
        tree.lastFilter = filter;
        tree.filterChanged.fire(filter);
      }
      tree.refresh();
    }
  }

  private viewHost(viewId: string, entry: () => ViewEntry | undefined): RailViewHost {
    return Object.freeze({
      getFilter: (sessionId: string | undefined) =>
        entry()?.filters.get(sessionKey(sessionId)) ?? "",
      setFilter: (sessionId: string | undefined, text: string) => {
        const view = entry();
        if (!view) return;
        const key = sessionKey(sessionId);
        const value = String(text).slice(0, MAX_FILTER);
        view.filters.delete(key);
        if (value !== "") view.filters.set(key, value);
        while (view.filters.size > MAX_FILTER_SESSIONS) {
          const oldest = view.filters.keys().next().value;
          if (oldest === undefined) break;
          view.filters.delete(oldest);
        }
        const tree = view.tree;
        if (tree && key === sessionKey(this.currentSession()) && tree.lastFilter !== value) {
          tree.lastFilter = value;
          tree.filterChanged.fire(value);
        }
      },
      reportVisible: () => {
        const view = entry();
        if (!view) return () => {};
        view.shown += 1;
        if (view.shown === 1) view.tree?.visibility.fire({ visible: true });
        this.options.onViewShown?.(viewId);
        let done = false;
        return () => {
          if (done) return;
          done = true;
          view.shown -= 1;
          if (view.shown === 0) view.tree?.visibility.fire({ visible: false });
        };
      },
      runCommand: (command: string) => {
        this.options.executeCommand(command, []).catch((error: unknown) => {
          this.options.showError(`${command}: ${errorText(error)}`);
        });
      },
    });
  }

  /** Registers an extension's views, commands and menus; returns their removal. */
  addExtension(extensionId: string, contributions: ExtensionContributions): () => void {
    const added: string[] = [];
    for (const command of contributions.commands) {
      if (!this.commandInfo.has(command.command)) this.commandInfo.set(command.command, command);
    }
    for (const submenu of contributions.submenus) {
      if (!this.submenus.has(submenu.id)) this.submenus.set(submenu.id, submenu);
    }
    for (const item of contributions.viewTitleMenu) this.menus.push({ extensionId, item });
    for (const view of contributions.views) {
      if (this.views.has(view.id) || this.options.registry.get(view.id)) {
        console.warn(`[omnigent-extensions] ${extensionId}: view ${view.id} already exists`);
        continue;
      }
      const handle = this.options.registry.register(
        {
          id: view.id,
          extensionId,
          name: view.name,
          icon: view.icon,
          ...(view.builtInTab === undefined ? {} : { builtInTab: view.builtInTab }),
          ...(view.filter === undefined ? {} : { filter: view.filter }),
        },
        view.order,
      );
      const entry: ViewEntry = {
        extensionId,
        handle,
        actionsKey: "",
        tree: undefined,
        shown: 0,
        filters: new Map(),
      };
      this.views.set(view.id, entry);
      handle.update({
        host: this.viewHost(view.id, () => (this.views.get(view.id) === entry ? entry : undefined)),
      });
      added.push(view.id);
    }
    this.refreshActions();
    return () => {
      for (const viewId of added) {
        this.views.get(viewId)?.handle.dispose();
        this.views.delete(viewId);
      }
      for (const command of contributions.commands) {
        if (this.commandInfo.get(command.command) === command) {
          this.commandInfo.delete(command.command);
        }
      }
      for (const submenu of contributions.submenus) {
        if (this.submenus.get(submenu.id) === submenu) this.submenus.delete(submenu.id);
      }
      for (let index = this.menus.length - 1; index >= 0; index -= 1) {
        if (this.menus[index].extensionId === extensionId) this.menus.splice(index, 1);
      }
      this.refreshActions();
    };
  }

  /**
   * The extension finished activating, or failed (`error`): its views stop
   * showing as loading, and a failure shows as the views' error state.
   */
  extensionSettled(extensionId: string, error?: string): void {
    for (const entry of this.views.values()) {
      if (entry.extensionId === extensionId) {
        entry.handle.update({ loading: false, ...(error === undefined ? {} : { error }) });
      }
    }
  }

  private runner(command: string, title: string): () => Promise<void> {
    return () =>
      this.options.executeCommand(command, []).then(
        () => undefined,
        (error: unknown) => {
          this.options.showError(`${title}: ${errorText(error)}`);
        },
      );
  }

  /** The view/title actions of `viewId` under the current context keys. */
  titleActions(viewId: string): RailViewTitleAction[] {
    const lookup = this.options.contextKeys.lookup({ view: viewId });
    const actions: RailViewTitleAction[] = [];
    for (const { item } of this.menus) {
      // "navigation" is the title bar and "filter" the filter row; other groups
      // would need an overflow menu.
      if (item.group !== "navigation" && item.group !== "filter") continue;
      if (item.when && !item.when.evaluate(lookup)) continue;
      const id = item.submenu ?? item.command;
      if (actions.some((action) => action.id === id)) continue;
      if (item.submenu !== undefined) {
        const submenu = this.submenus.get(item.submenu);
        if (!submenu) continue;
        const items: RailViewMenuItem[] = submenu.items
          .filter(
            (entry) => entry.submenu === undefined && (!entry.when || entry.when.evaluate(lookup)),
          )
          .map((entry) => {
            const info = this.commandInfo.get(entry.command);
            const title = info?.title ?? entry.command;
            return {
              id: entry.command,
              title,
              icon: info?.icon,
              toggled: info?.toggled ? info.toggled.evaluate(lookup) : undefined,
              run: this.runner(entry.command, title),
            };
          });
        actions.push({
          id,
          title: submenu.label,
          tooltip: interpolate(item.tooltip, lookup) ?? submenu.tooltip,
          icon: submenu.icon,
          toggled: undefined,
          tone: item.tone,
          group: item.group,
          run: () => Promise.resolve(),
          items,
        });
        continue;
      }
      const info = this.commandInfo.get(item.command);
      const title = info?.title ?? item.command;
      actions.push({
        id,
        title,
        tooltip: interpolate(item.tooltip, lookup),
        icon: info?.icon,
        toggled: info?.toggled ? info.toggled.evaluate(lookup) : undefined,
        tone: item.tone,
        group: item.group,
        run: this.runner(item.command, title),
      });
    }
    return actions;
  }

  private refreshActions(): void {
    for (const [viewId, entry] of this.views) {
      const actions = this.titleActions(viewId);
      const key = JSON.stringify(
        actions.map(({ id, title, tooltip, icon, toggled, tone, group, items }) => [
          id,
          title,
          tooltip,
          icon,
          toggled,
          tone,
          group,
          items?.map((item) => [item.id, item.title, item.icon, item.toggled]),
        ]),
      );
      if (key === entry.actionsKey) continue;
      entry.actionsKey = key;
      entry.handle.update({ actions });
    }
  }

  /** `window.createTreeView` for `extensionId`; throws for a view it did not contribute. */
  createTreeView<T>(
    extensionId: string,
    viewId: string,
    options: omnigent.TreeViewOptions<T>,
    logError: (message: string, error?: unknown) => void,
  ): omnigent.TreeView<T> {
    const entry = this.views.get(viewId);
    if (!entry || entry.extensionId !== extensionId) {
      throw new Error(`no view with id '${viewId}' is contributed by ${extensionId}`);
    }
    if (entry.tree !== undefined) {
      throw new Error(`view '${viewId}' already has a tree view`);
    }
    const provider = options?.treeDataProvider;
    if (
      typeof provider !== "object" ||
      provider === null ||
      typeof provider.getChildren !== "function" ||
      typeof provider.getTreeItem !== "function"
    ) {
      throw new TypeError(
        "createTreeView needs a treeDataProvider with getChildren and getTreeItem",
      );
    }
    const workspace = this.options.workspace;
    const tree = createTreeViewModel(provider, {
      executeCommand: this.options.executeCommand,
      logError: (message, error) => logError(`tree view ${viewId}: ${message}`, error),
      ...(workspace ? { dataSessionId: () => workspace.activeSessionId } : {}),
    });
    const treeEntry: TreeViewEntry = {
      owner: {},
      visibility: new EventEmitter((error) =>
        logError("onDidChangeVisibility listener threw", error),
      ),
      filterChanged: new EventEmitter((error) =>
        logError("onDidChangeFilter listener threw", error),
      ),
      lastFilter: entry.filters.get(sessionKey(this.currentSession())) ?? "",
      refresh: tree.refresh,
    };
    entry.tree = treeEntry;
    const state: {
      title: string | undefined;
      description: string | undefined;
      message: string | undefined;
      messageSeverity: "info" | "error" | undefined;
      notice: RailViewNotice | undefined;
      tag: RailViewTag | undefined;
      badge: omnigent.ViewBadge | undefined;
    } = {
      title: undefined,
      description: undefined,
      message: undefined,
      messageSeverity: undefined,
      notice: undefined,
      tag: undefined,
      badge: undefined,
    };
    let disposed = false;
    const currentSession = () => this.currentSession();
    entry.handle.update({ tree: tree.model });
    const update = () => {
      if (disposed) return;
      entry.handle.update({
        title: state.title,
        description: state.description,
        message: state.message,
        messageSeverity: state.messageSeverity,
        notice: state.notice,
        tag: state.tag,
        badge: badgeOf(state.badge),
      });
    };
    const view: omnigent.TreeView<T> = {
      get title() {
        return state.title;
      },
      set title(value) {
        state.title = textOf(value, MAX_VIEW_TEXT);
        update();
      },
      get description() {
        return state.description;
      },
      set description(value) {
        state.description = textOf(value, MAX_VIEW_TEXT);
        update();
      },
      get message() {
        return state.message;
      },
      set message(value) {
        state.message = textOf(value, MAX_MESSAGE);
        update();
      },
      get messageSeverity() {
        return state.messageSeverity;
      },
      set messageSeverity(value) {
        state.messageSeverity = value === "error" || value === "info" ? value : undefined;
        update();
      },
      get notice() {
        return state.notice;
      },
      set notice(value) {
        state.notice = NOTICES.has(value as RailViewNotice) ? (value as RailViewNotice) : undefined;
        update();
      },
      get tag() {
        return state.tag;
      },
      set tag(value) {
        state.tag = tagOf(value);
        update();
      },
      get badge() {
        return state.badge;
      },
      set badge(value) {
        const badge = badgeOf(value);
        // Only a changed badge re-renders the tab strip.
        if (badge?.value === state.badge?.value && badge?.tooltip === state.badge?.tooltip) {
          return;
        }
        state.badge = badge;
        update();
      },
      get visible() {
        return !disposed && entry.shown > 0;
      },
      onDidChangeVisibility: treeEntry.visibility.event,
      get filter() {
        return disposed ? "" : (entry.filters.get(sessionKey(currentSession())) ?? "");
      },
      onDidChangeFilter: treeEntry.filterChanged.event,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        tree.dispose();
        treeEntry.visibility.dispose();
        treeEntry.filterChanged.dispose();
        if (entry.tree === treeEntry) {
          entry.tree = undefined;
          // Back to VS Code's "no data provider" state; the view stays contributed.
          entry.handle.update({
            tree: undefined,
            title: undefined,
            description: undefined,
            message: undefined,
            messageSeverity: undefined,
            notice: undefined,
            tag: undefined,
            badge: undefined,
          });
        }
      },
    };
    return view;
  }

  dispose(): void {
    this.unsubscribe();
  }
}
