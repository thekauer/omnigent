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

  /** Passed to an extension's `activate` function. */
  export interface ExtensionContext {
    /** Disposed, in order, when the extension is deactivated. */
    readonly subscriptions: DisposableLike[];
    readonly extension: Extension;
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
    /** Show the item. New items are hidden until shown. */
    show: () => void;
    hide: () => void;
    /** Remove the item for good. */
    dispose: () => void;
  }

  /** Options for {@link window.withProgress}. Progress shows as a notification. */
  export interface ProgressOptions {
    /** Shown for the whole task, with the latest reported message below it. */
    title: string;
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

  export namespace window {
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
  }

  /**
   * Commands, as in `vscode.commands`: one registry per window, shared by all
   * extensions. Arguments and results are copied as JSON.
   */
  export namespace commands {
    /**
     * Register a command. An id that already exists (in the page or on the
     * Node side) throws.
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
     * Reconnect `host`. The host shows a "Reconnecting <name>" notification
     * with each reported message while this runs; a rejection's message is
     * shown as the error.
     */
    reconnect: (host: ReconnectHost, progress: Progress<ProgressReport>) => Promise<void>;
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

  export namespace sessions {
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

  export namespace commands {
    /**
     * Register a command the page can run. Arguments arrive and results leave
     * as JSON. An id that already exists throws.
     */
    export function registerCommand(
      command: string,
      callback: (...args: never[]) => unknown,
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
