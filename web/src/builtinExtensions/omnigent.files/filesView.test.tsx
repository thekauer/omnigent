// The Files tab as users see it: the built-in extension running in the real
// extension host, drawn by the host's tree view. Ported from the classic
// FilesPanel and FolderTree tests.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as UseSessionModule from "@/hooks/useSession";
import type * as WorkspaceChangedFilesModule from "@/hooks/useWorkspaceChangedFiles";

const { copyTextMock, sessionState, environmentState } = vi.hoisted(() => ({
  copyTextMock: vi.fn(() => Promise.resolve()),
  sessionState: { hostId: "host_1" as string | null, permissionLevel: null as number | null },
  environmentState: { reachable: null as unknown },
}));
vi.mock("@/lib/clipboard", () => ({ copyText: copyTextMock }));
vi.mock("@/hooks/useSession", async (original) => ({
  ...(await original<typeof UseSessionModule>()),
  useSession: () => ({
    session: { hostId: sessionState.hostId, permissionLevel: sessionState.permissionLevel },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/useWorkspaceChangedFiles", async (original) => ({
  ...(await original<typeof WorkspaceChangedFilesModule>()),
  useWorkspaceEnvironment: () => ({
    data: {
      available: true,
      root: "/workspace",
      home: null,
      reachable: environmentState.reachable,
    },
    isLoading: false,
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  PathUnreachableError,
  RunnerOfflineError,
  type WorkspaceFile,
} from "@/hooks/useWorkspaceChangedFiles";
import { ExtensionRailView } from "@/shell/extensionViews/ExtensionRailView";
import { clearExpandStates } from "@/shell/extensionViews/treeRows";
import {
  ROW_ACTION_SIZE_CLASS,
  ROW_META_SLOT_CLASS,
  ROW_STATUS_SLOT_CLASS,
} from "@/shell/fileStatusUtils";
import { RailViewRegistry } from "@/shell/railViews";
import { WorkspaceBridge, WorkspaceUnavailableError } from "@/shell/workspaceBridge";
import { type BuiltInHarness, changedFile, startBuiltIns } from "@/test/builtInExtensions";
import { VIEW_ID } from "./extension";

let harness: BuiltInHarness;

const file = (
  path: string,
  bytes: number | null = 10,
  modified: number | null = null,
): WorkspaceFile => ({
  path,
  name: path.split("/").at(-1) ?? path,
  type: "file",
  bytes,
  modified_at: modified,
});
const dir = (path: string, modified: number | null = null): WorkspaceFile => ({
  path,
  name: path.split("/").at(-1) ?? path,
  type: "directory",
  bytes: null,
  modified_at: modified,
});

async function start(options: Parameters<typeof startBuiltIns>[0] = {}) {
  harness = await startBuiltIns({
    registry: new RailViewRegistry(),
    bridge: new WorkspaceBridge(),
    ...options,
  });
  return harness;
}

function view(
  conversationId = "conv_abc",
  props: { visible?: boolean; onClose?: () => void } = {},
) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ExtensionRailView
          viewId={VIEW_ID}
          settled
          conversationId={conversationId}
          registry={harness.registry}
          closeLabel="Close files"
          {...props}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const folder = (name: string) => screen.findByRole("button", { name: `${name}/` });
const rowNames = () =>
  Array.from(document.querySelectorAll("[data-tree-item]")).map((row) =>
    (row.textContent ?? "").replace(/\d+(\.\d+)? (B|KB|MB)$/, "").trim(),
  );
const search = (text: string) =>
  fireEvent.change(screen.getByRole("searchbox", { name: "Search all files" }), {
    target: { value: text },
  });

beforeEach(() => {
  copyTextMock.mockClear();
  sessionState.hostId = "host_1";
  sessionState.permissionLevel = null;
  environmentState.reachable = null;
});
afterEach(async () => {
  cleanup();
  clearExpandStates();
  vi.useRealTimers();
  await harness?.dispose();
});

describe("Files tab header", () => {
  it("shows the working folder's name instead of a heading, then copy, Refresh and Open In", async () => {
    await start({ listings: { "": [file("README.md")] } });
    render(view());
    expect(await screen.findByText("workspace")).toHaveClass("font-medium", "text-ui");
    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
    const copy = screen.getByRole("button", { name: "Copy folder path: workspace" });
    const refresh = screen.getByRole("button", { name: "Refresh files" });
    expect(refresh).toHaveAttribute("data-size", "icon-sm");
    expect(copy.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not use the native title tooltip for the folder name", async () => {
    await start();
    render(view());
    expect(await screen.findByText("workspace")).not.toHaveAttribute("title");
  });

  it("handles Windows-style paths", async () => {
    await start({ rootPath: "C:\\Users\\me\\proj" });
    render(view());
    expect(await screen.findByText("proj")).toBeInTheDocument();
  });

  it("draws no folder label while the root is unknown", async () => {
    await start({ rootPath: undefined });
    await harness.publish({ rootPath: undefined });
    render(view());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Loading…"));
    expect(screen.queryByRole("button", { name: /Copy folder path/ })).toBeNull();
  });

  it("puts a Close button in the drawer, before Open In", async () => {
    const onClose = vi.fn();
    await start();
    render(view("conv_abc", { onClose }));
    fireEvent.click(await screen.findByRole("button", { name: "Close files" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("copies the working folder's absolute path", async () => {
    await start();
    render(view());
    fireEvent.click(await screen.findByRole("button", { name: "Copy folder path: workspace" }));
    expect(copyTextMock).toHaveBeenCalledWith("/workspace");
  });

  it("shows the Asleep tag while the host serves the files", async () => {
    await start();
    await harness.publish({ servedFromHost: true });
    render(view());
    expect(await screen.findByTestId("extension-view-tag")).toHaveTextContent("Asleep");
  });
});

describe("Files tab toolbar", () => {
  it("has the search field, Sort, the filters toggle and the hidden toggle, in that order", async () => {
    await start();
    render(view());
    const input = await screen.findByRole("searchbox", { name: "Search all files" });
    expect(input).toHaveAttribute("placeholder", "Find files by name");
    const labels = Array.from(document.querySelectorAll("[data-view-action]")).map((node) =>
      node.getAttribute("aria-label"),
    );
    expect(labels).toEqual([
      "Refresh files",
      "Sort: Filename",
      "Show search filters",
      "Hide hidden files",
    ]);
  });

  it("shows a slashed eye when a click hides hidden files, a plain one when it shows them", async () => {
    await start();
    render(view());
    const hide = await screen.findByRole("button", { name: "Hide hidden files" });
    expect(hide.querySelector(".lucide-eye-off")).not.toBeNull();
    fireEvent.click(hide);
    await waitFor(() => expect(harness.updateSettings).toHaveBeenCalledWith({ showHidden: false }));
    const show = await screen.findByRole("button", { name: "Show hidden files" });
    expect(show.querySelector(".lucide-eye")).not.toBeNull();
  });

  it("sorts through the shared setting", async () => {
    await start();
    render(view());
    fireEvent.pointerDown(await screen.findByRole("button", { name: "Sort: Filename" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Last edited" }));
    await waitFor(() =>
      expect(harness.updateSettings).toHaveBeenCalledWith({ sortOrder: "recent" }),
    );
  });

  it("reveals the include and exclude fields with the filters toggle", async () => {
    await start();
    render(view());
    const toggle = await screen.findByRole("button", { name: "Show search filters" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "files to include" })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("textbox", { name: "files to include" })).toHaveAttribute(
      "placeholder",
      "e.g. *.ts, src/**",
    );
    expect(screen.getByRole("textbox", { name: "files to exclude" })).toHaveAttribute(
      "placeholder",
      "e.g. **/node_modules, *.test.ts",
    );
    expect(screen.getByRole("button", { name: "Hide search filters" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("refreshes the listings and changed files, spinning until the tree reloaded", async () => {
    await start({ listings: { "": [dir("src")], src: [file("a.ts")] } });
    render(view());
    fireEvent.click(await folder("src"));
    await screen.findByText("a.ts");
    harness.readDirectory.mockClear();
    const refresh = screen.getByRole("button", { name: "Refresh files" });
    fireEvent.click(refresh);
    await waitFor(() => expect(harness.refreshFiles).toHaveBeenCalledOnce());
    await waitFor(() => expect(harness.readDirectory).toHaveBeenCalledWith(""));
    await waitFor(() => expect(harness.readDirectory).toHaveBeenCalledWith("src"));
    await waitFor(() => expect(refresh).not.toBeDisabled());
  });
});

describe("Files tab states", () => {
  it("says it is loading before the listing answers, not that the folder is empty", async () => {
    await start();
    harness.readDirectory.mockImplementation(() => new Promise(() => {}));
    await harness.publish({ filesRevision: 1 });
    render(view("conv_new"));
    await harness.publish({ sessionId: "conv_new" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Loading…"));
    expect(screen.queryByText("No files in workspace")).toBeNull();
  });

  it("shows why the workspace could not be read before its root is known", async () => {
    await start({ rootPath: undefined });
    await harness.publish({
      rootPath: undefined,
      changedFiles: undefined,
      error: "503 Service Unavailable",
    });
    render(view());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to load: 503 Service Unavailable",
    );
  });

  it("says an empty workspace is empty", async () => {
    await start({ listings: { "": [] } });
    render(view());
    expect(await screen.findByText("No files in workspace")).toBeInTheDocument();
  });

  it("says so when every file is hidden", async () => {
    await start({ listings: { "": [file(".env")] } });
    await harness.publish({ settings: { sortOrder: "alpha", showHidden: false } });
    render(view());
    expect(
      await screen.findByText("All files are hidden. Click the eye icon to reveal them."),
    ).toBeInTheDocument();
  });

  it("shows the reconnect hint when the runner went offline", async () => {
    await start();
    harness.readDirectory.mockRejectedValue(new RunnerOfflineError());
    await harness.publish({ availability: "agentAsleep", sessionId: "conv_new" });
    render(view("conv_new"));
    expect(await screen.findByText(/Send a message in the chat/)).toBeInTheDocument();
  });

  it("shows the empty state, not the asleep hint, for a session that has not started", async () => {
    await start();
    harness.readDirectory.mockRejectedValue(new RunnerOfflineError());
    await harness.publish({ sessionId: "conv_new" });
    render(view("conv_new"));
    expect(await screen.findByText("No files in workspace")).toBeInTheDocument();
  });

  it("says a session without files has none", async () => {
    await start();
    harness.readDirectory.mockRejectedValue(new WorkspaceUnavailableError());
    await harness.publish({ sessionId: "conv_new" });
    render(view("conv_new"));
    expect(await screen.findByText("No files in workspace")).toBeInTheDocument();
  });

  it("shows any other failure", async () => {
    await start();
    harness.readDirectory.mockRejectedValue(new Error("500 Internal Server Error"));
    await harness.publish({ sessionId: "conv_new" });
    render(view("conv_new"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to load: 500 Internal Server Error",
    );
  });

  it.each([
    ["sandboxOffline", /offline/i],
    ["sandboxStarting", /starting/i],
  ] as const)(
    "says the sandbox is %s instead of an empty workspace",
    async (availability, text) => {
      await start();
      harness.readDirectory.mockImplementation(() => new Promise(() => {}));
      await harness.publish({ availability, filesRevision: 1 });
      render(view("conv_other"));
      await harness.publish({ sessionId: "conv_other" });
      expect(await screen.findByText(text)).toBeInTheDocument();
    },
  );

  it("keeps showing a listing loaded before the sandbox went offline", async () => {
    await start({ listings: { "": [file("kept.md")] } });
    render(view());
    await screen.findByText("kept.md");
    await harness.publish({ availability: "sandboxOffline" });
    expect(screen.getByText("kept.md")).toBeInTheDocument();
  });
});

describe("Files tab tree", () => {
  it("lists folders ahead of files, then files by name", async () => {
    await start({ listings: { "": [file("b.ts"), dir("zeta"), file("a.ts"), dir("alpha")] } });
    render(view());
    await screen.findByText("a.ts");
    expect(rowNames()).toEqual(["alpha/", "zeta/", "a.ts", "b.ts"]);
  });

  it("orders folders by last edited among themselves, still ahead of files", async () => {
    await start({ listings: { "": [dir("old", 1), dir("new", 9), file("f.ts", 1, 5)] } });
    await harness.publish({ settings: { sortOrder: "recent", showHidden: true } });
    render(view());
    await screen.findByText("f.ts");
    expect(rowNames()).toEqual(["new/", "old/", "f.ts"]);
  });

  it("orders files by size, largest first, folders grouped first", async () => {
    await start({ listings: { "": [file("s.ts", 1), file("l.ts", 900), dir("src")] } });
    await harness.publish({ settings: { sortOrder: "size", showHidden: true } });
    render(view());
    await screen.findByText("l.ts");
    expect(rowNames()).toEqual(["src/", "l.ts", "s.ts"]);
  });

  it("orders files by extension for the type order", async () => {
    await start({ listings: { "": [file("b.ts"), file("a.md"), file("c.css")] } });
    await harness.publish({ settings: { sortOrder: "type", showHidden: true } });
    render(view());
    await screen.findByText("a.md");
    expect(rowNames()).toEqual(["c.css", "a.md", "b.ts"]);
  });

  it("hides dotfiles while hidden files are off", async () => {
    await start({ listings: { "": [file(".env"), file("a.ts")] } });
    render(view());
    await screen.findByText(".env");
    await harness.publish({ settings: { sortOrder: "alpha", showHidden: false } });
    await waitFor(() => expect(screen.queryByText(".env")).toBeNull());
    expect(screen.getByText("a.ts")).toBeInTheDocument();
  });

  it("loads a folder's children when it is opened", async () => {
    await start({ listings: { "": [dir("src")], src: [file("app.ts"), dir("lib")] } });
    render(view());
    const src = await folder("src");
    expect(src).toHaveAttribute("aria-expanded", "false");
    expect(harness.readDirectory).not.toHaveBeenCalledWith("src");
    fireEvent.click(src);
    expect(await screen.findByText("app.ts")).toBeInTheDocument();
    expect(harness.readDirectory).toHaveBeenCalledWith("src");
    expect(rowNames()).toEqual(["src/", "lib/", "app.ts"]);
  });

  it("shows Loading under a folder while it lists, then its children", async () => {
    let finish!: (files: WorkspaceFile[]) => void;
    await start({ listings: { "": [dir("src")] } });
    harness.readDirectory.mockImplementation((location) =>
      location === "src"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve([dir("src")]),
    );
    render(view());
    fireEvent.click(await folder("src"));
    expect(await screen.findByText("Loading…")).toBeInTheDocument();
    await act(async () => finish([file("late.ts")]));
    expect(await screen.findByText("late.ts")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("shows an error row when a folder's listing fails", async () => {
    await start({ listings: { "": [dir("broken")] } });
    render(view());
    fireEvent.click(await folder("broken"));
    expect(await screen.findByText("Failed to load this folder.")).toBeInTheDocument();
  });

  it("says a folder's files are all hidden", async () => {
    await start({ listings: { "": [dir("src")], src: [file(".secret")] } });
    await harness.publish({ settings: { sortOrder: "alpha", showHidden: false } });
    render(view());
    fireEvent.click(await folder("src"));
    expect(
      await screen.findByText("All files are hidden. Click the eye icon to reveal them."),
    ).toBeInTheDocument();
  });

  it("loads a deep level of a restored multi-level expansion without clicks", async () => {
    await start({ listings: { "": [dir("a")], a: [dir("b")], "a/b": [file("deep.ts")] } });
    const { unmount } = render(view());
    fireEvent.click(await folder("a"));
    fireEvent.click(await folder("b"));
    await screen.findByText("deep.ts");
    unmount();
    render(view());
    expect(await screen.findByText("deep.ts")).toBeInTheDocument();
  });

  it("shows the size at rest and the download button over it", async () => {
    await start({ listings: { "": [file("readme.md", 2048)] } });
    render(view());
    const size = await screen.findByText("2.0 KB");
    const slot = size.parentElement;
    expect(slot).toHaveClass("relative");
    expect(size).toHaveClass("text-sm", "group-hover:invisible");
    const download = screen.getByRole("button", { name: /download readme\.md/i });
    const overlay = download.closest("span.absolute");
    expect(overlay).not.toBeNull();
    expect(slot).toContainElement(overlay as HTMLElement);
  });

  it("puts a folder's dot and a file's letter in one status column", async () => {
    await start({
      listings: { "": [dir("src"), file("app.ts")] },
      files: [changedFile("src/app.ts"), changedFile("app.ts", { status: "created" })],
    });
    render(view());
    const dot = await screen.findByText("●");
    const letter = screen.getByTitle("Added");
    for (const slot of [dot.parentElement, letter.parentElement]) {
      expect(slot).toHaveClass(ROW_STATUS_SLOT_CLASS, "justify-center");
    }
  });

  it("suppresses list markers on file rows", async () => {
    await start({ listings: { "": [file("README.md")] } });
    render(view());
    expect((await screen.findByText("README.md")).closest("li")).toHaveClass("list-none");
  });

  it("gives folders and files the same trailing column, copy beside download or its space", async () => {
    await start({
      listings: { "": [file("tiny.txt", 985), file("huge.json", 474_000), dir("src")] },
    });
    render(view());
    await screen.findByText("tiny.txt");
    const copies = screen
      .getAllByRole("button", { name: /^Copy (path|folder path):/ })
      .filter(
        (button) => !button.closest("[data-view-action]") && button.closest("[data-tree-item]"),
      );
    expect(copies).toHaveLength(3);
    for (const button of copies) {
      expect(button).toHaveAttribute("data-size", "icon-sm");
      expect(button.closest(`.${ROW_META_SLOT_CLASS}`)).not.toBeNull();
      const beside = button.previousElementSibling;
      expect(
        beside?.getAttribute("aria-label")?.startsWith("Download") ||
          beside?.classList.contains(ROW_ACTION_SIZE_CLASS),
      ).toBe(true);
    }
  });

  it("copies a folder's path from its row", async () => {
    await start({ listings: { "": [dir("src")] } });
    render(view());
    fireEvent.click(await screen.findByRole("button", { name: "Copy folder path: src" }));
    expect(copyTextMock).toHaveBeenCalledWith("src");
  });

  it("shows a folder icon at rest and a chevron on hover, open when expanded", async () => {
    await start({ listings: { "": [dir("src")], src: [] } });
    render(view());
    const row = await folder("src");
    const closed = row.querySelector(".lucide-folder");
    expect(closed?.parentElement).toHaveClass(
      "group-hover/folder:opacity-0",
      "group-focus-visible/folder:opacity-0",
    );
    expect(row.querySelector(".lucide-chevron-right")).toHaveClass(
      "opacity-0",
      "group-hover/folder:opacity-100",
    );
    fireEvent.click(row);
    await waitFor(() => expect(row.querySelector(".lucide-folder-open")).not.toBeNull());
    expect(row.querySelector(".lucide-chevron-right")).toHaveClass("rotate-90");
  });

  it("names files and folders in the interface body-text token", async () => {
    await start({ listings: { "": [dir("src"), file("README.md")] } });
    render(view());
    for (const label of [await screen.findByText("src/"), screen.getByText("README.md")]) {
      expect(label).toHaveClass("text-ui");
      expect(label).not.toHaveClass("font-mono");
    }
  });

  it("animates a folder's rows out before removing them, and in when it opens", async () => {
    await start({ listings: { "": [] }, files: [changedFile("src/app.ts")] });
    render(view());
    const row = await folder("src");
    await screen.findByText("app.ts");
    fireEvent.click(row);
    await waitFor(() => expect(row).toHaveAttribute("aria-expanded", "false"));
    expect(screen.getByText("app.ts").closest("[data-tree-motion]")).toHaveAttribute(
      "data-tree-motion",
      "exit",
    );
    await waitFor(() => expect(screen.queryByText("app.ts")).toBeNull());
    fireEvent.click(row);
    expect((await screen.findByText("app.ts")).closest("[data-tree-motion]")).toHaveAttribute(
      "data-tree-motion",
      "enter",
    );
  });

  it("aligns sibling folders and files at the same indentation", async () => {
    await start({ listings: { "": [dir("src"), file("README.md")] } });
    render(view());
    const folderRow = (await folder("src")).parentElement as HTMLElement;
    const fileRow = screen.getByText("README.md").closest("li")?.firstElementChild as HTMLElement;
    expect(folderRow.style.paddingLeft).toBe("8px");
    expect(fileRow.style.paddingLeft).toBe("8px");
  });

  it("opens a file through the workspace", async () => {
    await start({ listings: { "": [file("README.md")] } });
    render(view());
    fireEvent.click(await screen.findByRole("button", { name: "README.md" }));
    await waitFor(() => expect(harness.openFile).toHaveBeenCalledWith("README.md"));
  });

  it("keeps each session's open folders, and switches without remounting", async () => {
    await start({ listings: { "": [dir("src")], src: [file("a.ts")] } });
    const { rerender } = render(view("conv_abc"));
    fireEvent.click(await folder("src"));
    await screen.findByText("a.ts");
    await harness.publish({ sessionId: "conv_xyz" });
    rerender(view("conv_xyz"));
    await waitFor(() => expect(screen.queryByText("a.ts")).toBeNull());
    await harness.publish({ sessionId: "conv_abc" });
    rerender(view("conv_abc"));
    expect(await screen.findByText("a.ts")).toBeInTheDocument();
  });

  it("restores the scroll position when the session comes back", async () => {
    await start({
      listings: { "": Array.from({ length: 50 }, (_, index) => file(`f${index}.ts`)) },
    });
    const { unmount } = render(view());
    await screen.findByText("f0.ts");
    const section = document.querySelector("section") as HTMLElement;
    section.scrollTop = 120;
    fireEvent.scroll(section);
    unmount();
    render(view());
    await screen.findByText("f0.ts");
    await waitFor(() =>
      expect((document.querySelector("section") as HTMLElement).scrollTop).toBe(120),
    );
  });

  it("moves between rows with the arrow keys and opens and closes folders", async () => {
    await start({ listings: { "": [dir("src"), file("README.md")], src: [file("a.ts")] } });
    render(view());
    const src = await folder("src");
    src.focus();
    fireEvent.keyDown(src, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("button", { name: "README.md" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    await waitFor(() => expect(src).toHaveFocus());
    fireEvent.keyDown(src, { key: "ArrowRight" });
    expect(await screen.findByText("a.ts")).toBeInTheDocument();
    fireEvent.keyDown(src, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("button", { name: "a.ts" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowLeft" });
    await waitFor(() => expect(src).toHaveFocus());
    expect(src.closest("[data-tree-item]")).toHaveAttribute("aria-selected", "true");
  });
});

describe("Files tab change overlay", () => {
  it("adds created and deleted files the listing lacks, with their letters", async () => {
    await start({
      listings: { "": [dir("src"), file("kept.ts")], src: [file("old.ts")] },
      files: [
        changedFile("new.ts", { status: "created" }),
        changedFile("gone.ts", { status: "deleted" }),
        changedFile("src/fresh.ts", { status: "created" }),
      ],
    });
    render(view());
    expect(await screen.findByText("new.ts")).toBeInTheDocument();
    expect(screen.getByText("gone.ts")).toHaveClass("line-through");
    expect(screen.getByTitle("Added")).toHaveTextContent("A");
    expect(screen.getByTitle("Deleted")).toHaveTextContent("D");
    // A folder's known changes show under it while it lists, then with its listing.
    fireEvent.click(await folder("src"));
    expect(await screen.findByText("old.ts")).toBeInTheDocument();
    expect(screen.getByText("fresh.ts")).toBeInTheDocument();
  });

  it("colors a folder by its strongest change", async () => {
    await start({
      listings: { "": [dir("src")] },
      files: [
        changedFile("src/a.ts", { status: "deleted" }),
        changedFile("src/b.ts", { status: "created" }),
      ],
    });
    render(view());
    expect(await screen.findByText("src/")).toHaveClass("text-green-500");
  });

  it("matches workspace changes after browsing into a subfolder", async () => {
    await start({
      listings: { "": [dir("src")], src: [file("app.ts")] },
      files: [changedFile("src/app.ts")],
    });
    render(view());
    fireEvent.doubleClick(await folder("src"));
    await waitFor(() => expect(harness.readDirectory).toHaveBeenCalledWith("src"));
    expect(await screen.findByTitle("Modified")).toBeInTheDocument();
    expect(screen.getByText("app.ts")).toHaveClass("text-amber-500");
  });

  it("reloads the listing when the files changed on disk", async () => {
    await start({ listings: { "": [file("a.ts")] } });
    render(view());
    await screen.findByText("a.ts");
    harness.readDirectory.mockResolvedValue([file("a.ts"), file("b.ts")]);
    await harness.publish({ filesRevision: 7 });
    expect(await screen.findByText("b.ts")).toBeInTheDocument();
  });
});

describe("Files tab search", () => {
  const result = (files: WorkspaceFile[], truncated = false) => ({
    files,
    truncated,
    hasMore: false,
    unavailable: false,
  });

  it("searches after typing pauses and lists matches flat, folders first", async () => {
    await start({ listings: { "": [file("README.md")] } });
    harness.findFiles.mockResolvedValue(result([file("src/app.ts"), dir("src")]));
    render(view());
    await screen.findByText("README.md");
    search("app");
    expect(harness.findFiles).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(harness.findFiles).toHaveBeenCalledWith(
        { pattern: "app", include: "", exclude: "", location: "" },
        expect.any(AbortSignal),
      ),
    );
    expect((await screen.findByText("src/app.ts")).closest("span")).toHaveClass("[direction:rtl]");
    expect(rowNames()).toEqual(["src/", "src/app.ts"]);
    expect(screen.queryByText("README.md")).toBeNull();
  });

  it("says Searching while the request is in flight", async () => {
    await start();
    harness.findFiles.mockImplementation(() => new Promise(() => {}));
    render(view());
    search("x");
    expect(await screen.findByText("Searching…")).toBeInTheDocument();
  });

  it("does not show a previous query's results while the next one loads", async () => {
    await start();
    harness.findFiles.mockResolvedValueOnce(result([file("first.ts")]));
    render(view());
    search("first");
    await screen.findByText("first.ts");
    harness.findFiles.mockImplementation(() => new Promise(() => {}));
    search("second");
    expect(await screen.findByText("Searching…")).toBeInTheDocument();
    expect(screen.queryByText("first.ts")).toBeNull();
  });

  it("says nothing matched", async () => {
    await start();
    render(view());
    search("zzz");
    expect(await screen.findByText('No files match "zzz"')).toBeInTheDocument();
  });

  it("says the search stopped early instead of a plain no-match", async () => {
    await start();
    harness.findFiles.mockResolvedValue(result([], true));
    render(view());
    search("zzz");
    expect(
      await screen.findByText(
        'No files match "zzz". The search stopped early, so results may be incomplete.',
      ),
    ).toBeInTheDocument();
  });

  it("notes partial results", async () => {
    await start();
    harness.findFiles.mockResolvedValue(result([file("a.ts")], true));
    render(view());
    search("a");
    expect(
      await screen.findByText("Search stopped early, so results may be incomplete."),
    ).toBeInTheDocument();
  });

  it("hides dotfile matches while hidden files are off, with a way to show them", async () => {
    await start();
    await harness.publish({ settings: { sortOrder: "alpha", showHidden: false } });
    harness.findFiles.mockResolvedValue(result([file(".github/ci.yml")], true));
    render(view());
    search("ci");
    const line = await screen.findByText(/1 match in hidden directories/);
    expect(line).toHaveTextContent("Search stopped early, so results may be incomplete.");
    fireEvent.click(within(line).getByRole("button", { name: "Show hidden files" }));
    await waitFor(() => expect(harness.updateSettings).toHaveBeenCalledWith({ showHidden: true }));
  });

  it("shows a failed search", async () => {
    await start();
    harness.findFiles.mockRejectedValue(new Error("500 Internal Server Error"));
    render(view());
    search("a");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Search failed: 500 Internal Server Error",
    );
  });

  it("returns to the tree when the query is cleared", async () => {
    await start({ listings: { "": [file("README.md")] } });
    harness.findFiles.mockResolvedValue(result([file("x.ts")]));
    render(view());
    search("x");
    await screen.findByText("x.ts");
    search("");
    expect(await screen.findByText("README.md")).toBeInTheDocument();
  });

  it("sends the include and exclude globs with the query", async () => {
    await start();
    render(view());
    fireEvent.click(await screen.findByRole("button", { name: "Show search filters" }));
    fireEvent.change(screen.getByRole("textbox", { name: "files to include" }), {
      target: { value: "*.ts" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "files to exclude" }), {
      target: { value: "**/node_modules" },
    });
    search("app");
    await waitFor(() =>
      expect(harness.findFiles).toHaveBeenLastCalledWith(
        { pattern: "app", include: "*.ts", exclude: "**/node_modules", location: "" },
        expect.any(AbortSignal),
      ),
    );
    // The toggle marks active filters while they are hidden.
    fireEvent.click(screen.getByRole("button", { name: "Hide search filters" }));
    expect(
      screen.getByRole("button", { name: "Show search filters" }).querySelector(".bg-primary"),
    ).not.toBeNull();
  });

  it("reveals a folder result in the tree, back from the search, its ancestors open", async () => {
    await start({ listings: { "": [dir("a")], a: [dir("b")], "a/b": [dir("target")] } });
    harness.findFiles.mockResolvedValue(result([dir("a/b/target")]));
    render(view());
    search("target");
    fireEvent.click(await screen.findByRole("button", { name: "a/b/target/" }));
    await waitFor(() =>
      expect(screen.getByRole("searchbox", { name: "Search all files" })).toHaveValue(""),
    );
    const target = await folder("target");
    expect(target).toHaveAttribute("aria-expanded", "false");
    expect(await folder("a")).toHaveAttribute("aria-expanded", "true");
    expect(target.parentElement).toHaveClass("animate-user-msg-flash");
    await waitFor(() => expect(target.parentElement).not.toHaveClass("animate-user-msg-flash"), {
      timeout: 2000,
    });
  });

  it("keeps each session's query", async () => {
    await start();
    const { rerender } = render(view("conv_abc"));
    search("mine");
    await harness.publish({ sessionId: "conv_xyz" });
    rerender(view("conv_xyz"));
    expect(screen.getByRole("searchbox", { name: "Search all files" })).toHaveValue("");
  });
});

describe("Files tab browse location", () => {
  const UNCONFINED = {
    unconfined: true,
    roots: [{ path: "/workspace", access: "write", origin: "cwd" }],
  };

  it("stays a plain label when the session may not leave its folder", async () => {
    await start();
    render(view());
    expect(await screen.findByText("workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("browse-location-path")).toBeNull();
    expect(screen.getByRole("button", { name: "Go to parent folder" })).toBeDisabled();
  });

  it("shows the full path, clickable, when the session is unconfined", async () => {
    environmentState.reachable = UNCONFINED;
    await start();
    render(view());
    const trigger = await screen.findByTestId("browse-location-path");
    expect(trigger).toHaveTextContent("/workspace");
    expect(trigger).toHaveClass("cursor-pointer", "hover:bg-muted");
  });

  it("hides the picker from a collaborator who is not the owner", async () => {
    environmentState.reachable = UNCONFINED;
    sessionState.permissionLevel = 1;
    await start();
    render(view());
    await screen.findByText("workspace");
    expect(screen.queryByTestId("browse-location-path")).toBeNull();
  });

  it("goes up one folder, listing it by its absolute path", async () => {
    environmentState.reachable = UNCONFINED;
    await start({ listings: { "": [], "/": [dir("workspace"), dir("etc")] } });
    render(view());
    const back = await screen.findByRole("button", { name: "Go to parent folder" });
    expect(back).toHaveAttribute("data-size", "icon-sm");
    fireEvent.click(back);
    await waitFor(() => expect(harness.readDirectory).toHaveBeenCalledWith("/"));
    expect(await folder("etc")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to working folder" }));
    await waitFor(() => expect(screen.queryByText("etc/")).toBeNull());
  });

  it("opens a file outside the workspace by its absolute path, and copies that folder", async () => {
    environmentState.reachable = UNCONFINED;
    await start({ listings: { "": [], "/": [dir("etc")], "/etc": [file("hosts")] } });
    render(view());
    fireEvent.click(await screen.findByRole("button", { name: "Go to parent folder" }));
    fireEvent.doubleClick(await folder("etc"));
    fireEvent.click(await screen.findByRole("button", { name: "hosts" }));
    await waitFor(() => expect(harness.openFile).toHaveBeenCalledWith("/etc/hosts"));
    fireEvent.click(screen.getByRole("button", { name: "Copy folder path: etc" }));
    expect(copyTextMock).toHaveBeenCalledWith("/etc");
  });

  it("browses a double-clicked folder relative to the workspace, and opens its files there", async () => {
    await start({ listings: { "": [dir("src")], src: [file("App.tsx")] } });
    render(view());
    fireEvent.doubleClick(await folder("src"));
    expect(await screen.findByText("src")).toHaveClass("font-medium");
    fireEvent.click(await screen.findByRole("button", { name: "App.tsx" }));
    await waitFor(() => expect(harness.openFile).toHaveBeenCalledWith("src/App.tsx"));
  });

  it("searches the browsed folder", async () => {
    await start({ listings: { "": [dir("src")], src: [] } });
    render(view());
    fireEvent.doubleClick(await folder("src"));
    await waitFor(() => expect(harness.readDirectory).toHaveBeenCalledWith("src"));
    search("x");
    await waitFor(() =>
      expect(harness.findFiles).toHaveBeenCalledWith(
        expect.objectContaining({ location: "src" }),
        expect.any(AbortSignal),
      ),
    );
  });

  it("remembers the folder across a remount, per session", async () => {
    await start({ listings: { "": [dir("src")], src: [file("in-src.ts")] } });
    const { unmount } = render(view());
    fireEvent.doubleClick(await folder("src"));
    await screen.findByText("in-src.ts");
    unmount();
    render(view());
    expect(await screen.findByText("in-src.ts")).toBeInTheDocument();
    cleanup();
    await harness.publish({ sessionId: "conv_xyz" });
    render(view("conv_xyz"));
    await waitFor(() => expect(screen.queryByText("in-src.ts")).toBeNull());
    expect(await screen.findByText("src/")).toBeInTheDocument();
  });

  it("browses a folder revealed from elsewhere, live and for a session not on screen", async () => {
    await start({
      listings: { "": [dir("src")], src: [file("live.ts")], docs: [file("later.md")] },
    });
    render(view());
    await folder("src");
    await act(() =>
      harness.bridge.executeCommand("omnigent.revealInFiles", "/workspace/src", {
        sessionId: "conv_abc",
      }),
    );
    expect(await screen.findByText("live.ts")).toBeInTheDocument();
    await act(() =>
      harness.bridge.executeCommand("omnigent.revealInFiles", "/workspace/docs", {
        sessionId: "conv_xyz",
      }),
    );
    expect(screen.getByText("live.ts")).toBeInTheDocument();
    cleanup();
    await harness.publish({ sessionId: "conv_xyz" });
    render(view("conv_xyz"));
    expect(await screen.findByText("later.md")).toBeInTheDocument();
  });

  it("reveals a file in the tree, opening its folders", async () => {
    await start({
      listings: { "": [dir("src")], src: [dir("lib")], "src/lib": [file("util.ts")] },
    });
    render(view());
    await folder("src");
    await act(() =>
      harness.bridge.executeCommand("omnigent.revealInFiles", "src/lib/util.ts", {
        sessionId: "conv_abc",
        kind: "file",
      }),
    );
    const util = await screen.findByText("util.ts");
    expect(await folder("lib")).toHaveAttribute("aria-expanded", "true");
    await waitFor(() =>
      expect(util.closest("[data-tree-item]")).toHaveAttribute("aria-selected", "true"),
    );
  });

  it("says why a folder may not be browsed instead of an empty tree", async () => {
    environmentState.reachable = UNCONFINED;
    await start({ listings: { "": [] } });
    harness.readDirectory.mockImplementation((location) =>
      location === "/"
        ? Promise.reject(
            new PathUnreachableError("Path is outside this session's reach", ["/workspace"]),
          )
        : Promise.resolve([]),
    );
    render(view());
    fireEvent.click(await screen.findByRole("button", { name: "Go to parent folder" }));
    expect(await screen.findByTestId("browse-location-error")).toHaveTextContent(
      "Path is outside this session's reach. Reachable: /workspace",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load");
  });
});

describe("Files tab in grids", () => {
  it("shows nothing of another session's workspace while it comes on screen", async () => {
    await start({ listings: { "": [file("mine.ts")] } });
    render(view("conv_other"));
    expect(await screen.findByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("mine.ts")).toBeNull();
    within(document.body);
  });
});
