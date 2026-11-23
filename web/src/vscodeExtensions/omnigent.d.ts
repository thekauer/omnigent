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

  export namespace window {
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
