// Runs the real extension host with the built-in extensions (the Changes tab) for
// renderer tests, against a workspace source the test publishes to.
import { type Mock, vi } from "vitest";
import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";
import { type RailViewRegistry, railViews } from "@/shell/railViews";
import {
  DEFAULT_WORKSPACE_FILE_SETTINGS,
  type WorkspaceActions,
  type WorkspaceBridge,
  type WorkspaceBridgeState,
  type WorkspaceFileSettings,
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
  /** What the workspace on screen shows; settings changes go through `actions`. */
  publish: (patch: Partial<WorkspaceBridgeState>) => Promise<void>;
  readonly state: () => WorkspaceBridgeState;
  /** The workspace actions the source received. */
  readonly openFile: Mock<(path: string) => void>;
  readonly refreshChangedFiles: Mock<() => Promise<void>>;
  readonly updateSettings: Mock<(patch: Partial<WorkspaceFileSettings>) => void>;
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
  };
  const openFile = vi.fn<(path: string) => void>();
  const refreshChangedFiles = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const updateSettings = vi.fn<(patch: Partial<WorkspaceFileSettings>) => void>((patch) => {
    state = { ...state, settings: { ...state.settings, ...patch } };
    source.update(state);
  });
  const actions: WorkspaceActions = { openFile, refreshChangedFiles, updateSettings };
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
    publish: async (patch) => {
      state = { ...state, ...patch };
      source.update(state);
      await flushMicrotasks();
    },
    state: () => state,
    openFile,
    refreshChangedFiles,
    updateSettings,
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
