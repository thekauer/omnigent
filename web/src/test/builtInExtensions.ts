// Runs the real extension host with the built-in extensions (the Changes tab) for
// renderer tests, against a workspace source the test publishes to.
import type { QueryClient } from "@tanstack/react-query";
import { type Mock, vi } from "vitest";
import type {
  WorkspaceChangedFile,
  WorkspaceFile,
  WorkspaceFileSearchResult,
} from "@/hooks/useWorkspaceChangedFiles";
import { type RailViewRegistry, railViews } from "@/shell/railViews";
import {
  DEFAULT_WORKSPACE_FILE_SETTINGS,
  type WorkspaceActions,
  type WorkspaceBridge,
  type WorkspaceBridgeState,
  type WorkspaceFileQuery,
  type WorkspaceFileSettings,
  type WorkspaceSource,
  workspaceBridge,
} from "@/shell/workspaceBridge";
import { createExtensionRuntime, type ExtensionRuntime } from "@/vscodeExtensions/extensionHost";
import type { ExtensionStateStore } from "@/vscodeExtensions/memento";

/** A per-test workspaceState store, so mementos never leak between tests. */
export function memoryExtensionState(): ExtensionStateStore {
  const buckets = new Map<string, Record<string, unknown>>();
  return {
    read: (sessionId, extensionId) => buckets.get(`${sessionId}\n${extensionId}`) ?? {},
    write: (sessionId, extensionId, bucket) => {
      buckets.set(`${sessionId}\n${extensionId}`, { ...bucket });
    },
  };
}

export interface BuiltInHarness {
  readonly runtime: ExtensionRuntime;
  readonly registry: RailViewRegistry;
  readonly bridge: WorkspaceBridge;
  /** The workspace source in front, for code under test that publishes on it (tasks). */
  readonly source: WorkspaceSource;
  /** What the workspace on screen shows; settings changes go through `actions`. */
  publish: (patch: Partial<WorkspaceBridgeState>) => Promise<void>;
  readonly state: () => WorkspaceBridgeState;
  /** The workspace actions the source received. */
  readonly openFile: Mock<(path: string) => void>;
  readonly refreshChangedFiles: Mock<() => Promise<void>>;
  readonly updateSettings: Mock<(patch: Partial<WorkspaceFileSettings>) => void>;
  readonly openSession: Mock<(sessionId: string, options: { asSubagent: boolean }) => void>;
  /** Folder listings ("" the root); entry paths relative to the folder. Rejects for a missing folder. */
  readonly readDirectory: Mock<(location: string) => Promise<readonly WorkspaceFile[]>>;
  readonly findFiles: Mock<
    (query: WorkspaceFileQuery, signal: AbortSignal) => Promise<WorkspaceFileSearchResult>
  >;
  readonly refreshFiles: Mock<() => Promise<void>>;
  dispose: () => Promise<void>;
}

/** Lets queued microtasks (event coalescing, activation) run. */
export function flushMicrotasks(): Promise<void> {
  // A macrotask runs after every queued microtask (event coalescing, activation).
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Starts the built-ins on `registry` (the window's by default, which
 * WorkspacePanel reads) with a workspace source in front on `bridge`.
 */
export async function startBuiltIns(
  options: {
    registry?: RailViewRegistry;
    bridge?: WorkspaceBridge;
    sessionId?: string;
    files?: readonly WorkspaceChangedFile[];
    /** False when the code under test registers its own workspace source (AppShell). */
    withSource?: boolean;
    /** The query cache the workspace's session data (the Agents view's) comes from. */
    queryClient?: QueryClient;
    rootSessionId?: string | null;
    agentCostsEnabled?: boolean;
    /** The workspace root (`/workspace` by default; null for none). */
    rootPath?: string | null;
    /** Listings by folder, entry paths relative to it ("" the root). */
    listings?: Record<string, readonly WorkspaceFile[]>;
  } = {},
): Promise<BuiltInHarness> {
  const registry = options.registry ?? railViews;
  const bridge = options.bridge ?? workspaceBridge;
  const source = bridge.createSource();
  let state: WorkspaceBridgeState = {
    sessionId: options.sessionId ?? "conv_abc",
    changedFiles: options.files ?? [],
    availability: "available",
    servedFromHost: false,
    settings: DEFAULT_WORKSPACE_FILE_SETTINGS,
    rootSessionId: options.rootSessionId ?? null,
    agentCostsEnabled: options.agentCostsEnabled ?? false,
    rootPath: options.rootPath === undefined ? "/workspace" : options.rootPath,
    filesRevision: 0,
  };
  const listings = options.listings ?? { "": [] };
  const readDirectory = vi.fn<(location: string) => Promise<readonly WorkspaceFile[]>>(
    (location) =>
      Object.hasOwn(listings, location)
        ? Promise.resolve(listings[location])
        : Promise.reject(new Error("404 Not Found")),
  );
  const findFiles = vi.fn<
    (query: WorkspaceFileQuery, signal: AbortSignal) => Promise<WorkspaceFileSearchResult>
  >(() => Promise.resolve({ files: [], truncated: false, hasMore: false, unavailable: false }));
  const refreshFiles = vi.fn<() => Promise<void>>(() => {
    state = { ...state, filesRevision: (state.filesRevision ?? 0) + 1 };
    source.update(state);
    return Promise.resolve();
  });
  const openFile = vi.fn<(path: string) => void>();
  const refreshChangedFiles = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const updateSettings = vi.fn<(patch: Partial<WorkspaceFileSettings>) => void>((patch) => {
    state = { ...state, settings: { ...state.settings, ...patch } };
    source.update(state);
  });
  const openSession = vi.fn<(sessionId: string, options: { asSubagent: boolean }) => void>();
  const actions: WorkspaceActions = {
    openFile,
    refreshChangedFiles,
    updateSettings,
    openSession,
    readDirectory,
    findFiles,
    refreshFiles,
    ...(options.queryClient ? { queryClient: options.queryClient } : {}),
  };
  source.update(state);
  source.setActions(actions);
  source.setActive(options.withSource !== false);
  const runtime = createExtensionRuntime({
    registry,
    bridge,
    hostOptions: { extensionState: memoryExtensionState() },
  });
  await runtime.builtInsStarted;
  await flushMicrotasks();
  return {
    runtime,
    registry,
    bridge,
    source,
    publish: async (patch) => {
      state = { ...state, ...patch };
      source.update(state);
      await flushMicrotasks();
    },
    state: () => state,
    openFile,
    refreshChangedFiles,
    updateSettings,
    openSession,
    readDirectory,
    findFiles,
    refreshFiles,
    dispose: async () => {
      await runtime.dispose();
      source.dispose();
    },
  };
}

export function changedFile(
  path: string,
  overrides: Partial<WorkspaceChangedFile> = {},
): WorkspaceChangedFile {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    status: "modified",
    bytes: 10,
    modified_at: null,
    lines_added: null,
    lines_removed: null,
    ...overrides,
  };
}
