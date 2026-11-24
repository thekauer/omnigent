// What a workspace surface publishes to extension views, from its queries. Ports
// the classic Changes list's loading, failure, offline and asleep cases.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RunnerOfflineError,
  useWorkspaceAsleep,
  useWorkspaceChangedFiles,
  useWorkspaceEnvironment,
} from "@/hooks/useWorkspaceChangedFiles";
import type * as WorkspaceChangedFilesModule from "@/hooks/useWorkspaceChangedFiles";
import { useChatStore } from "@/store/chatStore";
import { changedFile } from "@/test/builtInExtensions";
import {
  useWorkspaceBridgeSource,
  type WorkspaceBridgeSourceOptions,
} from "./useWorkspaceBridgeSource";
import { WorkspaceBridge } from "./workspaceBridge";

vi.mock("@/hooks/useWorkspaceChangedFiles", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceChangedFilesModule>()),
  useWorkspaceAsleep: vi.fn(() => false),
  useWorkspaceChangedFiles: vi.fn(),
  useWorkspaceEnvironment: vi.fn(),
}));
let sandboxStarting = false;
vi.mock("@/hooks/useSessionReconnect", () => ({ useSandboxStarting: () => sandboxStarting }));
let runnerOnline: boolean | undefined;
let hostOnline: boolean | null | undefined;
vi.mock("@/hooks/RunnerHealthProvider", () => ({
  useSessionRunnerOnline: () => runnerOnline,
  useSessionHostOnline: () => hostOnline,
}));

const changedMock = vi.mocked(useWorkspaceChangedFiles);
const environmentMock = vi.mocked(useWorkspaceEnvironment);
const asleepMock = vi.mocked(useWorkspaceAsleep);

function query(state: { data?: unknown; isLoading?: boolean; error?: Error }) {
  return {
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.error !== undefined,
    error: state.error ?? null,
  } as never;
}
const loadedEnvironment = query({ data: { available: true, root: "/w" } });

function Surface(props: Partial<WorkspaceBridgeSourceOptions> & { bridge: WorkspaceBridge }) {
  useWorkspaceBridgeSource({
    sessionId: "conv_a",
    enabled: true,
    active: true,
    openFile: () => {},
    sortOrder: "alpha",
    onSortOrderChange: () => {},
    showHidden: true,
    onShowHiddenChange: () => {},
    ...props,
  });
  return null;
}

const wrap = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
);

beforeEach(() => {
  sandboxStarting = false;
  runnerOnline = undefined;
  hostOnline = undefined;
  asleepMock.mockReturnValue(false);
  environmentMock.mockReturnValue(loadedEnvironment);
  changedMock.mockReturnValue(query({ data: { available: true, data: [] } }));
  useChatStore.setState({ conversationId: null, sessionStatus: "idle" } as never);
});
afterEach(cleanup);

describe("useWorkspaceBridgeSource", () => {
  it("publishes the loaded files, the settings, and nothing while inactive", () => {
    const bridge = new WorkspaceBridge();
    const files = [changedFile("a.ts")];
    changedMock.mockReturnValue(query({ data: { available: true, data: files } }));
    const { rerender } = render(wrap(<Surface bridge={bridge} active={false} />));
    expect(bridge.getState().sessionId).toBeNull();
    rerender(wrap(<Surface bridge={bridge} />));
    expect(bridge.getState()).toMatchObject({
      sessionId: "conv_a",
      changedFiles: files,
      availability: "available",
      settings: { sortOrder: "alpha", showHidden: true },
    });
  });

  it("says loading, not empty, before the environment answers", () => {
    const bridge = new WorkspaceBridge();
    environmentMock.mockReturnValue(query({ isLoading: true }));
    changedMock.mockReturnValue(query({}));
    render(wrap(<Surface bridge={bridge} />));
    expect(bridge.getState().changedFiles).toBeUndefined();
    expect(bridge.getState().error).toBeUndefined();
  });

  it("reports why the environment failed", () => {
    const bridge = new WorkspaceBridge();
    environmentMock.mockReturnValue(query({ error: new Error("environment unavailable") }));
    changedMock.mockReturnValue(query({}));
    render(wrap(<Surface bridge={bridge} />));
    expect(bridge.getState().error).toBe("environment unavailable");
  });

  it("says the agent is asleep when the runner went offline, empty when it never started", () => {
    const bridge = new WorkspaceBridge();
    changedMock.mockReturnValue(query({ error: new RunnerOfflineError() }));
    const { rerender } = render(wrap(<Surface bridge={bridge} />));
    expect(bridge.getState()).toMatchObject({ changedFiles: [], availability: "available" });
    useChatStore.setState({ conversationId: "conv_a", sessionStatus: "failed" } as never);
    rerender(wrap(<Surface bridge={bridge} />));
    expect(bridge.getState()).toMatchObject({
      changedFiles: undefined,
      availability: "agentAsleep",
    });
    expect(bridge.getState().error).toBeUndefined();
  });

  it("names an offline or starting sandbox, but keeps a list cached before it slept", () => {
    const bridge = new WorkspaceBridge();
    asleepMock.mockReturnValue(true);
    changedMock.mockReturnValue(query({}));
    const { rerender } = render(wrap(<Surface bridge={bridge} />));
    expect(bridge.getState().availability).toBe("sandboxOffline");
    sandboxStarting = true;
    rerender(wrap(<Surface bridge={bridge} />));
    expect(bridge.getState().availability).toBe("sandboxStarting");
    const files = [changedFile("README.md")];
    changedMock.mockReturnValue(query({ data: { available: true, data: files } }));
    rerender(wrap(<Surface bridge={bridge} />));
    expect(bridge.getState()).toMatchObject({ availability: "available", changedFiles: files });
  });

  it("flags a workspace the host serves while the agent sleeps", () => {
    const bridge = new WorkspaceBridge();
    runnerOnline = false;
    hostOnline = true;
    render(wrap(<Surface bridge={bridge} />));
    expect(bridge.getState().servedFromHost).toBe(true);
  });

  it("publishes no files for a session whose workspace cannot be read", () => {
    const bridge = new WorkspaceBridge();
    render(wrap(<Surface bridge={bridge} enabled={false} />));
    expect(bridge.getState().changedFiles).toEqual([]);
  });

  it("routes the bridge's actions to the surface in front, and the latest activated wins", () => {
    const bridge = new WorkspaceBridge();
    const openA = vi.fn();
    const openB = vi.fn();
    const sortB = vi.fn();
    const { rerender } = render(
      wrap(
        <>
          <Surface bridge={bridge} openFile={openA} />
          <Surface
            bridge={bridge}
            sessionId="conv_b"
            active={false}
            openFile={openB}
            onSortOrderChange={sortB}
          />
        </>,
      ),
    );
    bridge.openFile("x.ts");
    expect(openA).toHaveBeenCalledWith("x.ts");
    rerender(
      wrap(
        <>
          <Surface bridge={bridge} openFile={openA} />
          <Surface bridge={bridge} sessionId="conv_b" openFile={openB} onSortOrderChange={sortB} />
        </>,
      ),
    );
    expect(bridge.getState().sessionId).toBe("conv_b");
    bridge.openFile("y.ts");
    bridge.updateSettings({ sortOrder: "size" });
    expect(openB).toHaveBeenCalledWith("y.ts");
    expect(sortB).toHaveBeenCalledWith("size");
    cleanup();
    expect(bridge.getState().sessionId).toBeNull();
    expect(() => bridge.openFile("z.ts")).toThrow("no workspace is open");
  });
});
