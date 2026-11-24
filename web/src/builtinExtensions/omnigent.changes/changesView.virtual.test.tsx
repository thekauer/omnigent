// The Changes tab windows its rows with the real virtualizer (the shared test
// setup replaces it with a pass-through that renders every row). Ported from the
// classic FlatFileList windowing tests.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ExtensionRailView } from "@/shell/extensionViews/ExtensionRailView";
import { clearExpandStates } from "@/shell/extensionViews/treeRows";
import { RailViewRegistry } from "@/shell/railViews";
import { WorkspaceBridge } from "@/shell/workspaceBridge";
import { type BuiltInHarness, changedFile, startBuiltIns } from "@/test/builtInExtensions";
import { VIEW_ID } from "./extension";

vi.unmock("@tanstack/react-virtual");

const VIEWPORT_HEIGHT = 300;
const ROW_HEIGHT = 25;
const MAX_MOUNTED_ROWS = 60;

const restorers: (() => void)[] = [];
function stub<Key extends keyof HTMLElement>(key: Key, descriptor: PropertyDescriptor): void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
  Object.defineProperty(HTMLElement.prototype, key, { configurable: true, ...descriptor });
  restorers.push(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, key, original);
    else Reflect.deleteProperty(HTMLElement.prototype, key);
  });
}
const isScroller = (element: HTMLElement) => element.matches("section.overflow-y-auto");
const isRow = (element: HTMLElement) => "treeItem" in element.dataset;
const heightOf = (element: HTMLElement) =>
  isScroller(element) ? VIEWPORT_HEIGHT : isRow(element) ? ROW_HEIGHT : 0;

beforeAll(() => {
  stub("offsetHeight", {
    get(this: HTMLElement) {
      return heightOf(this);
    },
  });
  stub("offsetWidth", {
    get(this: HTMLElement) {
      return isScroller(this) ? 300 : 0;
    },
  });
  stub("getBoundingClientRect", {
    value(this: HTMLElement) {
      const height = heightOf(this);
      return { top: 0, left: 0, right: 300, bottom: height, width: 300, height, x: 0, y: 0 };
    },
  });
});

afterAll(() => {
  for (const restore of restorers.reverse()) restore();
});

let harness: BuiltInHarness;
afterEach(async () => {
  cleanup();
  clearExpandStates();
  await harness?.dispose();
});

function manyFiles(count: number, root?: string) {
  return Array.from({ length: count }, (_, index) =>
    changedFile(`${root ? `${root}/` : ""}src/file-${String(index).padStart(4, "0")}.ts`, {
      repository_root: root,
    }),
  );
}

const mountedRows = (root = "") =>
  screen.queryAllByRole("button", { name: new RegExp(`^${root}src/file-\\d+\\.ts$`) });

async function renderView(files: ReturnType<typeof manyFiles>) {
  harness = await startBuiltIns({
    registry: new RailViewRegistry(),
    bridge: new WorkspaceBridge(),
    files,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ExtensionRailView
          viewId={VIEW_ID}
          settled
          conversationId="conv_abc"
          registry={harness.registry}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return document.querySelector<HTMLElement>("section.overflow-y-auto")!;
}

function scrollTo(scroller: HTMLElement, top: number) {
  act(() => {
    scroller.scrollTop = top;
    fireEvent.scroll(scroller);
  });
}

describe("Changes tab windowing", () => {
  it("mounts only the rows near the viewport of a large change set", async () => {
    const scroller = await renderView(manyFiles(2_000));
    expect(await screen.findByRole("button", { name: "src/file-0000.ts" })).toBeInTheDocument();
    expect(mountedRows().length).toBeLessThan(MAX_MOUNTED_ROWS);
    expect(screen.queryByRole("button", { name: "src/file-1999.ts" })).toBeNull();

    scrollTo(scroller, 1_000 * (ROW_HEIGHT + 2));
    expect(await screen.findByRole("button", { name: "src/file-1000.ts" })).toBeInTheDocument();
    expect(mountedRows().length).toBeLessThan(MAX_MOUNTED_ROWS);
    expect(screen.queryByRole("button", { name: "src/file-0000.ts" })).toBeNull();
  });

  it("windows repository groups as one list, so a collapsed group frees its rows", async () => {
    const scroller = await renderView([...manyFiles(1_000, "api"), ...manyFiles(1_000, "web")]);
    const api = await screen.findByRole("button", { name: "api, 1000 changed files" });
    expect(screen.getByRole("button", { name: "api/src/file-0000.ts" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "web, 1000 changed files" })).toBeNull();
    expect(mountedRows("api/").length + mountedRows("web/").length).toBeLessThan(MAX_MOUNTED_ROWS);

    fireEvent.click(api);
    expect(
      await screen.findByRole("button", { name: "web, 1000 changed files" }),
    ).toBeInTheDocument();
    expect(mountedRows("api/")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "web/src/file-0000.ts" })).toBeInTheDocument();
    scrollTo(scroller, 0);
    expect(mountedRows("web/").length).toBeLessThan(MAX_MOUNTED_ROWS);
  });
});
