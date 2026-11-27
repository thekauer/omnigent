// View containers (layout plan L3), VS Code's `IViewContainersRegistry`: the named groups of
// views each side bar and the panel show. Extensions contribute them through
// `contributes.viewsContainers` (`activitybar` for the primary side bar, `secondarySidebar`, an
// Omnigent key, for the secondary side bar, and `panel`); the host keeps the right panel's
// container as one of its own. Plain data; no React.

import { useSyncExternalStore } from "react";
import type { RailViewTitleAction } from "@/shell/railViews";

/** Where a container's views are drawn: the part that shows it. */
export type ViewContainerLocation = "sidebar" | "auxiliarybar" | "panel";

/** `contributes.viewsContainers` keys and the location each one names. */
export const VIEW_CONTAINER_LOCATION_KEYS: Readonly<Record<string, ViewContainerLocation>> =
  Object.freeze({
    activitybar: "sidebar",
    secondarySidebar: "auxiliarybar",
    panel: "panel",
  });

/** The classic workspace rail's container, drawn in the secondary side bar. */
export const RIGHT_PANEL_CONTAINER = "omnigent.rightPanel";
/** The sessions: the primary side bar's first container. */
export const CONVERSATIONS_CONTAINER = "omnigent.conversations";

/** The owner of the host's own containers (VS Code's workbench registers Explorer, Search...). */
export const HOST_CONTAINER_OWNER = "omnigent";

export interface ViewContainerDescriptor {
  readonly id: string;
  readonly title: string;
  /** A name from the view icon allowlist (railViewIcons.ts). */
  readonly icon: string | undefined;
  readonly location: ViewContainerLocation;
  /** The contributing extension, or `omnigent` for the host's own. */
  readonly extensionId: string;
  /** Built-in extensions' and the host's containers come first. */
  readonly builtIn: boolean;
  /** Manifest order within the extension. */
  readonly order: number;
}

/** The host's own containers, always there. */
export const CORE_VIEW_CONTAINERS: readonly ViewContainerDescriptor[] = Object.freeze([
  Object.freeze({
    id: RIGHT_PANEL_CONTAINER,
    title: "Workspace",
    icon: "panel-right",
    location: "auxiliarybar",
    extensionId: HOST_CONTAINER_OWNER,
    builtIn: true,
    order: 0,
  } satisfies ViewContainerDescriptor),
]);

export interface ViewContainersSnapshot {
  /** Core containers first, then built-ins in registration order, then others by extension id. */
  readonly containers: readonly ViewContainerDescriptor[];
  /** Each container's `viewContainer/title` actions under the current context keys. */
  readonly titleActions: ReadonlyMap<string, readonly RailViewTitleAction[]>;
}

const NO_ACTIONS: readonly RailViewTitleAction[] = Object.freeze([]);

interface Entry {
  readonly descriptor: ViewContainerDescriptor;
  readonly sequence: number;
}

export class ViewContainerRegistry {
  private readonly entries = new Map<string, Entry>();
  private titleActions = new Map<string, readonly RailViewTitleAction[]>();
  private readonly listeners = new Set<() => void>();
  private sequence = 0;
  private snapshot: ViewContainersSnapshot;
  private readonly log: Pick<Console, "warn">;

  constructor(log: Pick<Console, "warn"> = console) {
    this.log = log;
    this.snapshot = this.build();
  }

  getSnapshot = (): ViewContainersSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get(id: string): ViewContainerDescriptor | undefined {
    return (
      CORE_VIEW_CONTAINERS.find((container) => container.id === id) ??
      this.entries.get(id)?.descriptor
    );
  }

  /** The container's title actions (none until the extension host sets them). */
  actionsOf(id: string): readonly RailViewTitleAction[] {
    return this.snapshot.titleActions.get(id) ?? NO_ACTIONS;
  }

  /** Sets the containers' title actions (the views service, when menus or context keys change). */
  setTitleActions(actions: ReadonlyMap<string, readonly RailViewTitleAction[]>): void {
    this.titleActions = new Map(actions);
    this.publish();
  }

  /** Containers drawn at `location`, in order. */
  at(location: ViewContainerLocation): readonly ViewContainerDescriptor[] {
    return this.snapshot.containers.filter((container) => container.location === location);
  }

  /**
   * Adds a container; an id someone registered already stays theirs (a warning). Returns the
   * removal, a no-op when the id was refused.
   */
  register(descriptor: ViewContainerDescriptor): () => void {
    if (this.get(descriptor.id)) {
      this.log.warn(
        `[omnigent-extensions] ${descriptor.extensionId}: view container ${descriptor.id} already exists; ignoring it`,
      );
      return () => {};
    }
    const entry: Entry = { descriptor: Object.freeze({ ...descriptor }), sequence: this.sequence };
    this.sequence += 1;
    this.entries.set(descriptor.id, entry);
    this.publish();
    return () => {
      if (this.entries.get(descriptor.id) !== entry) return;
      this.entries.delete(descriptor.id);
      this.publish();
    };
  }

  private build(): ViewContainersSnapshot {
    const registered = [...this.entries.values()].sort(
      (left, right) =>
        Number(right.descriptor.builtIn) - Number(left.descriptor.builtIn) ||
        (left.descriptor.builtIn
          ? left.sequence - right.sequence
          : left.descriptor.extensionId.localeCompare(right.descriptor.extensionId) ||
            left.descriptor.order - right.descriptor.order),
    );
    return Object.freeze({
      containers: Object.freeze([
        ...CORE_VIEW_CONTAINERS,
        ...registered.map((entry) => entry.descriptor),
      ]),
      titleActions: this.titleActions,
    });
  }

  private publish(): void {
    this.snapshot = this.build();
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[layout] a view container listener failed", error);
      }
    }
  }
}

/** The window's view containers. */
export const viewContainers = new ViewContainerRegistry();

export function useViewContainers(
  registry: ViewContainerRegistry = viewContainers,
): ViewContainersSnapshot {
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
}
