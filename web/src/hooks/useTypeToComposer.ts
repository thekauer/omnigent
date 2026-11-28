// Typing while focus is in the conversation, or nowhere, starts a message: the
// keystroke moves focus to the chat composer, which then receives the character.
// Chords (Cmd/Ctrl/Alt), Space (which scrolls the transcript), keys that a
// waiting question or a dialog took, a fullscreen view, a focused dropdown's
// type-to-select, and IME composition are left alone.

import { type RefObject, useEffect, useRef } from "react";

import { useIsEmbedded } from "@/lib/embedded";
import { isFocusInDialogOrMenu, isKeyOwningOverlayOpen, isTextEntry } from "@/lib/hotkeys";
import { isImeCompositionKeyEvent } from "@/lib/ime";
import { isNativeShell } from "@/lib/nativeBridge";
import { isActiveWorkbenchScope, useWorkbenchScope } from "@/workbench/workbenchScope";

/** An embed's scope root, or its wrapper that takes focus: no control, so typing still counts. */
function isEmbedRootElement(element: HTMLElement, embedRoot: HTMLElement | null): boolean {
  return embedRoot !== null && (element === embedRoot || element.parentElement === embedRoot);
}

/**
 * Whether `event` should carry its character into the composer. `embedRoot` is the mount's own
 * root (null standalone).
 */
export function typesIntoComposer(
  event: KeyboardEvent,
  conversation: HTMLElement | null,
  embedRoot: HTMLElement | null = null,
): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key.length !== 1 || event.key === " ") return false;
  if (isImeCompositionKeyEvent({ nativeEvent: event })) return false;
  const active = document.activeElement;
  // A click on transcript text can focus an embed's root, which counts as no control.
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    !isEmbedRootElement(active, embedRoot)
  ) {
    if (!conversation?.contains(active) || isTextEntry(active)) return false;
    // A native dropdown picks its option by the typed letter.
    if (active instanceof HTMLSelectElement) return false;
  }
  // A fullscreen table or diagram covers the composer while focus stays behind it.
  return !isFocusInDialogOrMenu() && !isKeyOwningOverlayOpen();
}

/**
 * Focus the composer when the user starts typing in the conversation.
 *
 * @param focusComposer Focus the composer; a no-op where it can't take text.
 * @param conversation The conversation area that counts as being in the chat.
 */
export function useTypeToComposer(
  focusComposer: () => void,
  conversation: RefObject<HTMLElement | null>,
  enabled = true,
): void {
  const latest = useRef(focusComposer);
  latest.current = focusComposer;
  const isEmbedded = useIsEmbedded();

  const scope = useWorkbenchScope();
  useEffect(() => {
    if (!enabled) return;
    // Bubble phase on window, so a waiting question's capture-phase keys go first.
    const handler = (event: KeyboardEvent): void => {
      if (!isActiveWorkbenchScope(scope)) return;
      // Embedded, typing in the host page around the app stays there. A native
      // shell has no host page, and its unfocusable root leaves a click on
      // transcript text with focus on the body.
      const embedRoot = scope.layout.getRoot();
      const inHostPage = !embedRoot || !event.composedPath().includes(embedRoot);
      if (isEmbedded && !isNativeShell() && inHostPage) return;
      if (typesIntoComposer(event, conversation.current, embedRoot)) latest.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, conversation, isEmbedded, scope]);
}
