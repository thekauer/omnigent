// Where the settings JSON editor's overflowing widgets (the hover, the suggestions) render.
// The dialog's translate and backdrop filter make it the containing block of everything in
// it, so Monaco's `fixedOverflowWidgets` gets a node of its own outside the dialog, through
// `overflowWidgetsDomNode`. The node is a React portal from the editor, so the dialog
// counts a pointer or focus in it as inside, and it goes where the dialogs portal to (the
// embed's inner root, else the body): inside the theme scope, with Monaco's own class.

import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

import { getEmbedRoot } from "@/lib/host";

/** The marker on the overflow widgets node. */
export const OVERFLOW_WIDGETS_ATTRIBUTE = "data-settings-json-overflow-widgets";

function createHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.className = "monaco-editor";
  host.setAttribute(OVERFLOW_WIDGETS_ATTRIBUTE, "");
  // A modal dialog turns pointer events off outside itself; the widgets take them, so the
  // hover stays open under the pointer and its links work.
  host.style.pointerEvents = "auto";
  // Above the dialog: the same z-index (z-50), so it must come later in the document.
  host.style.position = "relative";
  host.style.zIndex = "50";
  return host;
}

export interface OverflowWidgetsProps {
  /** Called with the node once it is mounted (and null once it is gone). */
  onNode: (node: HTMLDivElement | null) => void;
}

export function OverflowWidgets({ onNode }: OverflowWidgetsProps) {
  const [host] = useState(createHost);
  // Appended in a layout effect, after the commit placed the dialog: a portal nested in the
  // dialog's portal is placed before the dialog's own nodes when both mount in one commit.
  useLayoutEffect(() => {
    (getEmbedRoot() ?? document.body).appendChild(host);
    return () => host.remove();
  }, [host]);
  return createPortal(<div ref={onNode} />, host);
}
