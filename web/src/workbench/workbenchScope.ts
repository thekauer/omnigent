// Each mounted app's own workbench (layout plan L8): its layout service, layout state, product
// layout and Move View picker, so two embeds on one page (or an embed beside the standalone app)
// never share their side bar, views, widths or product policy. A mount provides its scope to its
// React tree; the window's code outside the trees (commands, keybindings) reaches the active one:
// the mount last mounted or used.

import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { createMoveViewPicker, type MoveViewPicker } from "@/store/moveViewPicker";
import {
  embedLayoutScope,
  LayoutStateStore,
  setActiveLayoutState,
  standaloneLayoutState,
} from "./layoutState";
import { LayoutService, setActiveLayoutService, standaloneLayoutService } from "./layoutService";
import {
  ProductLayoutPolicy,
  setActiveProductLayout,
  standaloneProductLayout,
} from "./productLayout";

export interface WorkbenchScope {
  /**
   * The mount's id, unique in the window (the standalone app's is "window"): the key of its
   * conversation view and of its palette rows.
   */
  readonly id: string;
  readonly layout: LayoutService;
  readonly state: LayoutStateStore;
  /** The product's layout policy built for this mount (`productLayout` is the active mount's). */
  readonly productLayout: ProductLayoutPolicy;
  /** The "View: Move View..." picker this mount's overlays render. */
  readonly moveViewPicker: MoveViewPicker;
  /** The id of the mount's own toaster: toasts about this mount only (a reset's undo). */
  readonly toasterId: string;
}

/**
 * The standalone app's own scope: its React tree never reads or registers into an embed's,
 * even while one is active (the window's commands follow the active one through the proxies).
 */
const WINDOW_SCOPE: WorkbenchScope = Object.freeze({
  id: "window",
  layout: standaloneLayoutService,
  state: standaloneLayoutState,
  productLayout: standaloneProductLayout,
  moveViewPicker: createMoveViewPicker(standaloneProductLayout),
  toasterId: "workbench-window",
});

/** Each mount's scope by its layout state, so a command that resolved a store finds its mount. */
const scopesByState = new WeakMap<LayoutStateStore, WorkbenchScope>([
  [standaloneLayoutState, WINDOW_SCOPE],
]);
/** Each embed's own layout key (its persistent one, whatever its state keeps in memory). */
const layoutKeys = new WeakMap<WorkbenchScope, string>();
/** The layout keys live mounts hold, each by the mount holding it (from its commit on). */
const heldLayoutKeys = new Map<string, WorkbenchScope>();
const warnedLayoutKeys = new Set<string>();
let createdScopes = 0;

/** The standalone app's scope; an embed's mounts have their own (`createWorkbenchScope`). */
export const standaloneWorkbenchScope: WorkbenchScope = WINDOW_SCOPE;

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

/**
 * A new mount's workbench: its layout state keyed by its basename and `workbenchId` (the mount's
 * stable id, for embeds that share a basename). A key a live mount already holds isn't shared:
 * the new mount keeps its layout in memory (see {@link holdWorkbenchLayoutKey}).
 */
export function createWorkbenchScope(
  basename: string | undefined,
  workbenchId?: string,
): WorkbenchScope {
  const layoutKey = embedLayoutScope(basename, workbenchId);
  const state = new LayoutStateStore();
  if (heldLayoutKeys.has(layoutKey)) keepSharedKeyInMemory(state, layoutKey);
  else state.setScope(layoutKey);
  createdScopes += 1;
  const id = `workbench-${createdScopes}`;
  const productLayout = new ProductLayoutPolicy();
  const scope = Object.freeze({
    id,
    state,
    layout: new LayoutService(state),
    productLayout,
    moveViewPicker: createMoveViewPicker(productLayout),
    toasterId: id,
  });
  scopesByState.set(state, scope);
  layoutKeys.set(scope, layoutKey);
  return scope;
}

/** A mount whose layout key another mount holds: its layout in memory, warned about once per key. */
function keepSharedKeyInMemory(state: LayoutStateStore, layoutKey: string): void {
  state.keepInMemory(`memory:${layoutKey}`);
  if (warnedLayoutKeys.has(layoutKey)) return;
  warnedLayoutKeys.add(layoutKey);
  console.warn(
    `[layout] another app on this page keeps its layout under "${layoutKey}"; this one keeps its layout for this page view only. Give each embed its own workbenchId to keep its layout across reloads.`,
  );
}

/**
 * Holds an embed's layout key while its mount is committed (its release when it goes). A mount
 * whose key another live mount holds keeps its layout in memory, with a console warning that it
 * needs its own `workbenchId` to keep its layout across reloads; it never reads that mount's
 * document. The standalone app holds nothing.
 */
export function holdWorkbenchLayoutKey(scope: WorkbenchScope): () => void {
  const layoutKey = layoutKeys.get(scope);
  if (layoutKey === undefined || scope.state.isMemoryOnly()) return () => {};
  const holder = heldLayoutKeys.get(layoutKey);
  if (holder !== undefined && holder !== scope) {
    keepSharedKeyInMemory(scope.state, layoutKey);
    return () => {};
  }
  heldLayoutKeys.set(layoutKey, scope);
  return () => {
    if (heldLayoutKeys.get(layoutKey) === scope) heldLayoutKeys.delete(layoutKey);
  };
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
  setActiveProductLayout(top?.productLayout ?? null);
  setActiveLayoutState(top?.state ?? null);
  for (const listener of [...activationListeners]) listener();
}

/** The mount the window's commands reach: the one last activated, else the standalone app. */
export function activeWorkbenchScope(): WorkbenchScope {
  return active[active.length - 1] ?? WINDOW_SCOPE;
}

/** Re-renders when `scope` becomes or stops being the active one. */
export function useIsActiveWorkbenchScope(scope: WorkbenchScope): boolean {
  return useSyncExternalStore(subscribeActiveWorkbenchScope, () => isActiveWorkbenchScope(scope));
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
  return activeWorkbenchScope() === scope;
}

/** Calls `listener` each time the active mount changes. */
export function subscribeActiveWorkbenchScope(listener: () => void): () => void {
  activationListeners.add(listener);
  return () => {
    activationListeners.delete(listener);
  };
}

/**
 * Makes `scope` the active one when the user points, types or focuses inside `getRoot()`
 * (the mount's own tree), so a mount used after another took over gets the window's
 * commands back.
 */
export function useActivateWorkbenchOnUse(
  scope: WorkbenchScope,
  getRoot: () => Element | null,
): void {
  const latestRoot = useRef(getRoot);
  latestRoot.current = getRoot;
  useEffect(() => {
    const onUse = (event: Event) => {
      const element = latestRoot.current();
      if (element && event.target instanceof Node && element.contains(event.target)) {
        activateWorkbenchScope(scope);
      }
    };
    const events = ["pointerdown", "keydown", "focusin"] as const;
    for (const type of events) document.addEventListener(type, onUse, true);
    return () => {
      for (const type of events) document.removeEventListener(type, onUse, true);
    };
  }, [scope]);
}

/** The mount went: the one used before it is active again (none: the standalone app). */
export function releaseWorkbenchScope(scope: WorkbenchScope): void {
  const index = active.indexOf(scope);
  if (index < 0) return;
  active.splice(index, 1);
  publish();
}
