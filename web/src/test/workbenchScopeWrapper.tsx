import type { ReactNode } from "react";

import {
  createWorkbenchScope,
  type WorkbenchScope,
  WorkbenchScopeProvider,
} from "@/workbench/workbenchScope";

/** A renderHook wrapper that mounts its tree in `scope`, as an embed's app does. */
export function inWorkbenchScope(scope: WorkbenchScope) {
  return function WorkbenchScopeWrapper({ children }: { children: ReactNode }) {
    return <WorkbenchScopeProvider scope={scope}>{children}</WorkbenchScopeProvider>;
  };
}

/** A render wrapper for an embed on `root`: its overlays portal into `root`, as an embed's do. */
export function embedMount(root: HTMLElement) {
  const scope = createWorkbenchScope("/test-embed");
  scope.overlayRoot.set(root);
  return inWorkbenchScope(scope);
}
