import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { SelectionPopup } from "./SelectionPopup";
import { embedMount } from "@/test/workbenchScopeWrapper";

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

it.each([true, false])("portals outside the transcript (embedded: %s)", (embedded) => {
  const containerRef = createRef<HTMLDivElement>();
  const onReply = vi.fn();
  // The embed's own element (an embed's overlays portal into it), or the page.
  const embedRoot = document.createElement("div");
  document.body.append(embedRoot);
  onTestFinished(() => embedRoot.remove());
  render(
    <>
      <div ref={containerRef}>Selected message</div>
      <SelectionPopup containerRef={containerRef} onReply={onReply} />
    </>,
    { container: embedRoot, wrapper: embedded ? embedMount(embedRoot) : undefined },
  );

  const range = document.createRange();
  range.selectNodeContents(containerRef.current!);
  range.getBoundingClientRect = () => new DOMRect(10, 30, 80, 20);
  window.getSelection()!.addRange(range);
  fireEvent(document, new Event("selectionchange"));

  const reply = screen.getByRole("button", { name: "Reply ↵" });
  expect(reply.parentElement?.parentElement).toBe(embedded ? embedRoot : document.body);
  expect(reply.parentElement).toHaveStyle({ position: "fixed", left: "50px", top: "30px" });
  fireEvent.click(reply);
  expect(onReply).toHaveBeenCalledExactlyOnceWith("Selected message");
  expect(screen.queryByRole("button", { name: "Reply ↵" })).toBeNull();
});
