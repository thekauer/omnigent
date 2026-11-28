// Where the settings JSON editor's overflowing widgets (the hover, the suggestions) render.
// The dialog's translate and backdrop filter make it the containing block of everything in
// it, so Monaco's `fixedOverflowWidgets` gets a node of its own outside the dialog, through
// `overflowWidgetsDomNode`, where the dialogs portal to (the embed's inner root, else the
// body): inside the theme scope, with Monaco's own class. The node is a React portal from
// the editor, so the dialog's React handlers count a pointer in it as inside; the dialog's
// DOM checks (its focus trap and `aria-hidden` on everything else) are kept off it here.

import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useOverlayRoot } from "@/workbench/workbenchScope";

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

/** Lets focus into the host past a modal dialog's focus trap, and keeps it announced. */
function attachHost(host: HTMLDivElement, container: HTMLElement): () => void {
  // The trap listens on the document and pulls focus back from outside the dialog's DOM.
  const keepFocusIn = (event: FocusEvent) => event.stopPropagation();
  const keepFocusOut = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Node && host.contains(event.relatedTarget)) {
      event.stopPropagation();
    }
  };
  // A modal dialog hides everything outside itself from assistive technology.
  const unhide = () => {
    if (host.hasAttribute("aria-hidden")) host.removeAttribute("aria-hidden");
  };
  const observer = new MutationObserver(unhide);
  container.appendChild(host);
  host.addEventListener("focusin", keepFocusIn);
  container.addEventListener("focusout", keepFocusOut);
  observer.observe(host, { attributes: true, attributeFilter: ["aria-hidden"] });
  return () => {
    observer.disconnect();
    container.removeEventListener("focusout", keepFocusOut);
    host.removeEventListener("focusin", keepFocusIn);
    host.remove();
  };
}

export interface OverflowWidgetsProps {
  /** Called with the node once it is mounted (and null once it is gone). */
  onNode: (node: HTMLDivElement | null) => void;
}

export function OverflowWidgets({ onNode }: OverflowWidgetsProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const overlayRoot = useOverlayRoot();
  // Appended in a layout effect, after the commit placed the dialog: a portal nested in the
  // dialog's portal is placed before the dialog's own nodes when both mount in one commit.
  useLayoutEffect(() => {
    const node = createHost();
    const detach = attachHost(node, overlayRoot ?? document.body);
    setHost(node);
    return () => {
      detach();
      setHost(null);
    };
  }, [overlayRoot]);
  return host ? createPortal(<div ref={onNode} />, host) : null;
}
