// A `matchMedia` that answers width and aspect queries from `window.innerWidth`/`innerHeight`,
// for tests that size the window (the setup's default answers every query with false).

import { vi } from "vitest";

function evaluate(query: string): boolean {
  const width = window.innerWidth;
  const height = window.innerHeight || 1;
  return query.split(" and ").every((part) => {
    const feature = part.trim().match(/^\(([\w-]+):\s*([\d./]+)(px)?\)$/);
    if (!feature) return false;
    const [, name, raw] = feature;
    const value = raw.includes("/")
      ? Number(raw.split("/")[0]) / Number(raw.split("/")[1])
      : Number(raw);
    if (name === "min-width") return width >= value;
    if (name === "max-width") return width <= value;
    if (name === "min-aspect-ratio") return width / height >= value;
    return false;
  });
}

/** Stubs `window.matchMedia` with width queries evaluated against the window's size. */
export function stubWindowMediaQueries(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: evaluate(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}
