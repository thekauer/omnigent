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

/**
 * The Monaco theme for the app's mode: the syntax theme the tokens name, once it is
 * registered with Monaco (until then, the last registered pair's).
 */
export function useMonacoTheme(resolved: ResolvedThemeMode): string {
  const names = useSyntaxThemeNames();
  const key = syntaxThemeKey(names);
  const [registered, setRegistered] = useState<{ key: string; names: SyntaxThemeNames }>(() => ({
    key: syntaxThemeKey(SYNTAX_THEME_NAMES),
    names: SYNTAX_THEME_NAMES,
  }));
  useEffect(() => {
    if (key === registered.key) return;
    let cancelled = false;
    void ensureMonacoThemes(names).then(
      () => {
        if (!cancelled) setRegistered({ key, names });
      },
      (error: unknown) => {
        console.warn("[monaco] syntax theme not registered", error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, names, registered.key]);
  return resolvedThemeToMonaco(resolved, registered.names);
}
