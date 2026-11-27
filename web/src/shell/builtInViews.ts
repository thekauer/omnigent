// The host components built-in views draw as their body (`builtInView`, layout plan L3): the
// trusted tier's first seam, open to built-in extensions only. The side bar registers its own
// (the navigation, the conversation list); the trusted stage opens the same registry to products.

import { type ComponentType, memo } from "react";
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
