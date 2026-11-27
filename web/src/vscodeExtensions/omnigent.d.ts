/**
 * Type definitions for the Omnigent web extension API (prototype).
 *
 * Modeled on `@types/vscode`. An extension imports the API the same way a VS
 * Code extension imports `vscode`:
 *
 * ```js
 * import * as omnigent from "omnigent";
 *
 * export function activate(context) {
 *   const item = omnigent.window.createSessionHeaderItem("cost");
 *   context.subscriptions.push(item);
 * }
 * ```
 *
 * The host resolves `"omnigent"` to an API instance bound to the importing
 * extension. Everything here is either an event or a plain-data call: no React
 * components, DOM nodes or store objects cross this boundary, so the host can
 * later move extensions into a Worker without changing extension code.
 *
 * This file is the source of truth. Extensions vendor a copy until the typings
 * are published as a package.
 */
declare module "omnigent" {
  /** The version of the API described by this file. */
  export const version: string;

  /**
   * Represents a type which can release resources, such as event listening or a
   * header item. Same shape and semantics as `vscode.Disposable`.
   */
  export class Disposable {
    /**
     * Combine many disposable-likes into one. Disposing the result disposes all
     * of them, in order, exactly once.
     */
    static from(...disposableLikes: { dispose: () => unknown }[]): Disposable;

    /** @param callOnDispose Function that disposes something. Called at most once. */
    constructor(callOnDispose: () => unknown);

    /** Dispose this object. Calling it again is a no-op. */
    dispose(): unknown;
  }

  /**
   * Represents a typed event. A function that you call with a listener to
   * subscribe; it returns a {@link Disposable} that removes the listener.
   *
   * @param listener The listener function, called when the event fires.
   * @param thisArgs The `this` argument used when calling the listener.
   * @param disposables An array to which the returned {@link Disposable} is added.
   */
  export interface Event<T> {
    (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]): Disposable;
  }

  /** Create and fire your own {@link Event}s. Same semantics as `vscode.EventEmitter`. */
  export class EventEmitter<T> {
    /** The event listeners can subscribe to. */
    event: Event<T>;
    /** Notify all subscribers. A listener that throws does not stop the others. */
    fire(data: T): void;
    /** Remove all listeners. Firing afterwards is a no-op. */
    dispose(): void;
  }

  /** Tells a running operation to stop, as `vscode.CancellationToken`. */
  export interface CancellationToken {
    /** True once cancellation was requested. */
    readonly isCancellationRequested: boolean;
    /** Fires once, when cancellation is requested. */
    readonly onCancellationRequested: Event<unknown>;
  }

  /** Creates and cancels a {@link CancellationToken}, as `vscode.CancellationTokenSource`. */
  export class CancellationTokenSource {
    readonly token: CancellationToken;
    /** Request cancellation; calling it again is a no-op. */
    cancel(): void;
    dispose(): void;
  }

  /** Something an extension can clean up, as accepted by `ExtensionContext.subscriptions`. */
  export interface DisposableLike {
    dispose: () => unknown;
  }

  /** The extension as the host knows it. */
  export interface Extension {
    /** `publisher.name`, as in VS Code. */
    readonly id: string;
    /** The extension's `package.json` `version`. */
    readonly version: string;
  }

  /**
   * A key-value store, as `vscode.Memento`. Values are JSON data; `get` returns
   * a copy, so changing it does not change what is stored.
   */
  export interface Memento {
    /** The stored keys. */
    keys: () => readonly string[];
    /** The value stored under `key`, or `defaultValue` when there is none. */
    get: {
      <T>(key: string): T | undefined;
      <T>(key: string, defaultValue: T): T;
    };
    /**
     * Store `value` (JSON) under `key`; `undefined` removes the key. Rejects when
     * no chat session is open, the value is not JSON, or the store is full (50
     * keys and 8 KiB of JSON per extension and chat session).
     */
    update: (key: string, value: unknown) => Promise<void>;
  }

  /** Passed to an extension's `activate` function. */
  export interface ExtensionContext {
    /** Disposed, in order, when the extension is deactivated. */
    readonly subscriptions: DisposableLike[];
    readonly extension: Extension;
    /**
     * Values kept per chat session, unlike VS Code's per-workspace state: each
     * call reads or writes the memento of the session on screen at that moment
     * (see {@link workspace.activeSessionId}). It lives in this browser's storage,
     * with the session's other UI state, for the 100 most recent sessions.
     */
    readonly workspaceState: Memento;
  }

  /** Which end of the session header slot an item sits at. */
  export enum SessionHeaderItemAlignment {
    /** Toward the left edge of the slot. */
    Left = 1,
    /** Toward the anchor (the agent info button) at the right edge of the slot. */
    Right = 2,
  }

  /**
   * A short text item in the chat header, shown to the left of the agent info
   * button on desktop. Like a VS Code status bar item: one per window, not per
   * session; update its text when the active session changes.
   */
  export interface SessionHeaderItem {
    /** `<extension id>.<id>`; the id given at creation or a generated one. */
    readonly id: string;
    readonly alignment: SessionHeaderItemAlignment;
    /** Higher priority sits closer to its alignment's edge. */
    readonly priority: number | undefined;
    /** Plain text, single line. The host truncates it to 40 characters. */
    text: string;
    /** Plain text tooltip. The host truncates it to 200 characters. */
    tooltip: string | undefined;
    /**
     * The text's colour: a {@link ThemeColor} (drawn as its token, so it follows the
     * theme), or a CSS colour that reads registry tokens only. Unknown theme colours
     * and other values are dropped with a warning; undefined is the host's own colour.
     */
    color: string | ThemeColor | undefined;
    /** Show the item. New items are hidden until shown. */
    show: () => void;
    hide: () => void;
    /** Remove the item for good. */
    dispose: () => void;
  }

  /** Which region of the title bar an item sits in (layout plan L7). */
  export type TitleBarRegion = "left" | "center" | "right";

  /**
   * A short text item in the title bar, as VS Code's status bar item: one per window, shown
   * once the title bar is on (`window.titleBar.visible`). Clicking it runs its command.
   */
  export interface TitleBarItem {
    /** `<extension id>.<id>`; the id given at creation or a generated one. */
    readonly id: string;
    readonly region: TitleBarRegion;
    /** Higher priority sits further left within its region. */
    readonly priority: number | undefined;
    /** Plain text, single line. The host truncates it to 40 characters. */
    text: string;
    /** Plain text tooltip. The host truncates it to 200 characters. */
    tooltip: string | undefined;
    /** As {@link SessionHeaderItem.color}. */
    color: string | ThemeColor | undefined;
    /** The command run on click: its id, or a {@link Command} with arguments. */
    command: string | Command | undefined;
    /** Show the item. New items are hidden until shown. */
    show: () => void;
    hide: () => void;
    /** Remove the item for good. */
    dispose: () => void;
  }

  /**
   * A colour of the theme by id, as `vscode.ThemeColor`: a registry token id
   * (`muted-foreground`, `primary`, ...) or one of this extension's own
   * `contributes.colors` (`<extension id>.<name>`, or its short id).
   */
  export class ThemeColor {
    readonly id: string;
    constructor(id: string);
  }

  /** A theme's kind, as `vscode.ColorThemeKind`. Omnigent's themes are Light or Dark for now. */
  export enum ColorThemeKind {
    Light = 1,
    Dark = 2,
    HighContrast = 3,
    HighContrastLight = 4,
  }

  /** The colour theme on screen, as plain data. */
  export interface ColorTheme {
    /** The theme on screen: `<extension id>/<theme id>` (a family's member for the mode). */
    readonly id: string;
    readonly label: string;
    readonly kind: ColorThemeKind;
    /** The chosen theme's option choices (choice id by option id); empty for a built-in palette. */
    readonly options: Readonly<Record<string, string>>;
    /** The style variants that apply (the theme's, the user's over them), by name. */
    readonly variants: Readonly<Record<string, string>>;
  }

  /** How a tree item shows its children, as `vscode.TreeItemCollapsibleState`. */
  export enum TreeItemCollapsibleState {
    /** A leaf. */
    None = 0,
    Collapsed = 1,
    Expanded = 2,
  }

  /**
   * What a tree item stands for, as plain data: a workspace file or folder
   * (`scheme` "file", the default) or a chat session (`scheme` "session", with
   * the session id as `path`).
   */
  export interface ResourceUri {
    readonly scheme?: "file" | "session";
    readonly path: string;
  }

  /** A label with highlighted ranges, as `vscode.TreeItemLabel`. */
  export interface TreeItemLabel {
    label: string;
    /** `[start, end)` offsets into `label`, at most 32. */
    highlights?: [number, number][];
  }

  /** The agent whose icon a row shows: an agent name and the harness it runs on. */
  export interface AgentIcon {
    readonly agent: string;
    readonly harness?: string | null;
  }

  /** How busy or settled an agent is, as the Agents tab draws it. */
  export type AgentState =
    "launching" | "working" | "awaiting" | "done" | "failed" | "disconnected" | "idle" | "other";

  /** The status of an agent session; drawn as a status tile or dot. */
  export interface AgentStatus {
    readonly state: AgentState;
    /** Short human label, such as "Working" or "Needs response". */
    readonly label: string;
    /** More detail, such as the first line of an error. */
    readonly detail?: string;
  }

  /** A command a tree item runs when clicked, as `vscode.Command`. */
  export interface Command {
    command: string;
    title?: string;
    /** Copied as JSON. */
    arguments?: unknown[];
  }

  /** One styled piece of a {@link TreeItemDecoration}. */
  export interface TreeItemDecorationPart {
    text: string;
    tone?: "added" | "removed" | "muted";
    /** Shown on hover. */
    tooltip?: string;
  }

  /**
   * Trailing text of a row, such as a diffstat. `parts` (up to 8, 24 characters
   * each) win over `text`; `title` is its accessible label.
   */
  export interface TreeItemDecoration {
    text?: string;
    parts?: TreeItemDecorationPart[];
    title?: string;
  }

  /**
   * One row of a tree view, as `vscode.TreeItem`, in plain data. A row with a
   * `resourceUri` is drawn like the Files tree (a folder when it has children
   * and `iconPath` is "folder"), or like the Changes list when it has a
   * `description` and no children.
   */
  export interface TreeItem {
    /** Names the item across refreshes; expand state is kept by it. */
    id?: string;
    /**
     * Defaults to the last segment of `resourceUri`. A file row whose label
     * holds a `/` is drawn as a path, truncated at its start.
     */
    label?: string | TreeItemLabel;
    /** Muted text after the label; `true` uses the folder of `resourceUri`. */
    description?: string | boolean;
    tooltip?: string;
    resourceUri?: ResourceUri;
    /**
     * "file" or "folder" for the file icon of `resourceUri`, an icon name from
     * the allowlist, or an agent's icon (its harness logo when it has one).
     */
    iconPath?: string | AgentIcon;
    decoration?: TreeItemDecoration;
    /** Drawn as the A/M/D letter of a file, or the dot of a folder. */
    gitStatus?: "added" | "modified" | "deleted";
    collapsibleState?: TreeItemCollapsibleState;
    /**
     * Runs when the row is clicked. A collapsible folder row expands on a
     * click and runs its command on a double click. An item with neither a
     * command nor a `resourceUri` is drawn as a muted placeholder line (such as
     * "Loading…" under a folder).
     */
    command?: Command;
    contextValue?: string;
    /** Size of the resource in bytes, drawn like the Changes list's file size. */
    size?: number;
    /**
     * The line of `resourceUri` the row stands for (1-based). The row is drawn
     * as a text match: the line number, then the label in monospace with its
     * highlights marked.
     */
    line?: number;
    /** The row's accessible name, as `vscode.AccessibilityInformation`. */
    accessibilityInformation?: { label: string };
    /**
     * An agent's status, for a row whose `resourceUri` is a session: drawn as
     * a status tile in the list and a dot in the graph; settled states (done,
     * idle) are dimmed.
     */
    status?: AgentStatus;
  }

  /** Provides a tree view's data, as `vscode.TreeDataProvider`. */
  export interface TreeDataProvider<T> {
    /** Fire it when the data changes; the view reloads what it shows. */
    onDidChangeTreeData?: Event<T | T[] | undefined | null | void>;
    getTreeItem: (element: T) => TreeItem | Promise<TreeItem>;
    /**
     * The roots when `element` is undefined. Called when a node is expanded, so
     * a folder can load its children then (lazily) and fire
     * `onDidChangeTreeData` once they arrived.
     */
    getChildren: (element?: T) => T[] | null | undefined | Promise<T[] | null | undefined>;
    /** The parent of `element`, or undefined for a root; needed by {@link TreeView.reveal}. */
    getParent?: (element: T) => T | null | undefined | Promise<T | null | undefined>;
  }

  export interface TreeViewOptions<T> {
    treeDataProvider: TreeDataProvider<T>;
  }

  /** A count on a view's tab, as `vscode.ViewBadge`. */
  export interface ViewBadge {
    readonly value: number;
    readonly tooltip: string;
    /** Text drawn instead of `value`, such as "2/5". */
    readonly label?: string;
    /** "success" or "muted" draws the badge in that color. */
    readonly tone?: "success" | "muted";
  }

  /**
   * The text of a view's search input (a view that contributes `searchInput`):
   * the query, its option toggles and its extra fields, by the ids the
   * contribution names.
   */
  export interface SearchInputValue {
    readonly query: string;
    readonly options: Readonly<Record<string, boolean>>;
    readonly fields: Readonly<Record<string, string>>;
  }

  /**
   * A host-drawn query form at the top of a view, like the input box of a
   * `vscode.SourceControl`. Its value is kept per chat session.
   */
  export interface ViewSearchInput {
    /** The value for the workspace on screen. */
    readonly value: SearchInputValue;
    /** Fires on every edit, and when another workspace comes on screen. */
    readonly onDidChangeValue: Event<SearchInputValue>;
    /** Fires when the user submits (Enter, or the submit button) while it is enabled. */
    readonly onDidAccept: Event<SearchInputValue>;
    /** Shown below the input as an alert; while set, submitting does nothing. */
    validationMessage: string | undefined;
    /** Whether submitting is possible; the submit button is disabled while false. */
    enabled: boolean;
  }

  /** As `vscode.TreeViewVisibilityChangeEvent`. */
  export interface TreeViewVisibilityChangeEvent {
    readonly visible: boolean;
  }

  /**
   * A state the host draws in place of a view's rows, the same way for every
   * workspace view: the agent is asleep (a message reconnects it), the session's
   * sandbox is offline, or it is starting.
   */
  export type ViewNotice = "agentAsleep" | "sandboxOffline" | "sandboxStarting";

  /** A small pill after a view's title, such as "Asleep". */
  export interface ViewTag {
    readonly text: string;
    readonly tooltip?: string;
    /** An icon name from the allowlist. */
    readonly icon?: string;
  }

  /** As `vscode.TreeViewSelectionChangeEvent`. */
  export interface TreeViewSelectionChangeEvent<T> {
    readonly selection: readonly T[];
  }

  /** Options of {@link TreeView.reveal}, as in VS Code. */
  export interface TreeViewRevealOptions {
    /** Select the element (the default). */
    readonly select?: boolean;
    /** Move keyboard focus to its row. */
    readonly focus?: boolean;
    /** Expand the element too; a number expands that many levels below it (at most 3). */
    readonly expand?: boolean | number;
  }

  /**
   * The folder a view browses, drawn by the host as its location bar in place
   * of the title (a view that contributes `location: true`): the folder's name
   * or path, Back one folder, Back to working folder, and, where the session
   * may browse its host, a folder picker. Both paths are absolute.
   * `location: true` is honored for built-in extensions only.
   */
  export interface ViewLocation {
    readonly path: string;
    /** The workspace root, for Back to working folder. */
    readonly root: string;
    /** Shown under the path, as when the folder cannot be read. */
    readonly error?: string;
  }

  /** A tree view, as `vscode.TreeView`; plain text everywhere. */
  export interface TreeView<T> {
    /** Shown in the view's title bar; defaults to the contributed name. */
    title: string | undefined;
    /** Muted text next to the title. */
    description: string | undefined;
    /**
     * Shown above the tree, for example when it is empty. Links written as
     * `[text](command:<command id>)` are drawn as buttons that run the command,
     * as in a trusted `vscode.MarkdownString`; everything else is plain text.
     */
    message: string | undefined;
    /** `"error"` draws {@link message} as an error. Defaults to `"info"`. */
    messageSeverity: "info" | "error" | undefined;
    /** A host-drawn state shown instead of the rows and the message. */
    notice: ViewNotice | undefined;
    /** A pill after the title. */
    tag: ViewTag | undefined;
    badge: ViewBadge | undefined;
    /** Whether the view is on screen, as `vscode.TreeView.visible`. */
    readonly visible: boolean;
    readonly onDidChangeVisibility: Event<TreeViewVisibilityChangeEvent>;
    /**
     * The text in the view's filter field (a view that contributes `filter`),
     * for the workspace on screen; `""` when empty. The extension filters its
     * own data with it.
     */
    readonly filter: string;
    /** Fires when the filter text or a filter field changes, also when another workspace comes on screen. */
    readonly onDidChangeFilter: Event<string>;
    /**
     * Sets the filter text for the workspace on screen, as when a result is
     * revealed and the view leaves its search; `onDidChangeFilter` fires.
     */
    setFilter: (text: string) => void;
    /** The values of the filter's extra fields (`filter.fields`), by id, for the workspace on screen. */
    readonly filterFields: Readonly<Record<string, string>>;
    /** The selected elements, as `vscode.TreeView.selection`: a click, the keyboard or `reveal` set it. */
    readonly selection: readonly T[];
    readonly onDidChangeSelection: Event<TreeViewSelectionChangeEvent<T>>;
    /**
     * As `vscode.TreeView.reveal`: expands the element's ancestors, scrolls its
     * row into view with a brief highlight, and selects or focuses it. The
     * provider must implement `getParent`, and the element and its ancestors
     * need a `TreeItem.id`. In the chat session on screen at the call; when the
     * view is not drawn, it is revealed as soon as it is.
     *
     * Resolves once the reveal is queued for the tree, not once the row is on
     * screen. Rejects when the element's or an ancestor's lookup
     * (`getTreeItem`, `getParent`) takes longer than 30 seconds. A queued
     * reveal is dropped when no tree takes it within 30 seconds, when another
     * conversation comes on screen, or when a loaded folder on its path lacks
     * the row.
     */
    reveal: (element: T, options?: TreeViewRevealOptions) => Promise<void>;
    /** The folder the view browses; see {@link ViewLocation}. */
    location: ViewLocation | undefined;
    /** Fires with the absolute path the user picked in the location bar. */
    readonly onDidChangeLocation: Event<string>;
    /** The view's search input, when its contribution has `searchInput`. */
    readonly searchInput: ViewSearchInput | undefined;
    /**
     * How the host draws the rows: as a tree (the default), or as a graph of
     * cards, every node expanded, for trees of sessions.
     */
    presentation: "tree" | "graph";
    /** Removes the data provider; the view stays, without data. */
    dispose: () => void;
  }

  /** Options for {@link window.withProgress}. Progress shows as a notification. */
  export interface ProgressOptions {
    /** Shown for the whole task, with the latest reported message below it. */
    title: string;
    /**
     * Where the progress shows instead of a notification. A failure is not
     * shown at either location.
     *
     * - `{ viewId }`: in a view the extension contributes, as
     *   `vscode.ProgressLocation` with a view id: a spinner and the title above
     *   its rows, which are marked busy.
     * - `{ hostId }`: inline at a host, as `vscode.ProgressLocation.Window`
     *   scoped to one host: a small spinner and the title, then the latest
     *   reported message, in the host's badge and host menu.
     */
    location?: { readonly viewId: string } | { readonly hostId: string };
  }

  /** A progress report; only `message` is shown so far. */
  export interface ProgressReport {
    message?: string;
    increment?: number;
  }

  /** Reports progress, as `vscode.Progress`. */
  export interface Progress<T> {
    report: (value: T) => void;
  }

  /** Where a task stands, as the Tasks tab draws it. */
  export type TaskState =
    "waiting" | "ready" | "running" | "stopped" | "needs_input" | "done" | "failed";

  /** One status a task recorded: started, done, waiting for the user or failed. */
  export interface TaskStatus {
    readonly id: string;
    readonly status: "started" | "done" | "needs_input" | "failed";
    /** What the agent wrote with it, if anything. */
    readonly text: string | null;
    /** Epoch seconds. */
    readonly createdAt: number;
    /** It starts a new attempt: a start after the task was done or failed. */
    readonly restart: boolean;
  }

  /** One of a session's tasks: a plan's step, or an item of the agent's own task list. Plain data. */
  export interface SessionTask {
    readonly id: string;
    readonly name: string;
    /** The task's goal, as Markdown. */
    readonly goal: string | null;
    /** The tasks it waits on, by id. */
    readonly dependsOn: readonly string[];
    readonly state: TaskState;
    /** Its newest status; `null` until it has one. */
    readonly status: TaskStatus | null;
    /** When its current attempt first started, in epoch seconds, if it wrote a start. */
    readonly startedAt: number | null;
    /** An item of the agent's own task list, which has no history. */
    readonly native: boolean;
    /** What the agent says it is doing, for an item of its own list in progress. */
    readonly activeForm: string | null;
    /** Every status it recorded, oldest first; empty for the agent's own items. */
    readonly history: readonly TaskStatus[];
    /** The chat marker of its newest status, for `omnigent.showInChat`; none before it starts. */
    readonly chatMarker: string | undefined;
    /** The chat message of a question its agent waits on, while it waits for the user. */
    readonly question: string | undefined;
    /** The failed tasks it waits on, by id, when that is why it cannot start. */
    readonly blockedBy: readonly string[];
  }

  /** The plan a session's tasks come from. */
  export interface SessionPlan {
    /** Its goal in a few words, or `null`. */
    readonly name: string | null;
    /** Epoch seconds. */
    readonly createdAt: number;
    /** The saved workflow it runs or was saved as, or `null`. */
    readonly workflowId: string | null;
    /** That workflow's name, when the user can see it. */
    readonly workflowName: string | undefined;
    /** Its last task finished, so no Stop or Continue applies. */
    readonly complete: boolean;
  }

  /** What the session's composer can do for its tasks, through the `omnigent.tasks.*` commands. */
  export interface SessionTaskActions {
    readonly startWorkflow: boolean;
    readonly saveWorkflow: boolean;
    readonly continuePlan: boolean;
    readonly stopWork: boolean;
    readonly taskAction: boolean;
  }

  /** A session's tasks: its plan's steps, or the agent's own task list without a plan. Plain data. */
  export interface SessionTasks {
    readonly sessionId: string;
    /** True until it is known whether the session has a plan. */
    readonly loading: boolean;
    /** Why the session's journal could not be loaded. */
    readonly error: string | undefined;
    readonly plan: SessionPlan | undefined;
    readonly tasks: readonly SessionTask[];
    /** What an idle list says ("Stopped", "Run ended") while tasks could run. */
    readonly paused: string | undefined;
    /** The session's work is in flight: its turn, a background task or a sub-agent. */
    readonly working: boolean;
    /** A Stop was sent and the session has not stopped yet. */
    readonly stopping: boolean;
    readonly actions: SessionTaskActions;
    /** The Workflows page is on, so a workflow can be opened. */
    readonly workflowsLinked: boolean;
  }

  /** A task's menu entry in a {@link PlanView}: the action its state offers. */
  export interface PlanTaskAction {
    /** Names the entry ("Run", "Continue", "Retry", "Stop") and its icon. */
    readonly action: "run" | "continue" | "proceed" | "retry" | "stop";
    readonly command: Command;
  }

  /** A task as a {@link PlanView} draws it. */
  export interface PlanViewTask {
    readonly task: SessionTask;
    /** Its ⋯ menu, on its row, its card and its graph node. */
    readonly action?: PlanTaskAction;
    /** Runs when its row is clicked ("Show in the chat"). */
    readonly command?: Command;
  }

  /** An entry of a plan's ⋯ menu. */
  export interface PlanMenuItem {
    readonly title: string;
    /** An icon name from the allowlist. */
    readonly icon?: string;
    readonly command: Command;
    /** Shown instead of running it; the entry is drawn disabled. */
    readonly disabledReason?: string;
  }

  /**
   * What a {@link PlanView} shows, drawn by the host. A message may link
   * `[text](command:<id>)` to a command, and `[text](picker:workflow)` to the
   * host's Run a workflow menu, whose choice runs `omnigent.tasks.startWorkflow`.
   */
  export type PlanViewContent =
    | { readonly kind: "loading"; readonly label: string }
    | {
        readonly kind: "error";
        /** The session it is for; a view drawn for another one waits instead. */
        readonly sessionId?: string;
        readonly message: string;
        readonly retry?: Command;
      }
    | {
        readonly kind: "empty";
        readonly sessionId?: string;
        readonly title: string;
        readonly message: string;
        /** An icon name from the allowlist. */
        readonly icon?: string;
      }
    | {
        readonly kind: "plan";
        readonly sessionId: string;
        /** The heading; without one the tab's name is. */
        readonly title?: string;
        /** A chip naming the saved workflow the plan comes from. */
        readonly workflow?: {
          readonly id: string;
          readonly tooltip: string;
          readonly linked: boolean;
        };
        /** When anything last changed, in epoch seconds ("Updated 3m ago"). */
        readonly updatedAt?: number;
        /** "2 of 5 finished". */
        readonly summary: string;
        /** Counts after the summary, in the order given. */
        readonly counts?: readonly { readonly state: TaskState; readonly count: number }[];
        /** "Stopped" or "Run ended". */
        readonly paused?: string;
        /** The plan's Stop, Stopping… or Continue button. */
        readonly runControl?:
          | { readonly kind: "stop" | "play"; readonly command: Command }
          | { readonly kind: "stopping" };
        /** Offers the plan on a graph of its tasks. */
        readonly graph?: boolean;
        readonly menu?: readonly PlanMenuItem[];
        /**
         * The first 1,000 are drawn. A task's goal keeps 200,000 characters (a
         * plan's goals together 4,000,000) and its name 2,000; longer text is cut
         * at a Markdown block boundary, or a word for a name, and ends "(truncated)".
         */
        readonly tasks: readonly PlanViewTask[];
        /** The tasks say what they wait on (a plan's steps), so hovering one links them. */
        readonly dependencies: boolean;
        /** Lists the workflow runs below the session's run of this workflow. */
        readonly runsOfWorkflow?: string;
      };

  /**
   * A view drawn by the host from plain data: a session's tasks, their progress
   * strip and their history. No VS Code equivalent; see the plan doc.
   */
  export interface PlanView {
    content: PlanViewContent;
    /** Whether the view is on screen, as {@link TreeView.visible}. */
    readonly visible: boolean;
    readonly onDidChangeVisibility: Event<TreeViewVisibilityChangeEvent>;
    /** Removes the content; the view stays, without data. */
    dispose: () => void;
  }

  export namespace window {
    /**
     * The committed colour theme: the chosen theme in the chosen mode. A picker's preview
     * of another theme or mode is never reflected, as {@link onDidChangeActiveColorTheme}
     * never fires for one.
     */
    export const activeColorTheme: ColorTheme;

    /**
     * Fires after a committed change of {@link activeColorTheme} is applied: another
     * theme chosen, an option, a variant or a colour customization changed, or the mode
     * switched. Never for a picker's preview of a theme or a mode.
     */
    export const onDidChangeActiveColorTheme: Event<ColorTheme>;

    /**
     * A theme token's resolved value (`getComputedStyle` on the innermost theme root),
     * `""` when unset: a registry token id, or one of this extension's own colours.
     * Undefined, with a warning, for any other id.
     */
    export function getThemeToken(id: string): string | undefined;

    /**
     * Show progress while `task` runs, as a notification with `title` and the
     * latest reported message. It closes when the task resolves; when the task
     * rejects, it shows the error message instead, and the promise rejects.
     *
     * Progress that a Node-side command reports while it runs (through its own
     * `withProgress`) joins the calling extension's latest open progress, or
     * shows as its own notification when there is none.
     */
    export function withProgress<R>(
      options: ProgressOptions,
      task: (progress: Progress<ProgressReport>) => R | Promise<R>,
    ): Promise<R>;

    /** Show a short success or information message. Resolves at once. */
    export function showInformationMessage(message: string): Promise<undefined>;

    /** Show an error message. Resolves at once. */
    export function showErrorMessage(message: string): Promise<undefined>;

    /**
     * Create a session header item.
     *
     * @param id Identifier of the item, unique within the extension.
     * @param alignment Defaults to {@link SessionHeaderItemAlignment.Left}.
     * @param priority Higher sits closer to the alignment's edge.
     */
    export function createSessionHeaderItem(
      id: string,
      alignment?: SessionHeaderItemAlignment,
      priority?: number,
    ): SessionHeaderItem;
    export function createSessionHeaderItem(
      alignment?: SessionHeaderItemAlignment,
      priority?: number,
    ): SessionHeaderItem;

    /**
     * Create a title bar item, as `createStatusBarItem`.
     *
     * @param id Identifier of the item, unique within the extension.
     * @param region Defaults to `"right"`.
     * @param priority Higher sits further left within the region.
     */
    export function createTitleBarItem(
      id?: string,
      region?: TitleBarRegion,
      priority?: number,
    ): TitleBarItem;

    /**
     * Give a view the extension contributes (`contributes.views`) its data. Its
     * rows are drawn by the host, windowed, with expand state kept per view and
     * chat session. Throws for a view the extension did not contribute.
     */
    export function createTreeView<T>(viewId: string, options: TreeViewOptions<T>): TreeView<T>;

    /**
     * Give a view the extension contributes a plan's content, drawn by the
     * host. Throws for a view the extension did not contribute, or one that
     * already has a tree or plan view.
     */
    export function createPlanView(viewId: string): PlanView;

    /**
     * Give a view the extension contributes a session's pull requests, drawn
     * by the host. Throws for a view the extension did not contribute, or one
     * that already has content.
     */
    export function createPullRequestView(viewId: string): PullRequestView;
  }

  /**
   * Commands, as in `vscode.commands`: one registry per window, shared by all
   * extensions. Arguments and results are copied as JSON.
   *
   * Built-in commands:
   * - `setContext(key, value)` sets a context key for `when` clauses.
   * - `omnigent.openFile(path, { line?, column? })` opens a workspace file in the
   *   file viewer, at a position when given.
   * - `omnigent.refreshChangedFiles()` refetches the active session's changed files.
   * - `omnigent.openSession(sessionId)` shows a chat session in the window.
   * - `omnigent.openSubagent(sessionId)` opens a sub-agent of the session on
   *   screen: as a tab beside the chat when the user's setting asks for it and
   *   the workspace can, otherwise like `omnigent.openSession`.
   * - `omnigent.showInChat(sessionId, markerId)` scrolls the session's chat to a
   *   marker, such as a task's (`SessionTask.chatMarker`) or a question.
   * - `omnigent.openWorkflow(workflowId)` opens a saved workflow's page.
   * - For the tasks of the workspace on screen ({@link sessions.activeSessionTasks}),
   *   each rejecting for another session: `omnigent.tasks.runTaskAction(sessionId,
   *   action, taskName)` asks the agent to run, continue, proceed with or retry a
   *   task; `omnigent.tasks.stop(sessionId)` asks it to stop the work and its
   *   workers; `omnigent.tasks.continuePlan(sessionId, planName)`;
   *   `omnigent.tasks.saveAsWorkflow(sessionId, planName)` opens the composer's
   *   Save as workflow dialog; `omnigent.tasks.startWorkflow(sessionId, { description?,
   *   workflowId? })` opens its workflow dialog; `omnigent.tasks.reload(sessionId)`
   *   loads the journal again after a failure.
   * - `<view id>.focus` for every contributed view: shows its tab in the
   *   workspace on screen and focuses its search input, as VS Code's
   *   `<view>.focus`; resolves to whether it could.
   *
   * Context keys the host sets: `config.<setting>` for each setting with a
   * string, number or boolean value (see {@link workspace.getConfiguration}), and `view.<view id>.available`
   * while the workspace on screen can show that view's tab.
   */
  export namespace commands {
    /**
     * Register a command. Its id starts with the extension id
     * (`<publisher>.<name>.`); the `omnigent.` namespace is reserved for
     * built-in commands. An id outside it, or one that already exists (in the
     * page or on the Node side), throws.
     *
     * @returns A {@link Disposable} that unregisters the command.
     */
    export function registerCommand(
      command: string,
      callback: (...args: never[]) => unknown,
    ): Disposable;

    /**
     * Run a command registered in the page or by an extension's Node entry.
     * Rejects when the command does not exist or fails.
     */
    export function executeCommand<T = unknown>(command: string, ...rest: unknown[]): Promise<T>;
  }

  /** A session's host, as a reconnect provider sees it. Plain data. */
  export interface ReconnectHost {
    readonly hostId: string;
    /** The host's name; its id when the host record is not loaded. */
    readonly name: string;
    readonly status: "online" | "offline" | "unknown";
    /** The managed sandbox provider; `null` for a user-connected host or when unknown. */
    readonly sandboxProvider: string | null;
    /** The server can resume the host itself (a resumable managed sandbox). */
    readonly resumable: boolean;
  }

  /**
   * Handles "Reconnect host" for the hosts it claims, like a VS Code remote
   * authority resolver. Providers are asked in registration order, after the
   * built-in ones; the first that can reconnect the host does.
   */
  export interface HostReconnectProvider {
    /**
     * Whether this provider reconnects `host`. Keep it cheap and free of side
     * effects: it is also called when the host menu opens, to warm caches. A
     * throw, a rejection or an answer slower than 5 seconds counts as `false`.
     */
    canReconnect: (host: ReconnectHost) => boolean | Promise<boolean>;
    /**
     * Reconnect `host`. `progress` shows inline at the host (its badge and host
     * menu): "Reconnecting...", then each reported message. When this resolves,
     * the host shows "Waiting for host..." and checks its liveness until it is
     * online (then the badge shows it online) or 90 seconds pass ("Host didn't
     * come online", with `detail` in the tooltip). A rejection shows "Reconnect
     * failed" inline, with its message in the tooltip. No notification is shown.
     */
    reconnect: (
      host: ReconnectHost,
      progress: Progress<ProgressReport>,
    ) => Promise<void | ReconnectResult>;
  }

  /** What a successful {@link HostReconnectProvider.reconnect} may return. Plain data. */
  export interface ReconnectResult {
    /** A short summary of what ran, shown if the host does not come online. */
    readonly detail?: string;
  }

  export namespace hosts {
    /** @returns A {@link Disposable} that unregisters the provider. */
    export function registerReconnectProvider(provider: HostReconnectProvider): Disposable;
  }

  /** The session shown in the window. */
  export interface Session {
    readonly id: string;
  }

  /** Token buckets and USD cost for one model. Plain data. */
  export interface ModelUsage {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly totalTokens: number | null;
    readonly cacheReadInputTokens: number | null;
    readonly cacheCreationInputTokens: number | null;
    readonly totalCostUsd: number | null;
  }

  /** Usage of a session's subtree (the session and its sub-agents). Plain data. */
  export interface SessionUsage {
    readonly sessionId: string;
    /** Cumulative USD spend; `null` when unknown or unpriced (never a misleading 0). */
    readonly totalCostUsd: number | null;
    /** True when the operator hides USD cost; `totalCostUsd` is then `null`. */
    readonly costHidden: boolean;
    /** Per-model breakdown keyed by raw model id; `null` until recorded. */
    readonly usageByModel: Readonly<Record<string, ModelUsage>> | null;
  }

  /** A file the active session changed. Plain data. */
  export interface ChangedFile {
    /** Workspace-relative path. */
    readonly path: string;
    readonly name: string;
    /** The repository the file is in, when the workspace has several. */
    readonly repositoryRoot: string | undefined;
    readonly status: "added" | "modified" | "deleted";
    readonly bytes: number | null;
    readonly modifiedAt: number | null;
    /** `null` when unknown (binary files, for example). */
    readonly linesAdded: number | null;
    readonly linesRemoved: number | null;
  }

  /** Why the workspace on screen cannot be read right now, when the host knows. */
  export type WorkspaceAvailability =
    "available" | "agentAsleep" | "sandboxOffline" | "sandboxStarting";

  /** As `vscode.FileType`, by name. */
  export type FileType = "file" | "directory";

  /** One entry of a folder listing or a file search, in plain data. */
  export interface FileEntry {
    /**
     * In the form the folder was asked for: workspace-relative inside the
     * workspace (`src/app.ts`), absolute outside it (`/tmp/notes.md`).
     */
    readonly path: string;
    readonly name: string;
    readonly type: FileType;
    readonly bytes: number | null;
    /** Seconds since the epoch, when known. */
    readonly modifiedAt: number | null;
  }

  /**
   * Why a folder could not be read, as `vscode.FileSystemError.code`:
   * `Unavailable` (the session has no files), `RunnerOffline` (its runner is
   * not connected), `NoPermissions` (the folder is outside what the session
   * may browse; `reachableRoots` names what it may), or `Unknown`.
   */
  export type FileSystemErrorCode = "Unavailable" | "RunnerOffline" | "NoPermissions" | "Unknown";

  /** The error {@link FileSystem.readDirectory} rejects with: named "FileSystemError". */
  export interface FileSystemError extends Error {
    readonly code: FileSystemErrorCode;
    readonly reachableRoots: readonly string[];
  }

  /** The workspace's files, as `vscode.workspace.fs`. */
  export interface FileSystem {
    /**
     * The entries of a folder of the workspace on screen: `""` for the
     * workspace root, a workspace-relative folder, or an absolute path on the
     * session's host (owners of sessions that may browse it). Empty and `.`
     * segments of a relative path are ignored; a `..` segment, an escaped dot
     * segment or separator (`%2e`, `%2f`, `%5c`), a backslash, or a `.` in an
     * absolute path is refused with a `TypeError`. Listings are cached by the
     * host and reloaded once stale.
     */
    readDirectory: (path: string) => Promise<readonly FileEntry[]>;
  }

  /** A search for files by name ({@link workspace.findFiles}). */
  export interface FileSearchQuery {
    /** Matched against names and paths, case-insensitively. */
    readonly pattern: string;
    /** Comma-separated globs of files to search, such as `*.ts, src/**`. */
    readonly include?: string;
    /** Comma-separated globs of files to skip. */
    readonly exclude?: string;
    /** The folder to search in, as for `readDirectory`; the root by default. */
    readonly location?: string;
  }

  export interface FileSearchComplete {
    /** Matching files and folders, paths as for `readDirectory`. */
    readonly files: readonly FileEntry[];
    /** True when the search stopped before it covered the folder, so a miss proves nothing. */
    readonly limitHit: boolean;
  }

  /** The workspace's files may have changed on disk (a turn ended, a refresh, the server said so). */
  export interface FilesChangeEvent {
    readonly sessionId: string | undefined;
  }

  export interface ChangedFilesChangeEvent {
    readonly sessionId: string | undefined;
    /** `undefined` while the list loads, or when it could not be loaded. */
    readonly files: readonly ChangedFile[] | undefined;
    /** Why the list could not be loaded, as {@link workspace.changedFilesError}. */
    readonly error?: string;
    readonly availability: WorkspaceAvailability;
    readonly servedFromHost: boolean;
    /** As {@link workspace.rootPath}. */
    readonly rootPath: string | undefined;
  }

  /**
   * The settings, as `vscode.WorkspaceConfiguration`: every setting an extension
   * registers (`contributes.configuration` in the manifest, built-ins included),
   * read from the user's settings JSON over its default (or a
   * `contributes.configurationDefaults` override). A value the setting's schema
   * doesn't take is left out (its default applies). Built-in settings include
   * `omnigent.files.sortOrder` (`"alpha"`, `"recent"`, `"size"` or `"type"`) and
   * `omnigent.files.showHidden` (boolean), which read and write the workspace on
   * screen (its Files tab and file viewer), and the theme's `omnigent.style.*`.
   * Each string, number or boolean setting is also the context key `config.<name>`.
   */
  export interface WorkspaceConfiguration {
    get: {
      <T>(key: string): T | undefined;
      <T>(key: string, defaultValue: T): T;
    };
    has: (key: string) => boolean;
    /** A registered setting's value per layer, as `vscode.WorkspaceConfiguration.inspect`. */
    inspect: (key: string) => ConfigurationInspection | undefined;
    /**
     * Writes the user's settings JSON (comments kept), or the workspace on screen for
     * `omnigent.files.*`. An extension writes only its own settings (`<extension id>.*`) and
     * the Files tab's. Rejects for an unknown setting, another's, a value its schema doesn't
     * take, one set by the product, a settings JSON with syntax errors, or no workspace on
     * screen.
     */
    update: (key: string, value: unknown) => Promise<void>;
  }

  /** A setting's value per layer, as VS Code's `inspect` result. */
  export interface ConfigurationInspection {
    readonly key: string;
    readonly defaultValue: unknown;
    /** The user's settings JSON value, when it sets one the schema takes. */
    readonly globalValue?: unknown;
    /** The workspace on screen's value (`omnigent.files.*`). */
    readonly workspaceValue?: unknown;
  }

  export interface ConfigurationChangeEvent {
    /** Whether `section` (such as `omnigent.files` or `omnigent.files.sortOrder`) changed. */
    affectsConfiguration: (section: string) => boolean;
  }

  /** A text search, as `vscode.TextSearchQuery`. */
  export interface TextSearchQuery {
    readonly pattern: string;
    readonly isRegExp?: boolean;
    readonly isCaseSensitive?: boolean;
    /** Whole words only; the host turns the pattern into a bounded expression. */
    readonly isWordMatch?: boolean;
  }

  /**
   * Why a {@link TextSearchQuery} cannot run: too long for the server (whole word
   * lengthens the pattern it sends), or a whole-word regular expression that could
   * escape its boundaries.
   */
  export type TextSearchQueryProblem = "tooLong" | "unopenedGroup" | "verbose";

  /**
   * Which files {@link workspace.findTextInFiles} searches. Each is a string of at
   * most 4096 characters; anything else rejects with a TypeError.
   */
  export interface FindTextInFilesOptions {
    /** Comma-separated globs of files to search, such as `src/**, *.{ts,tsx}`. */
    readonly include?: string;
    /** Comma-separated globs of files to skip; wins over `include`. */
    readonly exclude?: string;
  }

  /** One matching line, as `vscode.TextSearchMatch`, in plain data. */
  export interface TextSearchMatch {
    /** Workspace-relative path. */
    readonly path: string;
    /** 1-based line number. */
    readonly line: number;
    /** 1-based column of the first match. */
    readonly column: number;
    /** The line's text and the `[start, end)` offsets of its first match in it. */
    readonly preview: { readonly text: string; readonly matches: readonly [number, number][] };
  }

  /** The result of {@link workspace.findTextInFiles}. */
  export interface TextSearchComplete {
    readonly matches: readonly TextSearchMatch[];
    /** True when there were more matches than the search returns (at most 2000). */
    readonly limitHit: boolean;
    /** A message from the searcher, such as a skipped part of the workspace. */
    readonly message: string | undefined;
  }

  export namespace workspace {
    /**
     * Search the contents of the workspace on screen (at the call), as
     * `vscode.workspace.findTextInFiles`. Respects readable ignore files unless
     * explicitly included; skips binary files and `.git`. Rejects with the
     * searcher's message when it cannot run, and with an error named
     * "Canceled" when `token` is cancelled first.
     */
    export function findTextInFiles(
      query: TextSearchQuery,
      options?: FindTextInFilesOptions,
      token?: CancellationToken,
    ): Promise<TextSearchComplete>;
    /** Why `query` cannot be searched, if it cannot; checked before sending it. */
    export function validateTextSearchQuery(
      query: TextSearchQuery,
    ): TextSearchQueryProblem | undefined;
    /**
     * The chat session whose workspace is on screen: the session open in the
     * window, or the selected grid cell. `workspaceState` follows it.
     */
    export const activeSessionId: string | undefined;
    /** Fires with the new {@link activeSessionId} when another workspace comes on screen. */
    export const onDidChangeActiveSessionId: Event<string | undefined>;
    /**
     * That session's changed files, frozen; `undefined` while they load, when
     * they cannot be loaded, or without a session.
     */
    export function getChangedFiles(): readonly ChangedFile[] | undefined;
    /** Why the active session's changed files could not be loaded, if they could not. */
    export const changedFilesError: string | undefined;
    /** Whether the workspace can be read, or why not. */
    export const availability: WorkspaceAvailability;
    /** The agent is asleep but its host serves the workspace. */
    export const servedFromHost: boolean;
    /** Fires when that list, its availability, the root or the session on screen changes. */
    export const onDidChangeChangedFiles: Event<ChangedFilesChangeEvent>;
    /**
     * The absolute path of the workspace root on screen, as the deprecated
     * `vscode.workspace.rootPath`; undefined while unknown or without files.
     */
    export const rootPath: string | undefined;
    /** The files of the workspace on screen. */
    export const fs: FileSystem;
    /**
     * Searches the workspace on screen for files and folders by name, as
     * `vscode.workspace.findFiles` (with a name pattern); at most 500 results.
     * Rejects with an error named "Canceled" when `token` is cancelled.
     */
    export function findFiles(
      query: FileSearchQuery,
      token?: CancellationToken,
    ): Promise<FileSearchComplete>;
    /** Fires when the files of the workspace on screen may have changed on disk. */
    export const onDidChangeFiles: Event<FilesChangeEvent>;
    /** The settings under `section` (for example `omnigent.files`), or all of them. */
    export function getConfiguration(section?: string): WorkspaceConfiguration;
    export const onDidChangeConfiguration: Event<ConfigurationChangeEvent>;
  }

  /** An agent's USD cost: its total including sub-agents, or a parent's estimate. */
  export interface AgentCost {
    readonly usd: number | null;
    /** A parent-reported estimate that the parent's total already includes. */
    readonly estimated: boolean;
  }

  /** A model an intelligent router picked for a sub-agent. */
  export interface RoutedModel {
    readonly id: string;
    /** Its short display name. */
    readonly label: string;
  }

  /** A sub-agent session under another session. Plain data. */
  export interface ChildSession {
    readonly id: string;
    /** The name the Agents tab shows: its task, instance name or native nickname. */
    readonly label: string;
    /** `"{tool}:{name}"` as spawned, or `null`. */
    readonly title: string | null;
    /** The sub-agent type, such as "researcher" or "Explore". */
    readonly tool: string | null;
    /** The harness and agent it runs as, when it is a native coding agent. */
    readonly agent: AgentIcon | undefined;
    readonly status: AgentStatus;
    /** Its latest task is queued or running. */
    readonly busy: boolean;
    /** One line of its latest message. */
    readonly preview: string | undefined;
    readonly routedModel: RoutedModel | undefined;
    /** `undefined` while unknown, or when the server reports no costs. */
    readonly cost: AgentCost | undefined;
  }

  /** A session's sub-agents, as {@link sessions.getChildSessions} returns them. */
  export interface ChildSessionList {
    /** Empty while loading or when loading failed. */
    readonly sessions: readonly ChildSession[];
    readonly loading: boolean;
    /** Why they could not be loaded. */
    readonly error: string | undefined;
  }

  /** A session's own details, as the Agents tab names its root. Plain data. */
  export interface SessionDetails {
    readonly id: string;
    /** Its agent's display name: the product name of a native coding agent, else the agent name. */
    readonly label: string | undefined;
    readonly agent: AgentIcon;
    /**
     * What runs it: `<harness>-native` (such as "claude-native") for a native
     * coding agent, "nessie", or "agent".
     */
    readonly kind: string;
    /** One line of its latest message. */
    readonly preview: string | undefined;
    readonly status: AgentStatus;
    readonly cost: AgentCost | undefined;
  }

  export interface ChildSessionsChangeEvent {
    /** The sessions whose sub-agent lists or details changed. */
    readonly sessionIds: readonly string[];
  }

  /** A pull request a git host provider recognizes in a link. Plain data. */
  export interface PullRequestLocation {
    /** The host, lowercase, such as `github.com`. */
    readonly host: string;
    readonly owner: string;
    readonly repo: string;
    readonly number: number;
  }

  /**
   * Recognizes the pull request links of one git host, like a VS Code
   * `DocumentLinkProvider` for one scheme. Providers are asked in
   * registration order, after the built-in GitHub one; the first match wins.
   */
  export interface GitHostProvider {
    /** Unique among providers, such as `publisher.name.host`. */
    readonly id: string;
    /** The pull request `url` links to, or `undefined` when it is not one of this host's. */
    matchUrl: (url: string) => PullRequestLocation | undefined;
  }

  /** A provider's match, with the provider's id. */
  export interface PullRequestMatch extends PullRequestLocation {
    readonly providerId: string;
  }

  export namespace git {
    /**
     * Recognize a git host's pull request links in chats and link inputs. A
     * throw or a malformed answer counts as no match and is logged.
     *
     * @returns A {@link Disposable} that unregisters the provider.
     */
    export function registerHostProvider(provider: GitHostProvider): Disposable;
    /** The first provider's match for `url`, or `undefined`. */
    export function matchPullRequestUrl(url: string): PullRequestMatch | undefined;
  }

  /** Why a session's pull requests cannot be shown, or `ready` when one can. */
  export type PullRequestStatus =
    | "loading"
    | "runner-offline"
    | "sandbox-offline"
    | "error"
    | "host-outdated"
    | "unavailable"
    | "not-a-git-repo"
    | "unsupported-remote"
    | "no-cli"
    | "repo-unresolved"
    | "no-pr"
    | "ready";

  /** One CI check of a pull request. */
  export interface PullRequestCheckRun {
    readonly name: string;
    readonly bucket: "passing" | "failing" | "pending" | "cancelled" | "skipped";
    readonly url: string | null;
  }

  export interface PullRequestChecks {
    readonly passing: number;
    readonly failing: number;
    readonly pending: number;
    readonly cancelled: number;
    readonly skipped: number;
    readonly total: number;
    readonly runs: readonly PullRequestCheckRun[];
    /** Some checks could not be read; the counts cover the rest. */
    readonly partial: boolean;
  }

  export interface PullRequestReviewer {
    /** A user's login or a team's slug. */
    readonly login: string;
    readonly kind: "user" | "team";
    readonly state: string;
  }

  /** What the host last read of a pull request, live. */
  export interface PullRequestDetails {
    readonly url: string;
    readonly number: number;
    readonly title: string;
    /** `OPEN`, `MERGED` or `CLOSED`. */
    readonly state: string;
    readonly isDraft: boolean;
    readonly author: string | null;
    readonly baseRef: string | null;
    readonly headRef: string | null;
    readonly headSha: string | undefined;
    readonly checks: PullRequestChecks;
    /** False when the signed-in account cannot read checks, so `checks` is empty. */
    readonly checksSupported: boolean;
    /** `undefined` where the host does not report them. */
    readonly reviewers: readonly PullRequestReviewer[] | undefined;
    readonly labels:
      readonly { readonly name: string; readonly color: string | null }[] | undefined;
    readonly mergeStateStatus: string | null | undefined;
    readonly commentCount: number;
    /** Whether the merge button would merge now, and why not when it would not. */
    readonly mergeable: { readonly ready: boolean; readonly hint: string | undefined };
  }

  /** One of a session's pull requests. Plain data. */
  export interface SessionPullRequest {
    readonly url: string;
    readonly host: string;
    /** `owner/repo`. */
    readonly repository: string;
    readonly number: number;
    readonly title: string | null;
    /** How it came to the session; `inferred` is the branch's own, not linked. */
    readonly relationship: "created" | "worked_on" | "attached" | "inferred";
    /** Its git provider, such as `github`. */
    readonly provider: string | undefined;
    readonly providerDisplay: GitProviderDisplay | undefined;
    /** The provider's name ("GitHub"), its number prefix ("#") and the host its labels leave out. */
    readonly providerLabel: string;
    readonly numberPrefix: string;
    readonly defaultHost: string | null;
    /** As the server last stored it; `null` before the host read it. */
    readonly state: string | null;
    readonly isDraft: boolean;
    /** Epoch seconds of that read, or `null`. */
    readonly stateCheckedAt: number | null;
    /** Its live read: still loading, failed, or the details. */
    readonly live: {
      readonly loading: boolean;
      readonly error: string | undefined;
      /** The host could not answer for it (asleep, offline). */
      readonly offline: boolean;
      /** Why, and when it was last read, while offline. */
      readonly offlineHint: string | undefined;
      readonly details: PullRequestDetails | undefined;
      /** An earlier read is cached, so the host can draw its merge control. */
      readonly cached: boolean;
      /** The host can merge it from here. */
      readonly canMerge: boolean;
    };
  }

  /** A git provider as the host names it. */
  export interface GitProviderDisplay {
    readonly id: string;
    readonly displayName: string;
    readonly requestName: string;
    readonly numberPrefix: string;
  }

  /** The workspace on screen's pull requests, as its surface reads them. Plain data. */
  export interface SessionPullRequests {
    readonly sessionId: string;
    /** For the pull request in focus (see {@link PullRequestsWatch.focus}), or the branch's. */
    readonly status: PullRequestStatus;
    /** {@link status} once an empty linked list leaves no pull request to read. */
    readonly listStatus: PullRequestStatus;
    /** The session's provider; `null` when none is known. */
    readonly provider: string | null | undefined;
    readonly providerDisplay: GitProviderDisplay | undefined;
    /** Its label ("GitHub") and the example link of its link input. */
    readonly providerLabel: string;
    readonly linkPlaceholder: string;
    /** The provider named by the session's pull requests, even outside a git checkout. */
    readonly listProviderLabel: string;
    /** The host links and unlinks pull requests for the session. */
    readonly trackingAvailable: boolean;
    /** Neither the session's runner nor its host can answer now. */
    readonly hostOffline: boolean;
    /** The server keeps the session's pull requests, so linking needs the host online. */
    readonly linkNeedsHost: boolean;
    readonly sandbox: "awake" | "asleep" | "starting";
    /** Offline before the server imported the session's pull requests. */
    readonly notSynced: boolean;
    /** The viewer may change the session. */
    readonly canEdit: boolean;
    /** The session's pull requests, in display order. */
    readonly pullRequests: readonly SessionPullRequest[];
    /** The branch's own pull request, while none is linked. */
    readonly branchPullRequest: SessionPullRequest | undefined;
    /** The one the host would show first. */
    readonly selectedUrl: string | undefined;
    /** The listed pull requests come from the server's list. */
    readonly listedByServer: boolean;
    /** The host read the pull request in focus. */
    readonly hasDetails: boolean;
    readonly warnings: readonly string[];
    /** A review comment asked to be shown in its pull request's changes, newest first. */
    readonly reviewTarget: { readonly id: string; readonly pullRequestUrl: string } | undefined;
  }

  /** What a watch of the session's pull requests reads first. */
  export interface PullRequestsFocus {
    readonly sessionId: string;
    /** The pull request shown or selected. */
    readonly url: string | undefined;
    /** Its details are on screen, so it reads first and at the details' pace. */
    readonly details: boolean;
  }

  /** Keeps the session's pull requests live; see {@link pullRequests.watchActiveSessionPullRequests}. */
  export interface PullRequestsWatch extends Disposable {
    focus: PullRequestsFocus | undefined;
  }

  export namespace pullRequests {
    /**
     * The pull requests of the session whose workspace is on screen;
     * `undefined` without one. They are read only while some extension holds
     * {@link watchActiveSessionPullRequests}.
     */
    export const activeSessionPullRequests: SessionPullRequests | undefined;
    /** Fires when {@link activeSessionPullRequests} changes, coalesced per microtask. */
    export const onDidChangeActiveSessionPullRequests: Event<SessionPullRequests | undefined>;
    /** Read and poll the session's pull requests while held, as the tab does while it shows. */
    export function watchActiveSessionPullRequests(): PullRequestsWatch;
  }

  /** A button of a {@link PullRequestView}'s bar. */
  export interface PullRequestViewAction {
    readonly title: string;
    /** An icon name from the allowlist (`refresh-cw`, `plus`, `trash-2`). */
    readonly icon: string;
    readonly command: Command;
    readonly disabled?: boolean;
    /** Its icon spins (a refresh running). */
    readonly busy?: boolean;
  }

  /** A pull request's row in a {@link PullRequestView}'s list. */
  export interface PullRequestViewRow {
    readonly pullRequest: SessionPullRequest;
    /** "acme/app #12", the muted part of its label. */
    readonly identity: string;
    readonly title: string | undefined;
    /** Runs when the row is clicked. */
    readonly command: Command;
    /** What its trailing area says. */
    readonly status:
      | { readonly kind: "offline"; readonly label: string; readonly hint: string }
      | {
          readonly kind: "checks";
          readonly incomplete: boolean;
          readonly noChecks?: string;
          readonly draft: boolean;
        }
      | { readonly kind: "state"; readonly state: string }
      | { readonly kind: "text"; readonly text: string; readonly tooltip?: string }
      | { readonly kind: "none" };
    /** Draws the host's compact merge control; `trigger` shows its button. */
    readonly merge?: { readonly trigger: boolean; readonly unavailable: boolean };
    /** Its ⋯ menu: unlink (when it can be), open on the provider, copy the link. */
    readonly unlink?: { readonly command: Command; readonly disabled: boolean };
    readonly openUrl?: { readonly url: string; readonly label: string };
  }

  /** The bar above a {@link PullRequestView}'s body. */
  export type PullRequestViewBar =
    /** The tab's heading (visible, or for screen readers only) with the actions. */
    | { readonly kind: "toolbar"; readonly showTitle: boolean }
    /** The heading and a Refresh button. */
    | { readonly kind: "refresh"; readonly busy: boolean; readonly command: Command };

  /** A {@link PullRequestView}'s body: a list of pull requests, or one's details. */
  export type PullRequestViewBody =
    | { readonly kind: "list"; readonly rows: readonly PullRequestViewRow[] }
    | {
        readonly kind: "details";
        /** The pull request; `undefined` for the branch's. */
        readonly url: string | undefined;
        /** The session links none, so the branch's own pull request is not shown. */
        readonly branchHidden: boolean;
        readonly section: "summary" | "comments" | "changes";
        /** Runs with the section picked appended. */
        readonly selectSection: Command;
        /** The pull request as the server stored it, while the host is offline. */
        readonly stored?: SessionPullRequest;
        readonly notSynced: boolean;
        /** The details draw the heading and a Refresh button themselves. */
        readonly refresh?: { readonly busy: boolean; readonly command: Command };
        /** Below an empty state: how to link one, a note, or where to open it. */
        readonly emptyState?:
          | { readonly kind: "link"; readonly command: Command }
          | { readonly kind: "message"; readonly text: string }
          | { readonly kind: "open"; readonly url: string; readonly label: string };
      };

  /**
   * What a {@link PullRequestView} shows: the bar, the link form, notes, and a
   * list of pull requests or one pull request's details, which the host draws
   * (its header, checks, reviewers, labels, merge, comments with their
   * composer, and the diff with its review threads).
   */
  export type PullRequestViewContent =
    | { readonly kind: "loading" }
    | {
        readonly kind: "pullRequests";
        readonly sessionId: string;
        /** The pull request selected, which a drawn view reads first even while hidden. */
        readonly selectedUrl?: string;
        /** The bar's buttons; a phone draws them in its drawer's header. */
        readonly actions: readonly PullRequestViewAction[];
        /** "All pull requests (3)", back to the list. */
        readonly back?: { readonly title: string; readonly command: Command };
        readonly bar?: PullRequestViewBar;
        /** The link form; its submit runs `submit` with the typed link appended. */
        readonly linkForm?: {
          readonly open: boolean;
          readonly placeholder: string;
          readonly disabled: boolean;
          readonly pending: boolean;
          readonly error: string | undefined;
          readonly submit: Command;
          readonly cancel: Command;
        };
        /** A failed unlink, shown as an alert. */
        readonly alert?: string;
        /** Warnings from the host, one line. */
        readonly note?: string;
        readonly body: PullRequestViewBody;
        /**
         * The same view on a page that shows each pull request on its own (a
         * sidebar's tab): always a list while there are any, whose rows the
         * page opens itself.
         */
        readonly page?: {
          readonly actions: readonly PullRequestViewAction[];
          readonly bar?: PullRequestViewBar;
          readonly body: PullRequestViewBody;
        };
      };

  /**
   * A view drawn by the host from plain data: a session's pull requests. The
   * host draws each pull request's details, diff and review threads, like
   * VS Code's diff editor, and the merge, label, reviewer and comment
   * controls. No VS Code equivalent; see the plan doc.
   */
  export interface PullRequestView {
    content: PullRequestViewContent;
    readonly visible: boolean;
    readonly onDidChangeVisibility: Event<TreeViewVisibilityChangeEvent>;
    /** Removes the content; the view stays, without data. */
    dispose: () => void;
  }

  export namespace sessions {
    /**
     * The top-level session of the session tree of the workspace on screen (the
     * session itself, or the root above a sub-agent); `undefined` until known.
     */
    export const activeSessionTreeRoot: string | undefined;
    /** Fires when {@link activeSessionTreeRoot} changes. */
    export const onDidChangeActiveSessionTree: Event<string | undefined>;
    /**
     * The sub-agents of `sessionId`, loaded on first ask and kept live (new
     * sub-agents, status, cost); costs are those of the active session tree.
     */
    export function getChildSessions(sessionId: string): ChildSessionList;
    /** `sessionId`'s details, loaded on first ask; `undefined` while loading. */
    export function getSession(sessionId: string): SessionDetails | undefined;
    /** Fires when lists or details asked for change, coalesced per microtask. */
    export const onDidChangeChildSessions: Event<ChildSessionsChangeEvent>;
    /**
     * The tasks of the session whose workspace is on screen (see
     * {@link workspace.activeSessionId}); `undefined` without one. Its journal loads only while some extension
     * holds {@link watchActiveSessionTasks}; until then it is `loading`.
     */
    export const activeSessionTasks: SessionTasks | undefined;
    /** Fires when {@link activeSessionTasks} changes, coalesced per microtask. */
    export const onDidChangeActiveSessionTasks: Event<SessionTasks | undefined>;
    /**
     * Keep the tasks of the workspace on screen loaded and live while held, as
     * the Tasks tab does while it shows; dispose it to stop.
     */
    export function watchActiveSessionTasks(): Disposable;
    /** The session on screen, or `undefined` on pages without one. */
    export const activeSession: Session | undefined;
    /** Current usage of {@link activeSession}, so late activators need not wait for an event. */
    export const activeSessionUsage: SessionUsage | undefined;
    /** Fires when the session on screen changes, including to none. */
    export const onDidChangeActiveSession: Event<Session | undefined>;
    /**
     * Fires when the active session's usage changes: on live updates, when the
     * usage read on load lands, and when the active session changes.
     */
    export const onDidChangeUsage: Event<SessionUsage>;
  }
}

/**
 * The API of an extension's Node entry (`main` in package.json), which the dev
 * server runs in a separate Node process:
 *
 * ```js
 * import * as omnigent from "omnigent/node";
 *
 * export function activate(context) {
 *   context.subscriptions.push(
 *     omnigent.commands.registerCommand("publisher.name.hello", (who) => `hello ${who}`),
 *   );
 * }
 * ```
 *
 * The page runs these commands with `omnigent.commands.executeCommand`.
 */
declare module "omnigent/node" {
  import type {
    Disposable as DisposableClass,
    Progress,
    ProgressOptions,
    ProgressReport,
  } from "omnigent";

  export const version: string;
  export const Disposable: typeof DisposableClass;

  /** Passed to the Node entry's `activate` function. */
  export interface ExtensionContext {
    readonly subscriptions: { dispose: () => unknown }[];
    readonly extension: { readonly id: string; readonly version: string };
  }

  /** Options of a Node command. */
  export interface CommandOptions {
    /**
     * How long one call may run before the dev server fails it, in
     * milliseconds: positive, at most 24 hours; 15 minutes when unset.
     */
    timeoutMs?: number;
  }

  export namespace commands {
    /**
     * Register a command the page can run. Arguments arrive and results leave
     * as JSON (at most 1 MiB). As in the page, the id starts with the extension
     * id and `omnigent.` is reserved; an id outside it, or one that already
     * exists, throws.
     */
    export function registerCommand(
      command: string,
      callback: (...args: never[]) => unknown,
      options?: CommandOptions,
    ): DisposableClass;
  }

  /** A log channel; lines show in the dev server's output with the extension id. */
  export interface LogOutputChannel {
    readonly name: string;
    appendLine: (value: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
    dispose: () => void;
  }

  export namespace window {
    /**
     * Report progress. While a command called from the page runs, the reports
     * stream to the page, which shows them; otherwise they are logged.
     */
    export function withProgress<R>(
      options: ProgressOptions,
      task: (progress: Progress<ProgressReport>) => R | Promise<R>,
    ): Promise<R>;

    export function createOutputChannel(name: string): LogOutputChannel;
  }
}
