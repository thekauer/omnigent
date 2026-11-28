import type { ReactNode } from "react";

import { type WorkbenchScope, WorkbenchScopeProvider } from "@/workbench/workbenchScope";

/** A renderHook wrapper that mounts its tree in `scope`, as an embed's app does. */
export function inWorkbenchScope(scope: WorkbenchScope) {
  return function WorkbenchScopeWrapper({ children }: { children: ReactNode }) {
    return <WorkbenchScopeProvider scope={scope}>{children}</WorkbenchScopeProvider>;
  };
}
