// Each mounted app's own workbench (layout plan L8): its layout service and layout state, so two
// embeds on one page (or an embed beside the standalone app) never share their side bar, views
// or widths. A mount provides its scope to its React tree; the window's code outside the trees
// (commands, keybindings) reaches the active one: the mount last mounted or used.

import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";
import {
  embedLayoutScope,
  LayoutStateStore,
  setActiveLayoutState,
  standaloneLayoutState,
} from "./layoutState";
import { LayoutService, setActiveLayoutService, standaloneLayoutService } from "./layoutService";

export interface WorkbenchScope {
  /** The mount's id, unique in the window: the key of its conversation view. */
  readonly id: string;
  readonly layout: LayoutService;
  readonly state: LayoutStateStore;
  /** The id of the mount's own toaster: toasts about this mount only (a reset's undo). */
  readonly toasterId: string;
}

/**
 * The standalone app's own scope: its React tree never reads or registers into an embed's,
 * even while one is active (the window's commands follow the active one through the proxies).
 */
const WINDOW_SCOPE: WorkbenchScope = Object.freeze({
  id: "workbench-window",
  layout: standaloneLayoutService,
  state: standaloneLayoutState,
  toasterId: "workbench-window",
});

/** Each mount's scope by its layout state, so a command that resolved a store finds its mount. */
const scopesByState = new WeakMap<LayoutStateStore, WorkbenchScope>([
  [standaloneLayoutState, WINDOW_SCOPE],
]);
let createdScopes = 0;

const WorkbenchScopeContext = createContext<WorkbenchScope>(WINDOW_SCOPE);

export function WorkbenchScopeProvider({
  scope,
  children,
}: {
  scope: WorkbenchScope;
  children: ReactNode;
}) {
  return createElement(WorkbenchScopeContext.Provider, { value: scope }, children);
}

/** The workbench of the mount being rendered. */
export function useWorkbenchScope(): WorkbenchScope {
  return useContext(WorkbenchScopeContext);
}

/** A new mount's workbench: its layout state keyed by its basename. */
export function createWorkbenchScope(basename: string | undefined): WorkbenchScope {
  const state = new LayoutStateStore();
  state.setScope(embedLayoutScope(basename));
  createdScopes += 1;
  const id = `workbench-${createdScopes}`;
  const scope = Object.freeze({
    id,
    state,
    layout: new LayoutService(state),
    toasterId: id,
  });
  scopesByState.set(state, scope);
  return scope;
}

/** The mount whose layout state `store` is (the window's proxy: the active mount's). */
export function workbenchScopeOfState(store: LayoutStateStore): WorkbenchScope | undefined {
  return scopesByState.get(store.resolve());
}

/** The mounts, last activated last. */
const active: WorkbenchScope[] = [];
const activationListeners = new Set<() => void>();

function publish(): void {
  const top = active[active.length - 1];
  // The service first: the state's listeners then read the new mount's service.
  setActiveLayoutService(top?.layout ?? null);
  setActiveLayoutState(top?.state ?? null);
  for (const listener of activationListeners) listener();
}

/** Notified whenever the active scope changes. Returns an unsubscribe function. */
export function subscribeWorkbenchActivation(listener: () => void): () => void {
  activationListeners.add(listener);
  return () => {
    activationListeners.delete(listener);
  };
}

/** Re-renders when `scope` becomes or stops being the active one. */
export function useIsActiveWorkbenchScope(scope: WorkbenchScope): boolean {
  return useSyncExternalStore(subscribeWorkbenchActivation, () => isActiveWorkbenchScope(scope));
}

/** Makes `scope` the one the window's commands reach (a mount, or the user's use of it). */
export function activateWorkbenchScope(scope: WorkbenchScope): void {
  const index = active.indexOf(scope);
  if (index === active.length - 1 && index >= 0) return;
  if (index >= 0) active.splice(index, 1);
  active.push(scope);
  publish();
}

/** Whether the window's keybindings reach `scope` (the standalone app's while no mount is). */
export function isActiveWorkbenchScope(scope: WorkbenchScope): boolean {
  const top = active[active.length - 1];
  return top ? top === scope : scope === WINDOW_SCOPE;
}

/** The mount went: the one used before it is active again (none: the standalone app). */
export function releaseWorkbenchScope(scope: WorkbenchScope): void {
  const index = active.indexOf(scope);
  if (index < 0) return;
  active.splice(index, 1);
  publish();
}
