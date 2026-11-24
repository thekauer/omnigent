// Keeps the window's extension host running while an embedded app is mounted.
import { useEffect, useState } from "react";
import { ensureExtensionHost, retainExtensionHost } from "./extensionHost";

/**
 * Starts the window's extension host, with the built-ins, before the calling
 * component's first render, so the built-in views are registered when the
 * workspace rail first reads them, and holds it while the component is mounted.
 * Several mounted callers share one host; the last to unmount disposes it. A
 * render React discards before commit starts the host without holding it; the
 * host then disposes itself unless a committed caller holds it shortly after.
 */
export function useWindowExtensionHost(): void {
  useState(() => {
    ensureExtensionHost();
    return null;
  });
  useEffect(() => retainExtensionHost(), []);
}
