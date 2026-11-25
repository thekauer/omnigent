// The Monaco theme the editors apply, following the syntax theme tokens. Apart from
// monacoSetup so a test that mocks that module keeps its own theme stub.

import { useEffect, useState } from "react";
import type { ResolvedThemeMode } from "@/components/theme/themeMode";
import {
  SYNTAX_THEME_NAMES,
  syntaxThemeKey,
  type SyntaxThemeNames,
  useSyntaxThemeNames,
} from "@/lib/syntaxTheme";
import { ensureMonacoThemes, resolvedThemeToMonaco } from "./monacoSetup";

interface LoadedPair {
  /** The syntax theme key the pair was loaded for. */
  key: string;
  /** Its Monaco theme names, as loaded. */
  monacoNames: SyntaxThemeNames;
}

/**
 * The Monaco theme for the app's mode: the syntax theme the tokens name, once Monaco
 * has it. Until then the previous pair's, which Monaco already has, so the editor
 * never gets a theme name that isn't loaded (a re-registered theme takes a new name).
 * A name that fails to load (an unregistered theme) falls back to the default pair.
 */
export function useMonacoTheme(resolved: ResolvedThemeMode): string {
  const names = useSyntaxThemeNames();
  const key = syntaxThemeKey(names);
  const [loaded, setLoaded] = useState<LoadedPair>(() => ({
    key: syntaxThemeKey(SYNTAX_THEME_NAMES),
    monacoNames: SYNTAX_THEME_NAMES,
  }));
  useEffect(() => {
    if (key === loaded.key) return;
    let cancelled = false;
    void (async () => {
      let monacoNames: SyntaxThemeNames;
      try {
        monacoNames = await ensureMonacoThemes(names);
      } catch (error: unknown) {
        console.warn("[monaco] syntax theme not loaded, using the default pair", error);
        monacoNames = await ensureMonacoThemes(SYNTAX_THEME_NAMES);
      }
      if (!cancelled) setLoaded({ key, monacoNames });
    })().catch((error: unknown) => {
      console.warn("[monaco] syntax theme not registered", error);
    });
    return () => {
      cancelled = true;
    };
  }, [key, names, loaded.key]);
  return resolvedThemeToMonaco(resolved, loaded.monacoNames);
}
