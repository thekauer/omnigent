// Host-side source of `omnigent.sessions`: turns chat store changes into plain-data
// events. One instance per window; extensions get guarded views of its events.
import type * as omnigent from "omnigent";
import { useChatStore } from "@/store/chatStore";
import { EventEmitter } from "./base";

/** The slice of window state the sessions API is derived from. */
export interface SessionSourceState {
  readonly sessionId: string | null;
  readonly totalCostUsd: number | null;
  readonly costHidden: boolean;
  readonly usageByModel: Readonly<Record<string, omnigent.ModelUsage>> | null;
}

export interface SessionSource {
  getState: () => SessionSourceState;
  subscribe: (listener: () => void) => () => void;
}

/** Reads the session on screen from the chat store's flat active-conversation fields. */
export function chatStoreSessionSource(): SessionSource {
  const read = (): SessionSourceState => {
    const state = useChatStore.getState();
    return {
      sessionId: state.conversationId,
      totalCostUsd: state.sessionCostUsd,
      costHidden: state.sessionCostHidden,
      usageByModel: state.sessionUsageByModel,
    };
  };
  return {
    getState: read,
    subscribe: (listener) => useChatStore.subscribe(listener),
  };
}

function sameUsageInputs(a: SessionSourceState, b: SessionSourceState): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.totalCostUsd === b.totalCostUsd &&
    a.costHidden === b.costHidden &&
    a.usageByModel === b.usageByModel
  );
}

/** A frozen deep copy, so no extension can hold or mutate store objects. */
function toUsage(state: SessionSourceState): omnigent.SessionUsage | undefined {
  if (state.sessionId === null) return undefined;
  const usageByModel =
    state.usageByModel === null
      ? null
      : Object.freeze(
          Object.fromEntries(
            Object.entries(state.usageByModel).map(([model, usage]) => [
              model,
              Object.freeze({ ...usage }),
            ]),
          ),
        );
  return Object.freeze({
    sessionId: state.sessionId,
    totalCostUsd:
      state.costHidden || typeof state.totalCostUsd !== "number" ? null : state.totalCostUsd,
    costHidden: state.costHidden,
    usageByModel,
  });
}

export class SessionsService {
  private readonly activeSessionEmitter = new EventEmitter<omnigent.Session | undefined>();
  private readonly usageEmitter = new EventEmitter<omnigent.SessionUsage>();
  private readonly unsubscribe: () => void;
  private state: SessionSourceState;
  private session: omnigent.Session | undefined;
  private usage: omnigent.SessionUsage | undefined;
  private flushScheduled = false;
  private disposed = false;

  readonly onDidChangeActiveSession = this.activeSessionEmitter.event;
  readonly onDidChangeUsage = this.usageEmitter.event;

  private readonly source: SessionSource;

  constructor(source: SessionSource) {
    this.source = source;
    this.state = source.getState();
    this.session = this.state.sessionId === null ? undefined : { id: this.state.sessionId };
    this.usage = toUsage(this.state);
    this.unsubscribe = source.subscribe(() => this.scheduleFlush());
  }

  get activeSession(): omnigent.Session | undefined {
    return this.session;
  }

  get activeSessionUsage(): omnigent.SessionUsage | undefined {
    return this.usage;
  }

  // Store writes come in bursts (a bind sets many fields); coalesce them into one
  // event per microtask, which is also how a Worker-hosted API would see them.
  private scheduleFlush(): void {
    if (this.flushScheduled || this.disposed) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      if (!this.disposed) this.flush();
    });
  }

  private flush(): void {
    const next = this.source.getState();
    const previous = this.state;
    if (sameUsageInputs(previous, next)) return;
    this.state = next;
    if (next.sessionId !== previous.sessionId) {
      this.session = next.sessionId === null ? undefined : Object.freeze({ id: next.sessionId });
      this.usage = toUsage(next);
      this.activeSessionEmitter.fire(this.session);
    } else {
      this.usage = toUsage(next);
    }
    if (this.usage !== undefined) this.usageEmitter.fire(this.usage);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.activeSessionEmitter.dispose();
    this.usageEmitter.dispose();
  }
}
