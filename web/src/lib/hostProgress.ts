// Host progress locations: progress shown inline at a host, in its badge and
// host menu, instead of as a notification. Like VS Code's
// `ProgressLocation.Window`, scoped to one host: `withProgress({ location:
// { hostId } })` and Reconnect host both draw here. A host also keeps the
// failure of its last reconnect, which Reconnect host sets and clears.

import { useCallback, useSyncExternalStore } from "react";

/** A reconnect that failed, shown in place of its progress. Plain data. */
export interface HostProgressFailure {
  /** Short text for the badge, such as "Reconnect failed". */
  readonly message: string;
  /** What went wrong, for the tooltip; `null` when there is nothing more to say. */
  readonly detail: string | null;
}

/** What a host's badge draws. */
export interface HostProgressState {
  /** The latest open progress's message; `null` while none runs. */
  readonly progress: string | null;
  readonly failure: HostProgressFailure | null;
}

/** One open progress at a host. */
export interface HostProgressHandle {
  report: (message: string) => void;
  /** Closes it; later reports are ignored. */
  end: () => void;
}

const EMPTY: HostProgressState = Object.freeze({ progress: null, failure: null });

interface HostEntry {
  readonly open: { message: string }[];
  failure: { readonly value: HostProgressFailure; readonly owner: object } | null;
  snapshot: HostProgressState;
}

export class HostProgressLocations {
  private readonly hosts = new Map<string, HostEntry>();
  private readonly listeners = new Set<() => void>();

  /** Opens a progress at `hostId` showing `message`; the newest open one is shown. */
  begin(hostId: string, message: string): HostProgressHandle {
    const entry = this.entry(hostId);
    const progress = { message };
    entry.open.push(progress);
    this.changed(hostId);
    let ended = false;
    return {
      report: (next) => {
        if (ended || typeof next !== "string" || !next) return;
        progress.message = next;
        this.changed(hostId);
      },
      end: () => {
        if (ended) return;
        ended = true;
        const index = entry.open.indexOf(progress);
        if (index >= 0) entry.open.splice(index, 1);
        this.changed(hostId);
      },
    };
  }

  /** Shows `failure` at `hostId` until `owner` clears it or another failure replaces it. */
  setFailure(hostId: string, failure: HostProgressFailure, owner: object): void {
    this.entry(hostId).failure = { value: Object.freeze({ ...failure }), owner };
    this.changed(hostId);
  }

  /** Clears the failure at `hostId`; with `owner`, only the one it set. */
  clearFailure(hostId: string, owner?: object): void {
    const entry = this.hosts.get(hostId);
    if (!entry?.failure || (owner !== undefined && entry.failure.owner !== owner)) return;
    entry.failure = null;
    this.changed(hostId);
  }

  get(hostId: string | null | undefined): HostProgressState {
    return (hostId && this.hosts.get(hostId)?.snapshot) || EMPTY;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private entry(hostId: string): HostEntry {
    let entry = this.hosts.get(hostId);
    if (!entry) {
      entry = { open: [], failure: null, snapshot: EMPTY };
      this.hosts.set(hostId, entry);
    }
    return entry;
  }

  private changed(hostId: string): void {
    const entry = this.hosts.get(hostId);
    if (!entry) return;
    const progress = entry.open.at(-1)?.message ?? null;
    const failure = entry.failure?.value ?? null;
    if (progress === null && failure === null) {
      this.hosts.delete(hostId);
    } else if (entry.snapshot.progress !== progress || entry.snapshot.failure !== failure) {
      entry.snapshot = Object.freeze({ progress, failure });
    }
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.warn("[host-progress] listener failed", error);
      }
    }
  }
}

/** The window's host progress locations. */
export const hostProgress = new HostProgressLocations();

/** What `hostId`'s badge shows: its latest progress and its reconnect failure. */
export function useHostProgress(
  hostId: string | null | undefined,
  locations: HostProgressLocations = hostProgress,
): HostProgressState {
  const subscribe = useCallback(
    (listener: () => void) => locations.subscribe(listener),
    [locations],
  );
  const read = useCallback(() => locations.get(hostId), [locations, hostId]);
  return useSyncExternalStore(subscribe, read, read);
}
