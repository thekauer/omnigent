// The settings JSON editor's overflow widgets: a node of their own outside the dialog, where
// the dialogs portal to (the embed's inner root when embedded), handed to Monaco as
// `overflowWidgetsDomNode` with `fixedOverflowWidgets`.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
const overflowNodes = () => document.querySelectorAll(`[${OVERFLOW_WIDGETS_ATTRIBUTE}]`);

// The dialog's portal and the editor inside it mount together (a loaded editor chunk).
function DialogWithWidgets({ onNode = () => {} }: { onNode?: (node: HTMLDivElement | null) => void }) {
  return createPortal(
    <div data-testid="dialog">
      <OverflowWidgets onNode={onNode} />
    </div>,
    document.querySelector<HTMLElement>("[data-embed-inner]") ?? document.body,
  );
}

// A modal Radix dialog with an editor field and the widgets, a link put in them as Monaco would.
function ModalWithWidgets() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>JSON</DialogDescription>
        <textarea data-testid="editor-field" />
        <OverflowWidgets
          onNode={(node) => {
            if (node && !node.firstChild) {
              const link = node.appendChild(document.createElement("a"));
              link.href = "#hover-link";
              link.textContent = "hover link";
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

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
    expect(onNode).toHaveBeenCalledWith(node.firstElementChild);
  });

  it("comes after a dialog it mounts with in one commit, so it draws above it", () => {
    render(<DialogWithWidgets />);
    const dialog = screen.getByTestId("dialog");
    expect(dialog.compareDocumentPosition(overflowNode()!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("comes after a dialog it mounts with in one commit on the embed's inner root", () => {
    const scope = document.body.appendChild(document.createElement("div"));
    const inner = scope.appendChild(document.createElement("div"));
    inner.setAttribute("data-embed-inner", "");
    setEmbedRoot(inner);
    render(<DialogWithWidgets />);
    expect(overflowNode()!.parentElement).toBe(inner);
    expect(screen.getByTestId("dialog").compareDocumentPosition(overflowNode()!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    cleanup();
    scope.remove();
  });

  it("keeps one node under StrictMode, and none once unmounted", () => {
    const onNode = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <OverflowWidgets onNode={onNode} />
      </StrictMode>,
    );
    expect(overflowNodes()).toHaveLength(1);
    expect(onNode).toHaveBeenLastCalledWith(overflowNode()!.firstElementChild);
    act(() => unmount());
    expect(overflowNodes()).toHaveLength(0);
  });

  it("gives two editors a node each and removes each with its editor", () => {
    const first = render(<OverflowWidgets onNode={() => {}} />);
    const second = render(<OverflowWidgets onNode={() => {}} />);
    const [firstNode, secondNode] = overflowNodes();
    expect(overflowNodes()).toHaveLength(2);
    act(() => first.unmount());
    expect([...overflowNodes()]).toEqual([secondNode]);
    expect(firstNode.isConnected).toBe(false);
    act(() => second.unmount());
    expect(overflowNodes()).toHaveLength(0);
  });

  it("takes focus from a modal dialog's field without the dialog's trap pulling it back", async () => {
    render(<ModalWithWidgets />);
    const field = await screen.findByTestId("editor-field");
    act(() => field.focus());
    expect(document.activeElement).toBe(field);
    const link = screen.getByText("hover link");
    // The trap's document listeners don't see focus move into the widgets.
    const seen = vi.fn();
    document.addEventListener("focusin", seen);
    document.addEventListener("focusout", seen);
    act(() => link.focus());
    document.removeEventListener("focusin", seen);
    document.removeEventListener("focusout", seen);
    expect(seen).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(link);
    act(() => field.focus());
    expect(document.activeElement).toBe(field);
  });

  it("is not hidden from assistive technology while a modal dialog is open", async () => {
    render(<ModalWithWidgets />);
    await screen.findByTestId("editor-field");
    await waitFor(() => expect(screen.getByText("Settings")).toBeVisible());
    // The dialog hides its siblings; the node stays announced.
    await waitFor(() => expect(document.querySelector("[aria-hidden]")).not.toBeNull());
    await waitFor(() => expect(overflowNode()!.hasAttribute("aria-hidden")).toBe(false));
    expect(screen.getByRole("link", { name: "hover link" })).toBeInTheDocument();
  });

  it("renders on the embed's inner root, inside the theme scope", () => {
    const scope = document.body.appendChild(document.createElement("div"));
    const inner = scope.appendChild(document.createElement("div"));
    setEmbedRoot(inner);
    render(<OverflowWidgets onNode={() => {}} />);
    expect(overflowNode()!.parentElement).toBe(inner);
    cleanup();
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
    expect(editorOptions.current!.overflowWidgetsDomNode).toBe(overflowNode()!.firstElementChild);
    act(() => unmount());
    expect(overflowNode()).toBeNull();
  });
});
