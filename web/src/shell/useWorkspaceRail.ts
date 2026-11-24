// Registers a workspace rail with the workspace bridge: which extension views its
// tab strip can show for the session, and how to bring one to the front, so a
// view's `<view>.focus` command (and a keybinding on it, such as ⌘⇧F) works.

import { useEffect, useRef } from "react";
import {
  type WorkspaceBridge,
  type WorkspaceRailRegistration,
  workspaceBridge,
} from "./workspaceBridge";

export function useWorkspaceRail({
  sessionId,
  views,
  reveal,
  bridge = workspaceBridge,
}: {
  /** Null while the rail cannot reveal anything (no session, pending, or on a phone). */
  sessionId: string | null;
  views: readonly string[];
  reveal: (viewId: string) => boolean;
  bridge?: WorkspaceBridge;
}): void {
  const registration = useRef<WorkspaceRailRegistration | null>(null);
  const latestReveal = useRef(reveal);
  latestReveal.current = reveal;
  useEffect(() => {
    const rail = bridge.createRail();
    registration.current = rail;
    return () => {
      rail.dispose();
      if (registration.current === rail) registration.current = null;
    };
  }, [bridge]);
  const key = views.join("\n");
  useEffect(() => {
    registration.current?.update(
      sessionId === null
        ? null
        : {
            sessionId,
            views: key === "" ? [] : key.split("\n"),
            reveal: (viewId) => latestReveal.current(viewId),
          },
    );
  }, [sessionId, key]);
}
