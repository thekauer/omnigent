// ⌘K quick picks for the theme settings (theming plan M10b), as VS Code's
// "Preferences: Color Theme": "Color Theme: Select Option…" (the chosen theme's options, each
// a page of its choices), "Preferences: Select Style Variant…" (each variant, a page of
// "Theme default" and its values) and "Preferences: Open Settings (JSON)". They write the
// settings document through the theme service, as its editor does; a product's locks grey
// their rows out ("Set by product"), and `hideCustomizations` withdraws them.

import { useMemo, useSyncExternalStore } from "react";
import { BracesIcon, PaintbrushIcon, SlidersHorizontalIcon } from "lucide-react";

import {
  AVAILABLE,
  type CommandAvailability,
  HIDDEN,
  type PaletteCommand,
  type PaletteCommandOption,
  unavailableBecause,
} from "@/store/paletteCommands";
import type { PaletteSetting } from "@/store/paletteSettings";
import { openSettingsJsonEditor } from "@/store/settingsJsonEditor";
import { SET_BY_PRODUCT } from "@/theme/settingsDocument";
import { type ActiveTheme, themeService, type ThemeService } from "@/theme/themeService";
import { defaultVariant, VARIANT_LABELS, VARIANT_NAMES, VARIANTS } from "@/theme/variants";

export const OPEN_SETTINGS_JSON_COMMAND_ID = "open-settings-json";
export const SELECT_THEME_OPTION_COMMAND_ID = "select-color-theme-option";
export const SELECT_STYLE_VARIANT_COMMAND_ID = "select-style-variant";

/** The value a variant's "Theme default" choice stands for. */
export const THEME_DEFAULT_CHOICE = "theme-default";
export const THEME_DEFAULT_LABEL = "Theme default";

/** Why a choice can't be written now, or available. */
function writable(service: ThemeService): CommandAvailability {
  const blocked = service.settingsWriteBlocked();
  return blocked ? unavailableBecause(blocked) : AVAILABLE;
}

/** The chosen theme's options, each a setting of its choices. */
export function themeOptionOptions(
  service: ThemeService,
  active: ActiveTheme | null,
): PaletteCommandOption[] {
  const options = active?.available ? active.options : [];
  const availability = writable(service);
  return options.map((option) => {
    const current = option.choices.find((choice) => choice.id === option.value)?.label;
    const setting: PaletteSetting = {
      id: `theme-option:${active!.id}:${option.id}`,
      owner: "app",
      label: option.label,
      icon: PaintbrushIcon,
      keywords: ["theme option", option.id],
      current: option.value,
      choices: option.choices.map((choice) => ({ value: choice.id, label: choice.label })),
      availability: option.locked ? unavailableBecause(SET_BY_PRODUCT) : availability,
      choose: (value) => service.setOption(option.id, value),
    };
    return {
      id: option.id,
      label: option.label,
      description: option.locked ? `${current ?? option.value} · ${SET_BY_PRODUCT}` : current,
      keywords: [option.id, ...option.choices.map((choice) => choice.label)],
      availability: setting.availability,
      setting,
      run: () => undefined,
    };
  });
}

/** Every style variant, each a setting of "Theme default" and its values. */
export function styleVariantOptions(service: ThemeService): PaletteCommandOption[] {
  const user = service.getUserVariants() as Record<string, string>;
  const theme = service.getThemeVariants() as Record<string, string>;
  const locked = service.getLockedVariants() as Record<string, string>;
  const availability = writable(service);
  return VARIANT_NAMES.map((name) => {
    const labels = VARIANT_LABELS[name];
    const valueLabels = labels.values as Record<string, string>;
    const themeValue = theme[name] ?? defaultVariant(name);
    const lock = locked[name];
    const current = lock ?? user[name] ?? THEME_DEFAULT_CHOICE;
    const setting: PaletteSetting = {
      id: `style-variant:${name}`,
      owner: "app",
      label: labels.label,
      icon: SlidersHorizontalIcon,
      keywords: ["style", "variant", name],
      current,
      choices: [
        {
          value: THEME_DEFAULT_CHOICE,
          label: THEME_DEFAULT_LABEL,
          description: valueLabels[themeValue],
        },
        ...(VARIANTS[name] as readonly string[]).map((value) => ({
          value,
          label: valueLabels[value] ?? value,
        })),
      ],
      availability: lock !== undefined ? unavailableBecause(SET_BY_PRODUCT) : availability,
      choose: (value) => service.setVariant(name, value === THEME_DEFAULT_CHOICE ? null : value),
    };
    const shown =
      lock !== undefined
        ? `${valueLabels[lock]} · ${SET_BY_PRODUCT}`
        : user[name] !== undefined
          ? valueLabels[user[name]]
          : `${THEME_DEFAULT_LABEL} (${valueLabels[themeValue]})`;
    return {
      id: name,
      label: labels.label,
      description: shown,
      keywords: [name, labels.description, ...Object.values(valueLabels)],
      availability: setting.availability,
      setting,
      run: () => undefined,
    };
  });
}

/** The three commands for `service` as it is now. */
export function themeSettingsCommands(service: ThemeService): PaletteCommand[] {
  if (service.getProductPolicy()?.hideCustomizations) return [];
  const active = service.getActive();
  const hasOptions = Boolean(active?.available && active.options.length > 0);
  return [
    {
      id: OPEN_SETTINGS_JSON_COMMAND_ID,
      label: "Preferences: Open Settings (JSON)",
      icon: BracesIcon,
      keywords: [
        "settings.json",
        "json",
        "theme options",
        "style",
        "variants",
        "color customizations",
      ],
      // The dialog takes focus once the palette has closed.
      movesFocus: true,
      run: openSettingsJsonEditor,
    },
    {
      id: SELECT_THEME_OPTION_COMMAND_ID,
      label: "Color Theme: Select Option…",
      icon: PaintbrushIcon,
      keywords: [
        "theme option",
        "accent",
        "corners",
        ...(active?.options.map((o) => o.label) ?? []),
      ],
      availability: hasOptions ? AVAILABLE : HIDDEN,
      options: () => themeOptionOptions(service, service.getActive()),
      optionsEmptyMessage: "The color theme has no options.",
      run: () => undefined,
    },
    {
      id: SELECT_STYLE_VARIANT_COMMAND_ID,
      label: "Preferences: Select Style Variant…",
      icon: SlidersHorizontalIcon,
      keywords: [
        "style",
        "variant",
        ...VARIANT_NAMES.map((name) => VARIANT_LABELS[name].label.toLowerCase()),
      ],
      options: () => styleVariantOptions(service),
      run: () => undefined,
    },
  ];
}

/** The commands, current as the theme service changes. */
export function useThemeSettingsCommands(): PaletteCommand[] {
  const version = useSyncExternalStore(
    (listener) => themeService.onDidChange(listener),
    () => themeService.getVersion(),
    () => 0,
  );
  return useMemo(() => (version >= 0 ? themeSettingsCommands(themeService) : []), [version]);
}
