// `workspace.fs.readDirectory` and `workspace.findFiles` end to end, down to the
// request URL: whatever path an extension passes, the request the browser sends
// (after it resolves dot segments) stays on the session's filesystem or search
// route. Also the path normalization and the clean errors for a malformed answer.
import { describe, expect, it, vi } from "vitest";

vi.mock(import("@/lib/workspaceApi"), async (original) => ({
  ...(await original()),
  listDirectoryViaWorkspaceApi: vi.fn(async () => null),
  searchFilesViaWorkspaceApi: vi.fn(async () => null),
}));
vi.mock(import("@/lib/identity"), async (original) => ({
  ...(await original()),
  authenticatedFetch: vi.fn(),
}));

import { QueryClient } from "@tanstack/react-query";
import {
  browseLocationSegment,
  fetchWorkspaceAllFiles,
  fetchWorkspaceFileSearch,
} from "@/hooks/useWorkspaceChangedFiles";
import { authenticatedFetch } from "@/lib/identity";
import { readWorkspaceDirectory } from "@/shell/useWorkspaceBridgeSource";
import {
  DEFAULT_WORKSPACE_FILE_SETTINGS,
  type WorkspaceActions,
  WorkspaceBridge,
} from "@/shell/workspaceBridge";
import { WorkspaceService } from "./workspaceService";

const fetchMock = vi.mocked(authenticatedFetch);
const SESSION = "s1";
const ROUTES = [
  `/v1/sessions/${SESSION}/resources/environments/default/filesystem`,
  `/v1/sessions/${SESSION}/resources/environments/default/search`,
];

function listing(data: unknown = [{ path: "a.ts", name: "a.ts", type: "file" }]): Response {
  return new Response(JSON.stringify({ object: "list", data, has_more: false }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** A workspace service wired to the real fetchers, as the shell wires it. */
function service(actions: Partial<WorkspaceActions> = {}) {
  const bridge = new WorkspaceBridge();
  const source = bridge.createSource();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  source.update({
    sessionId: SESSION,
    changedFiles: [],
    availability: "available",
    servedFromHost: false,
    settings: DEFAULT_WORKSPACE_FILE_SETTINGS,
    rootPath: "/w",
    filesRevision: 0,
  });
  source.setActions({
    openFile: () => {},
    queryClient,
    refreshChangedFiles: () => Promise.resolve(),
    updateSettings: () => {},
    readDirectory: (location) => readWorkspaceDirectory(queryClient, SESSION, location),
    findFiles: (query, signal) =>
      fetchWorkspaceFileSearch(
        SESSION,
        query.pattern,
        query.include,
        query.exclude,
        query.location,
        signal,
      ),
    ...actions,
  });
  source.setActive(true);
  return new WorkspaceService(bridge);
}

/** Every requested URL as the browser would send it, resolved against the page. */
function requestedPaths(): string[] {
  return fetchMock.mock.calls.map(([input]) => {
    const url = new URL(String(input), "https://omnigent.example/app/");
    expect(url.origin).toBe("https://omnigent.example");
    return decodeURIComponent(url.pathname);
  });
}

const HOSTILE = [
  "/../../../../../../../v1/sessions",
  "/../../../../../../../v1/hosts",
  "/./../v1/hosts",
  "/etc/../../../../../../../../v1/sessions",
  "/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/v1/hosts",
  "/%2E%2E/%2E%2E/v1/hosts",
  "/%252e%252e/v1/hosts",
  "/a%2f..%2f..%2fv1",
  "/a%5c..%5cv1",
  "/..\\..\\v1\\hosts",
  "\\..\\v1",
  "../../../v1/sessions",
  "src/../../v1",
  "%2e%2e/v1",
  "./../v1",
  "/.",
  "/./etc",
];

describe("workspace filesystem paths", () => {
  it.each(HOSTILE)("refuses %s before anything is requested", async (path) => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => listing());
    const workspace = service();
    await expect(workspace.readDirectory(path)).rejects.toThrow(/cannot contain/);
    await expect(workspace.findFiles({ pattern: "a", location: path })).rejects.toThrow(
      /cannot contain/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never sends a request outside the filesystem and search routes", async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => listing());
    const workspace = service();
    const paths = [...HOSTILE, "", "/", "src", "./web", "/etc", "/my docs/x", "a//b/"];
    for (const path of paths) {
      // oxlint-disable-next-line no-await-in-loop
      await workspace.readDirectory(path).catch(() => {});
      // oxlint-disable-next-line no-await-in-loop
      await workspace.findFiles({ pattern: "a", location: path }).catch(() => {});
    }
    const sent = requestedPaths();
    expect(sent.length).toBeGreaterThan(0);
    for (const sentPath of sent) {
      expect(
        ROUTES.some((route) => sentPath === route || sentPath.startsWith(`${route}/`)),
        sentPath,
      ).toBe(true);
    }
  });

  it("refuses dot segments in the URL helper itself", () => {
    expect(() => browseLocationSegment("/../v1/hosts")).toThrow(/cannot contain/);
    expect(() => browseLocationSegment("src/../../v1")).toThrow(/cannot contain/);
    expect(browseLocationSegment("./src/./app.ts")).toBe("src/app.ts");
    expect(browseLocationSegment("/%2e%2e")).toBe("%252e%252e");
    expect(browseLocationSegment("/a\\b")).toBe("a%5Cb");
  });

  it("rejects a hostile location in the fetchers when called directly", async () => {
    fetchMock.mockReset();
    await expect(fetchWorkspaceAllFiles(SESSION, "/../../v1/hosts")).rejects.toThrow(
      /cannot contain/,
    );
    await expect(fetchWorkspaceFileSearch(SESSION, "a", "", "", "/../../v1/hosts")).rejects.toThrow(
      /cannot contain/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes . and empty segments of a relative folder", async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () =>
      listing([
        { path: "web/a.ts", name: "a.ts", type: "file" },
        { path: "web/src", name: "src", type: "directory" },
      ]),
    );
    const workspace = service();
    const entries = await workspace.readDirectory("./web/");
    expect(entries.map((entry) => entry.path)).toEqual(["web/a.ts", "web/src"]);
    expect((await workspace.readDirectory("web/./")).map((entry) => entry.path)).toEqual([
      "web/a.ts",
      "web/src",
    ]);
    const found = await workspace.findFiles({ pattern: "a", location: ".//web" });
    expect(found.files.map((entry) => entry.path)).toEqual(["web/a.ts", "web/src"]);
    expect(requestedPaths().every((path) => path.endsWith("/web"))).toBe(true);
    expect((await workspace.readDirectory(".")).length).toBe(2);
    expect(requestedPaths().at(-1)).toBe(ROUTES[0]);
  });

  it.each([
    ["an object without data", {}],
    ["data that is not a list", { data: { path: "a" } }],
    ["entries without a path", { data: [{ name: "a" }] }],
    ["null", null],
  ])("answers %s with a clean Unknown error", async (_name, body) => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));
    const workspace = service();
    const error = await workspace.readDirectory("src").catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      name: "FileSystemError",
      code: "Unknown",
      message: "the workspace returned an unexpected response",
      reachableRoots: [],
    });
    await expect(workspace.findFiles({ pattern: "a" })).rejects.toThrow(
      "the workspace returned an unexpected response",
    );
  });

  it("answers a reader that resolves a non-list with a clean Unknown error", async () => {
    const workspace = service({
      readDirectory: () => Promise.resolve(undefined as never),
      findFiles: () => Promise.resolve({ files: undefined } as never),
    });
    await expect(workspace.readDirectory("")).rejects.toMatchObject({
      code: "Unknown",
      message: "the workspace returned an unexpected response",
    });
    await expect(workspace.findFiles({ pattern: "a" })).rejects.toThrow(
      "the workspace returned an unexpected response",
    );
  });
});
