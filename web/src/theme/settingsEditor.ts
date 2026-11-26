// The settings JSON editor's side of the theme service (theming plan M10b): the document's
// schema, its diagnostics (the language service's and the theme service's token checks) and
// saving with them. Loaded with the settings dialog, so boot carries neither the schema nor
// the language service.

import {
  COLOR_CUSTOMIZATIONS_SETTING,
  parseSettingsText,
  SET_BY_PRODUCT,
} from "./settingsDocument";
import { type SettingsDiagnostic, settingsDiagnostics, spanOfPath } from "./settingsLanguage";
import { buildSettingsSchema, type SettingsSchemaNode } from "./settingsSchema";
import { themeService, type ThemeService } from "./themeService";

// The schema of each service, by the version it was built at.
const schemas = new WeakMap<ThemeService, { version: number; schema: SettingsSchemaNode }>();

/**
 * The settings document's schema: every registered theme's options, the style variants
 * and the tokens, with the product's locks (`locked`) and `hideCustomizations` (`hidden`).
 */
export function getSettingsSchema(service: ThemeService = themeService): SettingsSchemaNode {
  const version = service.getVersion();
  const cached = schemas.get(service);
  if (cached?.version === version) return cached.schema;
  const schema = buildSettingsSchema(service.getSettingsSchemaInput());
  schemas.set(service, { version, schema });
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
): SettingsDiagnostic[] {
  const diagnostics = settingsDiagnostics(text, getSettingsSchema(service));
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
): { saved: boolean; diagnostics: SettingsDiagnostic[] } {
  const diagnostics = checkSettings(text, service);
  return { saved: service.saveSettingsText(text), diagnostics };
}
