// The settings JSON editor's side of the theme and configuration services (theming plan
// M10b, layout plan L1): the document's schema (the registered configuration's settings with
// the theme service's keys over them), its diagnostics (the language service's and the theme
// service's token checks) and saving with them. Loaded with the settings dialog, so boot
// carries neither the schema nor the language service.

import {
  type ConfigurationService,
  configurationService,
} from "@/configuration/configurationService";
import { parseSettingsText, SET_BY_PRODUCT } from "@/configuration/settingsDocument";
import {
  type SettingsDiagnostic,
  settingsDiagnostics,
  spanOfPath,
} from "@/configuration/settingsLanguage";
import type { SettingsSchemaNode } from "@/configuration/settingsSchema";
import { COLOR_CUSTOMIZATIONS_SETTING } from "./themeSettingKeys";
import { buildSettingsSchema } from "./themeSettingsSchema";
import { themeService, type ThemeService } from "./themeService";

// The schema of each service pair, by the versions it was built at.
const schemas = new WeakMap<
  ThemeService,
  WeakMap<ConfigurationService, { version: string; schema: SettingsSchemaNode }>
>();

/**
 * The settings document's root schema: the registered settings of `configuration`, with
 * `themes`' keys (`omnigent.themeOptions`, `omnigent.style.*`, `workbench.colorCustomizations`)
 * over them, as the theme service builds those from its themes and the product's locks.
 */
export function unionSettingsSchema(
  themeSchema: SettingsSchemaNode,
  configurationSchema: SettingsSchemaNode,
): SettingsSchemaNode {
  return {
    type: "object",
    properties: { ...configurationSchema.properties, ...themeSchema.properties },
    additionalProperties: false,
  };
}

/**
 * The settings document's schema: every registered setting, every registered theme's
 * options, the style variants and the tokens, with the product's locks (`locked`) and
 * `hideCustomizations` (`hidden`).
 */
export function getSettingsSchema(
  service: ThemeService = themeService,
  configuration: ConfigurationService = configurationService,
): SettingsSchemaNode {
  const version = `${service.getVersion()}:${configuration.getVersion()}`;
  let byConfiguration = schemas.get(service);
  if (!byConfiguration) {
    byConfiguration = new WeakMap();
    schemas.set(service, byConfiguration);
  }
  const cached = byConfiguration.get(configuration);
  if (cached?.version === version) return cached.schema;
  const schema = unionSettingsSchema(
    buildSettingsSchema(service.getSettingsSchemaInput()),
    configuration.getSchema(),
  );
  byConfiguration.set(configuration, { version, schema });
  return schema;
}

/** A customization problem's key (`[acme.x/dark].primary`, `background`) as a path. */
function customizationPath(key: string): string[] {
  if (!key) return [];
  const scoped = /^(\[[^\]]*\])(?:\.(.*))?$/.exec(key);
  if (scoped) return scoped[2] === undefined ? [scoped[1]!] : [scoped[1]!, scoped[2]];
  return [key];
}

/**
 * Checks a settings text as the editor shows it: syntax, the schema's keys and values,
 * the colour customizations' token values and the product's locks.
 */
export function checkSettings(
  text: string,
  service: ThemeService = themeService,
  configuration: ConfigurationService = configurationService,
): SettingsDiagnostic[] {
  const diagnostics = settingsDiagnostics(text, getSettingsSchema(service, configuration));
  const parsed = parseSettingsText(text);
  if (!parsed.ok || service.getProductPolicy()?.hideCustomizations) return diagnostics;
  const customizations = parsed.values[COLOR_CUSTOMIZATIONS_SETTING];
  if (customizations === undefined) return diagnostics;
  for (const problem of service.checkCustomizationsValue(customizations)) {
    const path = [COLOR_CUSTOMIZATIONS_SETTING, ...customizationPath(problem.key)];
    const locked =
      problem.severity === "warning" && problem.message.startsWith("set by the product");
    diagnostics.push({
      ...spanOfPath(text, path),
      severity: locked ? "info" : problem.severity === "warning" ? "warning" : "error",
      message: locked
        ? `${SET_BY_PRODUCT}: this value doesn't apply.`
        : problem.message.replace(/^./, (first) => first.toUpperCase()),
      ...(locked ? { unnecessary: true } : {}),
      path,
    });
  }
  return diagnostics;
}

/**
 * Stores the settings text as the editor saves it ({@link ThemeService.saveSettingsText}).
 * Returns the problems the editor shows; nothing is stored over the size cap.
 */
export function saveSettings(
  text: string,
  service: ThemeService = themeService,
  configuration: ConfigurationService = configurationService,
): { saved: boolean; diagnostics: SettingsDiagnostic[] } {
  const diagnostics = checkSettings(text, service, configuration);
  return { saved: service.saveSettingsText(text), diagnostics };
}
