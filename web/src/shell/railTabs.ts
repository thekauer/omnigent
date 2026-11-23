/**
 * Shared geometry + types for the right "Workspace" rail tabs. Its own module
 * so `WorkspacePanel` and the mobile FAB (`ChatHeader`) share one source of
 * truth without importing back through `AppShell` (a cycle).
 */

/** The built-in tabs in the right workspace rail, in display order.
 *  "browser" and "sidechat" are dynamic-tab modes (a browser tab / a side-chat
 *  tab is selected), not fixed nav tabs.
 *  "github" is a stable stored id for the Pull Requests tab; renaming it drops saved choices. */
export const BUILT_IN_RAIL_TABS = [
  "files",
  "changes",
  "github",
  "tasks",
  "subagents",
  "browser",
  "sidechat",
  "content-search",
] as const;

export type BuiltInRailTab = (typeof BUILT_IN_RAIL_TABS)[number];

/** A tab contributed by an extension view, stored as `ext:<view id>`. */
export type ExtensionRailTab = `ext:${string}`;

/** Every selectable rail tab: the built-ins plus extension views. */
export type RightRailTab = BuiltInRailTab | ExtensionRailTab;

const EXTENSION_RAIL_TAB_PREFIX = "ext:";
/** Extension view ids: `publisher.name.view`, letters, digits, `.`, `_` and `-`. */
const VIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isExtensionViewId(value: unknown): value is string {
  return typeof value === "string" && VIEW_ID_PATTERN.test(value);
}

/** The rail tab of an extension view. */
export function extensionRailTab(viewId: string): ExtensionRailTab {
  return `${EXTENSION_RAIL_TAB_PREFIX}${viewId}`;
}

export function isExtensionRailTab(value: unknown): value is ExtensionRailTab {
  return (
    typeof value === "string" &&
    value.startsWith(EXTENSION_RAIL_TAB_PREFIX) &&
    isExtensionViewId(value.slice(EXTENSION_RAIL_TAB_PREFIX.length))
  );
}

/** The view id of an extension tab, or null for a built-in one. */
export function extensionRailTabViewId(tab: RightRailTab | null): string | null {
  return isExtensionRailTab(tab) ? tab.slice(EXTENSION_RAIL_TAB_PREFIX.length) : null;
}

export function isBuiltInRailTab(value: unknown): value is BuiltInRailTab {
  return typeof value === "string" && (BUILT_IN_RAIL_TABS as readonly string[]).includes(value);
}

/** Whether a stored value names a rail tab; unknown ids are dropped on restore. */
export function isRailTab(value: unknown): value is RightRailTab {
  return isBuiltInRailTab(value) || isExtensionRailTab(value);
}

/**
 * Count/status badge geometry. Fixed height with min-width == height keeps a
 * single digit a circle while "1/2" / double digits grow into a pill.
 */
export const TAB_BADGE_BASE =
  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] leading-none tabular-nums";
