// The views and navigation entries that start hidden (layout plan L11, decision 11): the
// `workbench.view.defaultHidden` setting, a list of view ids, navigation entry command ids or
// `*` patterns, which `configurationDefaults` sets. The user's own choice in the layout state
// wins over it, a product's `hiddenViews` removes regardless, and View: Reset Layout returns to
// it. Plain data, plus the React read.

import { useMemo } from "react";
import {
  type ConfigurationService,
  configurationService,
} from "@/configuration/configurationService";
import { useConfigurationValue } from "@/configuration/useConfiguration";

export const DEFAULT_HIDDEN_VIEWS_SETTING = "workbench.view.defaultHidden";

export const NO_DEFAULT_HIDDEN: readonly string[] = Object.freeze([]);

/** The patterns the setting's value lists: its strings, once each (anything else is left out). */
export function defaultHiddenViewsOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return NO_DEFAULT_HIDDEN;
  const patterns = [
    ...new Set(value.filter((item): item is string => typeof item === "string" && item !== "")),
  ];
  return patterns.length === 0 ? NO_DEFAULT_HIDDEN : Object.freeze(patterns);
}

/** The patterns that start hidden now (none when nothing sets the setting). */
export function readDefaultHiddenViews(
  service: ConfigurationService = configurationService,
): readonly string[] {
  return defaultHiddenViewsOf(service.getValue(DEFAULT_HIDDEN_VIEWS_SETTING));
}

/** {@link readDefaultHiddenViews}, kept current: a change re-renders the reader. */
export function useDefaultHiddenViews(
  service: ConfigurationService = configurationService,
): readonly string[] {
  const value = useConfigurationValue(DEFAULT_HIDDEN_VIEWS_SETTING, service);
  return useMemo(() => defaultHiddenViewsOf(value), [value]);
}
