// Window-wide views: registers the views extensions contribute in the rail's view
// registry, keeps each view's view/title actions in step with the context keys,
// and backs `window.createTreeView`.
import type * as omnigent from "omnigent";
import type {
  RailViewBadge,
  RailViewHandle,
  RailViewRegistry,
  RailViewTitleAction,
} from "@/shell/railViews";
import { errorText } from "./progress";
import type { ContextKeyService } from "./contextKeys";
import type {
  CommandContribution,
  ExtensionContributions,
  MenuItemContribution,
} from "./contributions";
import { createTreeViewModel } from "./treeView";

const MAX_VIEW_TEXT = 200;
const MAX_MESSAGE = 500;

export interface ViewsServiceOptions {
  registry: RailViewRegistry;
  contextKeys: ContextKeyService;
  /** Runs a command with JSON arguments (the window's command registry). */
  executeCommand: (command: string, args: readonly unknown[]) => Promise<unknown>;
  /** Shows a failed title action, as VS Code shows a failed command. */
  showError: (message: string) => void;
}

interface ViewEntry {
  readonly extensionId: string;
  readonly handle: RailViewHandle;
  /** JSON of the actions last published, to skip no-op updates. */
  actionsKey: string;
  treeOwner: object | undefined;
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

export class ViewsService {
  private readonly options: ViewsServiceOptions;
  private readonly views = new Map<string, ViewEntry>();
  private readonly commandInfo = new Map<string, CommandContribution>();
  private readonly menus: { extensionId: string; item: MenuItemContribution }[] = [];
  private readonly unsubscribe: () => void;

  constructor(options: ViewsServiceOptions) {
    this.options = options;
    const subscription = options.contextKeys.onDidChange(() => this.refreshActions());
    this.unsubscribe = () => subscription.dispose();
  }

  /** Registers an extension's views, commands and menus; returns their removal. */
  addExtension(extensionId: string, contributions: ExtensionContributions): () => void {
    const added: string[] = [];
    for (const command of contributions.commands) {
      if (!this.commandInfo.has(command.command)) this.commandInfo.set(command.command, command);
    }
    for (const item of contributions.viewTitleMenu) this.menus.push({ extensionId, item });
    for (const view of contributions.views) {
      if (this.views.has(view.id) || this.options.registry.get(view.id)) {
        console.warn(`[omnigent-extensions] ${extensionId}: view ${view.id} already exists`);
        continue;
      }
      const handle = this.options.registry.register(
        { id: view.id, extensionId, name: view.name, icon: view.icon },
        view.order,
      );
      this.views.set(view.id, { extensionId, handle, actionsKey: "", treeOwner: undefined });
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
      for (let index = this.menus.length - 1; index >= 0; index -= 1) {
        if (this.menus[index].extensionId === extensionId) this.menus.splice(index, 1);
      }
      this.refreshActions();
    };
  }

  /** The extension finished activating (or failed): its views stop showing as loading. */
  extensionSettled(extensionId: string): void {
    for (const entry of this.views.values()) {
      if (entry.extensionId === extensionId) entry.handle.update({ loading: false });
    }
  }

  /** The view/title actions of `viewId` under the current context keys. */
  titleActions(viewId: string): RailViewTitleAction[] {
    const lookup = this.options.contextKeys.lookup({ view: viewId });
    const actions: RailViewTitleAction[] = [];
    for (const { item } of this.menus) {
      // Only the inline "navigation" group is drawn; other groups need an overflow menu.
      if (item.group !== "navigation") continue;
      if (item.when && !item.when.evaluate(lookup)) continue;
      if (actions.some((action) => action.id === item.command)) continue;
      const info = this.commandInfo.get(item.command);
      const title = info?.title ?? item.command;
      actions.push({
        id: item.command,
        title,
        icon: info?.icon,
        toggled: info?.toggled ? info.toggled.evaluate(lookup) : undefined,
        run: () => {
          this.options.executeCommand(item.command, []).catch((error: unknown) => {
            this.options.showError(`${title}: ${errorText(error)}`);
          });
        },
      });
    }
    return actions;
  }

  private refreshActions(): void {
    for (const [viewId, entry] of this.views) {
      const actions = this.titleActions(viewId);
      const key = JSON.stringify(
        actions.map(({ id, title, icon, toggled }) => [id, title, icon, toggled]),
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
    if (entry.treeOwner !== undefined) {
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
    const owner = {};
    entry.treeOwner = owner;
    const tree = createTreeViewModel(provider, {
      executeCommand: this.options.executeCommand,
      logError: (message, error) => logError(`tree view ${viewId}: ${message}`, error),
    });
    const state: {
      title: string | undefined;
      description: string | undefined;
      message: string | undefined;
      badge: omnigent.ViewBadge | undefined;
    } = { title: undefined, description: undefined, message: undefined, badge: undefined };
    let disposed = false;
    entry.handle.update({ tree: tree.model });
    const update = () => {
      if (disposed) return;
      entry.handle.update({
        title: state.title,
        description: state.description,
        message: state.message,
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
      get badge() {
        return state.badge;
      },
      set badge(value) {
        const badge = badgeOf(value);
        state.badge = badge;
        update();
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        tree.dispose();
        if (entry.treeOwner === owner) {
          entry.treeOwner = undefined;
          // Back to VS Code's "no data provider" state; the view stays contributed.
          entry.handle.update({
            tree: undefined,
            title: undefined,
            description: undefined,
            message: undefined,
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
