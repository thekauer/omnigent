// The activity bar's state (layout plan L4): where it sits (`workbench.activityBar.location`,
// a setting), and what the user changed about its items (moved, hidden), kept in the layout
// state as VS Code keeps its composite bar's items in storage. Plain data, plus the React reads.

import { useCallback, useSyncExternalStore } from "react";
import {
  type ConfigurationService,
  configurationService,
} from "@/configuration/configurationService";
import { useConfigurationValue } from "@/configuration/useConfiguration";
import { LAYOUT_SLOTS, type LayoutStateStore, layoutState } from "./layoutState";
import { LayoutTokens, readLengthToken } from "./layoutTokens";

export const ACTIVITY_BAR_LOCATION_SETTING = "workbench.activityBar.location";

export type ActivityBarLocation = "default" | "top" | "bottom" | "hidden";

/** The bar's width beside the side bar, as the shell reserves it (`ui-activitybar-width`). */
export function activityBarWidthPx(): number {
  return readLengthToken(LayoutTokens.activityBarWidth, () => 48);
}

const LOCATIONS: readonly ActivityBarLocation[] = ["default", "top", "bottom", "hidden"];

export function activityBarLocationOf(value: unknown): ActivityBarLocation {
  return LOCATIONS.includes(value as ActivityBarLocation)
    ? (value as ActivityBarLocation)
    : "hidden";
}

/** The setting's value; `hidden` (today's look) when nothing sets it. */
export function useActivityBarLocation(
  service: ConfigurationService = configurationService,
): ActivityBarLocation {
  return activityBarLocationOf(useConfigurationValue(ACTIVITY_BAR_LOCATION_SETTING, service));
}

/** VS Code's toggle: a hidden bar comes back at `default`, any other location hides it. */
export function toggleActivityBarVisibility(
  service: ConfigurationService = configurationService,
): void {
  const location = activityBarLocationOf(service.getValue(ACTIVITY_BAR_LOCATION_SETTING));
  service.update(ACTIVITY_BAR_LOCATION_SETTING, location === "hidden" ? "default" : "hidden");
}

export interface ActivityBarItemsState {
  /** Container ids in the user's order; others follow in their own order. */
  readonly order: readonly string[];
  /** Container ids the user hid. */
  readonly hidden: readonly string[];
}

const EMPTY: ActivityBarItemsState = Object.freeze({ order: [], hidden: [] });

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string"))]
    : [];
}

export function readActivityBarItems(store: LayoutStateStore = layoutState): ActivityBarItemsState {
  const stored = store.get(LAYOUT_SLOTS.activityBar);
  if (typeof stored !== "object" || stored === null) return EMPTY;
  const { order, hidden } = stored as Record<string, unknown>;
  return Object.freeze({ order: stringList(order), hidden: stringList(hidden) });
}

function writeActivityBarItems(state: ActivityBarItemsState, store: LayoutStateStore): void {
  const value = {
    ...(state.order.length > 0 ? { order: [...state.order] } : {}),
    ...(state.hidden.length > 0 ? { hidden: [...state.hidden] } : {}),
  };
  store.set(LAYOUT_SLOTS.activityBar, Object.keys(value).length > 0 ? value : undefined);
}

/** `ids` in the user's order: the stored ones first, as stored, then the rest as they came. */
export function orderActivityBarItems<T extends { readonly id: string }>(
  items: readonly T[],
  state: ActivityBarItemsState,
): T[] {
  const rank = new Map(state.order.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        (rank.get(left.item.id) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(right.item.id) ?? Number.MAX_SAFE_INTEGER) || left.index - right.index,
    )
    .map(({ item }) => item);
}

/** Moves `id` to where `beforeId` is (the end for undefined), among `ids` as drawn. */
export function moveActivityBarItem(
  ids: readonly string[],
  id: string,
  beforeId: string | undefined,
  store: LayoutStateStore = layoutState,
): void {
  const without = ids.filter((item) => item !== id);
  const index = beforeId === undefined ? without.length : without.indexOf(beforeId);
  const order = [...without.slice(0, index < 0 ? without.length : index), id];
  order.push(...without.slice(index < 0 ? without.length : index));
  writeActivityBarItems({ ...readActivityBarItems(store), order }, store);
}

export function setActivityBarItemHidden(
  id: string,
  hidden: boolean,
  store: LayoutStateStore = layoutState,
): void {
  const state = readActivityBarItems(store);
  const others = state.hidden.filter((item) => item !== id);
  writeActivityBarItems({ ...state, hidden: hidden ? [...others, id] : others }, store);
}

let cache: { text: string; state: ActivityBarItemsState } | undefined;

export function useActivityBarItems(store: LayoutStateStore = layoutState): ActivityBarItemsState {
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  return useSyncExternalStore(
    subscribe,
    () => {
      const state = readActivityBarItems(store);
      const text = JSON.stringify(state);
      if (cache?.text !== text) cache = { text, state };
      return cache.state;
    },
    () => EMPTY,
  );
}
