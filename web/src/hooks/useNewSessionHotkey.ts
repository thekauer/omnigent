import { useEffect } from "react";

import { useIsEmbedded } from "@/lib/embedded";
import { isMacPlatform } from "@/lib/hotkeys";
import { isNativeShell } from "@/lib/nativeBridge";
import { useNavigate } from "@/lib/routing";
import { matchesShortcut } from "@/lib/shortcuts/registry";
import { isActiveWorkbenchScope, useWorkbenchScope } from "@/workbench/workbenchScope";

/** Browser Cmd/Ctrl+Shift+O; native shells Cmd/Ctrl+N. */
export function isNewSessionHotkey(
  e: globalThis.KeyboardEvent,
  isMac = isMacPlatform(),
  native = isNativeShell(),
): boolean {
  return matchesShortcut(e, "session.new", { mac: isMac, native });
}

/** Navigate to the same new-session route used by the command palette. */
export function useNewSessionHotkey(enabled = true, isMac = isMacPlatform()): void {
  const navigate = useNavigate();
  const isEmbedded = useIsEmbedded();

  const scope = useWorkbenchScope();
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: globalThis.KeyboardEvent): void => {
      if (!isActiveWorkbenchScope(scope)) return;
      if (e.repeat || !isNewSessionHotkey(e, isMac)) return;
      const embedRoot = scope.layout.getRoot();
      if (isEmbedded && (!embedRoot || !e.composedPath().includes(embedRoot))) return;
      e.preventDefault();
      e.stopPropagation();
      navigate("/");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, isMac, isEmbedded, navigate, scope]);
}
