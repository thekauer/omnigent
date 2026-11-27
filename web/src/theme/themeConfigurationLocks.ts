// The product theme's locks, as the configuration service's (layout plan L1, fixed after its
// validation): what `lockedVariants`, `lockedOptions`, `lockedTokens` and `hideCustomizations`
// keep from the user is locked for `getConfiguration`, `inspect`, the `config.*` keys and
// writes too, not only for the theme service that applies it.

import type {
  ConfigurationPolicy,
  ConfigurationService,
} from "@/configuration/configurationService";
import { SET_BY_PRODUCT } from "@/configuration/settingsDocument";
import {
  COLOR_CUSTOMIZATIONS_SETTING,
  STYLE_SETTING_PREFIX,
  THEME_OPTIONS_SETTING,
} from "./themeSettingKeys";
import type { ThemeService } from "./themeService";
import { defaultVariant, VARIANT_NAMES } from "./variants";

/** The theme configuration source of {@link ConfigurationService.setPolicy}. */
export const THEME_POLICY_SOURCE = "theme";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The entries of an object setting: its own keys and those of each `[scope]` inside it. */
function scopedEntries(value: unknown): [string, unknown][] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    key.startsWith("[") && isRecord(entry) ? Object.entries(entry) : [[key, entry]],
  );
}

/** The product theme's locks for the configuration service, or null when it locks nothing. */
export function themeConfigurationPolicy(service: ThemeService): ConfigurationPolicy | null {
  const policy = service.getProductPolicy();
  if (!policy) return null;
  const locked: Record<string, unknown> = {};
  const lockedVariants = service.getLockedVariants() as Record<string, string>;
  // Under `hideCustomizations` the user's variants, options and colours don't apply.
  const applied = service.getVariants() as Record<string, string>;
  for (const name of VARIANT_NAMES) {
    if (Object.hasOwn(lockedVariants, name)) {
      locked[`${STYLE_SETTING_PREFIX}${name}`] = lockedVariants[name];
    } else if (policy.hideCustomizations) {
      locked[`${STYLE_SETTING_PREFIX}${name}`] = applied[name] ?? defaultVariant(name);
    }
  }
  if (policy.hideCustomizations) {
    locked[THEME_OPTIONS_SETTING] = {};
    locked[COLOR_CUSTOMIZATIONS_SETTING] = {};
  }
  const lockedOptions = policy.lockedOptions ?? {};
  const lockedTokens = new Set(Object.keys(policy.lockedTokens ?? {}));
  const writeProblem = (key: string, value: unknown): string | undefined => {
    if (key === THEME_OPTIONS_SETTING && isRecord(value)) {
      for (const [, options] of Object.entries(value)) {
        for (const [option, choice] of Object.entries(isRecord(options) ? options : {})) {
          if (Object.hasOwn(lockedOptions, option) && choice !== lockedOptions[option]) {
            return `option ${option}: ${SET_BY_PRODUCT}`;
          }
        }
      }
    }
    if (key === COLOR_CUSTOMIZATIONS_SETTING && lockedTokens.size > 0) {
      for (const [token] of scopedEntries(value)) {
        if (lockedTokens.has(token)) return `${token}: ${SET_BY_PRODUCT}`;
      }
    }
    return undefined;
  };
  const empty =
    Object.keys(locked).length === 0 &&
    Object.keys(lockedOptions).length === 0 &&
    lockedTokens.size === 0;
  return empty ? null : { locked, writeProblem };
}

/** Keeps `configuration`'s theme policy in step with `service`'s product locks. */
export function followThemeLocks(
  service: ThemeService,
  configuration: ConfigurationService,
): () => void {
  let published = "";
  const publish = () => {
    const policy = themeConfigurationPolicy(service);
    const product = service.getProductPolicy();
    const key = JSON.stringify([
      policy?.locked ?? null,
      product?.lockedOptions ?? null,
      Object.keys(product?.lockedTokens ?? {}),
    ]);
    if (key === published) return;
    published = key;
    configuration.setPolicy(THEME_POLICY_SOURCE, policy);
  };
  publish();
  return service.onDidChange(publish);
}
