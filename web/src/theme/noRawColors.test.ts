// Guard against new hard-coded colours, radii and text sizes in the UI sources: colours
// belong in the theme tokens (`theme/tokens/`), so a theme can change them. Each file's
// remaining counts are recorded in `noRawColors.allowlist.ts`; they may only go down, and
// a file that isn't listed must have none.
//
// After lowering counts, rewrite the allowlist with
// `UPDATE_RAW_COLOR_ALLOWLIST=1 vitest run src/theme/noRawColors.test.ts`. That refuses a
// new file or a higher count; only `ALLOW_RAW_COLOR_INCREASE=1` together with it writes
// those, and such a change needs review (a guard that grew, or a deliberate exception).

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RAW_COLOR_ALLOWLIST,
  RAW_COLOR_EXEMPT,
  RAW_COLOR_TEST_DIRECTORIES,
  type RawCounts,
} from "./noRawColors.allowlist";

const SRC = resolve(__dirname, "..");
const WEB = resolve(SRC, "..");

/** Tailwind's palette hues: the installed version's (`theme.css`) must be a subset. */
export const HUES = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "mauve",
  "olive",
  "mist",
  "taupe",
] as const;
const HUE = HUES.join("|");
const STEP = `(?:(?:${HUE})-\\d{2,3}|white|black)`;
// Every utility that takes a colour; the longer prefixes are tried where a shorter one fails.
const UTILITIES = [
  "bg",
  "text",
  "text-shadow",
  "border",
  "border-[ltrbxyse]",
  "ring",
  "ring-offset",
  "inset-ring",
  "inset-shadow",
  "drop-shadow",
  "shadow",
  "fill",
  "stroke",
  "from",
  "to",
  "via",
  "outline",
  "decoration",
  "divide",
  "placeholder",
  "caret",
  "accent",
].join("|");

/** CSS's named colours (`transparent` and `currentColor` aren't raw colours). */
export const NAMED_COLORS = (
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue " +
  "blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk " +
  "crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki " +
  "darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
  "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue " +
  "dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite " +
  "gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
  "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
  "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen " +
  "lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen " +
  "magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
  "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
  "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
  "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
  "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
  "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen " +
  "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
).split(" ");
/** CSS's system colours, current and deprecated, which count as named colours. */
export const SYSTEM_COLORS = (
  "AccentColor AccentColorText ActiveText ButtonBorder ButtonFace ButtonText Canvas " +
  "CanvasText Field FieldText GrayText Highlight HighlightText LinkText Mark MarkText " +
  "SelectedItem SelectedItemText VisitedText ActiveBorder ActiveCaption AppWorkspace " +
  "Background ButtonHighlight ButtonShadow CaptionText InactiveBorder InactiveCaption " +
  "InactiveCaptionText InfoBackground InfoText Menu MenuText Scrollbar ThreeDDarkShadow " +
  "ThreeDFace ThreeDHighlight ThreeDLightShadow ThreeDShadow Window WindowFrame WindowText"
).split(" ");
// Not after `.`: a property read (`colors.background`) names a value, not a colour.
const wordPattern = (words: readonly string[], flags: string) =>
  new RegExp(
    `(?<![A-Za-z0-9.$-])(?:${[...words].sort((a, b) => b.length - a.length).join("|")})(?![A-Za-z0-9-])`,
    flags,
  );
const NAMED_WORD = wordPattern(NAMED_COLORS, "gi");
// System colours as CSS writes them, and the compound names in lower case too; a lower-case
// `canvas`, `field` or `menu` is a word, not a colour.
const SYSTEM_WORD = wordPattern(
  [
    ...SYSTEM_COLORS,
    ...SYSTEM_COLORS.filter((name) => /[A-Z].*[A-Z]/.test(name)).map((name) => name.toLowerCase()),
  ],
  "g",
);

/** What the guard counts by pattern, by category. */
export const RAW_PATTERNS = {
  /**
   * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, also after `_` in arbitrary values, written
   * with an escaped `#` (`\x23`, `\u0023`, `\u{23}`), and a template literal's `#${…}`
   * whose expression reads a colour (`color`, `hex`, `rgb`, `channel(`), not an id. A colour
   * built by concatenation (`"#" + hex`) or from other names is out of scope.
   */
  hex: /(?:(?<![&A-Za-z0-9])#|\\x23|\\u0023|\\u\{23\})(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![A-Za-z0-9-])|(?<![&A-Za-z0-9])#\$\{(?=[^}]{0,80}?(?:[Cc]olou?r|[Hh]ex|[Rr][Gg][Bb]|channel\())/g,
  /**
   * Tailwind's palette: steps and white/black in a colour utility (any variant, with an
   * alpha), its `--color-<hue>-<n>` variables however they are read (`var()`,
   * `bg-(…)`, `theme(--…)`), and `theme(colors.…)`.
   */
  palette: new RegExp(
    `(?<![\\w-])(?:${UTILITIES})-${STEP}(?![\\w-])|(?<![\\w-])--color-${STEP}(?![\\w-])|(?<![\\w-])theme\\(\\s*["']?colors\\.`,
    "g",
  ),
  /** Arbitrary radii, `rounded-[6px]`, `rounded-t-[...]`. */
  rounded: /(?<![\w-])rounded(?:-[a-z]{1,2})?-\[/g,
  /** Arbitrary pixel text sizes, `text-[11px]`. */
  textPx: /(?<![\w-])text-\[\d+(?:\.\d+)?px\]/g,
  /**
   * Colour functions with literal or interpolated channels, in any case: `rgba(0, 0, 0,
   * .1)`, `rgb(0_0_0/…)`, `RGB(…)`, `hsl(${hue} …)`, `oklch(0.6 …)`, `color(srgb …)`.
   */
  colorFunction:
    /(?<![\w-])(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*(?:[\d.+-]|\$\{|none\b)|(?<![\w-])color\(\s*(?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65)\b/gi,
} as const;

/** Every category the guard counts: {@link RAW_PATTERNS} and named colours. */
export const RAW_CATEGORIES = [
  ...(Object.keys(RAW_PATTERNS) as RawPatternCategory[]),
  "named",
] as const;
type RawPatternCategory = keyof typeof RAW_PATTERNS;
export type RawCategory = RawPatternCategory | "named";

// Where a named colour is a colour. Each pattern's last group is the value to look in.
const COLOR_PROPERTY =
  "(?:--)?[\\w-]*color|background(?:-[\\w-]+)?|fill|stroke|border(?:-[\\w-]+)?|outline(?:-[\\w-]+)?|box-shadow|text-shadow|text-decoration(?:-[\\w-]+)?|column-rule(?:-color)?";
// The camel-cased CSS properties that take a colour, as style objects write them.
const STYLE_KEY =
  "(?:color|background(?:Color|Image)?|border(?:Top|Right|Bottom|Left|Block|Inline)?(?:Start|End)?(?:Color)?|outline(?:Color)?|fill|stroke|boxShadow|textShadow|caretColor|accentColor|textDecoration(?:Color)?|columnRule(?:Color)?|stopColor|floodColor|lightingColor)";
const NAMED_CONTEXTS: { pattern: RegExp; css?: boolean }[] = [
  // Tailwind arbitrary values of a colour utility: `bg-[red]`, `shadow-[0_0_0_1px_white]`.
  { pattern: new RegExp(`(?<![\\w-])(?:${UTILITIES})-\\[([^\\]\\s"'\`]*)\\]`, "g") },
  // Tailwind arbitrary properties: `[color:red]`, `[--x-color:white]`.
  { pattern: new RegExp(`\\[(?:${COLOR_PROPERTY}):([^\\]\\s"'\`]*)\\]`, "g") },
  // Style objects: `color: "white"`, `"background-color": 'red'`, `boxShadow: \`…\``.
  {
    pattern: new RegExp(
      `(?<![\\w-])(?:${STYLE_KEY}|["'](?:${COLOR_PROPERTY})["'])\\s*:\\s*(["'\`])((?:(?!\\1)[^\\\\\\n]|\\\\.)*)\\1`,
      "g",
    ),
  },
  // SVG and JSX colour attributes: `fill="white"`, `stopColor="red"`.
  {
    pattern:
      /(?<![\w-])(?:fill|stroke|color|stopColor|stop-color|floodColor|flood-color|lightingColor)\s*=\s*\{?\s*(["'])([^"'\n]*)\1/g,
  },
  // CSS declarations (in stylesheets, and in a source's string literals): `color: white`.
  {
    pattern: new RegExp(`(?<![\\w-])(?:${COLOR_PROPERTY})\\s*:\\s*([^;{}\\n"'\`]*)`, "g"),
    css: true,
  },
];

const STRING_LITERAL = /(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g;

/** The start offsets of named colours `text` uses as colours (each counted once). */
function namedColorOffsets(text: string, stylesheet: boolean): Set<number> {
  const offsets = new Set<number>();
  const collect = (value: string, at: number) => {
    for (const match of value.matchAll(NAMED_WORD)) offsets.add(at + match.index);
    for (const match of value.matchAll(SYSTEM_WORD)) offsets.add(at + match.index);
  };
  const scan = (pattern: RegExp, source: string, base: number) => {
    for (const match of source.matchAll(pattern)) {
      const value = match[match.length - 1] ?? "";
      collect(value, base + match.index + match[0].lastIndexOf(value));
    }
  };
  for (const { pattern, css } of NAMED_CONTEXTS) {
    if (!css) scan(pattern, text, 0);
    else if (stylesheet) scan(pattern, text, 0);
    else {
      for (const literal of text.matchAll(STRING_LITERAL)) {
        scan(pattern, literal[2] ?? "", literal.index + 1);
      }
    }
  }
  // `color-mix()` with a named colour, one level of nested parentheses deep.
  for (const match of text.matchAll(/(?<![\w-])color-mix\(((?:[^()]|\([^()]*\))*)\)/gi)) {
    collect(match[1] ?? "", match.index + "color-mix(".length);
  }
  return offsets;
}

const DATA_START = /(?:\/\/|\/\*)\s*raw-colors-data:\s*(.*?)\s*(?:\*\/)?$/;
const DATA_END = /(?:\/\/|\/\*)\s*raw-colors-data-end\b/;

/**
 * The marked data blocks of a source: lines from a `raw-colors-data: <why>` comment to
 * `raw-colors-data-end`, whose raw colours are data (a palette, seeds), not styling.
 */
export function dataBlocks(text: string): { start: number; end: number; reason: string }[] {
  const blocks: { start: number; end: number; reason: string }[] = [];
  const lines = text.split("\n");
  let open: { start: number; reason: string } | null = null;
  lines.forEach((line, index) => {
    const start = DATA_START.exec(line);
    if (start) {
      if (open) throw new Error(`line ${index + 1}: raw-colors-data inside another block`);
      if (!start[1]) throw new Error(`line ${index + 1}: raw-colors-data needs a reason`);
      open = { start: index, reason: start[1] };
    } else if (DATA_END.test(line)) {
      if (!open) throw new Error(`line ${index + 1}: raw-colors-data-end without a start`);
      blocks.push({ ...(open as { start: number; reason: string }), end: index });
      open = null;
    }
  });
  if (open) throw new Error("raw-colors-data block left open");
  return blocks;
}

/** `text` with its data blocks' lines blanked (line count kept). */
function withoutDataBlocks(text: string): string {
  const blocks = dataBlocks(text);
  if (blocks.length === 0) return text;
  const lines = text.split("\n");
  for (const { start, end } of blocks) lines.fill("", start, end + 1);
  return lines.join("\n");
}

/** The counts of each category in `text`, categories with none left out. */
export function countRaw(text: string, { stylesheet = false } = {}): RawCounts {
  const counts: RawCounts = {};
  for (const [category, pattern] of Object.entries(RAW_PATTERNS) as [
    RawPatternCategory,
    RegExp,
  ][]) {
    const found = text.match(pattern)?.length ?? 0;
    if (found > 0) counts[category] = found;
  }
  const named = namedColorOffsets(text, stylesheet).size;
  if (named > 0) counts.named = named;
  return counts;
}

const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|css|scss|json|html)$/;
const NOT_SOURCE = /\.(?:test|stories)\.[^.]+$|\.d\.ts$/;

function relativeToSrc(path: string): string {
  return relative(SRC, path).split("\\").join("/");
}

function isTestDirectory(path: string): boolean {
  const file = `${relativeToSrc(path)}/`;
  return RAW_COLOR_TEST_DIRECTORIES.includes(file);
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return isTestDirectory(path) ? [] : sources(path);
    return SOURCE.test(entry.name) && !NOT_SOURCE.test(entry.name) ? [path] : [];
  });
}

function isExempt(file: string): boolean {
  return Object.keys(RAW_COLOR_EXEMPT).some((key) =>
    key.endsWith("/") ? file.startsWith(key) : file === key,
  );
}

function countFile(path: string): RawCounts {
  return countRaw(withoutDataBlocks(readFileSync(path, "utf8")), {
    stylesheet: /\.s?css$/.test(path),
  });
}

function measure(): Map<string, RawCounts> {
  const measured = new Map<string, RawCounts>();
  for (const path of sources(SRC)) {
    const file = relativeToSrc(path);
    if (isExempt(file)) continue;
    const counts = countFile(path);
    if (Object.keys(counts).length > 0) measured.set(file, counts);
  }
  return measured;
}

/** What `measured` raises over `allowlist`: new files and higher counts. */
export function increases(
  measured: ReadonlyMap<string, RawCounts>,
  allowlist: Readonly<Record<string, RawCounts>>,
): string[] {
  const problems: string[] = [];
  for (const [file, counts] of measured) {
    const allowed = allowlist[file];
    if (!allowed) {
      problems.push(`${file}: not in the allowlist (${formatCounts(counts)})`);
      continue;
    }
    for (const [category, count] of Object.entries(counts) as [RawCategory, number][]) {
      const limit = allowed[category] ?? 0;
      if (count > limit) problems.push(`${file}: ${count} ${category}, allowed ${limit}`);
    }
  }
  return problems;
}

function formatCounts(counts: RawCounts): string {
  const entries = RAW_CATEGORIES.filter((category) => counts[category]).map(
    (category) => `${category}: ${counts[category]}`,
  );
  return `{ ${entries.join(", ")} }`;
}

const PRINT_WIDTH = 100;

/** The allowlist's entries as the committed file writes them (Prettier's layout). */
export function formatAllowlist(measured: ReadonlyMap<string, RawCounts>): string {
  const entries = [...measured]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, counts]) => {
      const line = `  ${JSON.stringify(file)}: ${formatCounts(counts)},`;
      if (line.length <= PRINT_WIDTH) return line;
      const fields = RAW_CATEGORIES.filter((category) => counts[category]).map(
        (category) => `    ${category}: ${counts[category]},`,
      );
      return [`  ${JSON.stringify(file)}: {`, ...fields, "  },"].join("\n");
    });
  return [
    "export const RAW_COLOR_ALLOWLIST: Readonly<Record<string, RawCounts>> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}

/**
 * Rewrites the allowlist from `measured`. Refuses a new file or a higher count unless
 * `allowIncrease` is set.
 *
 * @returns The refused increases (nothing written), or none.
 */
function writeAllowlist(measured: Map<string, RawCounts>, allowIncrease: boolean): string[] {
  const refused = increases(measured, RAW_COLOR_ALLOWLIST);
  if (refused.length > 0 && !allowIncrease) return refused;
  const path = resolve(__dirname, "noRawColors.allowlist.ts");
  const source = readFileSync(path, "utf8");
  const start = source.indexOf("export const RAW_COLOR_ALLOWLIST");
  writeFileSync(path, source.slice(0, start) + formatAllowlist(measured));
  return [];
}

describe("raw colours in the UI sources", () => {
  const measured = measure();
  const refused = process.env.UPDATE_RAW_COLOR_ALLOWLIST
    ? writeAllowlist(measured, process.env.ALLOW_RAW_COLOR_INCREASE === "1")
    : [];

  it("counts what it should", () => {
    expect(
      countRaw(
        "a #fff #ffffff00 &#123; text-green-600 dark:bg-white/10 hover:ring-black rounded-[3px] text-[11px] rgba(0, 0, 0, .1) rgb(0_0_0/0.2) rgb(var(--x) / 1) text-(--ui-success-text) bg-muted",
      ),
    ).toEqual({ hex: 2, palette: 3, rounded: 1, textPx: 1, colorFunction: 2 });
  });

  it("finds hex colours after an underscore in arbitrary values", () => {
    expect(countRaw("shadow-[0_0_0_1px_#fff] shadow-[0_1px_#0008_inset] bg-[#abc]")).toEqual({
      hex: 3,
    });
    expect(countRaw("issue#123 a&#x27;b url#fff")).toEqual({});
  });

  it("finds escaped and interpolated hex colours", () => {
    expect(
      countRaw('const a = "\\x23fff"; const b = "\\u0023abcdef"; const c = "\\u{23}0008";'),
    ).toEqual({ hex: 3 });
    expect(
      countRaw("const d = `#${hex}`; const e = `#${channel(r)}${channel(g)}`; `#${label.color}`"),
    ).toEqual({ hex: 3 });
    expect(
      countRaw('const f = "\\x23 is a hash"; `item#${n}` `#${id}` `url(#${maskId})` `#${channel}`'),
    ).toEqual({});
  });

  it("finds CSS system colours where they are colours", () => {
    expect(
      countRaw('style={{ color: "CanvasText", background: "Canvas" }} [color:LinkText]'),
    ).toEqual({ named: 3 });
    expect(
      countRaw(".a { outline: 1px solid Highlight; color: canvastext }", { stylesheet: true }),
    ).toEqual({ named: 2 });
    expect(countRaw('const label = "Highlight the Menu"; const menu = "Menu";')).toEqual({});
  });

  it("finds Tailwind's palette under every colour utility and hue, and its variables", () => {
    const classes = [
      "border-l-red-500",
      "border-x-blue-200",
      "border-s-zinc-100",
      "ring-offset-white",
      "inset-ring-black/10",
      "inset-shadow-gray-900",
      "drop-shadow-sky-500",
      "text-shadow-rose-300",
      "bg-mauve-500",
      "text-olive-700",
      "fill-mist-100",
      "stroke-taupe-950",
    ];
    expect(countRaw(classes.join(" "))).toEqual({ palette: classes.length });
    expect(
      countRaw(
        'bg-[var(--color-red-500)] text-(--color-zinc-400) border-(--color-white) theme(--color-mist-50) theme("colors.gray.100") theme(colors.blue.500)',
      ),
    ).toEqual({ palette: 6 });
    expect(
      countRaw("bg-red text-red-hot --color-primary var(--color-brand-500) text-shadow-lg"),
    ).toEqual({});
  });

  it("knows every hue the installed Tailwind defines", () => {
    const theme = readFileSync(resolve(WEB, "node_modules/tailwindcss/theme.css"), "utf8");
    const installed = new Set(
      [...theme.matchAll(/--color-([a-z]+)-50:/g)].map((match) => match[1]),
    );
    expect([...installed].filter((hue) => !HUES.includes(hue as (typeof HUES)[number]))).toEqual(
      [],
    );
  });

  it("finds colour functions in any case, interpolated, and color()", () => {
    expect(
      countRaw(
        "RGB(0 0 0) Hsl(10 50% 50%) hsl(${hue} 50% 50%) rgba(${r}, 0, 0, 1) color(srgb 1 0 0) COLOR(display-p3 1 0 0) oklch(.5 .1 10)",
      ),
    ).toEqual({ colorFunction: 7 });
    expect(countRaw("rgb(var(--x)) hsl(var(--h)) color(--x) colorize(1) torgb(1)")).toEqual({});
  });

  it("finds named colours where they are colours", () => {
    const snippets = [
      "style={{ color: \"white\", backgroundColor: 'Red' }}",
      'const style = { boxShadow: "0 0 0 1px black", "border-color": "navy" };',
      "bg-[red] shadow-[0_0_0_1px_white] [color:tomato] [--x-color:gold]",
      '<path fill="white" stroke="black" stopColor="red" />',
      '"color: rebeccapurple; border: 1px solid silver"',
      "color-mix(in srgb, var(--x) 20%, white) color-mix(in oklab, white, var(--a, black))",
    ];
    expect(countRaw(snippets.join("\n"))).toEqual({ named: 16 });
    expect(countRaw("bg-[color-mix(in_srgb,white_10%,transparent)]")).toEqual({ named: 1 });
  });

  it("leaves named colours in prose and identifiers alone", () => {
    expect(
      countRaw(
        [
          "// The red button turns white when pressed, like a white flag.",
          'const label = "Red alert: the orange team wins";',
          "const white = 1; const color = isDark ? white : black;",
          'variant: "white", tone: "red", tagColor: "blue", title: "Background: white"',
          'fill="none" stroke="currentColor" color: "transparent", background: "inherit"',
          "bg-white-ish text-[red-ish] --sidebar-white var(--red)",
          "transition: color 120ms, background 120ms;",
        ].join("\n"),
      ),
    ).toEqual({});
  });

  it("finds named colours in stylesheet declarations, not in their comments' words", () => {
    expect(
      countRaw(".a { color: white; border: 1px solid red; --x-color: gold }", { stylesheet: true }),
    ).toEqual({ named: 3 });
    expect(
      countRaw(".a { mask: linear-gradient(#000, transparent) }", { stylesheet: true }),
    ).toEqual({
      hex: 1,
    });
  });

  it("skips marked data blocks, and rejects unbalanced or unexplained ones", () => {
    const text = [
      "const a = '#fff';",
      "// raw-colors-data: the seed colours the user edits",
      "const seed = '#000';",
      "// raw-colors-data-end",
      "const b = 'bg-red-500';",
    ].join("\n");
    expect(countRaw(withoutDataBlocks(text))).toEqual({ hex: 1, palette: 1 });
    expect(() => dataBlocks("// raw-colors-data: x\n")).toThrow(/open/);
    expect(() => dataBlocks("// raw-colors-data-end\n")).toThrow(/without a start/);
    expect(() => dataBlocks("// raw-colors-data:\n// raw-colors-data-end")).toThrow(/reason/);
  });

  it("adds none outside the allowlist, and lowers the allowlist as they go", () => {
    expect(
      refused,
      "UPDATE_RAW_COLOR_ALLOWLIST refuses new files and higher counts; ALLOW_RAW_COLOR_INCREASE=1 writes them (needs review)",
    ).toEqual([]);
    // While rewriting, the file on disk is new and this run's import the old one.
    const problems = process.env.UPDATE_RAW_COLOR_ALLOWLIST
      ? []
      : increases(measured, RAW_COLOR_ALLOWLIST);
    if (!process.env.UPDATE_RAW_COLOR_ALLOWLIST) {
      for (const [file, allowed] of Object.entries(RAW_COLOR_ALLOWLIST)) {
        const counts = measured.get(file) ?? {};
        for (const [category, limit] of Object.entries(allowed) as [RawCategory, number][]) {
          const count = counts[category] ?? 0;
          if (count < limit) {
            problems.push(
              `${file}: ${category} down to ${count} from ${limit}; lower the allowlist`,
            );
          }
        }
      }
    }
    expect(problems, "use the theme tokens (theme/tokens/) instead of raw values").toEqual([]);
  });

  it("refuses increases when rewriting the allowlist", () => {
    const allowlist = { "a.tsx": { hex: 2 } };
    expect(increases(new Map([["a.tsx", { hex: 1 }]]), allowlist)).toEqual([]);
    expect(increases(new Map([["a.tsx", { hex: 3 }]]), allowlist)).toEqual([
      "a.tsx: 3 hex, allowed 2",
    ]);
    expect(increases(new Map([["b.tsx", { named: 1 }]]), allowlist)).toEqual([
      "b.tsx: not in the allowlist ({ named: 1 })",
    ]);
  });

  it("writes the allowlist in the committed file's format", () => {
    if (process.env.UPDATE_RAW_COLOR_ALLOWLIST) return;
    const source = readFileSync(resolve(__dirname, "noRawColors.allowlist.ts"), "utf8");
    const committed = source.slice(source.indexOf("export const RAW_COLOR_ALLOWLIST"));
    expect(formatAllowlist(new Map(Object.entries(RAW_COLOR_ALLOWLIST)))).toBe(committed);
  });

  it("exempts only files that exist and still hold raw values", () => {
    for (const key of Object.keys(RAW_COLOR_EXEMPT)) {
      const files = key.endsWith("/") ? sources(join(SRC, key)) : [join(SRC, key)];
      const raw = files.some((file) => Object.keys(countRaw(readFileSync(file, "utf8"))).length);
      expect(raw, key).toBe(true);
    }
  });

  it("marks only data blocks that still hold raw values", () => {
    for (const path of sources(SRC)) {
      const text = readFileSync(path, "utf8");
      const lines = text.split("\n");
      for (const { start, end, reason } of dataBlocks(text)) {
        const block = lines.slice(start + 1, end).join("\n");
        const counts = countRaw(block, { stylesheet: /\.s?css$/.test(path) });
        expect(
          Object.keys(counts).length,
          `${relativeToSrc(path)}:${start + 1} (${reason})`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("skips only test directories that only tests import", () => {
    const importers: string[] = [];
    for (const directory of RAW_COLOR_TEST_DIRECTORIES) {
      expect(existsSync(join(SRC, directory)), directory).toBe(true);
    }
    for (const path of sources(SRC)) {
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        const specifier = match[1] ?? "";
        const target = specifier.startsWith("@/")
          ? join(SRC, specifier.slice(2))
          : specifier.startsWith(".")
            ? resolve(dirname(path), specifier)
            : null;
        if (!target) continue;
        const file = `${relativeToSrc(target)}/`;
        const directory = RAW_COLOR_TEST_DIRECTORIES.find((entry) => file.startsWith(entry));
        if (directory) importers.push(`${relativeToSrc(path)} imports ${specifier}`);
      }
    }
    expect(importers).toEqual([]);
  });
});
