// Reading theme tokens from script, for the surfaces that take colours as values rather
// than CSS: xterm's theme, the syntax theme names. Values come from the innermost theme
// root (`getThemeRoots()`), where the palette, the theme and the derived tokens resolve.

import { getThemeRoots } from "@/lib/host";
import { TOKEN_MODE_PROBE_ATTRIBUTE } from "./tokenModeProbe";

export { TOKEN_MODE_PROBE_ATTRIBUTE };

export type TokenMode = "light" | "dark";

function innermostThemeRoot(): HTMLElement | null {
  const roots = getThemeRoots();
  return roots[roots.length - 1] ?? null;
}

/**
 * The computed values of `ids` (token ids, without `--`), `""` for an unset token.
 *
 * `mode` reads them as that mode would: on the theme root when it is in that mode,
 * else on a probe element inside it, which the generated stylesheet gives the per-mode
 * defaults of the tokens marked `perMode` (a surface with its own light or dark
 * setting, such as the terminal).
 */
export function readThemeTokens<Id extends string>(
  ids: readonly Id[],
  mode?: TokenMode,
): Record<Id, string> {
  const values = Object.fromEntries(ids.map((id) => [id, ""])) as Record<Id, string>;
  const root = innermostThemeRoot();
  if (!root || typeof getComputedStyle !== "function") return values;
  const rootMode: TokenMode = root.classList.contains("dark") ? "dark" : "light";
  let target: HTMLElement = root;
  let probe: HTMLElement | null = null;
  if (mode && mode !== rootMode) {
    probe = root.ownerDocument.createElement("div");
    probe.setAttribute(TOKEN_MODE_PROBE_ATTRIBUTE, mode);
    probe.hidden = true;
    root.append(probe);
    target = probe;
  }
  try {
    const style = getComputedStyle(target);
    for (const id of ids) values[id] = style.getPropertyValue(`--${id}`).trim();
  } finally {
    probe?.remove();
  }
  return values;
}

// One observer for every subscriber: the theme roots' class, palette and inline
// variables, and the stylesheets in <head> (a theme's runtime CSS, a dev reload).
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function observe(): void {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return;
  observer = new MutationObserver(notify);
  for (const root of getThemeRoots()) {
    observer.observe(root, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
  }
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
}

/** Calls `listener` after anything that may change a token's value; returns the unsubscribe. */
export function subscribeThemeTokens(listener: () => void): () => void {
  listeners.add(listener);
  if (!observer) observe();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}
