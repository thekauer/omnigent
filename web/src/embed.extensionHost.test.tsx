// The embed runs the window's extension host, so the built-in right-panel tabs
// (now built-in extensions) exist in an embedded OmnigentApp as they do standalone.
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OmnigentApp } from "./embed";
import { useRailViews } from "./shell/railViews";
import { ExtensionRailView } from "./shell/extensionViews/ExtensionRailView";
import { flushMicrotasks } from "./test/builtInExtensions";
import { currentExtensionHost } from "./vscodeExtensions/extensionHost";

const BUILT_IN_TABS = ["Agents", "Changes", "Content search", "Files", "Pull Requests", "Tasks"];

// Stand in for the routed app with the part of the workspace rail that reads the
// window's views: a tab per registered view and the selected (Changes) view.
vi.mock("./App", () => ({
  default: function RailTestApp() {
    const { views, settled } = useRailViews();
    return (
      <div role="tablist" aria-label="Workspace tabs">
        {views.map((view) => (
          <button type="button" role="tab" key={view.id} data-view-id={view.id}>
            {view.name}
          </button>
        ))}
        {views.some((view) => view.id === "omnigent.changes.view") && (
          <section aria-label="Selected view">
            <ExtensionRailView
              viewId="omnigent.changes.view"
              settled={settled}
              conversationId="conv_embed"
            />
          </section>
        )}
      </div>
    );
  },
}));

// Keep backend discovery pending; the tabs must not depend on it.
const fetcher = () => new Promise<Response>(() => {});

function app() {
  return (
    <MemoryRouter>
      <OmnigentApp fetcher={fetcher} basename="/embedded" />
    </MemoryRouter>
  );
}

function tabNames(): string[] {
  return screen
    .queryAllByRole("tab")
    .map((tab) => tab.textContent ?? "")
    .sort();
}

/** Runs the deferred disposal and lets it settle. */
async function settleDisposal(): Promise<void> {
  await act(async () => {
    await flushMicrotasks();
    await currentExtensionHost()?.builtInsStarted;
    await flushMicrotasks();
  });
}

afterEach(async () => {
  cleanup();
  await settleDisposal();
  localStorage.clear();
});

describe("embedded extension host", () => {
  it("starts the built-in extensions before the first render", async () => {
    render(app());
    // Registered synchronously, so a restored extension tab is valid on first paint.
    expect(tabNames()).toEqual(BUILT_IN_TABS);
    const runtime = currentExtensionHost();
    expect(runtime).toBeDefined();
    await act(async () => {
      await runtime!.builtInsStarted;
    });
    // The built-in commands are registered too, so the shell can run them.
    expect(runtime!.commands.has("omnigent.changes.refresh")).toBe(true);
    const selected = screen.getByRole("region", { name: "Selected view" });
    expect(within(selected).queryByText(/no longer available|not available/i)).toBeNull();
  });

  it("shares one host between OmnigentApps and disposes it after the last unmount", async () => {
    const first = render(app());
    const runtime = currentExtensionHost();
    const second = render(app());
    expect(currentExtensionHost()).toBe(runtime);
    // Each app shows the same window views; none registered twice.
    expect(within(second.container).getAllByRole("tab")).toHaveLength(BUILT_IN_TABS.length);

    first.unmount();
    await settleDisposal();
    expect(currentExtensionHost()).toBe(runtime);
    expect(within(second.container).getAllByRole("tab")).toHaveLength(BUILT_IN_TABS.length);

    const dispose = vi.spyOn(runtime!, "dispose");
    second.unmount();
    await settleDisposal();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(currentExtensionHost()).toBeUndefined();

    // A later mount starts a fresh host with the built-ins again.
    render(app());
    expect(tabNames()).toEqual(BUILT_IN_TABS);
    expect(currentExtensionHost()).not.toBe(runtime);
  });

  it("keeps the host through a StrictMode remount and an immediate remount", async () => {
    const { unmount } = render(<StrictMode>{app()}</StrictMode>);
    const runtime = currentExtensionHost();
    const dispose = vi.spyOn(runtime!, "dispose");
    await settleDisposal();
    expect(dispose).not.toHaveBeenCalled();

    // A host re-rendering its route unmounts and mounts in one task.
    unmount();
    render(app());
    await settleDisposal();
    expect(dispose).not.toHaveBeenCalled();
    expect(currentExtensionHost()).toBe(runtime);
    expect(tabNames()).toEqual(BUILT_IN_TABS);
  });

  it("restarts the host when an app mounts while the previous one is disposing", async () => {
    const { unmount } = render(app());
    const runtime = currentExtensionHost()!;
    let finishDispose!: () => void;
    const original = runtime.dispose;
    vi.spyOn(runtime, "dispose").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDispose = () => void original().then(resolve);
        }),
    );
    unmount();
    await act(async () => {
      await flushMicrotasks();
    });
    expect(currentExtensionHost()).toBeUndefined();

    // The old views still hold their ids, so the new host waits for them to go.
    render(app());
    expect(currentExtensionHost()).toBeUndefined();
    await act(async () => {
      finishDispose();
      await flushMicrotasks();
    });
    const restarted = currentExtensionHost();
    expect(restarted).toBeDefined();
    expect(restarted).not.toBe(runtime);
    expect(tabNames()).toEqual(BUILT_IN_TABS);
  });
});
