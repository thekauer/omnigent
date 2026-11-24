// The Changes tab as users see it: the built-in extension running in the real
// extension host, drawn by the host's tree view. Ported from the classic
// FlatFileList and FilesPanel (Changes) tests.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { copyTextMock } = vi.hoisted(() => ({ copyTextMock: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/clipboard", () => ({ copyText: copyTextMock }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { ExtensionRailView } from "@/shell/extensionViews/ExtensionRailView";
import { clearExpandStates } from "@/shell/extensionViews/treeRows";
import { ROW_STATUS_SLOT_CLASS } from "@/shell/fileStatusUtils";
import { RailViewRegistry } from "@/shell/railViews";
import { SCROLL_RESTORE_BUDGET_MS } from "@/shell/useScrollRestore";
import { WorkspaceBridge } from "@/shell/workspaceBridge";
import { type BuiltInHarness, changedFile, startBuiltIns } from "@/test/builtInExtensions";
import { VIEW_ID } from "./extension";

let harness: BuiltInHarness;

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

const rowButton = (path: string) => screen.findByRole("button", { name: path });

beforeEach(() => copyTextMock.mockClear());
afterEach(async () => {
  cleanup();
  clearExpandStates();
  await harness?.dispose();
});

describe("Changes tab chrome", () => {
  it("has the Changes heading, View as Tree and Refresh, the search field, Sort and the hidden toggle", async () => {
    await start({ files: [changedFile("src/app.ts")] });
    render(view());
    expect(await screen.findByRole("heading", { name: "Changes" })).toBeInTheDocument();
    const titleActions = Array.from(document.querySelectorAll("[data-view-action]")).map((node) =>
      node.getAttribute("aria-label"),
    );
    expect(titleActions).toEqual([
      "View as Tree",
      "Refresh files",
      "Sort: Filename",
      "Hide hidden files",
    ]);
    expect(screen.getByRole("searchbox", { name: "Search changed files" })).toHaveAttribute(
      "placeholder",
      "Find changed files by name",
    );
  });

  it("puts a Close button in the drawer", async () => {
    const onClose = vi.fn();
    await start();
    render(view("conv_abc", { onClose }));
    fireEvent.click(await screen.findByRole("button", { name: "Close files" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("badges the tab with the changed-file count", async () => {
    await start({ files: [changedFile("a.ts"), changedFile(".env")] });
    expect(harness.registry.get(VIEW_ID)?.badge).toEqual({ value: 2, tooltip: "2 changed" });
    await harness.publish({ changedFiles: [] });
    expect(harness.registry.get(VIEW_ID)?.badge).toBeUndefined();
  });

  it("refreshes through the workspace, the button spinning and disabled while it runs", async () => {
    await start();
    let finish!: () => void;
    harness.refreshChangedFiles.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(view());
    const refresh = await screen.findByRole("button", { name: "Refresh files" });
    fireEvent.click(refresh);
    await waitFor(() => expect(refresh).toBeDisabled());
    expect(refresh.querySelector("svg")).toHaveClass("animate-spin");
    await act(async () => finish());
    await waitFor(() => expect(refresh).not.toBeDisabled());
    expect(harness.refreshChangedFiles).toHaveBeenCalledOnce();
  });
});

describe("Changes tab states", () => {
  it("shows Loading while the list loads", async () => {
    await start();
    await harness.publish({ changedFiles: undefined });
    render(view());
    await waitFor(() => expect(screen.getByText("Loading…")).toBeInTheDocument());
  });

  it("shows the reconnect hint when the agent went asleep, not the raw error", async () => {
    await start();
    await harness.publish({ changedFiles: undefined, availability: "agentAsleep" });
    render(view());
    expect(await screen.findByText(/agent is asleep/i)).toBeInTheDocument();
    expect(screen.getByText(/send a message in the chat to reconnect/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed to load/i)).toBeNull();
  });

  it("shows the empty state for a session that has not started", async () => {
    await start();
    render(view());
    expect(await screen.findByText("No workspace changes yet")).toBeInTheDocument();
    expect(screen.queryByText(/agent is asleep/i)).toBeNull();
  });

  it("still shows a real failure, as an error", async () => {
    await start();
    await harness.publish({ changedFiles: undefined, error: "500 Internal Server Error" });
    render(view());
    const message = await screen.findByText("Failed to load: 500 Internal Server Error");
    expect(message).toHaveClass("text-destructive");
  });

  it.each([
    ["sandboxOffline", /sandbox is offline/i],
    ["sandboxStarting", /starting sandbox/i],
  ] as const)("names the sandbox when it is %s", async (availability, text) => {
    await start();
    await harness.publish({ changedFiles: undefined, availability });
    render(view());
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("tags the title Asleep while the host serves an asleep agent's files", async () => {
    await start({ files: [changedFile("a.ts")] });
    render(view());
    await rowButton("a.ts");
    expect(screen.queryByTestId("extension-view-tag")).toBeNull();
    await act(() => harness.publish({ servedFromHost: true }));
    expect(await screen.findByTestId("extension-view-tag")).toHaveTextContent("Asleep");
    expect(screen.getByRole("button", { name: "a.ts" })).toBeInTheDocument();
  });

  it("retries a failed list when the view comes on screen (a 502 on the first fetch)", async () => {
    await start();
    await harness.publish({ changedFiles: undefined, error: "502 Bad Gateway" });
    const { rerender } = render(view("conv_abc", { visible: false }));
    await screen.findByText("Failed to load: 502 Bad Gateway");
    expect(harness.refreshChangedFiles).not.toHaveBeenCalled();
    rerender(view("conv_abc", { visible: true }));
    await waitFor(() => expect(harness.refreshChangedFiles).toHaveBeenCalled());
    expect(harness.registry.get(VIEW_ID)).toBeDefined();
  });
});

describe("Changes tab rows", () => {
  it("shows the size with the Files tree's caption, swapped for actions on hover", async () => {
    await start({ files: [changedFile("src/app.ts", { bytes: 2048 })] });
    render(view());
    const size = await screen.findByText("2.0 KB");
    expect(size).toHaveClass("text-sm", "text-muted-foreground", "group-hover:invisible");
    expect(screen.getByText("M").parentElement).toHaveClass(ROW_STATUS_SLOT_CLASS);
    const slot = size.parentElement!;
    expect(slot).toHaveClass("relative");
    const overlay = screen
      .getByRole("button", { name: /download app\.ts/i })
      .closest("span.absolute");
    expect(slot).toContainElement(overlay as HTMLElement);
  });

  it("renders +N and −M, only −M's side for a deletion, and nothing for 0/0 or null", async () => {
    await start({
      files: [
        changedFile("src/app.ts", { lines_added: 12, lines_removed: 3 }),
        changedFile("gone.py", {
          status: "deleted",
          bytes: null,
          lines_added: 0,
          lines_removed: 7,
        }),
        changedFile("img.bin", { lines_added: null, lines_removed: null }),
        changedFile("script.sh", { lines_added: 0, lines_removed: 0 }),
      ],
    });
    render(view());
    expect(await screen.findByText("+12")).toBeInTheDocument();
    expect(screen.getByText("−3")).toBeInTheDocument();
    expect(screen.getByText("−7")).toBeInTheDocument();
    expect(screen.getByText("+0")).toBeInTheDocument();
    expect(screen.getAllByText(/^\+/)).toHaveLength(2);
  });

  it("copies the full path from a button named for the file", async () => {
    await start({ files: [changedFile("src/deep/app.ts")] });
    render(view());
    fireEvent.click(await screen.findByRole("button", { name: "Copy path: app.ts" }));
    expect(copyTextMock).toHaveBeenCalledWith("src/deep/app.ts");
  });

  it("opens a file through the workspace, including a deleted one without a download", async () => {
    await start({ files: [changedFile("api/gone.py", { status: "deleted", bytes: null })] });
    render(view());
    fireEvent.click(await rowButton("api/gone.py"));
    await waitFor(() => expect(harness.openFile).toHaveBeenCalledWith("api/gone.py"));
    expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
  });

  it("groups repositories in order, opens and copies duplicate names by full path, and collapses", async () => {
    const files = [
      changedFile("web/src/app.ts", { repository_root: "web", lines_added: 1, lines_removed: 0 }),
      changedFile("api/src/app.ts", { repository_root: "api", lines_added: 1, lines_removed: 0 }),
      changedFile("notes.md"),
    ];
    await start({ files });
    render(view());
    const headers = await screen.findAllByRole("button", { name: /changed files$/ });
    expect(headers.map((header) => header.getAttribute("aria-label"))).toEqual([
      "api, 1 changed files",
      "web, 1 changed files",
      "Other files, 1 changed files",
    ]);
    for (const root of ["api", "web"]) {
      const row = screen
        .getByRole("button", { name: `${root}/src/app.ts` })
        .closest("[data-tree-item]") as HTMLElement;
      expect(within(row).getByText("src")).toBeInTheDocument();
      fireEvent.click(within(row).getByRole("button", { name: `${root}/src/app.ts` }));
      fireEvent.click(within(row).getByRole("button", { name: "Copy path: app.ts" }));
      expect(copyTextMock).toHaveBeenLastCalledWith(`${root}/src/app.ts`);
    }
    await waitFor(() =>
      expect(harness.openFile.mock.calls).toEqual([["api/src/app.ts"], ["web/src/app.ts"]]),
    );
    const api = screen.getByRole("button", { name: "api, 1 changed files" });
    fireEvent.click(api);
    await waitFor(() => expect(api).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByRole("button", { name: "api/src/app.ts" })).toBeNull();
    expect(screen.getByRole("button", { name: "web/src/app.ts" })).toBeInTheDocument();
    fireEvent.click(api);
    expect(await rowButton("api/src/app.ts")).toBeInTheDocument();
  });

  it("leaves rows without a repository flat", async () => {
    await start({ files: [changedFile(".env"), changedFile("z.py")] });
    render(view());
    expect(await rowButton(".env")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /changed files$/ })).toBeNull();
  });
});

describe("Changes tab search, sort and hidden files", () => {
  const files = [
    changedFile("src/Alpha.ts", { bytes: 5, modified_at: 1 }),
    changedFile("docs/beta.md", { bytes: 50, modified_at: 3 }),
    changedFile("src/gamma.ts", { bytes: 500, modified_at: 2 }),
  ];
  const rowNames = () =>
    Array.from(document.querySelectorAll("[data-tree-item] button[aria-label]"))
      .map((button) => button.getAttribute("aria-label")!)
      .filter((name) => !name.startsWith("Copy") && !name.startsWith("Download"));

  it("filters loaded files by name or full path, case-insensitively", async () => {
    await start({ files });
    render(view());
    await rowButton("src/Alpha.ts");
    const search = screen.getByRole("searchbox", { name: "Search changed files" });
    fireEvent.change(search, { target: { value: "ALPHA" } });
    await waitFor(() => expect(rowNames()).toEqual(["src/Alpha.ts"]));
    fireEvent.change(search, { target: { value: "docs/" } });
    await waitFor(() => expect(rowNames()).toEqual(["docs/beta.md"]));
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(await screen.findByText('No changed files match "zzz"')).toBeInTheDocument();
  });

  it("keeps each session's search text", async () => {
    await start({ files, sessionId: "conv_a" });
    const { rerender } = render(view("conv_a"));
    await rowButton("src/Alpha.ts");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "beta" } });
    await waitFor(() => expect(rowNames()).toEqual(["docs/beta.md"]));
    await act(() => harness.publish({ sessionId: "conv_b" }));
    rerender(view("conv_b"));
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    await act(() => harness.publish({ sessionId: "conv_a" }));
    rerender(view("conv_a"));
    await waitFor(() => expect(rowNames()).toEqual(["docs/beta.md"]));
    expect(screen.getByRole("searchbox")).toHaveValue("beta");
  });

  it("sorts by the shared sort setting from the Sort menu", async () => {
    await start({ files });
    render(view());
    await rowButton("src/Alpha.ts");
    expect(rowNames()).toEqual(["docs/beta.md", "src/Alpha.ts", "src/gamma.ts"]);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort: Filename" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Size" }));
    await waitFor(() => expect(harness.updateSettings).toHaveBeenCalledWith({ sortOrder: "size" }));
    await waitFor(() =>
      expect(rowNames()).toEqual(["src/gamma.ts", "docs/beta.md", "src/Alpha.ts"]),
    );
    expect(screen.getByRole("button", { name: "Sort: Size" })).toBeInTheDocument();
    await act(() =>
      harness.publish({ settings: { ...harness.state().settings, sortOrder: "recent" } }),
    );
    await waitFor(() =>
      expect(rowNames()).toEqual(["docs/beta.md", "src/gamma.ts", "src/Alpha.ts"]),
    );
  });

  it("hides hidden files behind the toggle, warning while some are hidden", async () => {
    await start({ files: [changedFile("a.ts"), changedFile("api/.env")] });
    await harness.publish({ settings: { ...harness.state().settings, showHidden: false } });
    render(view());
    await rowButton("a.ts");
    expect(screen.queryByRole("button", { name: "api/.env" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show hidden files" });
    expect(toggle).toHaveClass("text-warning");
    // The warning names the count, as the classic toggle did.
    expect(
      harness.registry
        .get(VIEW_ID)
        ?.actions.find((action) => action.id === "omnigent.changes.showHiddenFiles")?.tooltip,
    ).toBe("1 file in hidden directories. Click to show.");
    expect(toggle.querySelector("svg")).toHaveClass("lucide-eye");
    expect(screen.getByText(/1 file hidden\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Click to show" }));
    await waitFor(() => expect(harness.updateSettings).toHaveBeenCalledWith({ showHidden: true }));
    expect(await rowButton("api/.env")).toBeInTheDocument();
    const hide = screen.getByRole("button", { name: "Hide hidden files" });
    expect(hide.querySelector("svg")).toHaveClass("lucide-eye-off");
    fireEvent.click(hide);
    await waitFor(() => expect(screen.queryByRole("button", { name: "api/.env" })).toBeNull());
  });

  it("says when every change is in a hidden file, and keeps hidden search results hidden", async () => {
    await start({ files: [changedFile(".env"), changedFile("src/.cache")] });
    await harness.publish({ settings: { ...harness.state().settings, showHidden: false } });
    render(view());
    expect(await screen.findByText(/All changes are in hidden files\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show hidden files" })).not.toHaveClass(
      "text-muted-foreground",
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "env" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: ".env" })).toBeNull());
  });

  it("keeps a hidden file out of search results until hidden files are shown", async () => {
    await start({ files: [changedFile(".env"), changedFile("src/App.tsx")] });
    await harness.publish({ settings: { ...harness.state().settings, showHidden: false } });
    render(view());
    await rowButton("src/App.tsx");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: ".env" } });
    expect(await screen.findByText('No changed files match ".env"')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ".env" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show hidden files" }));
    expect(await rowButton(".env")).toBeInTheDocument();
  });
});

describe("Changes tab list and tree", () => {
  const files = [
    changedFile("src/lib/a.ts", { status: "created" }),
    changedFile("src/b.ts"),
    changedFile("README.md"),
  ];

  it("toggles to a folder tree and back, remembering the mode per session", async () => {
    await start({ files, sessionId: "conv_a" });
    const { rerender } = render(view("conv_a"));
    await rowButton("src/b.ts");
    fireEvent.click(screen.getByRole("button", { name: "View as Tree" }));
    expect(await screen.findByRole("button", { name: "View as List" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /^lib/ })).toBeInTheDocument());
    await act(() => harness.publish({ sessionId: "conv_b" }));
    rerender(view("conv_b"));
    expect(await screen.findByRole("button", { name: "View as Tree" })).toBeInTheDocument();
    await act(() => harness.publish({ sessionId: "conv_a" }));
    rerender(view("conv_a"));
    expect(await screen.findByRole("button", { name: "View as List" })).toBeInTheDocument();
  });

  it("does not show another session's rows while that workspace comes on screen", async () => {
    await start({ files, sessionId: "conv_a" });
    render(view("conv_b"));
    expect(await screen.findByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "src/b.ts" })).toBeNull();
    await act(() =>
      harness.publish({ sessionId: "conv_b", changedFiles: [changedFile("other.ts")] }),
    );
    expect(await rowButton("other.ts")).toBeInTheDocument();
  });
});

describe("Changes tab scroll position", () => {
  it("restores the saved scroll position when the view comes back", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(10_000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
    await start({ files: Array.from({ length: 50 }, (_, index) => changedFile(`f${index}.ts`)) });
    const { unmount } = render(view());
    await rowButton("f0.ts");
    const scroller = document.querySelector("section.overflow-y-auto") as HTMLElement;
    scroller.scrollTop = 420;
    fireEvent.scroll(scroller);
    unmount();
    render(view());
    await rowButton("f0.ts");
    const restored = document.querySelector("section.overflow-y-auto") as HTMLElement;
    await waitFor(() => expect(restored.scrollTop).toBe(420), {
      timeout: SCROLL_RESTORE_BUDGET_MS,
    });
    vi.restoreAllMocks();
  });
});
