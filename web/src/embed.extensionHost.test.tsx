// The embed runs the window's extension host, so the built-in right-panel tabs
// (now built-in extensions) exist in an embedded OmnigentApp as they do standalone.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OmnigentApp } from "./embed";
import { useRailViews } from "./shell/railViews";
import { ExtensionRailView } from "./shell/extensionViews/ExtensionRailView";
import { flushMicrotasks } from "./test/builtInExtensions";
import { useChatStore } from "./store/chatStore";
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
  vi.restoreAllMocks();
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

  it("leaves no chat store subscription or window listener behind over mount cycles", async () => {
    // Count the subscriptions taken through the chat store and the window's listeners.
    const subscribe = useChatStore.subscribe;
    let subscriptions = 0;
    vi.spyOn(useChatStore, "subscribe").mockImplementation((listener) => {
      subscriptions += 1;
      const unsubscribe = subscribe(listener);
      let done = false;
      return () => {
        if (!done) subscriptions -= 1;
        done = true;
        unsubscribe();
      };
    });
    const listeners = new Set<string>();
    const ids = new WeakMap<object, number>();
    let nextId = 0;
    const keyOf = (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) => {
      if (!listener) return undefined;
      if (!ids.has(listener)) ids.set(listener, (nextId += 1));
      const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
      return `${type}:${String(ids.get(listener) ?? 0)}:${String(capture)}`;
    };
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      const key = keyOf(type, listener, options);
      if (key && !(typeof options === "object" && options?.once)) listeners.add(key);
      add(type, listener, options);
    });
    vi.spyOn(window, "removeEventListener").mockImplementation((type, listener, options) => {
      const key = keyOf(type, listener, options);
      if (key) listeners.delete(key);
      remove(type, listener, options);
    });

    const cycle = async () => {
      const { unmount } = render(app());
      const runtime = currentExtensionHost();
      await act(async () => {
        await runtime?.builtInsStarted;
      });
      // The built-in keybindings listen on the window while the host runs.
      expect(listeners.size).toBeGreaterThan(0);
      unmount();
      await settleDisposal();
      expect(currentExtensionHost()).toBeUndefined();
    };
    // Lazy one-time setup on the first mount is not a leak; measure after it.
    await cycle();
    const baseline = { subscriptions, listeners: listeners.size };
    for (let i = 0; i < 5; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- the cycles run one after another
      await cycle();
    }
    expect({ subscriptions, listeners: listeners.size }).toEqual(baseline);
    expect(subscriptions).toBe(0);
  });

  it("runs embedded keybindings only from inside a mounted app root", async () => {
    render(app());
    const runtime = currentExtensionHost()!;
    await act(async () => {
      await runtime.builtInsStarted;
    });
    runtime.contextKeys.setHost("view.omnigent.content-search.view.available", true);
    const execute = vi.spyOn(runtime.commands, "execute");
    const hostInput = document.createElement("input");
    document.body.append(hostInput);
    const chord = { code: "KeyF", ctrlKey: true, shiftKey: true };
    try {
      // Content search's chord, pressed in the host page's own field and on its body,
      // reaches the host page untouched.
      hostInput.focus();
      expect(fireEvent.keyDown(hostInput, chord)).toBe(true);
      hostInput.blur();
      expect(fireEvent.keyDown(document.body, chord)).toBe(true);
      expect(execute).not.toHaveBeenCalled();
      // From inside the app root it runs, as standalone.
      const inside = document.querySelector(".omnigent-app")!.firstElementChild as HTMLElement;
      expect(fireEvent.keyDown(inside, chord)).toBe(false);
      expect(execute).toHaveBeenCalledWith(
        "omnigent.content-search.view.focus",
        [],
        expect.any(Function),
      );
    } finally {
      hostInput.remove();
    }
  });
});
