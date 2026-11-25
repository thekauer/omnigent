// Guard against new hard-coded colours, radii and text sizes in the UI sources: colours
// belong in the theme tokens (`theme/tokens/`), so a theme can change them. Each file's
// remaining counts are recorded in `noRawColors.allowlist.ts`; they may only go down, and
// a file that isn't listed must have none. After lowering counts, rewrite the allowlist
// with `UPDATE_RAW_COLOR_ALLOWLIST=1 vitest run src/theme/noRawColors.test.ts`.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { RAW_COLOR_ALLOWLIST, RAW_COLOR_EXEMPT, type RawCounts } from "./noRawColors.allowlist";

const SRC = resolve(__dirname, "..");

const HUES =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";
const UTILITIES =
  "bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|placeholder|caret|accent|shadow";

/** What the guard counts, by category. */
export const RAW_PATTERNS = {
  /** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. */
  hex: /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g,
  /** Tailwind's palette steps and white/black, in any variant or with an alpha. */
  palette: new RegExp(
    `(?<![\\w-])(?:${UTILITIES})-(?:(?:${HUES})-\\d{2,3}|white|black)(?![\\w-])`,
    "g",
  ),
  /** Arbitrary radii, `rounded-[6px]`, `rounded-t-[...]`. */
  rounded: /(?<![\w-])rounded(?:-[a-z]{1,2})?-\[/g,
  /** Arbitrary pixel text sizes, `text-[11px]`. */
  textPx: /(?<![\w-])text-\[\d+(?:\.\d+)?px\]/g,
  /** Colour functions with literal channels: `rgba(0, 0, 0, .1)`, `rgb(0_0_0/…)`, `oklch(0.6 …)`. */
  colorFunction: /(?<![\w-])(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*[\d.]/g,
} as const;

export type RawCategory = keyof typeof RAW_PATTERNS;

const SOURCE = /\.(?:ts|tsx|css)$/;
const NOT_SOURCE = /\.(?:test|stories)\.[^.]+$|\.d\.ts$/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "test" || entry.name === "__tests__" ? [] : sources(path);
    }
    return SOURCE.test(entry.name) && !NOT_SOURCE.test(entry.name) ? [path] : [];
  });
}

/** The counts of each category in `text`, categories with none left out. */
export function countRaw(text: string): RawCounts {
  const counts: RawCounts = {};
  for (const [category, pattern] of Object.entries(RAW_PATTERNS) as [RawCategory, RegExp][]) {
    const found = text.match(pattern)?.length ?? 0;
    if (found > 0) counts[category] = found;
  }
  return counts;
}

function isExempt(file: string): boolean {
  return Object.keys(RAW_COLOR_EXEMPT).some((key) =>
    key.endsWith("/") ? file.startsWith(key) : file === key,
  );
}

function measure(): Map<string, RawCounts> {
  const measured = new Map<string, RawCounts>();
  for (const path of sources(SRC)) {
    const file = relative(SRC, path).split("\\").join("/");
    if (isExempt(file)) continue;
    const counts = countRaw(readFileSync(path, "utf8"));
    if (Object.keys(counts).length > 0) measured.set(file, counts);
  }
  return measured;
}

function writeAllowlist(measured: Map<string, RawCounts>): void {
  const path = resolve(__dirname, "noRawColors.allowlist.ts");
  const source = readFileSync(path, "utf8");
  const start = source.indexOf("export const RAW_COLOR_ALLOWLIST");
  const entries = [...measured]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([file, counts]) =>
        `  ${JSON.stringify(file)}: ${JSON.stringify(counts).replaceAll(",", ", ").replaceAll(":", ": ")},`,
    );
  const list = [
    "export const RAW_COLOR_ALLOWLIST: Readonly<Record<string, RawCounts>> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
  writeFileSync(path, source.slice(0, start) + list);
}

describe("raw colours in the UI sources", () => {
  const measured = measure();
  if (process.env.UPDATE_RAW_COLOR_ALLOWLIST) writeAllowlist(measured);

  it("counts what it should", () => {
    expect(
      countRaw(
        "a #fff #ffffff00 &#123; text-green-600 dark:bg-white/10 hover:ring-black rounded-[3px] text-[11px] rgba(0, 0, 0, .1) rgb(0_0_0/0.2) rgb(var(--x) / 1) text-(--ui-success-text) bg-muted",
      ),
    ).toEqual({ hex: 2, palette: 3, rounded: 1, textPx: 1, colorFunction: 2 });
  });

  it("adds none outside the allowlist, and lowers the allowlist as they go", () => {
    const problems: string[] = [];
    for (const [file, counts] of measured) {
      const allowed = RAW_COLOR_ALLOWLIST[file] ?? {};
      for (const [category, count] of Object.entries(counts) as [RawCategory, number][]) {
        const limit = allowed[category] ?? 0;
        if (count > limit) problems.push(`${file}: ${count} ${category}, allowed ${limit}`);
      }
    }
    for (const [file, allowed] of Object.entries(RAW_COLOR_ALLOWLIST)) {
      const counts = measured.get(file) ?? {};
      for (const [category, limit] of Object.entries(allowed) as [RawCategory, number][]) {
        const count = counts[category] ?? 0;
        if (count < limit) {
          problems.push(`${file}: ${category} down to ${count} from ${limit}; lower the allowlist`);
        }
      }
    }
    expect(problems, "use the theme tokens (theme/tokens/) instead of raw values").toEqual([]);
  });

  it("exempts only files that exist and still hold raw values", () => {
    for (const key of Object.keys(RAW_COLOR_EXEMPT)) {
      const files = key.endsWith("/") ? sources(join(SRC, key)) : [join(SRC, key)];
      const raw = files.some((file) => Object.keys(countRaw(readFileSync(file, "utf8"))).length);
      expect(raw, key).toBe(true);
    }
  });
});
