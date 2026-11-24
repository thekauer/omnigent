// Host-side source of `pullRequests.activeSessionPullRequests`: the pull requests
// of the workspace on screen, as its surface publishes them on the workspace
// bridge, frozen, with change events coalesced per microtask. A watch keeps
// them read and polled, and says which pull request to read first.
import type * as omnigent from "omnigent";
import type { WorkspaceBridge } from "@/shell/workspaceBridge";
import { EventEmitter } from "./base";

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** A focus as plain, checked data; `undefined` for anything malformed. */
export function pullRequestsFocusOf(value: unknown): omnigent.PullRequestsFocus | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.sessionId !== "string" || candidate.sessionId === "") return undefined;
  const url = typeof candidate.url === "string" && candidate.url !== "" ? candidate.url : undefined;
  return Object.freeze({
    sessionId: candidate.sessionId,
    url,
    details: candidate.details === true,
  });
}

export class PullRequestsService {
  private readonly bridge: WorkspaceBridge;
  private readonly emitter = new EventEmitter<omnigent.SessionPullRequests | undefined>();
  private source: omnigent.SessionPullRequests | undefined;
  private snapshot: omnigent.SessionPullRequests | undefined;
  private fired: omnigent.SessionPullRequests | undefined;
  private scheduled = false;
  private disposed = false;
  private readonly unsubscribe: () => void;

  readonly onDidChangeActiveSessionPullRequests = this.emitter.event;

  constructor(bridge: WorkspaceBridge) {
    this.bridge = bridge;
    this.unsubscribe = bridge.subscribePullRequests(() => this.schedule());
    this.sync();
    this.fired = this.snapshot;
  }

  get activeSessionPullRequests(): omnigent.SessionPullRequests | undefined {
    this.sync();
    return this.snapshot;
  }

  private sync(): void {
    const next = this.bridge.getPullRequests();
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

  /** Keeps the pull requests of the workspace on screen read while the watch is held. */
  watch(): omnigent.PullRequestsWatch {
    const registration = this.bridge.watchPullRequests();
    let focus: omnigent.PullRequestsFocus | undefined;
    let disposed = false;
    return {
      get focus() {
        return focus;
      },
      set focus(value) {
        if (disposed) return;
        focus = pullRequestsFocusOf(value);
        registration.setFocus(focus);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        registration.dispose();
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.emitter.dispose();
  }
}
