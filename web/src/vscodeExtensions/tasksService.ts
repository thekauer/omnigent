// Host-side source of `sessions.activeSessionTasks`: the tasks of the workspace on
// screen, as its surface publishes them on the workspace bridge, frozen, with
// change events coalesced per microtask. Watching keeps the journal loading.
import type * as omnigent from "omnigent";
import type { WorkspaceBridge } from "@/shell/workspaceBridge";
import { Disposable, EventEmitter } from "./base";

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export class TasksService {
  private readonly bridge: WorkspaceBridge;
  private readonly emitter = new EventEmitter<omnigent.SessionTasks | undefined>();
  private source: omnigent.SessionTasks | undefined;
  private snapshot: omnigent.SessionTasks | undefined;
  /** The snapshot the last event carried. */
  private fired: omnigent.SessionTasks | undefined;
  private scheduled = false;
  private disposed = false;
  private readonly unsubscribe: () => void;

  readonly onDidChangeActiveSessionTasks = this.emitter.event;

  constructor(bridge: WorkspaceBridge) {
    this.bridge = bridge;
    this.unsubscribe = bridge.subscribeTasks(() => this.schedule());
    this.sync();
    this.fired = this.snapshot;
  }

  get activeSessionTasks(): omnigent.SessionTasks | undefined {
    this.sync();
    return this.snapshot;
  }

  /** Copies the bridge's tasks once per change, so each snapshot is the extensions' own. */
  private sync(): void {
    const next = this.bridge.getTasks();
    if (next === this.source) return;
    this.source = next;
    this.snapshot = next === undefined ? undefined : deepFreeze(structuredClone(next));
  }

  private schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.disposed) return;
      this.sync();
      if (this.snapshot === this.fired) return;
      this.fired = this.snapshot;
      this.emitter.fire(this.snapshot);
    });
  }

  /** Keeps the tasks of the workspace on screen loading while the returned value is held. */
  watch(): Disposable {
    return new Disposable(this.bridge.watchTasks());
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.emitter.dispose();
  }
}
