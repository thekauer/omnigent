// The workbench's parts and the layout service (layout plan L2), VS Code's `Parts` and
// `IWorkbenchLayoutService`: the shell registers each part it draws with a controller (its
// visibility and, where it has one, its size), and everything else (commands, context keys,
// later the activity bar and the extension API) reads and changes the layout through here.
// Plain data; no React.

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
  /** The part's current box size, when the shell measures it. */
  getSize?: () => PartSize | undefined;
  /** Sets the part's size (a drag's outcome), when the shell lets it be set. */
  setSize?: (size: Partial<PartSize>) => void;
}

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

  getSize(part: Part): PartSize | undefined {
    return this.controllers.get(part)?.getSize?.();
  }

  setSize(part: Part, size: Partial<PartSize>): void {
    this.controllers.get(part)?.setSize?.(size);
  }

  getLocation(part: Part): PartLocation {
    return DEFAULT_LOCATIONS[part];
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

/** The window's workbench layout. */
export const layoutService = new LayoutService();
