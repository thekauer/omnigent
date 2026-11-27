// App-global preference for whether a brand-new chat's right Workspace rail (Files / Agents /
// Shells) starts open or collapsed: the settings JSON's
// `workbench.secondarySideBar.defaultVisibility`, set from Appearance settings, and the state
// the rail was last left in (layout state), so a collapse carries into the next chat instead of
// springing back open.
//
// This only seeds sessions that have no saved per-chat `open` state. Once a
// user toggles the rail in a session, that session's own
// `SessionWorkspaceState.open` wins on restore.

import { configurationService } from "@/configuration/configurationService";
import { LAYOUT_SLOTS, layoutState } from "@/workbench/layoutState";
import {
  readSecondarySideBarDefaultVisibility,
  SECONDARY_SIDE_BAR_DEFAULT_VISIBILITY_SETTING,
} from "@/workbench/sideBars";

/** Where the default was kept before the settings JSON and the layout state. */
const STORAGE_KEY = "omnigent:default-workspace-panel";

export const workspacePanelDefaults = ["open", "collapsed"] as const;
export type WorkspacePanelDefault = (typeof workspacePanelDefaults)[number];

/** Keep new chats visually stable while their runner and workspace hydrate. */
export const WORKSPACE_PANEL_DEFAULT: WorkspacePanelDefault = "collapsed";

/** Return whether a string is one of the selectable Workspace panel defaults. */
export function isWorkspacePanelDefault(
  value: string | null | undefined,
): value is WorkspacePanelDefault {
  return value === "open" || value === "collapsed";
}

/**
 * Normalize a stored Workspace panel default to the product default.
 *
 * Unknown values can only come from localStorage drift or manual edits.
 * Falling back to the product default keeps unknown values deterministic.
 */
export function normalizeWorkspacePanelDefault(
  value: string | null | undefined,
): WorkspacePanelDefault {
  return isWorkspacePanelDefault(value) ? value : WORKSPACE_PANEL_DEFAULT;
}

/**
 * The old key held what Appearance chose and what the toggle last wrote: an "open" carries into
 * the settings JSON's intent (`visibleInWorkspace`) unless the user set one, then the key goes.
 * Run once, at load.
 */
export function migrateLegacyDefault(): void {
  if (typeof window === "undefined") return;
  try {
    const legacy = window.localStorage.getItem(STORAGE_KEY);
    if (legacy === null) return;
    window.localStorage.removeItem(STORAGE_KEY);
    if (
      legacy === "open" &&
      configurationService.inspect(SECONDARY_SIDE_BAR_DEFAULT_VISIBILITY_SETTING).userValue ===
        undefined
    ) {
      configurationService.update(
        SECONDARY_SIDE_BAR_DEFAULT_VISIBILITY_SETTING,
        "visibleInWorkspace",
      );
    }
  } catch {
    // Storage or the settings JSON refused: the product default stands.
  }
}

migrateLegacyDefault();

// The intent changing (Appearance, the settings JSON, a product) replaces the last toggle's state.
configurationService.onDidChangeConfiguration((event) => {
  if (event.affectsConfiguration(SECONDARY_SIDE_BAR_DEFAULT_VISIBILITY_SETTING)) {
    layoutState.set(LAYOUT_SLOTS.auxiliaryBarLastVisibility, undefined);
  }
});

/** How the rail was last left (layout state), when that differs from the intent. */
function lastLeftState(): WorkspacePanelDefault | null {
  const stored = layoutState.get(LAYOUT_SLOTS.auxiliaryBarLastVisibility);
  return typeof stored === "string" && isWorkspacePanelDefault(stored) ? stored : null;
}

/** The settings JSON's intent; `visible` and `visibleInWorkspace` both open it (it shows in a session only). */
function intendedDefault(): WorkspacePanelDefault {
  return readSecondarySideBarDefaultVisibility() === "hidden" ? "collapsed" : "open";
}

/**
 * Read the default for new-chat Workspace rail visibility: how the rail was last left, else
 * the settings JSON's `workbench.secondarySideBar.defaultVisibility` (`hidden` by default).
 * Never throws, so a corrupt entry can't break app boot.
 */
export function readWorkspacePanelDefault(): WorkspacePanelDefault {
  if (typeof window === "undefined") return WORKSPACE_PANEL_DEFAULT;
  return (
    lastLeftState() ?? (readSecondarySideBarDefaultVisibility() === "hidden" ? "collapsed" : "open")
  );
}

/**
 * Persist the default Workspace panel visibility for new chats (Appearance settings): the
 * settings JSON's intent, and the last-left state goes. Swallows a refused write (a settings
 * JSON that doesn't parse, a product lock) so settings don't break.
 */
export function writeWorkspacePanelDefault(value: WorkspacePanelDefault): void {
  if (typeof window === "undefined") return;
  const choice = normalizeWorkspacePanelDefault(value);
  try {
    // The default the user's value leaves (a product's or an extension's may be "visible").
    configurationService.update(SECONDARY_SIDE_BAR_DEFAULT_VISIBILITY_SETTING, undefined);
    if (intendedDefault() !== choice) {
      configurationService.update(
        SECONDARY_SIDE_BAR_DEFAULT_VISIBILITY_SETTING,
        choice === "open" ? "visibleInWorkspace" : "hidden",
      );
    }
    layoutState.set(LAYOUT_SLOTS.auxiliaryBarLastVisibility, undefined);
  } catch {
    // The settings JSON refused it: the choice carries as the last state.
    layoutState.set(LAYOUT_SLOTS.auxiliaryBarLastVisibility, choice);
  }
}

/**
 * Boolean form of {@link readWorkspacePanelDefault} for AppShell's
 * `rightPanelOpen` fallback when a session has no saved `open` state.
 */
export function readDefaultWorkspacePanelOpen(): boolean {
  return readWorkspacePanelDefault() === "open";
}

/**
 * Record the rail's visibility as the state the next chat starts from: what the user dragged
 * and toggled is layout state, not the settings JSON (decision 4).
 */
export function writeDefaultWorkspacePanelOpen(open: boolean): void {
  const intent = intendedDefault();
  const value: WorkspacePanelDefault = open ? "open" : "collapsed";
  layoutState.set(LAYOUT_SLOTS.auxiliaryBarLastVisibility, value === intent ? undefined : value);
}
