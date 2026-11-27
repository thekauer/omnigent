// The side bars' settings (layout plan L5): which side the primary side bar sits on
// (`workbench.sideBar.location`, the secondary side bar takes the other), whether a new
// session opens the secondary side bar (`workbench.secondarySideBar.defaultVisibility`) and
// the window width below which it hides (`omnigent.secondarySideBar.autoHideBelow`).

import { useSyncExternalStore } from "react";
import {
  type ConfigurationService,
  configurationService,
} from "@/configuration/configurationService";
import { useConfigurationValue } from "@/configuration/useConfiguration";

export const SIDE_BAR_LOCATION_SETTING = "workbench.sideBar.location";
export const SECONDARY_SIDE_BAR_DEFAULT_VISIBILITY_SETTING =
  "workbench.secondarySideBar.defaultVisibility";
export const SECONDARY_SIDE_BAR_AUTO_HIDE_SETTING = "omnigent.secondarySideBar.autoHideBelow";

export type SideBarSide = "left" | "right";

export function sideBarLocationOf(value: unknown): SideBarSide {
  return value === "right" ? "right" : "left";
}

/** The primary side bar's side; the secondary side bar is on the other. */
export function useSideBarLocation(
  service: ConfigurationService = configurationService,
): SideBarSide {
  return sideBarLocationOf(useConfigurationValue(SIDE_BAR_LOCATION_SETTING, service));
}

export function otherSide(side: SideBarSide): SideBarSide {
  return side === "left" ? "right" : "left";
}

/** The width below which the secondary side bar hides; 0 for never. */
export function useSecondarySideBarAutoHideBelow(
  service: ConfigurationService = configurationService,
): number {
  const value = useConfigurationValue<number>(SECONDARY_SIDE_BAR_AUTO_HIDE_SETTING, service);
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export type SecondarySideBarVisibility = "hidden" | "visible" | "visibleInWorkspace";

/** The setting's value, `hidden` (today's default) when nothing sets it. */
export function readSecondarySideBarDefaultVisibility(
  service: ConfigurationService = configurationService,
): SecondarySideBarVisibility {
  const value = service.getValue(SECONDARY_SIDE_BAR_DEFAULT_VISIBILITY_SETTING);
  return value === "visible" || value === "visibleInWorkspace" ? value : "hidden";
}

function subscribeWindowWidth(listener: () => void): () => void {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

/**
 * Whether the window is narrower than `below` px (never for 0): the secondary side bar's
 * `autoHideBelow`.
 */
export function useNarrowerThan(below: number): boolean {
  return useSyncExternalStore(
    subscribeWindowWidth,
    () => below > 0 && window.innerWidth < below,
    () => false,
  );
}
