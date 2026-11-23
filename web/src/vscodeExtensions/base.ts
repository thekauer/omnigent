// Disposable and EventEmitter with VS Code semantics. Dependency-free so the same
// code can run in a future Worker-based extension host.
import type * as omnigent from "omnigent";
import { isThenable } from "@/lib/thenable";

export type DisposableLike = omnigent.DisposableLike;

/** Reports an error thrown by a listener or a disposer; overridable for attribution. */
export type ErrorReporter = (error: unknown) => void;

const defaultReporter: ErrorReporter = (error) => {
  console.error("[omnigent-extensions] unexpected error", error);
};

export class Disposable implements omnigent.Disposable {
  static from(...disposableLikes: DisposableLike[]): Disposable {
    let pending: DisposableLike[] | undefined = disposableLikes;
    return new Disposable(() => {
      const items = pending;
      pending = undefined;
      if (items) disposeAll(items);
    });
  }

  private callOnDispose: (() => unknown) | undefined;

  constructor(callOnDispose: () => unknown) {
    this.callOnDispose = callOnDispose;
  }

  dispose(): unknown {
    const callback = this.callOnDispose;
    this.callOnDispose = undefined;
    return callback?.();
  }
}

/** Dispose each item in order; one throwing does not stop the rest. */
export function disposeAll(
  items: Iterable<DisposableLike>,
  report: ErrorReporter = defaultReporter,
): void {
  for (const item of items) {
    try {
      item.dispose();
    } catch (error) {
      report(error);
    }
  }
}

interface Listener<T> {
  callback: (e: T) => unknown;
  thisArgs: unknown;
}

export class EventEmitter<T> implements omnigent.EventEmitter<T> {
  private listeners: Listener<T>[] | undefined = [];
  private readonly report: ErrorReporter;

  constructor(report: ErrorReporter = defaultReporter) {
    this.report = report;
  }

  readonly event: omnigent.Event<T> = (callback, thisArgs, disposables) => {
    if (!this.listeners) return new Disposable(() => {});
    const listener: Listener<T> = { callback, thisArgs };
    this.listeners.push(listener);
    const subscription = new Disposable(() => {
      if (!this.listeners) return;
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    });
    if (Array.isArray(disposables)) disposables.push(subscription);
    return subscription;
  };

  fire(data: T): void {
    if (!this.listeners) return;
    // Snapshot so listeners added or removed while firing take effect next time.
    for (const listener of [...this.listeners]) {
      try {
        const result = listener.callback.call(listener.thisArgs, data);
        // By shape: zone.js replaces the global Promise, so instanceof misses async listeners.
        if (isThenable(result)) result.then(undefined, this.report);
      } catch (error) {
        this.report(error);
      }
    }
  }

  dispose(): void {
    this.listeners = undefined;
  }
}
