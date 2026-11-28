// The change events of the layout's read side (layout plan L10), for one extension's `window.layout`.
// They listen to the layout service the window's extension host reaches, which follows the active
// mount: an activation switch reports every part, so each event fires only where its value differs
// from the last one reported. Layout changes (sizes, the width class, the side bar's location) are
// coalesced: a drag reports at most once per LAYOUT_EVENT_DELAY_MS.

import { EventEmitter, type DisposableLike, type ErrorReporter } from "./base";
import {
  type LayoutService,
  type Part,
  PART_IDS,
  Parts,
  type PartVisibilityChange,
} from "@/workbench/layoutService";
import { layoutWidthOf } from "@/workbench/layoutViewport";

/** The shortest gap between two `onDidChangeLayout` events. */
export const LAYOUT_EVENT_DELAY_MS = 100;

/** The view container the side bar shows, or undefined while the side bar is hidden. */
export function visibleViewContainer(layout: LayoutService): string | undefined {
  return layout.isVisible(Parts.SIDEBAR_PART) ? layout.getActiveViewContainer() : undefined;
}

/** What `onDidChangeLayout` compares: the width class, the side bar's location and every part's box. */
function layoutSnapshot(layout: LayoutService): string {
  return JSON.stringify({
    width: layoutWidthOf(layout.getViewport()),
    sideBarLocation: layout.getLocation(Parts.SIDEBAR_PART),
    sizes: PART_IDS.map((part) => layout.getSize(part) ?? null),
  });
}

export class ExtensionLayoutEvents {
  readonly visibility: EventEmitter<PartVisibilityChange>;
  readonly activeViewContainer: EventEmitter<string | undefined>;
  readonly layout: EventEmitter<void>;
  private readonly service: LayoutService;
  private readonly visible = new Map<Part, boolean>();
  private container: string | undefined;
  private snapshot: string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly subscriptions: (() => void)[];

  constructor(service: LayoutService, report: ErrorReporter) {
    this.service = service;
    this.visibility = new EventEmitter<PartVisibilityChange>(report);
    this.activeViewContainer = new EventEmitter<string | undefined>(report);
    this.layout = new EventEmitter<void>(report);
    for (const part of PART_IDS) this.visible.set(part, service.isVisible(part));
    this.container = visibleViewContainer(service);
    this.snapshot = layoutSnapshot(service);
    this.subscriptions = [
      service.onDidChangePartVisibility(({ part, visible }) => this.partVisibility(part, visible)),
      service.onDidChangeSideBar(() => this.sideBar()),
      service.onDidChangeLayout(() => this.scheduleLayout()),
      service.onDidChangeViewport(() => this.scheduleLayout()),
      service.onDidChangeRootSize(() => this.scheduleLayout()),
    ];
  }

  private partVisibility(part: Part, visible: boolean): void {
    if (this.visible.get(part) === visible) return;
    this.visible.set(part, visible);
    this.visibility.fire(Object.freeze({ part, visible }));
    if (part === Parts.SIDEBAR_PART) this.sideBar();
  }

  private sideBar(): void {
    const container = visibleViewContainer(this.service);
    if (container === this.container) return;
    this.container = container;
    this.activeViewContainer.fire(container);
  }

  private scheduleLayout(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const snapshot = layoutSnapshot(this.service);
      if (snapshot === this.snapshot) return;
      this.snapshot = snapshot;
      this.layout.fire(undefined);
    }, LAYOUT_EVENT_DELAY_MS);
  }

  /** Stops listening and drops a pending `onDidChangeLayout`. */
  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    for (const unsubscribe of this.subscriptions) unsubscribe();
    const owned: DisposableLike[] = [this.visibility, this.activeViewContainer, this.layout];
    for (const emitter of owned) emitter.dispose();
  }
}
