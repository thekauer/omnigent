// Window-wide views: registers the views extensions contribute in the rail's view
// registry, keeps each view's title actions in step with the context keys, keeps
// each view's filter text per chat session, and backs `window.createTreeView`.
import {
  compareTitleBarEntries,
  type ContributedTitleBarEntry,
  contributedTitleBarEntries,
  MAX_TITLE_BAR_ITEMS_PER_EXTENSION,
} from "@/workbench/titleBar";
import { commandIdProblem } from "./commands";
import type { WhenClause } from "./when";
import type * as omnigent from "omnigent";
import type {
  RailViewLocation,
  RailViewBadge,
  RailViewHandle,
  RailViewHost,
  RailViewMenuItem,
  RailViewNotice,
  RailSearchInputValue,
  RailViewProgress,
  RailViewRegistry,
  RailViewTag,
  RailViewTitleAction,
} from "@/shell/railViews";
import { isRailViewIconName } from "@/shell/railViewIcons";
import { type Disposable, EventEmitter } from "./base";
import { errorText } from "./progress";
import type { ContextKeyService } from "./contextKeys";
import {
  type CommandContribution,
  type ExtensionContributions,
  type ViewContribution,
  type ViewWelcomeContribution,
  type MenuItemContribution,
  type TitleBarMenuItemContribution,
  OPEN_IN_SUBMENU,
  type SubmenuContribution,
  TOGGLE_FILTER_FIELDS_COMMAND,
} from "./contributions";
import { createTreeViewModel } from "./treeView";
import { planContentOf } from "./planContent";
import { pullRequestContentOf } from "./pullRequestContent";
import { WORKSPACE_SETTING_NAMES } from "./workspaceService";
import {
  type ViewContainerRegistry,
  viewContainers as windowViewContainers,
} from "@/workbench/viewContainers";
import {
  builtInNavigationEntries,
  type ContributedNavigationEntry,
  contributedNavigation,
} from "@/workbench/sidebarNavigation";

const MAX_VIEW_TEXT = 200;
// Room for a status line that quotes a long search query.
const MAX_MESSAGE = 10_000;
const MAX_FILTER = 500;
/** Filter texts kept per view, most recently used last. */
const MAX_FILTER_SESSIONS = 100;
/** Sessions a plan view keeps its last content for, oldest dropped first. */
const MAX_PLAN_SNAPSHOTS = 32;
const NOTICES = new Set<RailViewNotice>(["agentAsleep", "sandboxOffline", "sandboxStarting"]);
const MAX_INPUT_TEXT = 4096;
const MAX_VALIDATION = 300;

/** A search input value with only the contributed options and fields, capped. */
function inputValueOf(
  value: unknown,
  contribution: ViewContribution["searchInput"],
): RailSearchInputValue {
  const record = (typeof value === "object" && value !== null ? value : {}) as {
    query?: unknown;
    options?: Record<string, unknown>;
    fields?: Record<string, unknown>;
  };
  const options = (record.options ?? {}) as Record<string, unknown>;
  const fields = (record.fields ?? {}) as Record<string, unknown>;
  return Object.freeze({
    query: typeof record.query === "string" ? record.query.slice(0, MAX_INPUT_TEXT) : "",
    options: Object.freeze(
      Object.fromEntries(
        (contribution?.options ?? []).map(({ id }) => [
          id,
          Object.hasOwn(options, id) && options[id] === true,
        ]),
      ),
    ),
    fields: Object.freeze(
      Object.fromEntries(
        (contribution?.fields ?? []).map(({ id }) => {
          const text = Object.hasOwn(fields, id) ? fields[id] : undefined;
          return [id, typeof text === "string" ? text.slice(0, MAX_INPUT_TEXT) : ""];
        }),
      ),
    ),
  });
}

function sameInput(left: RailSearchInputValue, right: RailSearchInputValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The part of the workspace service views follow: the session on screen. */
export interface ViewsWorkspace {
  readonly activeSessionId: string | undefined;
  readonly onDidChangeChangedFiles: omnigent.Event<unknown>;
}

export interface ViewsServiceOptions {
  registry: RailViewRegistry;
  /** Where contributed view containers go; the window's by default. */
  containers?: ViewContainerRegistry;
  /** Where other extensions' side bar navigation entries go; the window's by default. */
  navigation?: { set: (entries: readonly ContributedNavigationEntry[]) => void };
  /** Where other extensions' `titleBar/*` entries go; the window's by default. */
  titleBar?: { set: (entries: readonly ContributedTitleBarEntry[]) => void };
  contextKeys: ContextKeyService;
  /** Runs a command with JSON arguments (the window's command registry). */
  executeCommand: (command: string, args: readonly unknown[]) => Promise<unknown>;
  /** Shows a failed title action, as VS Code shows a failed command. */
  showError: (message: string) => void;
  /** The workspace on screen; views keep their filter text per its session. */
  workspace?: ViewsWorkspace;
  /** Called whenever a view comes on screen, for host-side refreshes. */
  onViewShown?: (viewId: string) => void;
  /**
   * Registers each view's `<view id>.focus` command (VS Code's); it resolves to
   * whether the workspace on screen could reveal the view.
   */
  registerFocusCommand?: (
    extensionId: string,
    command: string,
    viewId: string,
    builtIn: boolean,
  ) => Disposable;
}

interface TreeViewEntry {
  readonly owner: object;
  /** Fires with the absolute folder the user picked in the location bar. */
  readonly locationPicked: EventEmitter<string>;
  readonly visibility: EventEmitter<omnigent.TreeViewVisibilityChangeEvent>;
  readonly filterChanged: EventEmitter<string>;
  /** The filter text last delivered, to fire only on a real change. */
  lastFilter: string;
  /** JSON of the filter fields last delivered. */
  lastFields: string;
  readonly inputChanged: EventEmitter<RailSearchInputValue>;
  readonly inputAccepted: EventEmitter<RailSearchInputValue>;
  /** The search input value last delivered. */
  lastInput: RailSearchInputValue | undefined;
  /** Whether the input can be submitted now (enabled and valid). */
  canAccept: () => boolean;
  /** Tells the drawn tree to reload, as when the workspace on screen changed. */
  readonly refresh: () => void;
}

interface ViewEntry {
  readonly extensionId: string;
  readonly handle: RailViewHandle;
  /** JSON of the actions last published, to skip no-op updates. */
  actionsKey: string;
  /** JSON of the welcome contents last published. */
  welcomeKey: string;
  tree: TreeViewEntry | undefined;
  /** The plan view's visibility events, while it has one. */
  plan: { readonly visibility: EventEmitter<omnigent.TreeViewVisibilityChangeEvent> } | undefined;
  /** How many drawn copies of the view are on screen. */
  shown: number;
  /** Filter text per chat session ("" key without one). */
  readonly filters: Map<string, string>;
  /** The filter's extra field values per chat session. */
  readonly filterFields: Map<string, Readonly<Record<string, string>>>;
  /** The contributed extra field ids of the filter. */
  readonly filterFieldIds: readonly string[];
  readonly searchInput: ViewContribution["searchInput"];
  /** Search input values per chat session. */
  readonly inputs: Map<string, RailSearchInputValue>;
  /** Running view progress, latest last, with the chat session each started in. */
  readonly progress: RailViewProgress[];
}

/** Keeps at most {@link MAX_FILTER_SESSIONS} entries, dropping the least recently set. */
function trimSessions(map: Map<string, unknown>): void {
  while (map.size > MAX_FILTER_SESSIONS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/** The largest badge count kept; a badge draws `99+` past 99. */
export const MAX_BADGE_VALUE = 1_000_000;

function badgeOf(value: unknown): RailViewBadge | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const {
    value: count,
    tooltip,
    label,
    tone,
  } = value as { value?: unknown; tooltip?: unknown; label?: unknown; tone?: unknown };
  if (typeof count !== "number" || !Number.isFinite(count)) return undefined;
  const text = typeof label === "string" && label !== "" ? label.slice(0, 12) : undefined;
  return Object.freeze({
    // A count past any list's: capped, so it stays a number the badge can draw.
    value: Math.min(MAX_BADGE_VALUE, Math.max(0, Math.floor(count))),
    tooltip: typeof tooltip === "string" ? tooltip.slice(0, MAX_VIEW_TEXT) : "",
    ...(text === undefined ? {} : { label: text }),
    ...(tone === "success" || tone === "muted" ? { tone: tone as "success" | "muted" } : {}),
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
const NO_FIELDS: Readonly<Record<string, string>> = Object.freeze({});

/** Field values with only the contributed ids, capped. */
function fieldValuesOf(value: unknown, ids: readonly string[]): Readonly<Record<string, string>> {
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  return Object.freeze(
    Object.fromEntries(
      ids.map((id) => {
        const text = Object.hasOwn(record, id) ? record[id] : undefined;
        return [id, typeof text === "string" ? text.slice(0, MAX_FILTER) : ""];
      }),
    ),
  );
}

function locationOf(value: unknown): RailViewLocation | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { path, root, error } = value as { path?: unknown; root?: unknown; error?: unknown };
  if (typeof path !== "string" || path === "" || typeof root !== "string" || root === "") {
    return undefined;
  }
  return Object.freeze({
    path: path.slice(0, 4096),
    root: root.slice(0, 4096),
    error: textOf(error, MAX_VIEW_TEXT * 5) || undefined,
  });
}

const CONTEXT_REFERENCE = /\$\{([A-Za-z0-9_.:-]{1,128})\}/g;

/** The `config.*` keys every extension's tooltips may read: the host's own settings. */
const SHARED_TOOLTIP_KEYS: ReadonlySet<string> = new Set(
  WORKSPACE_SETTING_NAMES.map((name) => `config.${name}`),
);

/**
 * What an extension's tooltips may read: its own keys (`<extension id>.*`), the
 * `view` being drawn and the host's settings, never another extension's keys.
 */
function tooltipLookup(
  extensionId: string,
  lookup: (key: string) => unknown,
): (key: string) => unknown {
  const own = `${extensionId}.`;
  return (key) =>
    key === "view" || key.startsWith(own) || SHARED_TOOLTIP_KEYS.has(key) ? lookup(key) : undefined;
}

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

/** JSON of the parts of title actions a drawn bar shows, to skip no-op updates. */
function actionsKeyOf(actions: readonly RailViewTitleAction[]): string {
  return JSON.stringify(
    actions.map(({ id, kind, title, tooltip, icon, toggled, tone, group, items }) => [
      id,
      kind,
      title,
      tooltip,
      icon,
      toggled,
      tone,
      group,
      items?.map((item) => [item.id, item.title, item.icon, item.toggled]),
    ]),
  );
}

/** The first `max` entries of each extension. */
function capPerExtension<Entry extends { readonly extensionId: string }>(
  entries: readonly Entry[],
  max: number,
): Entry[] {
  const counts = new Map<string, number>();
  return entries.filter((entry) => {
    const count = (counts.get(entry.extensionId) ?? 0) + 1;
    counts.set(entry.extensionId, count);
    return count <= max;
  });
}

/**
 * Whether `extensionId` owns `command`: its id starts with the extension's, and with no longer
 * loaded extension id (`acme.tools` doesn't own `acme.tools.admin.run` while `acme.tools.admin`
 * is loaded), as a setting key belongs to the longest loaded extension id.
 */
function ownsCommand(
  extensionId: string,
  command: string,
  loaded: ReadonlySet<string> = new Set(),
): boolean {
  if (commandIdProblem(extensionId, command) !== undefined) return false;
  for (const other of loaded) {
    if (other.length > extensionId.length && command.startsWith(`${other}.`)) return false;
  }
  return true;
}

/**
 * One menu entry per key (a command, or a region and command): an entry whose `when` holds over
 * one that doesn't, then the command's own extension's, then the first registered. So another
 * extension's entry, shown or not, can't keep the owner's from drawing.
 */
function oneEntryPerCommand<Item extends { readonly command: string }>(
  entries: readonly { readonly extensionId: string; readonly item: Item }[],
  keyOf: (item: Item) => string,
  holds: (item: Item) => boolean,
  loaded: ReadonlySet<string>,
): { readonly extensionId: string; readonly item: Item }[] {
  const rank = (entry: { readonly extensionId: string; readonly item: Item }) =>
    (holds(entry.item) ? 0 : 2) +
    (ownsCommand(entry.extensionId, entry.item.command, loaded) ? 0 : 1);
  const chosen = new Map<string, { readonly extensionId: string; readonly item: Item }>();
  for (const entry of entries) {
    const key = keyOf(entry.item);
    const current = chosen.get(key);
    if (!current || rank(entry) < rank(current)) chosen.set(key, entry);
  }
  // In registration order.
  const kept = new Set(chosen.values());
  return entries.filter((entry) => kept.has(entry));
}

export class ViewsService {
  private readonly options: ViewsServiceOptions;
  private readonly views = new Map<string, ViewEntry>();
  /** Every extension's `contributes.commands`, in load order; read through `commandInfoOf`. */
  private readonly commandInfo: {
    readonly extensionId: string;
    readonly builtIn: boolean;
    readonly command: CommandContribution;
  }[] = [];
  /** The loaded extensions' ids (with how many times each is loaded). */
  private readonly loadedExtensions = new Map<string, number>();
  private readonly menus: { extensionId: string; item: MenuItemContribution }[] = [];
  private readonly containerMenus: { extensionId: string; item: MenuItemContribution }[] = [];
  private readonly welcome: { extensionId: string; entry: ViewWelcomeContribution }[] = [];
  /** Other extensions' `sidebar/navigation` entries (the built-ins' are the host's rows). */
  private readonly navigation: { extensionId: string; item: MenuItemContribution }[] = [];
  /** Other extensions' `titleBar/*` command entries (the built-ins' are the host's items). */
  private readonly titleBar: { extensionId: string; item: TitleBarMenuItemContribution }[] = [];
  /** JSON of the container title actions last published. */
  private containerActionsKey = "";
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

  private get containers(): ViewContainerRegistry {
    return this.options.containers ?? windowViewContainers;
  }

  /** VS Code's `view.<id>.visible`: a drawn copy of the view is on screen. */
  private setVisibleKey(viewId: string, visible: boolean): void {
    try {
      this.options.contextKeys.setHost(`view.${viewId}.visible`, visible ? true : undefined);
    } catch {
      // A view id too long for a context key: `when` can't read it.
    }
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
      const fieldsKey = JSON.stringify(this.fieldsFor(entry, session));
      if (filter !== tree.lastFilter || fieldsKey !== tree.lastFields) {
        tree.lastFilter = filter;
        tree.lastFields = fieldsKey;
        tree.filterChanged.fire(filter);
      }
      if (entry.searchInput) {
        const input = this.inputFor(entry, session);
        if (!tree.lastInput || !sameInput(input, tree.lastInput)) {
          tree.lastInput = input;
          tree.inputChanged.fire(input);
        }
      }
      tree.refresh();
    }
  }

  private fieldsFor(entry: ViewEntry, sessionId: string | undefined) {
    return entry.filterFields.get(sessionKey(sessionId)) ?? fieldValuesOf({}, entry.filterFieldIds);
  }

  private inputFor(entry: ViewEntry, sessionId: string | undefined): RailSearchInputValue {
    return entry.inputs.get(sessionKey(sessionId)) ?? inputValueOf(undefined, entry.searchInput);
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
        trimSessions(view.filters);
        const tree = view.tree;
        if (tree && key === sessionKey(this.currentSession()) && tree.lastFilter !== value) {
          tree.lastFilter = value;
          tree.filterChanged.fire(value);
        }
      },
      getFilterFields: (sessionId: string | undefined) => {
        const view = entry();
        return view ? this.fieldsFor(view, sessionId) : NO_FIELDS;
      },
      setFilterFields: (
        sessionId: string | undefined,
        fields: Readonly<Record<string, string>>,
      ) => {
        const view = entry();
        if (!view || view.filterFieldIds.length === 0) return;
        const key = sessionKey(sessionId);
        const values = fieldValuesOf(fields, view.filterFieldIds);
        view.filterFields.delete(key);
        view.filterFields.set(key, values);
        trimSessions(view.filterFields);
        const tree = view.tree;
        const json = JSON.stringify(values);
        if (tree && key === sessionKey(this.currentSession()) && tree.lastFields !== json) {
          tree.lastFields = json;
          tree.filterChanged.fire(tree.lastFilter);
        }
      },
      navigate: (sessionId: string | undefined, path: string) => {
        const tree = entry()?.tree;
        if (!tree || typeof path !== "string" || path === "") return;
        if (sessionKey(sessionId) !== sessionKey(this.currentSession())) return;
        tree.locationPicked.fire(path.slice(0, 4096));
      },
      reportVisible: () => {
        const view = entry();
        if (!view) return () => {};
        view.shown += 1;
        if (view.shown === 1) {
          view.tree?.visibility.fire({ visible: true });
          view.plan?.visibility.fire({ visible: true });
          this.setVisibleKey(viewId, true);
        }
        this.options.onViewShown?.(viewId);
        let done = false;
        return () => {
          if (done) return;
          done = true;
          view.shown -= 1;
          if (view.shown === 0) {
            view.tree?.visibility.fire({ visible: false });
            view.plan?.visibility.fire({ visible: false });
            if (this.views.get(viewId) === view) this.setVisibleKey(viewId, false);
          }
        };
      },
      runCommand: (command: string, args: readonly unknown[] = []) => {
        this.options.executeCommand(command, args).catch((error: unknown) => {
          this.options.showError(`${command}: ${errorText(error)}`);
        });
      },
      getSearchInput: (sessionId: string | undefined) => {
        const view = entry();
        return view ? this.inputFor(view, sessionId) : inputValueOf(undefined, undefined);
      },
      setSearchInput: (sessionId: string | undefined, value: RailSearchInputValue) => {
        const view = entry();
        if (!view?.searchInput) return;
        const key = sessionKey(sessionId);
        const input = inputValueOf(value, view.searchInput);
        view.inputs.delete(key);
        view.inputs.set(key, input);
        trimSessions(view.inputs);
        const tree = view.tree;
        if (
          tree &&
          key === sessionKey(this.currentSession()) &&
          (!tree.lastInput || !sameInput(tree.lastInput, input))
        ) {
          tree.lastInput = input;
          tree.inputChanged.fire(input);
        }
      },
      acceptSearchInput: (sessionId: string | undefined) => {
        const view = entry();
        const tree = view?.tree;
        if (
          !view?.searchInput ||
          !tree ||
          sessionKey(sessionId) !== sessionKey(this.currentSession())
        ) {
          return;
        }
        if (!tree.canAccept()) return;
        tree.inputAccepted.fire(this.inputFor(view, sessionId));
      },
    });
  }

  /** Registers an extension's views, commands and menus; returns their removal. */
  /** A command's title and icon: a built-in's, or its owner's (see `ownsCommand`). */
  private commandInfoOf(command: string): CommandContribution | undefined {
    const loaded = new Set(this.loadedExtensions.keys());
    return this.commandInfo.find(
      (entry) =>
        entry.command.command === command &&
        (entry.builtIn || ownsCommand(entry.extensionId, command, loaded)),
    )?.command;
  }

  addExtension(
    extensionId: string,
    contributions: ExtensionContributions,
    { builtIn = false }: { builtIn?: boolean } = {},
  ): () => void {
    const added: string[] = [];
    const focusCommands: Disposable[] = [];
    this.loadedExtensions.set(extensionId, (this.loadedExtensions.get(extensionId) ?? 0) + 1);
    for (const command of contributions.commands) {
      // An extension titles only its own commands: another's (a host command, say) keeps
      // its own owner's title and icon, so a menu entry can't pass for something else.
      if (!builtIn && commandIdProblem(extensionId, command.command) !== undefined) {
        console.warn(
          `[omnigent-extensions] ${extensionId}: contributes.commands ${command.command} is not one of its commands; ignoring it`,
        );
        continue;
      }
      this.commandInfo.push({ extensionId, builtIn, command });
    }
    for (const submenu of contributions.submenus) {
      if (!this.submenus.has(submenu.id)) this.submenus.set(submenu.id, submenu);
    }
    for (const item of contributions.viewTitleMenu) this.menus.push({ extensionId, item });
    for (const item of contributions.viewContainerTitleMenu) {
      this.containerMenus.push({ extensionId, item });
    }
    for (const entry of contributions.viewsWelcome) this.welcome.push({ extensionId, entry });
    if (!builtIn) {
      // The built-in entries' ids are the host's rows: another extension's entry can't take one.
      const reserved = new Set(builtInNavigationEntries().map((entry) => entry.id.toLowerCase()));
      for (const item of contributions.navigationMenu) {
        if (reserved.has(item.command.toLowerCase())) {
          console.warn(
            `[omnigent-extensions] ${extensionId}: sidebar/navigation entry ${item.command} is a built-in entry; ignoring it`,
          );
          continue;
        }
        // One entry per command and extension; which one draws is chosen as they publish.
        const listed = this.navigation.some(
          (entry) => entry.extensionId === extensionId && entry.item.command === item.command,
        );
        if (!listed) this.navigation.push({ extensionId, item });
      }
      for (const item of contributions.titleBarMenu) {
        // One entry per command, region and extension; which one draws is chosen as they publish.
        const listed = this.titleBar.some(
          (entry) =>
            entry.extensionId === extensionId &&
            entry.item.command === item.command &&
            entry.item.region === item.region,
        );
        if (item.command !== "" && !listed) this.titleBar.push({ extensionId, item });
      }
    }
    const removeContainers = contributions.viewsContainers.map((container) =>
      this.containers.register({ ...container, extensionId, builtIn }),
    );
    for (const view of contributions.views) {
      if (this.views.has(view.id) || this.options.registry.get(view.id)) {
        console.warn(`[omnigent-extensions] ${extensionId}: view ${view.id} already exists`);
        continue;
      }
      if (!this.containers.get(view.containerId)) {
        console.warn(
          `[omnigent-extensions] ${extensionId}: unknown view container "${view.containerId}" for view ${view.id}; ignoring it`,
        );
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
          ...(view.searchInput === undefined ? {} : { searchInput: view.searchInput }),
          ...(view.location ? { locationBar: true } : {}),
          containerId: view.containerId,
          ...(view.when === undefined ? {} : { when: view.when }),
          ...(view.visibility === undefined ? {} : { visibility: view.visibility }),
          ...(view.contextualTitle === undefined ? {} : { contextualTitle: view.contextualTitle }),
          ...(view.initialSize === undefined ? {} : { initialSize: view.initialSize }),
          ...(view.builtInView === undefined ? {} : { builtInView: view.builtInView }),
        },
        view.order,
      );
      const entry: ViewEntry = {
        extensionId,
        handle,
        actionsKey: "",
        welcomeKey: "[]",
        tree: undefined,
        plan: undefined,
        shown: 0,
        filters: new Map(),
        filterFields: new Map(),
        filterFieldIds: (view.filter?.fields ?? []).map((field) => field.id),
        searchInput: view.searchInput,
        inputs: new Map(),
        progress: [],
      };
      this.views.set(view.id, entry);
      handle.update({
        host: this.viewHost(view.id, () => (this.views.get(view.id) === entry ? entry : undefined)),
      });
      added.push(view.id);
      const focus = this.options.registerFocusCommand?.(
        extensionId,
        `${view.id}.focus`,
        view.id,
        builtIn,
      );
      if (focus) focusCommands.push(focus);
    }
    this.refreshActions();
    return () => {
      for (const remove of removeContainers) remove();
      for (let index = this.containerMenus.length - 1; index >= 0; index -= 1) {
        if (this.containerMenus[index].extensionId === extensionId) {
          this.containerMenus.splice(index, 1);
        }
      }
      for (let index = this.welcome.length - 1; index >= 0; index -= 1) {
        if (this.welcome[index].extensionId === extensionId) this.welcome.splice(index, 1);
      }
      for (let index = this.navigation.length - 1; index >= 0; index -= 1) {
        if (this.navigation[index].extensionId === extensionId) this.navigation.splice(index, 1);
      }
      for (let index = this.titleBar.length - 1; index >= 0; index -= 1) {
        if (this.titleBar[index].extensionId === extensionId) this.titleBar.splice(index, 1);
      }
      for (const focus of focusCommands) focus.dispose();
      for (const viewId of added) {
        if ((this.views.get(viewId)?.shown ?? 0) > 0) this.setVisibleKey(viewId, false);
        this.views.get(viewId)?.handle.dispose();
        this.views.delete(viewId);
      }
      for (let index = this.commandInfo.length - 1; index >= 0; index -= 1) {
        if (contributions.commands.includes(this.commandInfo[index]!.command)) {
          this.commandInfo.splice(index, 1);
        }
      }
      const loads = (this.loadedExtensions.get(extensionId) ?? 1) - 1;
      if (loads > 0) this.loadedExtensions.set(extensionId, loads);
      else this.loadedExtensions.delete(extensionId);
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

  /**
   * Shows `title` as progress in `viewId` (a view of `extensionId`) until the
   * returned function is called; throws for a view it did not contribute.
   */
  beginProgress(extensionId: string, viewId: string, title: string): () => void {
    const entry = this.views.get(viewId);
    if (!entry || entry.extensionId !== extensionId) {
      throw new Error(`no view with id '${viewId}' is contributed by ${extensionId}`);
    }
    const progress: RailViewProgress = Object.freeze({
      title: title.slice(0, MAX_VIEW_TEXT),
      sessionId: this.currentSession(),
    });
    entry.progress.push(progress);
    entry.handle.update({ progress: Object.freeze([...entry.progress]) });
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const index = entry.progress.indexOf(progress);
      if (index >= 0) entry.progress.splice(index, 1);
      entry.handle.update({ progress: Object.freeze([...entry.progress]) });
    };
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
    return this.menuActions(this.menus, { view: viewId });
  }

  /** The viewContainer/title actions of `containerId` under the current context keys. */
  containerTitleActions(containerId: string): RailViewTitleAction[] {
    return this.menuActions(this.containerMenus, { viewContainer: containerId });
  }

  private menuActions(
    menus: readonly { extensionId: string; item: MenuItemContribution }[],
    overrides: Readonly<Record<string, string>>,
  ): RailViewTitleAction[] {
    const lookup = this.options.contextKeys.lookup(overrides);
    const actions: RailViewTitleAction[] = [];
    for (const { extensionId, item } of menus) {
      const tooltipKeys = tooltipLookup(extensionId, lookup);
      // "navigation" is the title bar and "filter" the filter row; other groups
      // would need an overflow menu.
      if (item.group !== "navigation" && item.group !== "filter") continue;
      if (item.when && !item.when.evaluate(lookup)) continue;
      const id = item.submenu ?? item.command;
      if (actions.some((action) => action.id === id)) continue;
      if (id === TOGGLE_FILTER_FIELDS_COMMAND || id === OPEN_IN_SUBMENU) {
        // Controls the host draws itself: the filter's fields toggle, the Open In menu.
        actions.push({
          id,
          kind: id === OPEN_IN_SUBMENU ? "openIn" : "filterFields",
          title: id === OPEN_IN_SUBMENU ? "Open in" : "Files to include / exclude",
          tooltip: interpolate(item.tooltip, tooltipKeys),
          icon: undefined,
          toggled: undefined,
          tone: undefined,
          group: item.group,
          run: () => Promise.resolve(),
        });
        continue;
      }
      if (item.submenu !== undefined) {
        const submenu = this.submenus.get(item.submenu);
        if (!submenu) continue;
        const items: RailViewMenuItem[] = submenu.items
          .filter(
            (entry) => entry.submenu === undefined && (!entry.when || entry.when.evaluate(lookup)),
          )
          .map((entry) => {
            const info = this.commandInfoOf(entry.command);
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
          tooltip: interpolate(item.tooltip, tooltipKeys) ?? submenu.tooltip,
          icon: submenu.icon,
          toggled: undefined,
          tone: item.tone,
          group: item.group,
          run: () => Promise.resolve(),
          items,
        });
        continue;
      }
      const info = this.commandInfoOf(item.command);
      const title = info?.title ?? item.command;
      actions.push({
        id,
        title,
        tooltip: interpolate(item.tooltip, tooltipKeys),
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
    const lookup = this.options.contextKeys.lookup();
    for (const [viewId, entry] of this.views) {
      const actions = this.titleActions(viewId);
      const key = actionsKeyOf(actions);
      if (key !== entry.actionsKey) {
        entry.actionsKey = key;
        entry.handle.update({ actions });
      }
      const view = this.options.registry.get(viewId);
      // A view's `when` and its welcome blocks follow the context keys.
      const active = !view?.when || view.when.evaluate(lookup);
      const welcome = this.welcome
        .filter(
          ({ entry: block }) =>
            block.view === viewId && (!block.when || block.when.evaluate(lookup)),
        )
        .map(({ entry: block }) => block.contents);
      const welcomeKey = JSON.stringify(welcome);
      if (welcomeKey !== entry.welcomeKey) {
        entry.welcomeKey = welcomeKey;
        entry.handle.update({ welcome: Object.freeze(welcome.map((contents) => ({ contents }))) });
      }
      entry.handle.update({ active });
    }
    const holds = (item: { readonly when?: WhenClause | undefined }) =>
      !item.when || item.when.evaluate(lookup);
    const loaded = new Set(this.loadedExtensions.keys());
    (this.options.navigation ?? contributedNavigation).set(
      oneEntryPerCommand(this.navigation, (item) => item.command, holds, loaded).map(
        ({ extensionId, item }) => {
          const info = this.commandInfoOf(item.command);
          return {
            id: item.command,
            title: info?.title ?? item.command,
            icon: info?.icon,
            when: item.when,
            extensionId,
            builtIn: false,
            active: !item.when || item.when.evaluate(lookup),
          };
        },
      ),
    );
    (this.options.titleBar ?? contributedTitleBarEntries).set(
      capPerExtension(
        oneEntryPerCommand(
          this.titleBar,
          (item) => `${item.region}\n${item.command}`,
          holds,
          loaded,
        ),
        MAX_TITLE_BAR_ITEMS_PER_EXTENSION,
      )
        .sort((left, right) => compareTitleBarEntries(left.item, right.item))
        .map(({ extensionId, item }) => {
          const info = this.commandInfoOf(item.command);
          return {
            region: item.region,
            command: item.command,
            builtInItem: undefined,
            title: info?.title ?? item.command,
            icon: info?.icon,
            // Another extension's command keeps its owner's words: no tooltip of the entry's.
            tooltip: ownsCommand(extensionId, item.command, loaded) ? item.tooltip : undefined,
            when: item.when,
            extensionId,
            group: item.group,
            active: !item.when || item.when.evaluate(lookup),
          };
        }),
    );
    const containerActions = new Map<string, readonly RailViewTitleAction[]>();
    for (const container of this.containers.getSnapshot().containers) {
      const actions = this.containerTitleActions(container.id);
      if (actions.length > 0) containerActions.set(container.id, Object.freeze(actions));
    }
    const containerKey = JSON.stringify(
      [...containerActions].map(([id, actions]) => [id, actionsKeyOf(actions)]),
    );
    if (containerKey !== this.containerActionsKey) {
      this.containerActionsKey = containerKey;
      this.containers.setTitleActions(containerActions);
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
    if (entry.tree !== undefined || entry.plan !== undefined) {
      throw new Error(`view '${viewId}' already has a tree or plan view`);
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
      locationPicked: new EventEmitter((error) =>
        logError("onDidChangeLocation listener threw", error),
      ),
      lastFields: JSON.stringify(this.fieldsFor(entry, this.currentSession())),
      visibility: new EventEmitter((error) =>
        logError("onDidChangeVisibility listener threw", error),
      ),
      filterChanged: new EventEmitter((error) =>
        logError("onDidChangeFilter listener threw", error),
      ),
      lastFilter: entry.filters.get(sessionKey(this.currentSession())) ?? "",
      inputChanged: new EventEmitter((error) => logError("onDidChangeValue listener threw", error)),
      inputAccepted: new EventEmitter((error) => logError("onDidAccept listener threw", error)),
      lastInput: entry.searchInput ? this.inputFor(entry, this.currentSession()) : undefined,
      canAccept: () => inputState.enabled && inputState.validationMessage === undefined,
      refresh: tree.refresh,
    };
    const inputState: { validationMessage: string | undefined; enabled: boolean } = {
      validationMessage: undefined,
      enabled: true,
    };
    const updateInput = () => {
      if (disposed) return;
      entry.handle.update({
        searchValidation: inputState.validationMessage,
        searchEnabled: inputState.enabled,
      });
    };
    const searchInput: omnigent.ViewSearchInput | undefined = entry.searchInput
      ? {
          get value() {
            return disposed ? inputValueOf(undefined, entry.searchInput) : currentInput();
          },
          onDidChangeValue: treeEntry.inputChanged.event,
          onDidAccept: treeEntry.inputAccepted.event,
          get validationMessage() {
            return inputState.validationMessage;
          },
          set validationMessage(value) {
            inputState.validationMessage = textOf(value, MAX_VALIDATION) || undefined;
            updateInput();
          },
          get enabled() {
            return inputState.enabled;
          },
          set enabled(value) {
            inputState.enabled = value !== false;
            updateInput();
          },
        }
      : undefined;
    let presentation: "tree" | "graph" = "tree";
    let location: RailViewLocation | undefined;
    let filterRevision = 0;
    const selectionChanged = new EventEmitter<omnigent.TreeViewSelectionChangeEvent<T>>((error) =>
      logError("onDidChangeSelection listener threw", error),
    );
    const stopSelection = tree.onSelection((selection) => {
      if (!disposed) selectionChanged.fire(Object.freeze({ selection }));
    });
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
    const currentInput = () => this.inputFor(entry, currentSession());
    const currentFields = () => this.fieldsFor(entry, currentSession());
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
        const previous = badgeOf(state.badge);
        if (
          badge?.value === previous?.value &&
          badge?.tooltip === previous?.tooltip &&
          badge?.label === previous?.label &&
          badge?.tone === previous?.tone
        ) {
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
      setFilter: (text: string) => {
        if (disposed) return;
        const session = currentSession();
        const key = sessionKey(session);
        const value = String(text ?? "").slice(0, MAX_FILTER);
        if ((entry.filters.get(key) ?? "") === value) return;
        entry.filters.delete(key);
        if (value !== "") entry.filters.set(key, value);
        trimSessions(entry.filters);
        filterRevision += 1;
        entry.handle.update({ filterRevision });
        if (treeEntry.lastFilter !== value) {
          treeEntry.lastFilter = value;
          treeEntry.filterChanged.fire(value);
        }
      },
      get filterFields() {
        return disposed ? NO_FIELDS : currentFields();
      },
      get selection() {
        return disposed ? Object.freeze([]) : tree.selection();
      },
      onDidChangeSelection: selectionChanged.event,
      reveal: (element: T, revealOptions?: omnigent.TreeViewRevealOptions) =>
        disposed
          ? Promise.reject(new Error("the tree view was disposed"))
          : tree.reveal(element, revealOptions, currentSession()),
      get location() {
        return location;
      },
      set location(value) {
        location = locationOf(value);
        if (!disposed) entry.handle.update({ location });
      },
      onDidChangeLocation: treeEntry.locationPicked.event,
      searchInput,
      get presentation() {
        return presentation;
      },
      set presentation(value) {
        presentation = value === "graph" ? "graph" : "tree";
        if (!disposed) entry.handle.update({ presentation });
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        tree.dispose();
        stopSelection();
        selectionChanged.dispose();
        treeEntry.locationPicked.dispose();
        treeEntry.visibility.dispose();
        treeEntry.filterChanged.dispose();
        treeEntry.inputChanged.dispose();
        treeEntry.inputAccepted.dispose();
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
            searchValidation: undefined,
            searchEnabled: true,
            presentation: "tree",
            location: undefined,
          });
        }
      },
    };
    return view;
  }

  /** `window.createPlanView` for `extensionId`; throws for a view it did not contribute. */
  createPlanView(
    extensionId: string,
    viewId: string,
    logError: (message: string, error?: unknown) => void,
  ): omnigent.PlanView {
    const entry = this.views.get(viewId);
    if (!entry || entry.extensionId !== extensionId) {
      throw new Error(`no view with id '${viewId}' is contributed by ${extensionId}`);
    }
    if (entry.tree !== undefined || entry.plan !== undefined) {
      throw new Error(`view '${viewId}' already has a tree or plan view`);
    }
    return this.createPlanContent(entry, logError);
  }

  /** `window.createPullRequestView` for `extensionId`; throws for a view it did not contribute. */
  createPullRequestView(
    extensionId: string,
    viewId: string,
    logError: (message: string, error?: unknown) => void,
  ): omnigent.PullRequestView {
    const entry = this.views.get(viewId);
    if (!entry || entry.extensionId !== extensionId) {
      throw new Error(`no view with id '${viewId}' is contributed by ${extensionId}`);
    }
    if (entry.tree !== undefined || entry.plan !== undefined) {
      throw new Error(`view '${viewId}' already has content`);
    }
    // The plan slot carries any host-drawn content's visibility.
    const contentEntry = {
      visibility: new EventEmitter<omnigent.TreeViewVisibilityChangeEvent>((error) =>
        logError("onDidChangeVisibility listener threw", error),
      ),
    };
    entry.plan = contentEntry;
    let content = pullRequestContentOf(undefined);
    let disposed = false;
    let bySession: ReadonlyMap<string, omnigent.PullRequestViewContent> = new Map();
    entry.handle.update({ pullRequests: content, pullRequestsBySession: bySession });
    return {
      get content() {
        return content;
      },
      set content(value) {
        if (disposed) return;
        content = pullRequestContentOf(value, logError);
        if (content.kind === "pullRequests") {
          const next = new Map(bySession);
          next.delete(content.sessionId);
          next.set(content.sessionId, content);
          for (const oldest of next.keys()) {
            if (next.size <= MAX_PLAN_SNAPSHOTS) break;
            next.delete(oldest);
          }
          bySession = next;
        }
        entry.handle.update({ pullRequests: content, pullRequestsBySession: bySession });
      },
      get visible() {
        return !disposed && entry.shown > 0;
      },
      onDidChangeVisibility: contentEntry.visibility.event,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        contentEntry.visibility.dispose();
        if (entry.plan === contentEntry) {
          entry.plan = undefined;
          entry.handle.update({ pullRequests: undefined, pullRequestsBySession: new Map() });
        }
      },
    };
  }

  private createPlanContent(
    entry: ViewEntry,
    logError: (message: string, error?: unknown) => void,
  ): omnigent.PlanView {
    const planEntry = {
      visibility: new EventEmitter<omnigent.TreeViewVisibilityChangeEvent>((error) =>
        logError("onDidChangeVisibility listener threw", error),
      ),
    };
    entry.plan = planEntry;
    let content = planContentOf(undefined);
    let disposed = false;
    // Each session's last content, so every grid cell draws its own session's plan.
    let bySession: ReadonlyMap<string, omnigent.PlanViewContent> = new Map();
    entry.handle.update({ plan: content, planBySession: bySession });
    return {
      get content() {
        return content;
      },
      set content(value) {
        if (disposed) return;
        content = planContentOf(value, logError);
        const sessionId = content.kind === "loading" ? undefined : content.sessionId;
        if (sessionId !== undefined) {
          const next = new Map(bySession);
          next.delete(sessionId);
          next.set(sessionId, content);
          for (const oldest of next.keys()) {
            if (next.size <= MAX_PLAN_SNAPSHOTS) break;
            next.delete(oldest);
          }
          bySession = next;
        }
        entry.handle.update({ plan: content, planBySession: bySession });
      },
      get visible() {
        return !disposed && entry.shown > 0;
      },
      onDidChangeVisibility: planEntry.visibility.event,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        planEntry.visibility.dispose();
        if (entry.plan === planEntry) {
          entry.plan = undefined;
          entry.handle.update({ plan: undefined, planBySession: new Map() });
        }
      },
    };
  }

  dispose(): void {
    this.unsubscribe();
  }
}
