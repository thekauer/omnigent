// The built-in colour themes (the omnigent.themes extension) as theme contributions: each palette of lib/themePalette.ts
// is a light and dark family, and Custom one more. Their theme files carry the palette's
// colours and swatches, and `omnigent.palette`, which tells the theme service to apply the
// palette's precompiled CSS (`data-theme`) instead of a runtime stylesheet, so a built-in
// theme paints before any extension loads.
import { PALETTE_TOKEN_CSS_NAMES, PALETTES, type ThemeSelection } from "@/lib/themePalette";
import themesManifest from "@/builtinExtensions/omnigent.themes/package.json";
import { parseThemeContributions } from "@/theme/themeContributions";
import type { ThemeService } from "@/theme/themeService";
import { getToken } from "@/theme/tokens/registry";
import type { ExtensionFile } from "@/vscodeExtensions/host";

export const BUILT_IN_THEMES_EXTENSION_ID = "omnigent.themes";

const MODES = ["light", "dark"] as const;
const CUSTOM_LABEL = "Custom";
const CUSTOM_DESCRIPTION = "Your own accent, tint and contrast, edited below.";

function themePath(selection: ThemeSelection, mode: (typeof MODES)[number]): string {
  return `themes/${selection}-${mode}.json`;
}

/** The contributed theme id of a built-in selection in a mode. */
export function builtInThemeId(selection: ThemeSelection, mode: "light" | "dark"): string {
  return `${BUILT_IN_THEMES_EXTENSION_ID}/${selection}-${mode}`;
}

/** `contributes.themes`: every palette, then Custom, each a light and dark family. */
export function builtInThemeContributions(): Record<string, unknown>[] {
  const entries: { id: ThemeSelection; label: string; description: string }[] = [
    ...PALETTES.map((palette) => ({
      id: palette.id,
      label: palette.label,
      description: palette.blurb,
    })),
    { id: "custom", label: CUSTOM_LABEL, description: CUSTOM_DESCRIPTION },
  ];
  return entries.flatMap(({ id, label, description }) =>
    MODES.map((mode) => ({
      id: `${id}-${mode}`,
      label,
      description,
      uiTheme: mode,
      path: `./${themePath(id, mode)}`,
      family: id,
    })),
  );
}

/** The theme files, by normalized path: the palette's colours, its swatch and its id. */
export function builtInThemeFiles(): Record<string, ExtensionFile> {
  const files: Record<string, ExtensionFile> = {};
  for (const palette of PALETTES) {
    for (const mode of MODES) {
      const tokens = palette.tokens[mode];
      const colors: Record<string, string> = {};
      for (const [key, value] of Object.entries(tokens)) {
        colors[(PALETTE_TOKEN_CSS_NAMES as Readonly<Record<string, string>>)[key]!] = value;
      }
      files[themePath(palette.id, mode)] = {
        kind: "json",
        data: {
          name: palette.label,
          type: mode,
          colors,
          omnigent: { palette: palette.id, swatch: { ...palette[mode] } },
        },
      };
    }
  }
  for (const mode of MODES) {
    // Custom's colours are the user's (`--custom-*`, lib/customTheme.ts).
    files[themePath("custom", mode)] = {
      kind: "json",
      data: { name: CUSTOM_LABEL, type: mode, omnigent: { palette: "custom" } },
    };
  }
  return files;
}

/**
 * Registers the built-in themes with `service` directly, as the extension host does at
 * startup (for tests that render the picker or Settings without the host).
 */
export function registerBuiltInThemes(service: ThemeService): () => void {
  const { contributions } = parseThemeContributions(
    BUILT_IN_THEMES_EXTENSION_ID,
    { themes: builtInThemeContributions() },
    { isKnownToken: (id) => getToken(id) !== undefined },
  );
  return service.addExtension({
    id: BUILT_IN_THEMES_EXTENSION_ID,
    version: themesManifest.version,
    label: themesManifest.displayName,
    builtIn: true,
    contributions,
    files: builtInThemeFiles(),
  });
}
