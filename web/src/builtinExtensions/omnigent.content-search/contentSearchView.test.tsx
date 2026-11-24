// The Content search tab as users see it: the built-in extension running in the
// real extension host, its form and results drawn by the host. Ported from the
// classic ContentSearchPanel tests; a session switch is the workspace on screen
// changing, and a remount is the tab's page drawing again.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { authenticatedFetch } from "@/lib/identity";
import { ExtensionRailView } from "@/shell/extensionViews/ExtensionRailView";
import { RailViewRegistry } from "@/shell/railViews";
import { WorkspaceBridge } from "@/shell/workspaceBridge";
import { type BuiltInHarness, startBuiltIns } from "@/test/builtInExtensions";
import { VIEW_ID } from "./extension";

vi.mock("@/lib/identity", () => ({ authenticatedFetch: vi.fn() }));

let harness: BuiltInHarness;

async function start(sessionId = "session-one") {
  harness = await startBuiltIns({
    registry: new RailViewRegistry(),
    bridge: new WorkspaceBridge(),
    sessionId,
  });
  return harness;
}

function view(conversationId = "session-one", key: string | number = conversationId) {
  return (
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <ExtensionRailView
            key={key}
            viewId={VIEW_ID}
            settled
            conversationId={conversationId}
            registry={harness.registry}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}

/** Brings another session's workspace on screen and draws the tab for it. */
async function switchTo(
  rerender: (ui: React.ReactElement) => void,
  conversationId: string,
): Promise<void> {
  await harness.publish({ sessionId: conversationId });
  rerender(view(conversationId));
}

const searchbox = () => screen.getByRole("searchbox", { name: "Search file contents" });
const submit = () => fireEvent.submit(searchbox().closest("form")!);
const emptyResult = () =>
  new Response(JSON.stringify({ matches: [], truncated: false, warning: null }));

afterEach(async () => {
  cleanup();
  vi.resetAllMocks();
  await harness?.dispose();
});

it("searches only on submission and allows the same query to run again", async () => {
  vi.mocked(authenticatedFetch).mockImplementation(async () => emptyResult());
  await start();
  const { rerender } = render(view("session-one", 1));
  expect(authenticatedFetch).not.toHaveBeenCalled();
  expect(await screen.findByText("Enter text and press Enter to search.")).toBeInTheDocument();
  fireEvent.change(searchbox(), { target: { value: "  needle  " } });
  const filters = screen.getByRole("button", { name: "Filter files" });
  expect(searchbox().nextElementSibling).toBe(filters);
  expect(filters).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByLabelText("Include")).not.toBeVisible();
  fireEvent.click(filters);
  expect(filters).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByLabelText("Include")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Include"), { target: { value: "src/**" } });
  fireEvent.change(screen.getByLabelText("Exclude"), { target: { value: "*.test.ts" } });
  fireEvent.click(filters);
  expect(filters).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByLabelText("Include")).not.toBeVisible();
  expect(authenticatedFetch).not.toHaveBeenCalled();
  submit();
  expect(await screen.findByText(/No matches for/)).toBeInTheDocument();
  expect(searchbox()).toHaveValue("  needle  ");
  expect(authenticatedFetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Filter files" }));
  fireEvent.change(screen.getByLabelText("Include"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Exclude"), { target: { value: "" } });
  submit();
  await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(2));
  const cleared = new URL(String(vi.mocked(authenticatedFetch).mock.calls[1][0]), "http://test");
  expect(cleared.searchParams.get("include")).toBe("");
  expect(cleared.searchParams.get("exclude")).toBe("");
  expect(await screen.findByText(/No matches for/)).toBeInTheDocument();
  // The page draws again (the tab comes back): the form and the results are kept.
  rerender(view("session-one", 2));
  expect(searchbox()).toHaveValue("  needle  ");
  expect(await screen.findByText(/No matches for/)).toBeInTheDocument();
  expect(authenticatedFetch).toHaveBeenCalledTimes(2);
});

it("submits content and options explicitly, highlights results and opens the exact position", async () => {
  let resolve!: (response: Response) => void;
  vi.mocked(authenticatedFetch).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await start();
  const { rerender } = render(view("session-one"));
  fireEvent.change(searchbox(), { target: { value: "  Needle.*  " } });
  fireEvent.click(screen.getByLabelText("Match case"));
  fireEvent.click(screen.getByLabelText("Regular expression"));
  fireEvent.click(screen.getByRole("button", { name: "Filter files" }));
  fireEvent.change(screen.getByLabelText("Include"), { target: { value: "src/**, *.{py,txt}" } });
  fireEvent.change(screen.getByLabelText("Exclude"), {
    target: { value: "**/tests/**, a & b/**" },
  });
  expect(authenticatedFetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(1));
  const url = new URL(String(vi.mocked(authenticatedFetch).mock.calls[0][0]), "http://test");
  expect(url.pathname).toBe(
    "/v1/sessions/session-one/resources/environments/default/content-search",
  );
  expect(Object.fromEntries(url.searchParams)).toEqual({
    q: "  Needle.*  ",
    case_sensitive: "true",
    regex: "true",
    include: "src/**, *.{py,txt}",
    exclude: "**/tests/**, a & b/**",
  });
  expect(await screen.findByText("Searching…")).toBeInTheDocument();
  // While it runs, the button waits and the results area is busy.
  expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  expect(screen.getByText("Searching…").closest("[aria-busy]")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  resolve(
    new Response(
      JSON.stringify({
        matches: [
          {
            path: "src/main.py",
            line: 351,
            column: 4,
            text: "😀 Needle",
            match_start: 3,
            match_end: 9,
          },
        ],
        truncated: true,
        warning: null,
      }),
    ),
  );
  const result = await screen.findByRole("button", { name: "Open src/main.py at line 351" });
  expect(screen.getByText("Needle").tagName).toBe("MARK");
  expect(await screen.findByRole("heading", { name: "src/main.py" })).toBeInTheDocument();
  expect(screen.getByText(/first 1 matching lines/)).toBeInTheDocument();
  fireEvent.click(result);
  await waitFor(() =>
    expect(harness.openFile).toHaveBeenCalledWith("src/main.py", { line: 351, column: 4 }),
  );

  fireEvent.change(searchbox(), { target: { value: "unsent draft" } });
  await switchTo(rerender, "session-two");
  expect(searchbox()).toHaveValue("");
  expect(screen.getByLabelText("Match case")).not.toBeChecked();
  expect(screen.getByLabelText("Include")).toHaveValue("");
  expect(screen.getByLabelText("Exclude")).toHaveValue("");
  expect(screen.queryByRole("button", { name: /Open src\/main.py/ })).not.toBeInTheDocument();
  await switchTo(rerender, "session-one");
  expect(searchbox()).toHaveValue("unsent draft");
  expect(screen.getByLabelText("Match case")).toBeChecked();
  expect(screen.getByLabelText("Regular expression")).toBeChecked();
  expect(screen.getByLabelText("Include")).toHaveValue("src/**, *.{py,txt}");
  expect(screen.getByLabelText("Exclude")).toHaveValue("**/tests/**, a & b/**");
  expect(screen.getByRole("button", { name: "Filter files" })).toBeInTheDocument();
  expect(await screen.findByText(/matching lines.*Needle/)).toBeInTheDocument();
  expect(screen.getByText(/first 1 matching lines/)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Open src/main.py at line 351" }));
  await waitFor(() =>
    expect(harness.openFile).toHaveBeenLastCalledWith("src/main.py", { line: 351, column: 4 }),
  );
  expect(authenticatedFetch).toHaveBeenCalledTimes(1);
});

it("keeps an in-flight search across switches without mixing conversations", async () => {
  let resolveFirst!: (response: Response) => void;
  vi.mocked(authenticatedFetch)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValueOnce(emptyResult());
  await start();
  const { rerender } = render(view("session-one"));
  fireEvent.change(searchbox(), { target: { value: "first" } });
  submit();
  await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(1));
  await switchTo(rerender, "session-two");
  expect(screen.queryByText("Searching…")).not.toBeInTheDocument();
  fireEvent.change(searchbox(), { target: { value: "second" } });
  submit();
  expect(await screen.findByText("No matches for “second”.")).toBeInTheDocument();
  await switchTo(rerender, "session-one");
  expect(await screen.findByText("Searching…")).toBeInTheDocument();
  expect(searchbox()).toHaveValue("first");
  await switchTo(rerender, "session-two");
  await act(async () => resolveFirst(emptyResult()));
  expect(await screen.findByText("No matches for “second”.")).toBeInTheDocument();
  await switchTo(rerender, "session-one");
  expect(await screen.findByText("No matches for “first”.")).toBeInTheDocument();
  expect(authenticatedFetch).toHaveBeenCalledTimes(2);
});

it("hides a previous error while retrying and displays runner warnings", async () => {
  let resolveRetry!: (response: Response) => void;
  vi.mocked(authenticatedFetch)
    .mockResolvedValueOnce(emptyResult())
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "regex parse error" })))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve;
        }),
    );
  await start();
  render(view());
  expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  fireEvent.change(searchbox(), { target: { value: "needle" } });
  submit();
  expect(await screen.findByText("No matches for “needle”.")).toBeInTheDocument();
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("regex parse error");
  submit();
  expect(await screen.findByText("Searching…")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  const warning = "Some files or ignore rules could not be read.";
  await act(async () =>
    resolveRetry(new Response(JSON.stringify({ matches: [], truncated: true, warning }))),
  );
  expect(await screen.findByText("No matches for “needle”.")).toBeInTheDocument();
  expect(screen.getByText(warning)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each([
  [502, "<html>Bad gateway</html>"],
  [200, ""],
  [200, "{}"],
  [200, "null"],
])("handles an invalid search response (%s, %s)", async (status, body) => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response(body, { status }));
  await start();
  render(view());
  fireEvent.change(searchbox(), { target: { value: "needle" } });
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("Content search is unavailable.");
});

it("searches whole words through the existing regex route and keeps the option", async () => {
  vi.mocked(authenticatedFetch).mockImplementation(async () => emptyResult());
  const user = userEvent.setup();
  await start();
  const { rerender } = render(view("session-one", 1));
  const wholeWord = screen.getByRole("checkbox", { name: "Whole word" });
  expect(wholeWord).not.toBeChecked();
  wholeWord.focus();
  await user.keyboard(" ");
  expect(wholeWord).toBeChecked();
  fireEvent.change(searchbox(), { target: { value: "C++" } });
  submit();
  expect(await screen.findByText("No matches for “C++”.")).toBeInTheDocument();
  const url = new URL(String(vi.mocked(authenticatedFetch).mock.calls[0][0]), "http://test");
  expect(url.searchParams.get("q")).toBe("\\bC\\+\\+");
  expect(url.searchParams.get("regex")).toBe("true");
  rerender(view("session-one", 2));
  expect(screen.getByRole("checkbox", { name: "Whole word" })).toBeChecked();
});

it("refuses a whole-word search that outgrows the server's limit without sending it", async () => {
  vi.mocked(authenticatedFetch).mockImplementation(async () => emptyResult());
  await start();
  render(view());
  fireEvent.change(searchbox(), { target: { value: "a".repeat(4096) } });
  fireEvent.click(screen.getByLabelText("Whole word"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This search is too long to match whole words. Shorten it, or turn off Whole word.",
  );
  expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  submit();
  expect(authenticatedFetch).not.toHaveBeenCalled();
  fireEvent.change(searchbox(), { target: { value: "a".repeat(4092) } });
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  fireEvent.change(searchbox(), { target: { value: "a".repeat(4096) } });
  fireEvent.click(screen.getByLabelText("Whole word"));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("button", { name: "Search" })).toBeEnabled());
  submit();
  await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(1));
  const url = new URL(String(vi.mocked(authenticatedFetch).mock.calls[0][0]), "http://test");
  expect(url.searchParams.get("q")).toBe("a".repeat(4096));
  expect(url.searchParams.get("regex")).toBe("false");
});

it("refuses whole-word expressions that could escape the boundaries", async () => {
  vi.mocked(authenticatedFetch).mockImplementation(async () => emptyResult());
  await start();
  render(view());
  fireEvent.change(searchbox(), { target: { value: "foo)|(bar" } });
  fireEvent.click(screen.getByLabelText("Regular expression"));
  fireEvent.click(screen.getByLabelText("Whole word"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This expression closes a group it never opened, so it can’t match whole words.",
  );
  expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  submit();
  expect(authenticatedFetch).not.toHaveBeenCalled();
  fireEvent.change(searchbox(), { target: { value: "(?x)[ ](]foo)|(bar" } });
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Whole word can’t be used with verbose mode (?x).",
    ),
  );
  expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  submit();
  expect(authenticatedFetch).not.toHaveBeenCalled();
  fireEvent.change(searchbox(), { target: { value: "foo)|(bar" } });
  // With Whole word off the expression goes to ripgrep unchanged, as before.
  fireEvent.click(screen.getByLabelText("Whole word"));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("button", { name: "Search" })).toBeEnabled());
  submit();
  await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(1));
  const url = new URL(String(vi.mocked(authenticatedFetch).mock.calls[0][0]), "http://test");
  expect(url.searchParams.get("q")).toBe("foo)|(bar");
  expect(url.searchParams.get("regex")).toBe("true");
});

it("groups matches by file in the order their first match came, each file once", async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        matches: [
          { path: "b.ts", line: 2, column: 1, text: "needle b", match_start: 0, match_end: 6 },
          { path: "a.ts", line: 9, column: 3, text: "a needle", match_start: 2, match_end: 8 },
          { path: "b.ts", line: 7, column: 5, text: "more needle", match_start: 5, match_end: 11 },
        ],
        truncated: false,
        warning: null,
      }),
    ),
  );
  await start();
  render(view());
  fireEvent.change(searchbox(), { target: { value: "needle" } });
  submit();
  expect(await screen.findByText("3 matching lines in 2 files for “needle”.")).toBeInTheDocument();
  expect((await screen.findAllByRole("heading")).map((heading) => heading.textContent)).toEqual([
    "b.ts",
    "a.ts",
  ]);
  expect(
    screen.getAllByRole("button", { name: /^Open / }).map((row) => row.getAttribute("aria-label")),
  ).toEqual(["Open b.ts at line 2", "Open b.ts at line 7", "Open a.ts at line 9"]);
});
