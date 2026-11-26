// Where the settings JSON editor's overflowing widgets (the hover, the suggestions) render.
// The dialog's translate and backdrop filter make it the containing block of everything in
// it, so Monaco's `fixedOverflowWidgets` gets a node of its own outside the dialog, through
// `overflowWidgetsDomNode`. The node is a React portal from the editor, so the dialog
// counts a pointer or focus in it as inside, and it goes where the dialogs portal to (the
// embed's inner root, else the body): inside the theme scope, with Monaco's own class.

import { createPortal } from "react-dom";

import { getEmbedRoot } from "@/lib/host";

/** The marker on the overflow widgets node. */
export const OVERFLOW_WIDGETS_ATTRIBUTE = "data-settings-json-overflow-widgets";

const NODE_STYLE = {
  // A modal dialog turns pointer events off outside itself; the widgets take them, so the
  // hover stays open under the pointer and its links work.
  pointerEvents: "auto",
  // Above the dialog (z-50, and later in the document).
  position: "relative",
  zIndex: 50,
} as const;

export interface OverflowWidgetsProps {
  /** Called with the node once it is mounted (and null once it is gone). */
  onNode: (node: HTMLDivElement | null) => void;
}

export function OverflowWidgets({ onNode }: OverflowWidgetsProps) {
  return createPortal(
    <div
      ref={onNode}
      className="monaco-editor"
      {...{ [OVERFLOW_WIDGETS_ATTRIBUTE]: "" }}
      style={NODE_STYLE}
    />,
    getEmbedRoot() ?? document.body,
  );
}
