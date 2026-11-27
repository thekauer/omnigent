// The host components built-in views draw as their body (`builtInView`, layout plan L3): the
// trusted tier's first seam, open to built-in extensions only. The side bar registers its own
// (the navigation, the conversation list); the trusted stage opens the same registry to products.

import { type ComponentType, createElement, memo, useEffect, useSyncExternalStore } from "react";
import type { BuiltInViewName } from "@/workbench/builtInViewNames";
import type { RailViewContribution } from "./railViews";

export interface BuiltInViewProps {
  /** The view being drawn. */
  readonly view: RailViewContribution;
}

const components = new Map<BuiltInViewName, ComponentType<BuiltInViewProps>>();

/**
 * Registers the component drawn for `name` (at module load, before the first render; a
 * container drawn earlier doesn't redraw). Memoized: a view re-renders only when its own
 * contribution or the state it reads changes, not on every registry update.
 */
export function registerBuiltInView(
  name: BuiltInViewName,
  component: ComponentType<BuiltInViewProps>,
): () => void {
  const drawn = memo(component);
  components.set(name, drawn);
  return () => {
    if (components.get(name) === drawn) components.delete(name);
  };
}

export function builtInViewComponent(
  name: string | undefined,
): ComponentType<BuiltInViewProps> | undefined {
  return name === undefined ? undefined : components.get(name as BuiltInViewName);
}

/** A built-in view's badge (the inbox's count), as its provider reads it. */
export interface BuiltInViewBadge {
  readonly value: number;
  /** Drawn instead of the value (a `+` for an incomplete count). */
  readonly label?: string;
  readonly tooltip: string;
}

export type BuiltInViewBadgeHook = () => BuiltInViewBadge | undefined;

const badgeHooks = new Map<BuiltInViewName, BuiltInViewBadgeHook>();
let badges: ReadonlyMap<string, BuiltInViewBadge> = new Map();
const badgeListeners = new Set<() => void>();

/** Registers the hook that reads `name`'s badge; {@link BuiltInViewBadgeProviders} runs it. */
export function registerBuiltInViewBadge(name: BuiltInViewName, hook: BuiltInViewBadgeHook): void {
  badgeHooks.set(name, hook);
}

function publishBadge(name: string, badge: BuiltInViewBadge | undefined): void {
  const current = badges.get(name);
  if (JSON.stringify(current) === JSON.stringify(badge)) return;
  const next = new Map(badges);
  if (badge) next.set(name, badge);
  else next.delete(name);
  badges = next;
  for (const listener of [...badgeListeners]) listener();
}

function subscribeBadges(listener: () => void): () => void {
  badgeListeners.add(listener);
  return () => {
    badgeListeners.delete(listener);
  };
}

/** The built-in views' badges by view name, kept current while the providers are mounted. */
export function useBuiltInViewBadges(): ReadonlyMap<string, BuiltInViewBadge> {
  return useSyncExternalStore(
    subscribeBadges,
    () => badges,
    () => badges,
  );
}

function BadgeProvider({ name, hook }: { name: string; hook: BuiltInViewBadgeHook }) {
  const badge = hook();
  useEffect(() => publishBadge(name, badge), [name, badge]);
  useEffect(() => () => publishBadge(name, undefined), [name]);
  return null;
}

/** Runs each registered badge hook once, publishing what it reads; mount it with the bar. */
export function BuiltInViewBadgeProviders() {
  return [...badgeHooks].map(([name, hook]) =>
    createElement(BadgeProvider, { key: name, name, hook }),
  );
}
