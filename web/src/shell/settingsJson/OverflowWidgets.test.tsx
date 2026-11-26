// The settings JSON editor's overflow widgets: a node of their own outside the dialog, where
// the dialogs portal to (the embed's inner root when embedded), handed to Monaco as
// `overflowWidgetsDomNode` with `fixedOverflowWidgets`.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setEmbedRoot } from "@/lib/host";

import { OVERFLOW_WIDGETS_ATTRIBUTE, OverflowWidgets } from "./OverflowWidgets";
import { SettingsJsonEditor } from "./SettingsJsonEditor";

const editorOptions = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("@monaco-editor/react", () => ({
  Editor: ({ options }: { options: Record<string, unknown> }) => {
    editorOptions.current = options;
    return <div data-testid="monaco" />;
  },
}));
vi.mock("../monacoSetup", () => ({
  ensureMonacoReady: () => Promise.resolve(),
  ensureLanguage: () => Promise.resolve(),
}));
vi.mock("../monacoTheme", () => ({ useMonacoTheme: () => "theme" }));

afterEach(() => {
  cleanup();
  setEmbedRoot(null);
  editorOptions.current = null;
});

const overflowNode = () => document.querySelector<HTMLElement>(`[${OVERFLOW_WIDGETS_ATTRIBUTE}]`);

describe("OverflowWidgets", () => {
  it("renders on the body standalone, with Monaco's class, taking the pointer above the dialog", () => {
    const onNode = vi.fn();
    const { container } = render(<OverflowWidgets onNode={onNode} />);
    const node = overflowNode()!;
    expect(node.parentElement).toBe(document.body);
    expect(container.contains(node)).toBe(false);
    expect(node).toHaveClass("monaco-editor");
    expect(node.style.pointerEvents).toBe("auto");
    expect(node.style.zIndex).toBe("50");
    expect(onNode).toHaveBeenCalledWith(node);
  });

  it("renders on the embed's inner root, inside the theme scope", () => {
    const scope = document.body.appendChild(document.createElement("div"));
    const inner = scope.appendChild(document.createElement("div"));
    setEmbedRoot(inner);
    render(<OverflowWidgets onNode={() => {}} />);
    expect(overflowNode()!.parentElement).toBe(inner);
    scope.remove();
  });

  it("is the editor's fixed overflow widgets node, gone with the editor", async () => {
    const { unmount } = render(
      <SettingsJsonEditor
        defaultValue="{}"
        diagnostics={[]}
        onChange={() => {}}
        onSave={() => {}}
      />,
    );
    await screen.findByTestId("monaco");
    await waitFor(() => expect(editorOptions.current).not.toBeNull());
    expect(editorOptions.current).toMatchObject({ fixedOverflowWidgets: true });
    expect(editorOptions.current!.overflowWidgetsDomNode).toBe(overflowNode());
    act(() => unmount());
    expect(overflowNode()).toBeNull();
  });
});
