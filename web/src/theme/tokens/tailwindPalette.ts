// Tailwind's default palette steps, for token defaults that keep a colour the UI took
// from a raw palette class (`text-green-600`) exactly as it was. A default reads the
// step's Tailwind theme variable, so it is the very value the class had, and Tailwind
// keeps emitting the variable.

type Hue =
  | "amber"
  | "blue"
  | "cyan"
  | "emerald"
  | "green"
  | "indigo"
  | "lime"
  | "neutral"
  | "orange"
  | "pink"
  | "purple"
  | "red"
  | "slate"
  | "yellow"
  | "zinc";
type Step = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;

/** A Tailwind palette step (`green-600`), or white or black. */
export type TailwindColor = `${Hue}-${Step}` | "white" | "black";

/** A palette step's theme variable, e.g. `tw("green-600")` is `var(--color-green-600)`. */
export function tw(name: TailwindColor): string {
  return `var(--color-${name})`;
}
