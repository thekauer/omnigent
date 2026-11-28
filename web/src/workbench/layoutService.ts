// The workbench's parts and the layout service (layout plan L2), VS Code's `Parts` and
// `IWorkbenchLayoutService`: the shell registers each part it draws with a controller (its
// visibility and, where it has one, its size), and everything else (commands, context keys,
// the activity bar and the extension API) reads and changes the layout through here. The
// primary side bar's own state lives here (L4): whether it is open and which view container
// it shows. Plain data; no React.

import { CONVERSATIONS_CONTAINER } from "./viewContainers";
import { LAYOUT_SLOTS, type LayoutStateStore, standaloneLayoutState } from "./layoutState";
import {
  LAYOUT_WIDTH_ATTRIBUTE,
  type LayoutViewport,
  layoutWidthAttributeValue,
  onDidChangeWindowViewport,
  viewportOfSize,
  windowViewport,
} from "./layoutViewport";

/** The workbench's parts, by VS Code's names (the auxiliary bar is the secondary side bar). */
export const Parts = Object.freeze({
  TITLEBAR_PART: "workbench.parts.titlebar",
  ACTIVITYBAR_PART: "workbench.parts.activitybar",
  SIDEBAR_PART: "workbench.parts.sidebar",
  MAIN_PART: "workbench.parts.main",
  AUXILIARYBAR_PART: "workbench.parts.auxiliarybar",
  PANEL_PART: "workbench.parts.panel",
  STATUSBAR_PART: "workbench.parts.statusbar",
} as const);

export type Part = (typeof Parts)[keyof typeof Parts];

export const PART_IDS: readonly Part[] = Object.freeze(Object.values(Parts));

/** A part's stable hook: `[data-part="<name>"]` on the element that draws it. */
export function partHook(part: Part): string {
  return part.slice("workbench.parts.".length);
}

export function isPart(value: unknown): value is Part {
  return typeof value === "string" && (PART_IDS as readonly string[]).includes(value);
}

/** Where a part sits. The side bars swap with `workbench.sideBar.location` (a later stage). */
export type PartLocation = "top" | "left" | "right" | "bottom" | "center";

const DEFAULT_LOCATIONS: Readonly<Record<Part, PartLocation>> = Object.freeze({
  [Parts.TITLEBAR_PART]: "top",
  [Parts.ACTIVITYBAR_PART]: "left",
  [Parts.SIDEBAR_PART]: "left",
  [Parts.MAIN_PART]: "center",
  [Parts.AUXILIARYBAR_PART]: "right",
  [Parts.PANEL_PART]: "bottom",
  [Parts.STATUSBAR_PART]: "bottom",
});

export interface PartSize {
  readonly width: number;
  readonly height: number;
}

/** What the shell gives the service for a part it draws. */
export interface PartController {
  isVisible: () => boolean;
  /** Shows or hides the part, as the shell does for its own buttons. */
  setHidden: (hidden: boolean) => void;
  /** The shell's toggle, when it differs from flipping `isVisible` (a pinned side bar). */
  toggle?: () => void;
  /** The part's current box size, when the shell measures it (else its element's box). */
  getSize?: () => PartSize | undefined;
  /** Sets the part's size (a drag's outcome), when the shell lets it be set. */
  setSize?: (size: Partial<PartSize>) => void;
  /** Moves keyboard focus into the part. */
  focus?: () => void;
  /** Maximizes the part over the main part, or restores it (the secondary side bar's). */
  toggleMaximized?: () => void;
  /** Whether the part is maximized over the main part. */
  isMaximized?: () => boolean;
}

/**
 * The element that draws `part` in `root` (an embed's root; null: the window). Without a root,
 * an embed's parts (inside its `.omnigent-app` scope) are not the window's.
 */
export function findPartElement(part: Part, root: HTMLElement | null): HTMLElement | null {
  const hook = `[data-part="${partHook(part)}"]`;
  if (root) return root.querySelector<HTMLElement>(hook);
  if (typeof document === "undefined") return null;
  for (const element of document.querySelectorAll<HTMLElement>(hook)) {
    if (!element.closest(".omnigent-app")) return element;
  }
  return null;
}

/** A value or an update of the previous one, as React's `setState` takes. */
export type StateUpdate<T> = T | ((previous: T) => T);

export interface PartVisibilityChange {
  readonly part: Part;
  readonly visible: boolean;
}

type Listener<T> = (event: T) => void;

function fire<T>(listeners: ReadonlySet<Listener<T>>, event: T): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (error) {
      console.error("[layout] a layout listener failed", error);
    }
  }
}

export class LayoutService {
  private readonly controllers = new Map<Part, PartController>();
  private readonly visible = new Map<Part, boolean>();
  private readonly visibilityListeners = new Set<Listener<PartVisibilityChange>>();
  private readonly layoutListeners = new Set<Listener<void>>();
  private readonly store: LayoutStateStore;
  /** The side bar's pinned open state; undefined until a shell first reads it. */
  private sideBarOpen: boolean | undefined;
  private sideBarHolds = 0;
  private readonly sideBarListeners = new Set<() => void>();

  private root: HTMLElement | null = null;
  private rootSize: PartSize | undefined;
  private rootObserver: ResizeObserver | null = null;
  private readonly rootListeners = new Set<Listener<void>>();
  /** The root's layout once it has a box (a root not laid out yet follows the window). */
  private rootViewport: LayoutViewport | null = null;
  private readonly viewportListeners = new Set<() => void>();

  constructor(store: LayoutStateStore = standaloneLayoutState) {
    this.store = store;
  }

  /** The layout state this service keeps the side bar's container in. */
  getStore(): LayoutStateStore {
    return this.store;
  }

  /**
   * The element the parts are laid out in (an embed's root; null: the window): its size is
   * what part sizes clamp to and what width-based rules read (layout plan L8, decision 14).
   */
  setRoot(root: HTMLElement | null): void {
    if (root === this.root) return;
    this.rootObserver?.disconnect();
    this.rootObserver = null;
    this.root?.removeAttribute(LAYOUT_WIDTH_ATTRIBUTE);
    this.root = root;
    if (root && typeof ResizeObserver !== "undefined") {
      this.rootObserver = new ResizeObserver(() => this.measureRoot());
      this.rootObserver.observe(root);
    }
    // Another root's layout is never kept, even at the size this one measures.
    this.measureRoot(true);
  }

  getRoot(): HTMLElement | null {
    return this.root;
  }

  /**
   * Takes the root's box. A zero-width box (the root is hidden) is no box, but a root that has
   * been measured keeps its last layout while hidden: its mount doesn't flip to the window's.
   */
  private measureRoot(forced = false): void {
    const box = this.root?.getBoundingClientRect();
    const next =
      box && box.width > 0 ? Object.freeze({ width: box.width, height: box.height }) : undefined;
    if (!forced && !next && this.rootViewport) return;
    if (!forced && next?.width === this.rootSize?.width && next?.height === this.rootSize?.height) {
      return;
    }
    this.rootSize = next;
    const viewport = next ? viewportOfSize(next.width, next.height) : null;
    if (viewport) {
      this.root?.setAttribute(LAYOUT_WIDTH_ATTRIBUTE, layoutWidthAttributeValue(viewport));
    } else {
      this.root?.removeAttribute(LAYOUT_WIDTH_ATTRIBUTE);
    }
    const viewportChanged = viewport !== this.rootViewport;
    this.rootViewport = viewport;
    fire(this.rootListeners, undefined);
    fire(this.layoutListeners, undefined);
    if (viewportChanged) for (const listener of [...this.viewportListeners]) listener();
  }

  /**
   * The layout the parts' width picks (decision 14): the root's box in an embed, the window's
   * media queries otherwise. Always the desktop layout in the desktop app.
   */
  getViewport(): LayoutViewport {
    return this.rootViewport ?? windowViewport();
  }

  /** The root's own layout, or null while the parts follow the window (no root, or no box yet). */
  getRootViewport(): LayoutViewport | null {
    return this.rootViewport;
  }

  /** True below `md`: the mobile layout. */
  isMobileLayout(): boolean {
    return this.getViewport().mobile;
  }

  /** True in the band where the open side bar docks beside the chat. */
  isSideBySideLayout(): boolean {
    return this.getViewport().sideBySide;
  }

  /** Fires when {@link getViewport} may have changed. */
  onDidChangeViewport(listener: () => void): () => void {
    this.viewportListeners.add(listener);
    const offWindow = onDidChangeWindowViewport(() => {
      if (!this.rootViewport) listener();
    });
    return () => {
      this.viewportListeners.delete(listener);
      offWindow();
    };
  }

  /** The service this one acts on: itself (the active mount's for the window's proxy). */
  resolve(): LayoutService {
    return this;
  }

  /** The root's size, or the window's when the parts are laid out in the window. */
  getRootSize(): PartSize {
    if (this.rootSize) return this.rootSize;
    if (typeof window === "undefined") return { width: 0, height: 0 };
    return { width: window.innerWidth, height: window.innerHeight };
  }

  /** Fires when the root's size changes (the window's resize when there is no root). */
  onDidChangeRootSize(listener: Listener<void>): () => void {
    this.rootListeners.add(listener);
    const onResize = () => {
      if (!this.root) listener(undefined);
    };
    if (typeof window !== "undefined") window.addEventListener("resize", onResize);
    return () => {
      this.rootListeners.delete(listener);
      if (typeof window !== "undefined") window.removeEventListener("resize", onResize);
    };
  }

  /**
   * The shell draws `part`: its controller answers for it until the returned removal. A
   * later registration replaces an earlier one (a remount).
   */
  registerPart(part: Part, controller: PartController): () => void {
    this.controllers.set(part, controller);
    this.partChanged(part);
    return () => {
      if (this.controllers.get(part) !== controller) return;
      this.controllers.delete(part);
      this.partChanged(part);
    };
  }

  /** Whether the shell draws `part` (reserved parts aren't). */
  hasPart(part: Part): boolean {
    return this.controllers.has(part);
  }

  /** Whether `part` is on screen; a part the shell doesn't draw isn't. */
  isVisible(part: Part): boolean {
    const controller = this.controllers.get(part);
    if (!controller) return false;
    try {
      return controller.isVisible();
    } catch {
      return false;
    }
  }

  /** VS Code's `setPartHidden(hidden, part)`. A part the shell doesn't draw stays hidden. */
  setPartHidden(hidden: boolean, part: Part): void {
    this.controllers.get(part)?.setHidden(hidden);
  }

  /** Flips `part` as its toggle command does. */
  togglePart(part: Part): void {
    const controller = this.controllers.get(part);
    if (!controller) return;
    if (controller.toggle) controller.toggle();
    else controller.setHidden(this.isVisible(part));
  }

  /** A visible part's box: the shell's own measure, else its element's. Undefined when hidden. */
  getSize(part: Part): PartSize | undefined {
    const controller = this.controllers.get(part);
    if (!controller || !this.isVisible(part)) return undefined;
    if (controller.getSize) return controller.getSize();
    const element = findPartElement(part, this.root);
    if (!element) return undefined;
    const box = element.getBoundingClientRect();
    return Object.freeze({ width: box.width, height: box.height });
  }

  isMaximized(part: Part): boolean {
    return this.controllers.get(part)?.isMaximized?.() ?? false;
  }

  setSize(part: Part, size: Partial<PartSize>): void {
    this.controllers.get(part)?.setSize?.(size);
  }

  getLocation(part: Part): PartLocation {
    return DEFAULT_LOCATIONS[part];
  }

  /** VS Code's `toggleMaximizedAuxiliaryBar`: the part over the main part, or back. */
  toggleMaximized(part: Part): void {
    if (!this.isVisible(part)) this.setPartHidden(false, part);
    this.controllers.get(part)?.toggleMaximized?.();
  }

  /** Moves keyboard focus into `part`, when the shell draws it and can focus it. */
  focusPart(part: Part): boolean {
    const focus = this.controllers.get(part)?.focus;
    if (!focus) return false;
    focus();
    return true;
  }

  /**
   * Whether the primary side bar is pinned open (a peek is the shell's own), starting from
   * `initial` the first time a shell asks.
   */
  isSideBarOpen(initial: () => boolean = () => true): boolean {
    this.sideBarOpen ??= initial();
    return this.sideBarOpen;
  }

  setSideBarOpen = (update: StateUpdate<boolean>): void => {
    const previous = this.isSideBarOpen();
    const next = typeof update === "function" ? update(previous) : update;
    if (next === previous) return;
    this.sideBarOpen = next;
    this.fireSideBar();
  };

  /** The view container the side bar shows (the layout state's, else the sessions). */
  getActiveViewContainer(): string {
    const stored = this.store.get(LAYOUT_SLOTS.activeViewContainer);
    return typeof stored === "string" && stored !== "" ? stored : CONVERSATIONS_CONTAINER;
  }

  /** Shows `containerId` in the side bar, remembered in the layout state. */
  setActiveViewContainer(containerId: string): void {
    if (containerId === this.getActiveViewContainer()) return;
    // The store's change reaches the side bar's listeners (`onDidChangeSideBar`).
    this.store.set(
      LAYOUT_SLOTS.activeViewContainer,
      containerId === CONVERSATIONS_CONTAINER ? undefined : containerId,
    );
  }

  /** VS Code's `openViewContainer`: shows the container and the side bar. */
  openViewContainer(containerId: string): void {
    this.setActiveViewContainer(containerId);
    this.setPartHidden(false, Parts.SIDEBAR_PART);
  }

  /** Fires when the side bar's open state or active container changed. */
  onDidChangeSideBar = (listener: () => void): (() => void) => {
    this.sideBarListeners.add(listener);
    const unsubscribeStore = this.store.subscribe((change) => {
      if (!change.slots || change.slots.includes(LAYOUT_SLOTS.activeViewContainer)) listener();
    });
    return () => {
      this.sideBarListeners.delete(listener);
      unsubscribeStore();
    };
  };

  /**
   * A shell keeps the side bar's state while it holds it; when the last holder lets go the
   * state is dropped, so the next shell starts from the layout state again.
   */
  holdSideBarState(): () => void {
    this.sideBarHolds += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.sideBarHolds -= 1;
      // A remount in the same task (React StrictMode) holds it again before this runs.
      queueMicrotask(() => {
        if (this.sideBarHolds === 0) this.sideBarOpen = undefined;
      });
    };
  }

  private fireSideBar(): void {
    for (const listener of [...this.sideBarListeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[layout] a side bar listener failed", error);
      }
    }
  }

  /**
   * The shell tells the service a part may have changed (its visibility or size): visibility
   * listeners hear a real change only, layout listeners every call.
   */
  partChanged(part: Part): void {
    const visible = this.isVisible(part);
    if ((this.visible.get(part) ?? false) !== visible) {
      this.visible.set(part, visible);
      fire(this.visibilityListeners, Object.freeze({ part, visible }));
    }
    fire(this.layoutListeners, undefined);
  }

  onDidChangePartVisibility(listener: Listener<PartVisibilityChange>): () => void {
    this.visibilityListeners.add(listener);
    return () => {
      this.visibilityListeners.delete(listener);
    };
  }

  onDidChangeLayout(listener: Listener<void>): () => void {
    this.layoutListeners.add(listener);
    return () => {
      this.layoutListeners.delete(listener);
    };
  }
}

/** The standalone app's workbench layout (an embed's mount has its own). */
export const standaloneLayoutService = new LayoutService(standaloneLayoutState);

let activeService: LayoutService = standaloneLayoutService;
const switchListeners = new Set<() => void>();

/** Calls `subscribe` on the active service now and again each time another becomes active. */
function followActiveService(
  subscribe: (service: LayoutService) => () => void,
  onSwitch?: () => void,
): () => void {
  let unsubscribe = subscribe(activeService);
  const resubscribe = () => {
    unsubscribe();
    unsubscribe = subscribe(activeService);
    onSwitch?.();
  };
  switchListeners.add(resubscribe);
  return () => {
    switchListeners.delete(resubscribe);
    unsubscribe();
  };
}

/**
 * The layout the window's code outside a mount's React tree reaches (the extension host's
 * commands, context keys): the active mount's (last mounted or used), the standalone app's
 * otherwise. Inside a mount, use the mount's own (`useWorkbenchScope`).
 */
class ActiveLayoutService extends LayoutService {
  override resolve(): LayoutService {
    return activeService;
  }
  override registerPart(part: Part, controller: PartController): () => void {
    return activeService.registerPart(part, controller);
  }
  override hasPart(part: Part): boolean {
    return activeService.hasPart(part);
  }
  override isVisible(part: Part): boolean {
    return activeService.isVisible(part);
  }
  override setPartHidden(hidden: boolean, part: Part): void {
    activeService.setPartHidden(hidden, part);
  }
  override togglePart(part: Part): void {
    activeService.togglePart(part);
  }
  override getSize(part: Part): PartSize | undefined {
    return activeService.getSize(part);
  }
  override isMaximized(part: Part): boolean {
    return activeService.isMaximized(part);
  }
  override setSize(part: Part, size: Partial<PartSize>): void {
    activeService.setSize(part, size);
  }
  override getLocation(part: Part): PartLocation {
    return activeService.getLocation(part);
  }
  override toggleMaximized(part: Part): void {
    activeService.toggleMaximized(part);
  }
  override focusPart(part: Part): boolean {
    return activeService.focusPart(part);
  }
  override isSideBarOpen(initial?: () => boolean): boolean {
    return activeService.isSideBarOpen(initial);
  }
  override setSideBarOpen = (update: StateUpdate<boolean>): void => {
    activeService.setSideBarOpen(update);
  };
  override getActiveViewContainer(): string {
    return activeService.getActiveViewContainer();
  }
  override setActiveViewContainer(containerId: string): void {
    activeService.setActiveViewContainer(containerId);
  }
  override openViewContainer(containerId: string): void {
    activeService.openViewContainer(containerId);
  }
  override onDidChangeSideBar = (listener: () => void): (() => void) =>
    followActiveService((service) => service.onDidChangeSideBar(listener), listener);
  override holdSideBarState(): () => void {
    return activeService.holdSideBarState();
  }
  override partChanged(part: Part): void {
    activeService.partChanged(part);
  }
  override onDidChangePartVisibility(listener: Listener<PartVisibilityChange>): () => void {
    return followActiveService(
      (service) => service.onDidChangePartVisibility(listener),
      () => {
        for (const part of PART_IDS) listener({ part, visible: activeService.isVisible(part) });
      },
    );
  }
  override onDidChangeLayout(listener: Listener<void>): () => void {
    return followActiveService(
      (service) => service.onDidChangeLayout(listener),
      () => listener(undefined),
    );
  }
  override getStore(): LayoutStateStore {
    return activeService.getStore();
  }
  override setRoot(root: HTMLElement | null): void {
    activeService.setRoot(root);
  }
  override getRoot(): HTMLElement | null {
    return activeService.getRoot();
  }
  override getRootSize(): PartSize {
    return activeService.getRootSize();
  }
  override onDidChangeRootSize(listener: Listener<void>): () => void {
    return followActiveService(
      (service) => service.onDidChangeRootSize(listener),
      () => listener(undefined),
    );
  }
  override getViewport(): LayoutViewport {
    return activeService.getViewport();
  }
  override getRootViewport(): LayoutViewport | null {
    return activeService.getRootViewport();
  }
  override isMobileLayout(): boolean {
    return activeService.isMobileLayout();
  }
  override isSideBySideLayout(): boolean {
    return activeService.isSideBySideLayout();
  }
  override onDidChangeViewport(listener: () => void): () => void {
    return followActiveService((service) => service.onDidChangeViewport(listener), listener);
  }
}

/** The active mount's workbench layout (the standalone app's unless an embed is active). */
export const layoutService: LayoutService = new ActiveLayoutService(standaloneLayoutState);

/** Makes `service` the active layout (null: the standalone app's). */
export function setActiveLayoutService(service: LayoutService | null): void {
  const next = service ?? standaloneLayoutService;
  if (next === activeService) return;
  activeService = next;
  for (const listener of [...switchListeners]) listener();
}

export function activeLayoutService(): LayoutService {
  return activeService;
}
