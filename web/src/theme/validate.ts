// Validation of theme values that reach CSS. Pure: shared by the browser and Node (the
// dev plugin, M6), with no DOM access.
//
// Two parts: the syntax themes' (`registerSyntaxTheme`), whose colours and font styles
// end up verbatim in inline `style` strings (Shiki's tokens, @pierre/diffs' theme
// styles), so anything but a plain colour could inject CSS properties; and the token
// values of the theme contribution API (`validateTokenValue`), checked per kind and
// written back out by the host.

import type { TokenKind } from "./tokens/types.ts";

/**
 * A hex colour as VS Code colour themes write them: `#rgb`, `#rgba`, `#rrggbb` or
 * `#rrggbbaa`. The only colour syntax a syntax theme may use.
 */
export const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Whether `value` is a hex colour ({@link HEX_COLOR}). */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

/** The font style keywords a TextMate rule may combine (VS Code's `fontStyle`). */
export const SYNTAX_FONT_STYLES = ["italic", "bold", "underline", "strikethrough"] as const;

/**
 * Whether `value` is a TextMate `fontStyle`: the {@link SYNTAX_FONT_STYLES} keywords
 * separated by spaces, each at most once, or `""` (which resets the inherited style).
 */
export function isSyntaxFontStyle(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const words = value.trim().split(/ +/).filter(Boolean);
  const allowed: readonly string[] = SYNTAX_FONT_STYLES;
  return words.every((word) => allowed.includes(word)) && new Set(words).size === words.length;
}

/** Size caps for a syntax theme, far above any real theme's. */
export const SYNTAX_THEME_LIMITS = {
  /** TextMate rules in `tokenColors`. */
  rules: 4000,
  /** Scope selectors in one rule. */
  scopesPerRule: 256,
  /** Characters in one scope selector. */
  scopeLength: 256,
  /** Entries in `colors`. */
  colors: 1000,
  /** Characters of all strings and keys in `colors` and `tokenColors` together. */
  chars: 1_048_576,
  /** Values in `colors` and `tokenColors` together. */
  nodes: 100_000,
} as const;

/** A syntax theme's name: a CSS keyword, as the `syntax-theme-*` tokens name it. */
export const SYNTAX_THEME_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

// A workbench colour id (`editor.background`, `terminal.ansiRed`).
const COLOR_ID = /^[A-Za-z][A-Za-z0-9.]{0,127}$/;
// A TextMate scope selector: scope names, spaces, `,`, `-` exclusions, `|`, `>` and
// parentheses. No quotes, semicolons, braces or backslashes.
const SCOPE_SELECTOR = /^[A-Za-z0-9_.\-+*:, >|&()^$]*$/;

/** One TextMate rule, as {@link sanitizeSyntaxTheme} returns it. */
export interface ValidTokenColor {
  name?: string;
  scope?: string | string[];
  settings: { foreground?: string; background?: string; fontStyle?: string };
}

/** The checked parts of a syntax theme. */
export interface ValidSyntaxTheme {
  colors: Record<string, string>;
  tokenColors: ValidTokenColor[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string-keyed map without a prototype, so keys like `__proto__` stay plain keys. */
export function nullMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** JSON-shaped data: what {@link snapshotPlainData} returns. */
export type PlainData =
  null | boolean | number | string | PlainData[] | { [key: string]: PlainData };

/** Caps on the data {@link snapshotPlainData} copies. */
export interface PlainDataLimits {
  /** Characters of all strings and keys together. */
  chars: number;
  /** Values (objects, arrays, primitives) together. */
  nodes: number;
  /** Nesting depth. */
  depth: number;
}

/**
 * Copies JSON-shaped `value` once, before anything checks it: each own property is read
 * exactly once, through its descriptor (accessors are rejected, never called), so a
 * getter or proxy can't show the check one value and the use another. Arrays must be
 * dense (a hole is rejected), objects plain (or null-prototype); the copy's objects have
 * no prototype. Over `limits` it fails as a whole.
 *
 * @returns The copy, or the reason it was rejected.
 */
export function snapshotPlainData(
  value: unknown,
  limits: PlainDataLimits,
): { ok: true; value: PlainData } | { ok: false; reason: string } {
  let chars = 0;
  let nodes = 0;
  const seen = new Set<object>();
  const reject = (reason: string): never => {
    throw new PlainDataError(reason);
  };
  const copy = (current: unknown, depth: number, at: string): PlainData => {
    nodes += 1;
    if (nodes > limits.nodes) reject(`more than ${limits.nodes} values`);
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number") {
      return Number.isFinite(current) ? current : reject(`${at}: not a finite number`);
    }
    if (typeof current === "string") {
      chars += current.length;
      if (chars > limits.chars) reject(`more than ${limits.chars} characters`);
      return current;
    }
    if (typeof current !== "object") return reject(`${at}: not JSON data`);
    if (depth >= limits.depth) reject(`${at}: nested deeper than ${limits.depth}`);
    if (seen.has(current)) reject(`${at}: a cycle`);
    seen.add(current);
    if (Array.isArray(current)) {
      const length = Object.getOwnPropertyDescriptor(current, "length")?.value as number;
      if (length > limits.nodes) reject(`${at}: more than ${limits.nodes} entries`);
      const items: PlainData[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, index);
        if (!descriptor) reject(`${at}[${index}]: a hole`);
        if (!("value" in descriptor!)) reject(`${at}[${index}]: an accessor`);
        items.push(copy(descriptor!.value, depth + 1, `${at}[${index}]`));
      }
      seen.delete(current);
      return items;
    }
    const prototype = Object.getPrototypeOf(current) as unknown;
    if (prototype !== Object.prototype && prototype !== null) reject(`${at}: not a plain object`);
    const result = nullMap<PlainData>();
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string") reject(`${at}: a symbol key`);
      const name = key as string;
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (!descriptor || !descriptor.enumerable) continue;
      if (!("value" in descriptor)) reject(`${at}.${name.slice(0, 64)}: an accessor`);
      chars += name.length;
      if (chars > limits.chars) reject(`more than ${limits.chars} characters`);
      result[name] = copy(descriptor.value, depth + 1, `${at}.${name.slice(0, 64)}`);
    }
    seen.delete(current);
    return result;
  };
  try {
    return { ok: true, value: copy(value, 0, "$") };
  } catch (error) {
    if (error instanceof PlainDataError) return { ok: false, reason: error.message };
    // A proxy trap that throws: reject rather than crash the caller.
    return { ok: false, reason: "unreadable data" };
  }
}

class PlainDataError extends Error {}

function validScope(scope: unknown): boolean {
  return (
    typeof scope === "string" &&
    scope.length <= SYNTAX_THEME_LIMITS.scopeLength &&
    SCOPE_SELECTOR.test(scope)
  );
}

/**
 * Keeps the parts of a syntax theme's `colors` and `tokenColors` that are safe to put
 * into style strings, and describes what it dropped: a colour that isn't hex, a
 * `fontStyle` outside the keywords, a malformed scope, a malformed colour id, and
 * anything past the {@link SYNTAX_THEME_LIMITS}. A rule left with no settings is
 * dropped too.
 *
 * @returns The kept theme parts, and one message per dropped entry.
 */
export function sanitizeSyntaxTheme(
  colorsInput: unknown,
  tokenColorsInput: unknown,
): ValidSyntaxTheme & { issues: string[] } {
  const issues: string[] = [];
  const keptColors = nullMap<string>();
  // One read of the caller's data; everything below checks and keeps the copy.
  const snapshot = snapshotPlainData([colorsInput ?? null, tokenColorsInput ?? null], {
    chars: SYNTAX_THEME_LIMITS.chars,
    nodes: SYNTAX_THEME_LIMITS.nodes,
    depth: 8,
  });
  if (!snapshot.ok) {
    issues.push(`theme rejected: ${snapshot.reason}`);
    return { colors: keptColors, tokenColors: [], issues };
  }
  const [copiedColors, copiedTokenColors] = snapshot.value as PlainData[];
  const colors = colorsInput === undefined ? undefined : copiedColors;
  const tokenColors = tokenColorsInput === undefined ? undefined : copiedTokenColors;
  if (colors !== undefined && !isRecord(colors)) issues.push("colors: not an object");
  const colorEntries = isRecord(colors) ? Object.entries(colors) : [];
  if (colorEntries.length > SYNTAX_THEME_LIMITS.colors) {
    issues.push(`colors: more than ${SYNTAX_THEME_LIMITS.colors} entries, the rest dropped`);
  }
  for (const [id, value] of colorEntries.slice(0, SYNTAX_THEME_LIMITS.colors)) {
    if (!COLOR_ID.test(id)) issues.push(`colors: invalid id ${JSON.stringify(id.slice(0, 64))}`);
    else if (!isHexColor(value)) issues.push(`colors.${id}: not a hex colour`);
    else keptColors[id] = value;
  }

  const keptRules: ValidTokenColor[] = [];
  if (!Array.isArray(tokenColors)) {
    issues.push("tokenColors: not an array");
    return { colors: keptColors, tokenColors: keptRules, issues };
  }
  if (tokenColors.length > SYNTAX_THEME_LIMITS.rules) {
    issues.push(`tokenColors: more than ${SYNTAX_THEME_LIMITS.rules} rules, the rest dropped`);
  }
  tokenColors.slice(0, SYNTAX_THEME_LIMITS.rules).forEach((rule: unknown, index) => {
    const at = `tokenColors[${index}]`;
    if (!isRecord(rule) || !isRecord(rule.settings)) {
      issues.push(`${at}: no settings`);
      return;
    }
    const kept: ValidTokenColor = { settings: {} };
    if (typeof rule.name === "string") kept.name = rule.name.slice(0, 256);
    if (rule.scope !== undefined) {
      const scopes = Array.isArray(rule.scope) ? rule.scope : [rule.scope];
      if (scopes.length > SYNTAX_THEME_LIMITS.scopesPerRule || !scopes.every(validScope)) {
        issues.push(`${at}.scope: invalid`);
        return;
      }
      kept.scope = Array.isArray(rule.scope) ? (scopes as string[]) : (rule.scope as string);
    }
    const { foreground, background, fontStyle } = rule.settings;
    for (const [key, value] of [
      ["foreground", foreground],
      ["background", background],
    ] as const) {
      if (value === undefined) continue;
      if (isHexColor(value)) kept.settings[key] = value;
      else issues.push(`${at}.settings.${key}: not a hex colour`);
    }
    if (fontStyle !== undefined) {
      if (isSyntaxFontStyle(fontStyle)) kept.settings.fontStyle = fontStyle.trim();
      else issues.push(`${at}.settings.fontStyle: not ${SYNTAX_FONT_STYLES.join("/")}`);
    }
    if (Object.keys(kept.settings).length === 0) return;
    keptRules.push(kept);
  });
  return { colors: keptColors, tokenColors: keptRules, issues };
}

// --- Token values ----------------------------------------------------------------------
//
// Theme token values (theming plan, "Validation"): tokenized, checked per kind against a
// small grammar, and written back out by the host, so no text of the theme's reaches CSS
// as written. Dangerous constructs fail before tokenizing.

/** What a token's value must be: a registry kind, or one of the extra value kinds. */
export type ValueKind = TokenKind | "duration" | "easing";

/** Caps on a theme (one file of a theme contribution). */
export const THEME_LIMITS = {
  /** Characters in one value. */
  valueLength: 256,
  /** Tokens one theme may set (aliases, tokens and terminal slots together). */
  tokens: 1000,
  /** Bytes of the theme's JSON. */
  jsonBytes: 65_536,
  /** Theme contributions per extension. */
  themesPerExtension: 20,
  /** `color-mix()` nesting. */
  colorMixDepth: 3,
  /** Nested functions in one value. */
  functionDepth: 8,
} as const;

// Never in a value: what could leave the declaration, load anything or run script.
const FORBIDDEN_VALUE =
  /url\(|image-set\(|@|expression|attr\(|env\(|!\s*important|[;{}<>\\]|\/\*|\*\/|javascript:/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/** CSS's named colours, `transparent` and `currentColor` (lower case). */
export const CSS_NAMED_COLORS: ReadonlySet<string> = new Set(
  (
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
    "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow " +
    "yellowgreen transparent currentcolor"
  ).split(" "),
);

/** The generic font families, which a font list may always end with. */
export const GENERIC_FONT_FAMILIES: ReadonlySet<string> = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

/** Families the host ships or its default stacks name, which a theme may use by name. */
export const HOST_FONT_FAMILIES: ReadonlySet<string> = new Set([
  "Geist Mono Variable",
  "JetBrains Mono",
  "Apple Color Emoji",
  "Segoe UI Emoji",
  "Segoe UI Symbol",
  "Noto Color Emoji",
]);

/** A font family name a theme may write (quoted or not). */
export const FONT_FAMILY_NAME = /^[A-Za-z0-9 _-]{1,64}$/;

/**
 * Host variables a value may read besides tokens: Tailwind's spacing step and text sizes,
 * which the density and label defaults are written in. Never Tailwind's colours.
 */
const READABLE_HOST_VARIABLES = /^(?:spacing|text-(?:xs|sm|base|lg|ui))$/;

/** Per-token limits beyond the kind. */
export interface TokenConstraint {
  /** The range a number (or the number of a duration, in ms) must be in. */
  range?: readonly [number, number];
  /** The keywords a `keyword` token takes. */
  keywords?: readonly string[];
  /** A `keyword` token that names a syntax theme ({@link SYNTAX_THEME_NAME}). */
  syntaxTheme?: boolean;
  /** Internal: themes may not set it. */
  internal?: boolean;
  /**
   * The range a length's literal must be in, in px (`rem` and `em` count 16px each, a
   * percentage stays within -100..100 clipped to the range's sign). Default 0..10000.
   */
  lengthRange?: readonly [number, number];
  /** Whether a calc() may multiply by `infinity` (the pill radius). */
  allowInfinity?: boolean;
  /** A length that may size against the window (`vw`, `vh`): the side bars' widths. */
  viewportUnits?: boolean;
  /**
   * A font size: `em` is the parent's font size, which a theme may set too, so an `em`
   * multiplier stays within {@link FONT_SIZE_EM_LIMIT}.
   */
  fontSize?: boolean;
}

/**
 * The values an expression can take (lengths in px, durations in ms): `var()`s at what
 * their tokens resolve to, or at their absolute ranges before resolving.
 */
export interface Interval {
  readonly lo: number;
  readonly hi: number;
  /** Whether it reads a variable or a non-static unit (`em`): its exact value unknown. */
  readonly vars: boolean;
  /** Whether it multiplies by `infinity`. */
  readonly infinite: boolean;
}

function multiply(a: Interval, b: Interval): Interval {
  const products = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
  return {
    lo: Math.min(...products),
    hi: Math.max(...products),
    vars: a.vars || b.vars,
    infinite: a.infinite || b.infinite,
  };
}

const BORDER_STYLES = [
  "none",
  "hidden",
  "solid",
  "dashed",
  "dotted",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
] as const;
const WEIGHT_RANGE = [1, 1000] as const;
/** The default range of a length token, in px. */
export const DEFAULT_LENGTH_RANGE = [0, 10_000] as const;
/** The largest literal a calc() in a value may hold (lengths in px, or plain numbers). */
const MATH_LITERAL_LIMIT = 10_000;
/** A colour channel's numbers and angles (rgb's 255, a hue's degrees, lab's axes). */
const CHANNEL_RANGE = [-1000, 1000] as const;
const GRADIENT_STOP_LIMIT = 32;
const ROW_RANGE = [0, 400] as const;
/**
 * The side bars' widths, in px: no wider than the widest window `vw` is taken at (4000px), so
 * `calc(100vw + 400px)` or `10000px` can't push the chat off the screen.
 */
const SIDE_BAR_WIDTH_RANGE = [0, 4000] as const;
const DURATION_RANGE = [0, 10_000] as const;
const TEXT_SIZE_RANGE = [0, 200] as const;
const TRACKING_RANGE = [-100, 100] as const;
/** The largest `em` multiplier a font size token may use (its parent's size times this). */
const FONT_SIZE_EM_LIMIT = 4;
/**
 * What one `em` can be, in px: the font size where the token is used, not a theme input,
 * so taken at its worst case, up to 4rem (the UI's largest text step).
 */
const EM_PX_RANGE = [0, 64] as const;
/** The bounds of Tailwind's `--spacing` step (0.25rem) and of the text sizes the user's font size sets. */
const SPACING_RANGE = [0, 16] as const;
/** A dimension in the unit calc() compares: px for lengths (16px per rem), ms for durations. */
function unitScale(unit: string): number {
  if (unit === "rem") return 16;
  if (unit === "s") return 1000;
  return 1;
}

/** The kinds whose value has a range checked once the tokens it reads are resolved. */
export const INTERVAL_KINDS: ReadonlySet<ValueKind> = new Set([
  "length",
  "number",
  "duration",
  "percentage",
]);

/**
 * The absolute range of a token of `kind` (lengths in px, durations in ms): what every
 * value it resolves to must lie in, and what a `var()` of it is taken at when unresolved.
 */
export function tokenRange(id: string, kind: ValueKind | undefined): readonly [number, number] {
  const constraint = TOKEN_CONSTRAINTS[id];
  if (kind === "length") return constraint?.lengthRange ?? DEFAULT_LENGTH_RANGE;
  if (kind === "percentage") return [0, 100];
  if (kind === "duration") return constraint?.range ?? DURATION_RANGE;
  if (kind === "alpha") return [0, 100];
  return constraint?.range ?? [-MATH_LITERAL_LIMIT, MATH_LITERAL_LIMIT];
}
// CSS-wide keywords: they would make a token take its parent's or initial value instead of a theme value.
const CSS_WIDE_KEYWORDS = new Set(["initial", "inherit", "unset", "revert", "revert-layer"]);

/** The registry tokens with limits beyond their kind. */
export const TOKEN_CONSTRAINTS: Readonly<Record<string, TokenConstraint>> = {
  "ui-elevation": { range: [0, 1] },
  "ui-radius-pill": { allowInfinity: true },
  "omnigent-elevation": { internal: true },
  "ui-weight-normal": { range: WEIGHT_RANGE },
  "ui-weight-medium": { range: WEIGHT_RANGE },
  "ui-weight-strong": { range: WEIGHT_RANGE },
  "ui-label-weight": { range: WEIGHT_RANGE },
  "ui-view-title-weight": { range: WEIGHT_RANGE },
  "ui-label-transform": { keywords: ["none", "uppercase", "lowercase", "capitalize"] },
  "ui-cta-transform": { keywords: ["none", "uppercase", "lowercase", "capitalize"] },
  "ui-app-name-weight": { range: WEIGHT_RANGE },
  "ui-border-style": { keywords: BORDER_STYLES },
  "ui-divider-style": { keywords: BORDER_STYLES },
  "ui-divider-dashed-style": { keywords: BORDER_STYLES },
  "ui-scrollbar-width": { keywords: ["auto", "thin", "none"] },
  "syntax-theme-light": { syntaxTheme: true },
  "syntax-theme-dark": { syntaxTheme: true },
  "ui-border-width": { lengthRange: [0, 32] },
  "ui-sidebar-width": { viewportUnits: true, lengthRange: SIDE_BAR_WIDTH_RANGE },
  "ui-sidebar-min-width": { viewportUnits: true, lengthRange: SIDE_BAR_WIDTH_RANGE },
  "ui-sidebar-max-width": { viewportUnits: true, lengthRange: SIDE_BAR_WIDTH_RANGE },
  "ui-auxiliarybar-width": { viewportUnits: true, lengthRange: SIDE_BAR_WIDTH_RANGE },
  "ui-auxiliarybar-min-width": { viewportUnits: true, lengthRange: SIDE_BAR_WIDTH_RANGE },
  "ui-auxiliarybar-max-width": { viewportUnits: true, lengthRange: SIDE_BAR_WIDTH_RANGE },
  "ui-activitybar-width": { lengthRange: [0, 200] },
  "ui-titlebar-height": { lengthRange: [0, 200] },
  "ui-scrollbar-size": { lengthRange: [0, 64] },
  "ui-row-line": { lengthRange: ROW_RANGE },
  "ui-row-height": { lengthRange: ROW_RANGE },
  "ui-control-h-xs": { lengthRange: ROW_RANGE },
  "ui-control-h-sm": { lengthRange: ROW_RANGE },
  "ui-control-h-md": { lengthRange: ROW_RANGE },
  "ui-control-h-lg": { lengthRange: ROW_RANGE },
  "ui-header-height": { lengthRange: ROW_RANGE },
  "ui-tabstrip-height": { lengthRange: ROW_RANGE },
  "ui-tabstrip-padding-x": { lengthRange: ROW_RANGE },
  "ui-tabstrip-padding-y": { lengthRange: ROW_RANGE },
  "ui-view-title-height": { lengthRange: ROW_RANGE },
  "ui-view-title-padding-x": { lengthRange: ROW_RANGE },
  "ui-view-title-gap": { lengthRange: ROW_RANGE },
  "ui-label-size": { lengthRange: TEXT_SIZE_RANGE, fontSize: true },
  "ui-view-title-size": { lengthRange: TEXT_SIZE_RANGE, fontSize: true },
  "ui-fold-label-size": { lengthRange: TEXT_SIZE_RANGE, fontSize: true },
  "ui-cta-size": { lengthRange: TEXT_SIZE_RANGE, fontSize: true },
  "ui-app-name-size": { lengthRange: TEXT_SIZE_RANGE, fontSize: true },
  "ui-cta-tracking": { lengthRange: TRACKING_RANGE },
  "ui-app-name-tracking": { lengthRange: TRACKING_RANGE },
  "ui-code-letter-spacing": { lengthRange: TRACKING_RANGE },
  "ui-letter-spacing": { lengthRange: TRACKING_RANGE },
  "ui-label-tracking": { lengthRange: TRACKING_RANGE },
};

/** What a value may refer to, for {@link validateTokenValue}. */
export interface ValueContext {
  /** Whether `var(--<id>)` may be read: a registry token or the extension's own colour. */
  isKnownToken: (id: string) => boolean;
  /**
   * The CSS a font family name becomes (the extension's declared fonts map to their
   * namespaced family), or undefined when the name is not allowed. Generic and
   * host families are allowed without it.
   */
  fontFamily?: (name: string) => string | undefined;
  /** Whether a syntax theme of this name exists (bundled or registered). */
  isSyntaxTheme?: (name: string) => boolean;
}

/** A checked value: the host's own serialization, and the tokens it reads. */
export type ValueResult =
  { ok: true; value: string; references: readonly string[] } | { ok: false; reason: string };

type CssNode =
  | { type: "ident"; value: string }
  | { type: "number"; value: number; unit: string }
  | { type: "hash"; value: string }
  | { type: "string"; value: string }
  | { type: "function"; name: string; args: CssNode[] }
  | { type: "group"; args: CssNode[] }
  | { type: "comma" }
  | { type: "slash" }
  | { type: "op"; value: "+" | "-" | "*" };

class ValueError extends Error {}

function fail(reason: string): never {
  throw new ValueError(reason);
}

const NUMBER_TOKEN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i;
const IDENT_TOKEN = /^-{0,2}[A-Za-z_][A-Za-z0-9_-]*/;
const UNIT_TOKEN = /^(?:%|[A-Za-z]+)/;

/** Tokenizes and nests a value; anything outside the small grammar fails. */
function parseValue(text: string): CssNode[] {
  let index = 0;
  const parseList = (depth: number, closing: boolean): CssNode[] => {
    if (depth > THEME_LIMITS.functionDepth) fail("nested too deeply");
    const nodes: CssNode[] = [];
    while (index < text.length) {
      const rest = text.slice(index);
      const char = rest[0]!;
      if (/\s/.test(char)) {
        index += 1;
        continue;
      }
      if (char === ")") {
        if (!closing) fail("unbalanced )");
        index += 1;
        return nodes;
      }
      if (char === "(") {
        index += 1;
        nodes.push({ type: "group", args: parseList(depth + 1, true) });
        continue;
      }
      if (char === ",") {
        nodes.push({ type: "comma" });
        index += 1;
        continue;
      }
      if (char === "/") {
        nodes.push({ type: "slash" });
        index += 1;
        continue;
      }
      if (char === "#") {
        const hex = /^#[0-9a-fA-F]+/.exec(rest)?.[0];
        if (!hex || !HEX_COLOR.test(hex)) fail(`invalid hex colour ${rest.slice(0, 10)}`);
        nodes.push({ type: "hash", value: hex.toLowerCase() });
        index += hex.length;
        continue;
      }
      if (char === '"' || char === "'") {
        const end = text.indexOf(char, index + 1);
        if (end < 0) fail("unterminated string");
        nodes.push({ type: "string", value: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
      const number = NUMBER_TOKEN.exec(rest)?.[0];
      if (number && !(char === "+" && /^\+\s/.test(rest))) {
        index += number.length;
        const unit = UNIT_TOKEN.exec(text.slice(index))?.[0] ?? "";
        index += unit.length;
        const value = Number(number);
        if (!Number.isFinite(value)) fail("not a finite number");
        nodes.push({ type: "number", value, unit: unit.toLowerCase() });
        continue;
      }
      const ident = IDENT_TOKEN.exec(rest)?.[0];
      if (ident) {
        index += ident.length;
        if (text[index] === "(") {
          index += 1;
          nodes.push({
            type: "function",
            name: ident.toLowerCase(),
            args: parseList(depth + 1, true),
          });
        } else {
          nodes.push({ type: "ident", value: ident });
        }
        continue;
      }
      if (char === "+" || char === "-" || char === "*") {
        nodes.push({ type: "op", value: char });
        index += 1;
        continue;
      }
      fail(`unexpected ${JSON.stringify(char)}`);
    }
    if (closing) fail("unbalanced (");
    return nodes;
  };
  return parseList(0, false);
}

function formatNumber(value: number): string {
  return String(Number(value.toPrecision(12)));
}

/** Writes nodes back out: the host's own text, never the theme's. */
function serialize(nodes: readonly CssNode[]): string {
  let out = "";
  nodes.forEach((node, position) => {
    const previous = nodes[position - 1];
    const separated =
      position > 0 && node.type !== "comma" && previous?.type !== "comma" ? " " : "";
    switch (node.type) {
      case "ident":
        out += separated + node.value;
        break;
      case "number":
        out += separated + formatNumber(node.value) + node.unit;
        break;
      case "hash":
        out += separated + node.value;
        break;
      case "string":
        out += `${separated}"${node.value}"`;
        break;
      case "function":
        out += `${separated}${node.name}(${serialize(node.args)})`;
        break;
      case "group":
        out += `${separated}(${serialize(node.args)})`;
        break;
      case "comma":
        out += ", ";
        break;
      case "slash":
        out += `${separated}/`;
        break;
      case "op":
        out += `${separated}${node.value}`;
        break;
    }
  });
  return out.replace(/, $/, ",");
}

/** Splits nodes on top-level commas. */
function splitCommas(nodes: readonly CssNode[]): CssNode[][] {
  const parts: CssNode[][] = [[]];
  for (const node of nodes) {
    if (node.type === "comma") parts.push([]);
    else parts[parts.length - 1]!.push(node);
  }
  return parts;
}

const COLOR_FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
]);
const COLOR_SPACES = new Set([
  "srgb",
  "srgb-linear",
  "display-p3",
  "a98-rgb",
  "prophoto-rgb",
  "rec2020",
  "xyz",
  "xyz-d50",
  "xyz-d65",
  "lab",
  "oklab",
  "lch",
  "oklch",
  "hsl",
  "hwb",
]);
const HUE_METHODS = new Set(["shorter", "longer", "increasing", "decreasing"]);
const CHANNEL_KEYWORDS = new Set([
  "none",
  "r",
  "g",
  "b",
  "h",
  "s",
  "l",
  "w",
  "c",
  "a",
  "x",
  "y",
  "z",
  "alpha",
]);
const ANGLE_UNITS = new Set(["deg", "rad", "grad", "turn"]);
const LENGTH_UNITS = new Set(["px", "rem", "em", "%"]);
/** Viewport units, for the layout tokens that size against the window (`50vw`). */
const VIEWPORT_UNITS = new Set(["vw", "vh"]);
/** A window-sized length: no `%`, which would resolve against the probe's container. */
const VIEWPORT_LENGTH_UNITS = new Set(["px", "rem", "em", ...VIEWPORT_UNITS]);
/** The px a `1vw` or `1vh` can be: a viewport of up to 4000px. */
const VIEWPORT_UNIT_PX: readonly [number, number] = [0, 40];
const MATH_FUNCTIONS = new Set(["calc", "min", "max", "clamp"]);
const GRADIENTS = new Set([
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "repeating-conic-gradient",
]);
const GRADIENT_KEYWORDS = new Set([
  "to",
  "at",
  "in",
  "from",
  "left",
  "right",
  "top",
  "bottom",
  "center",
  "circle",
  "ellipse",
  "closest-side",
  "closest-corner",
  "farthest-side",
  "farthest-corner",
  ...COLOR_SPACES,
  ...HUE_METHODS,
  "hue",
]);
const EASING_KEYWORDS = new Set([
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
]);
const STEP_POSITIONS = new Set([
  "jump-start",
  "jump-end",
  "jump-none",
  "jump-both",
  "start",
  "end",
]);

/** Fails unless `interval` lies in `range` (a pill's infinity counted as 1). */
function checkRange(interval: Interval, range: readonly [number, number], what: string): void {
  if (interval.lo < range[0] - 1e-9 || interval.hi > range[1] + 1e-9) {
    fail(
      `${what} can reach ${formatNumber(interval.lo)}..${formatNumber(interval.hi)}, outside ${formatNumber(range[0])}..${formatNumber(range[1])}`,
    );
  }
}

/** Checks one kind's grammar over parsed nodes, collecting `var()` references. */
class ValueChecker {
  readonly references: string[] = [];
  private readonly context: ValueContext;
  private readonly constraint: TokenConstraint;
  private readonly bounds: ((id: string) => Interval | undefined) | undefined;
  private readonly deferRanges: boolean;
  /**
   * `bounds`: what each token read resolves to (resolve time), or undefined to check the
   * syntax only and take a token read at its absolute range. `deferRanges`: a math
   * expression that reads tokens is checked against its range at resolve time only.
   */
  constructor(
    context: ValueContext,
    constraint: TokenConstraint,
    bounds?: (id: string) => Interval | undefined,
    deferRanges = false,
  ) {
    this.context = context;
    this.constraint = constraint;
    this.bounds = bounds;
    this.deferRanges = deferRanges && bounds === undefined;
  }

  /** `var(--id[, fallback])`: a known token, or a readable host variable. */
  private variable(node: CssNode, fallback?: (nodes: CssNode[]) => void): boolean {
    if (node.type !== "function" || node.name !== "var") return false;
    const [name, comma, ...rest] = node.args;
    if (name?.type !== "ident" || !name.value.startsWith("--")) fail("var() needs a --name");
    const id = name.value.slice(2);
    if (!READABLE_HOST_VARIABLES.test(id)) {
      if (!this.context.isKnownToken(id)) fail(`var(--${id}) is not a token`);
      this.references.push(id);
    }
    if (comma !== undefined) {
      if (comma.type !== "comma" || rest.length === 0) fail("var() fallback is malformed");
      if (!fallback) fail("var() takes no fallback here");
      fallback(rest);
    }
    return true;
  }

  private single(nodes: readonly CssNode[], what: string): CssNode {
    if (nodes.length !== 1) fail(`expected one ${what}`);
    return nodes[0]!;
  }

  /**
   * The values `var(--id)` can hold: what the token resolved to, else its absolute range
   * ({@link tokenRange}), which resolving guarantees. Tailwind's spacing step and the text
   * sizes (the user's font size setting) are not theme inputs: their worst case.
   */
  private variableBound(id: string): Interval {
    if (id === "spacing")
      return { lo: SPACING_RANGE[0], hi: SPACING_RANGE[1], vars: true, infinite: false };
    if (/^text-/.test(id)) return { lo: 0, hi: TEXT_SIZE_RANGE[1], vars: true, infinite: false };
    const resolved = this.bounds?.(id);
    if (resolved) return { ...resolved, vars: true };
    const constraint = TOKEN_CONSTRAINTS[id];
    const [lo, hi] = constraint?.lengthRange ??
      constraint?.range ?? [-MATH_LITERAL_LIMIT, MATH_LITERAL_LIMIT];
    return { lo, hi, vars: true, infinite: false };
  }

  /** A literal's interval: px for lengths, ms for durations; an `em` at its worst case. */
  private literal(node: Extract<CssNode, { type: "number" }>): Interval {
    if (VIEWPORT_UNITS.has(node.unit)) {
      const ends = [node.value * VIEWPORT_UNIT_PX[0], node.value * VIEWPORT_UNIT_PX[1]];
      return { lo: Math.min(...ends), hi: Math.max(...ends), vars: true, infinite: false };
    }
    if (node.unit === "em") {
      const ends = [node.value * EM_PX_RANGE[0], node.value * EM_PX_RANGE[1]];
      return { lo: Math.min(...ends), hi: Math.max(...ends), vars: true, infinite: false };
    }
    const value = node.value * unitScale(node.unit);
    return { lo: value, hi: value, vars: false, infinite: false };
  }

  /** One operand of a math expression, as the interval of values it can take. */
  private mathOperand(node: CssNode, units: ReadonlySet<string>): Interval {
    if (node.type === "number") {
      if (node.unit !== "" && !units.has(node.unit)) fail(`unit ${node.unit} not allowed`);
      this.checkEm(node);
      const value = node.value * (node.unit === "em" ? 16 : unitScale(node.unit));
      if (Math.abs(value) > MATH_LITERAL_LIMIT) {
        fail(`${formatNumber(node.value)}${node.unit} is too large for calc()`);
      }
      return this.literal(node);
    }
    if (node.type === "ident" && /^-?infinity$/i.test(node.value)) {
      // `calc(var(--ui-radius-base) * infinity)`, the pill radius; nowhere else.
      if (!this.constraint.allowInfinity) fail("infinity is not allowed here");
      return { lo: 1, hi: 1, vars: false, infinite: true };
    }
    if (node.type === "group") return this.math(node.args, units);
    if (node.type === "function" && MATH_FUNCTIONS.has(node.name)) {
      return this.mathFunction(node, units);
    }
    const before = this.references.length;
    if (!this.variable(node)) fail("calc() takes numbers, lengths and var()");
    const id = this.references[before];
    if (id !== undefined) return this.variableBound(id);
    // A readable host variable (Tailwind's spacing or a text size).
    const [name] = node.type === "function" ? node.args : [];
    return this.variableBound(name?.type === "ident" ? name.value.slice(2) : "");
  }

  /**
   * A math expression: operands (numbers, dimensions, var(), nested math) and operators,
   * evaluated as an interval (`*` and `/` before `+` and `-`), so its result is bounded.
   * Division is by a number range that excludes zero only.
   */
  private math(nodes: readonly CssNode[], units: ReadonlySet<string>): Interval {
    if (nodes.length === 0) fail("empty calc()");
    const terms: { sign: 1 | -1; value: Interval }[] = [];
    let sign: 1 | -1 = 1;
    let product: Interval | undefined;
    let pending: "*" | "/" | undefined;
    let expectOperand = true;
    const finishTerm = () => {
      if (product) terms.push({ sign, value: product });
      product = undefined;
    };
    for (const node of nodes) {
      if (expectOperand) {
        const value = this.mathOperand(node, units);
        if (!product) product = value;
        else if (pending === "*") product = multiply(product, value);
        else {
          if (value.infinite) fail("calc() divides only by a finite number");
          if (value.lo <= 0 && value.hi >= 0) fail("calc() divides only by a non-zero number");
          product = multiply(product, {
            lo: 1 / value.hi,
            hi: 1 / value.lo,
            vars: value.vars,
            infinite: false,
          });
        }
        expectOperand = false;
        continue;
      }
      if (node.type === "slash") pending = "/";
      else if (node.type === "op" && node.value === "*") pending = "*";
      else if (node.type === "op") {
        finishTerm();
        sign = node.value === "-" ? -1 : 1;
        pending = undefined;
      } else fail("calc() needs an operator");
      expectOperand = true;
    }
    if (expectOperand) fail("calc() ends with an operator");
    finishTerm();
    return terms.reduce<Interval>(
      (sum, term) => ({
        lo: sum.lo + (term.sign === 1 ? term.value.lo : -term.value.hi),
        hi: sum.hi + (term.sign === 1 ? term.value.hi : -term.value.lo),
        vars: sum.vars || term.value.vars,
        infinite: sum.infinite || term.value.infinite,
      }),
      { lo: 0, hi: 0, vars: false, infinite: false },
    );
  }

  private mathFunction(
    node: Extract<CssNode, { type: "function" }>,
    units: ReadonlySet<string>,
  ): Interval {
    const parts = splitCommas(node.args);
    if (node.name === "calc" ? parts.length !== 1 : parts.length < 1 || parts.length > 3) {
      fail(`${node.name}() takes the wrong number of arguments`);
    }
    // min(), max() and clamp() lie within the hull of their arguments.
    return parts
      .map((part) => this.math(part, units))
      .reduce((hull, value) => ({
        lo: Math.min(hull.lo, value.lo),
        hi: Math.max(hull.hi, value.hi),
        vars: hull.vars || value.vars,
        infinite: hull.infinite || value.infinite,
      }));
  }

  /**
   * A math function whose result must lie in `range`, with every token it reads at what it
   * resolved to (no widening), never beyond the calc() cap. Before resolving, one that
   * reads tokens is checked for its syntax only when its kind's range waits for resolving
   * (`deferRanges`), else at the tokens' absolute ranges. Infinity only where the token
   * allows it, its other operands bounded.
   */
  private boundedMath(
    node: Extract<CssNode, { type: "function" }>,
    units: ReadonlySet<string>,
    range: readonly [number, number] = [-MATH_LITERAL_LIMIT, MATH_LITERAL_LIMIT],
  ): Interval {
    // An `infinity` factor counts as 1 here, so the pill's other operands are bounded too.
    const result = this.mathFunction(node, units);
    if (!Number.isFinite(result.lo) || !Number.isFinite(result.hi)) fail("calc() is not finite");
    if (result.vars && this.deferRanges) return result;
    checkRange(result, range, node.name);
    return result;
  }

  /** A font size's `em` multiplier stays within {@link FONT_SIZE_EM_LIMIT}. */
  private checkEm(node: Extract<CssNode, { type: "number" }>): void {
    if (
      this.constraint.fontSize &&
      node.unit === "em" &&
      Math.abs(node.value) > FONT_SIZE_EM_LIMIT
    ) {
      fail(`${formatNumber(node.value)}em is more than ${FONT_SIZE_EM_LIMIT}em`);
    }
  }

  /** A number, dimension or math in `units` (and unitless). */
  private numeric(node: CssNode, units: ReadonlySet<string>, range?: readonly [number, number]) {
    if (node.type === "number") {
      if (node.unit !== "" && !units.has(node.unit))
        fail(`unit ${node.unit || "none"} not allowed`);
      if (range && (node.value < range[0] || node.value > range[1])) {
        fail(`${formatNumber(node.value)} is outside ${range[0]}..${range[1]}`);
      }
      return;
    }
    if (node.type === "function" && MATH_FUNCTIONS.has(node.name)) {
      this.boundedMath(node, units, range);
      return;
    }
    if (!this.variable(node)) fail("expected a number");
  }

  color(nodes: readonly CssNode[], depth = 0): void {
    const node = this.single(nodes, "colour");
    if (node.type === "hash") return;
    if (node.type === "ident") {
      if (!CSS_NAMED_COLORS.has(node.value.toLowerCase())) fail(`${node.value} is not a colour`);
      return;
    }
    if (node.type !== "function") fail("expected a colour");
    if (this.variable(node, (fallback) => this.color(fallback, depth))) return;
    if (COLOR_FUNCTIONS.has(node.name)) return this.colorFunction(node.args, depth);
    if (node.name === "color") {
      const [space, ...rest] = node.args;
      if (space?.type !== "ident" || !COLOR_SPACES.has(space.value.toLowerCase())) {
        fail("color() needs a colour space");
      }
      return this.channels(rest, 3);
    }
    if (node.name === "light-dark") {
      const parts = splitCommas(node.args);
      if (parts.length !== 2) fail("light-dark() takes two colours");
      for (const part of parts) this.color(part, depth);
      return;
    }
    if (node.name === "color-mix") {
      if (depth + 1 > THEME_LIMITS.colorMixDepth) fail("color-mix() nested too deeply");
      const [method, ...colors] = splitCommas(node.args);
      const [inWord, space, hue, hueWord, ...extra] = method ?? [];
      if (inWord?.type !== "ident" || inWord.value !== "in") fail("color-mix() needs in <space>");
      if (space?.type !== "ident" || !COLOR_SPACES.has(space.value.toLowerCase())) {
        fail("color-mix() needs a colour space");
      }
      if (hue !== undefined) {
        const valid =
          hue.type === "ident" &&
          HUE_METHODS.has(hue.value) &&
          hueWord?.type === "ident" &&
          hueWord.value === "hue" &&
          extra.length === 0;
        if (!valid) fail("color-mix() interpolation is malformed");
      }
      if (colors.length !== 2) fail("color-mix() takes two colours");
      for (const part of colors) {
        const percentages = part.filter((item) => item.type === "number");
        const rest = part.filter((item) => item.type !== "number");
        if (percentages.length > 1) fail("color-mix() takes one percentage per colour");
        for (const percentage of percentages) this.numeric(percentage, new Set(["%"]), [0, 100]);
        this.color(rest, depth + 1);
      }
      return;
    }
    fail(`${node.name}() is not a colour function`);
  }

  private colorFunction(args: readonly CssNode[], depth: number): void {
    const [first, origin, ...rest] = args;
    if (first?.type === "ident" && first.value.toLowerCase() === "from") {
      if (origin === undefined) fail("relative colour needs an origin");
      this.color([origin], depth);
      return this.channels(rest, 3);
    }
    return this.channels(args, 3);
  }

  /** Colour channels: `count` values (commas or spaces), then an optional `/ alpha`. */
  private channels(nodes: readonly CssNode[], count: number): void {
    const values = nodes.filter((node) => node.type !== "comma");
    const slash = values.findIndex((node) => node.type === "slash");
    const channelNodes = slash < 0 ? values : values.slice(0, slash);
    const alpha = slash < 0 ? [] : values.slice(slash + 1);
    const legacyAlpha = slash < 0 && channelNodes.length === count + 1;
    if (channelNodes.length !== count && !legacyAlpha) fail(`expected ${count} channels`);
    if (slash >= 0 && alpha.length !== 1) fail("expected one alpha after /");
    const units = new Set(["%", ...ANGLE_UNITS]);
    for (const node of channelNodes) {
      if (node.type === "ident" && CHANNEL_KEYWORDS.has(node.value.toLowerCase())) continue;
      this.numeric(
        node,
        units,
        node.type === "number" && node.unit === "%" ? [-100, 100] : CHANNEL_RANGE,
      );
    }
    for (const node of alpha) {
      if (node.type === "ident" && CHANNEL_KEYWORDS.has(node.value.toLowerCase())) continue;
      this.numeric(
        node,
        new Set(["%"]),
        node.type === "number" && node.unit === "" ? [0, 1] : [0, 100],
      );
    }
  }

  length(
    nodes: readonly CssNode[],
    range: readonly [number, number] = this.constraint.lengthRange ?? DEFAULT_LENGTH_RANGE,
  ): void {
    const node = this.single(nodes, "length");
    if (node.type === "number" && node.unit === "" && node.value !== 0) {
      fail("a length needs a unit (px, rem, em or %)");
    }
    const units = this.constraint.viewportUnits ? VIEWPORT_LENGTH_UNITS : LENGTH_UNITS;
    if (node.type === "function" && MATH_FUNCTIONS.has(node.name)) {
      this.boundedMath(node, units, range);
      return;
    }
    this.numeric(node, units);
    if (node.type !== "number") return;
    const [min, max] = range;
    if (VIEWPORT_UNITS.has(node.unit)) {
      if (node.value < 0 || node.value > 100) {
        fail(`${formatNumber(node.value)}${node.unit} is outside 0..100${node.unit}`);
      }
      return;
    }
    if (node.unit === "%") {
      if (
        node.value < Math.max(min, -100) ||
        node.value > Math.min(max, 100) ||
        (min >= 0 && node.value < 0)
      ) {
        fail(`${formatNumber(node.value)}% is outside ${min < 0 ? -100 : 0}..100%`);
      }
      return;
    }
    this.checkEm(node);
    const literal = this.literal(node);
    if (literal.lo < min || literal.hi > max) {
      const reach = node.unit === "em" ? ` (an em up to ${EM_PX_RANGE[1]}px)` : "";
      fail(`${formatNumber(node.value)}${node.unit} is outside ${min}..${max}px${reach}`);
    }
  }

  /**
   * The interval a value of an {@link INTERVAL_KINDS} kind takes, with the tokens it reads
   * at their {@link bounds}: a literal, a `var()` or a math function (already checked).
   */
  valueInterval(nodes: readonly CssNode[], units: ReadonlySet<string>): Interval {
    const node = this.single(nodes, "value");
    if (node.type === "number") return this.literal(node);
    if (node.type === "function" && MATH_FUNCTIONS.has(node.name)) {
      return this.mathFunction(node, units);
    }
    return this.mathOperand(node, units);
  }

  number(nodes: readonly CssNode[]): void {
    this.numeric(this.single(nodes, "number"), new Set(), this.constraint.range);
  }

  alpha(nodes: readonly CssNode[]): void {
    const node = this.single(nodes, "alpha");
    if (node.type === "number") {
      this.numeric(node, new Set(["%"]), node.unit === "%" ? [0, 100] : [0, 1]);
      return;
    }
    this.numeric(node, new Set(["%"]));
  }

  percentage(nodes: readonly CssNode[]): void {
    const node = this.single(nodes, "percentage");
    if (node.type === "number" && node.unit !== "%") fail("expected a percentage");
    this.numeric(node, new Set(["%"]), node.type === "number" ? [0, 100] : undefined);
  }

  channelTriple(nodes: readonly CssNode[]): void {
    if (nodes.length === 1 && this.variable(nodes[0]!)) return;
    if (nodes.length !== 3) fail("expected three channels (R G B)");
    for (const node of nodes) {
      if (node.type !== "number" || node.unit !== "") fail("channels are plain numbers");
      this.numeric(node, new Set(), [0, 255]);
    }
  }

  duration(nodes: readonly CssNode[]): void {
    const node = this.single(nodes, "duration");
    if (node.type === "number") {
      const ms = node.unit === "s" ? node.value * 1000 : node.value;
      if (node.unit !== "ms" && node.unit !== "s" && !(node.unit === "" && node.value === 0)) {
        fail("a duration needs ms or s");
      }
      const [min, max] = this.constraint.range ?? DURATION_RANGE;
      if (ms < min || ms > max) fail(`duration outside ${min}..${max}ms`);
      return;
    }
    // In ms (`s` scales by 1000), within the duration range.
    this.numeric(node, new Set(["ms", "s"]), this.constraint.range ?? DURATION_RANGE);
  }

  easing(nodes: readonly CssNode[]): void {
    const node = this.single(nodes, "easing");
    if (node.type === "ident") {
      if (!EASING_KEYWORDS.has(node.value)) fail(`${node.value} is not an easing`);
      return;
    }
    if (this.variable(node)) return;
    if (node.type !== "function") fail("expected an easing");
    if (node.name === "cubic-bezier") {
      const parts = splitCommas(node.args);
      if (parts.length !== 4) fail("cubic-bezier() takes four numbers");
      parts.forEach((part, index) =>
        this.numeric(this.single(part, "number"), new Set(), index % 2 === 0 ? [0, 1] : [-10, 10]),
      );
      return;
    }
    if (node.name === "steps") {
      const [count, position, ...extra] = splitCommas(node.args);
      const steps = count?.length === 1 ? count[0] : undefined;
      if (steps?.type !== "number" || steps.unit !== "" || !Number.isInteger(steps.value)) {
        fail("steps() needs a whole number");
      }
      if (steps.value < 1 || steps.value > 1000) fail("steps() outside 1..1000");
      if (position !== undefined) {
        const word = position.length === 1 ? position[0] : undefined;
        if (word?.type !== "ident" || !STEP_POSITIONS.has(word.value)) fail("steps() position");
      }
      if (extra.length > 0) fail("steps() takes at most two arguments");
      return;
    }
    fail(`${node.name}() is not an easing`);
  }

  keyword(nodes: readonly CssNode[]): void {
    const node = this.single(nodes, "keyword");
    if (this.variable(node)) return;
    if (node.type !== "ident") fail("expected a keyword");
    if (this.constraint.syntaxTheme) {
      if (!SYNTAX_THEME_NAME.test(node.value)) fail(`${node.value} is not a syntax theme name`);
      if (this.context.isSyntaxTheme && !this.context.isSyntaxTheme(node.value)) {
        fail(`no syntax theme named ${node.value}`);
      }
      return;
    }
    const keywords = this.constraint.keywords;
    if (keywords && !keywords.includes(node.value)) {
      fail(`${node.value} is not one of ${keywords.join(", ")}`);
    }
    if (!keywords && !/^[a-z][a-z0-9-]{0,63}$/.test(node.value)) fail("not a keyword");
  }

  /** A font family list; names are rewritten to what the context maps them to. */
  font(nodes: readonly CssNode[]): CssNode[] {
    const out: CssNode[] = [];
    splitCommas(nodes).forEach((family, index) => {
      if (index > 0) out.push({ type: "comma" });
      if (family.length === 0) fail("empty font family");
      const [first] = family;
      if (family.length === 1 && first?.type === "function") {
        // The name as written, not the last reference: a host variable records none.
        const [name] = first.name === "var" ? first.args : [];
        const id = name?.type === "ident" ? name.value.replace(/^--/, "") : "";
        if (!/^ui-font-[a-z0-9-]+$/.test(id))
          fail("a font list may read only the ui-font-* tokens");
        if (!this.variable(first)) fail("a font list takes names and var()");
        out.push(first);
        return;
      }
      let name: string;
      if (family.length === 1 && first?.type === "string") name = first.value;
      else if (family.every((part) => part.type === "ident")) {
        name = family.map((part) => (part as { value: string }).value).join(" ");
      } else fail("a font family is a name or a quoted name");
      if (family.length === 1 && first?.type === "ident" && GENERIC_FONT_FAMILIES.has(name)) {
        out.push(first);
        return;
      }
      if (!FONT_FAMILY_NAME.test(name)) fail(`font family ${JSON.stringify(name)} is malformed`);
      const mapped = this.context.fontFamily?.(name);
      if (mapped !== undefined) {
        out.push({ type: "string", value: mapped });
        return;
      }
      if (!HOST_FONT_FAMILIES.has(name)) {
        fail(`font family ${name} is neither generic, the host's nor the extension's`);
      }
      out.push({ type: "string", value: name });
    });
    return out;
  }

  shadow(nodes: readonly CssNode[]): void {
    if (nodes.length === 1 && nodes[0]!.type === "ident" && nodes[0].value === "none") return;
    for (const layer of splitCommas(nodes)) {
      if (layer.length === 1 && this.variable(layer[0]!)) continue;
      let lengths = 0;
      let colors = 0;
      layer.forEach((node, position) => {
        if (node.type === "ident" && node.value === "inset") {
          if (position !== 0 && position !== layer.length - 1) fail("inset goes first or last");
          return;
        }
        const isLength =
          node.type === "number" ||
          (node.type === "function" && (MATH_FUNCTIONS.has(node.name) || node.name === "var"));
        if (isLength && lengths < 4 && colors === 0) {
          // Offsets may be negative; blur and spread stay in the same bounds.
          if (node.type === "number") this.length([node], [-10_000, 10_000]);
          else if (node.type === "function" && node.name === "var") this.variable(node);
          else this.numeric(node, LENGTH_UNITS);
          lengths += 1;
          return;
        }
        colors += 1;
        if (colors > 1) fail("a shadow takes one colour");
        this.color([node]);
      });
      if (lengths < 2) fail("a shadow needs at least two lengths");
    }
  }

  image(nodes: readonly CssNode[]): void {
    if (nodes.length === 1 && nodes[0]!.type === "ident" && nodes[0].value === "none") return;
    for (const layer of splitCommas(nodes)) {
      const node = this.single(layer, "image");
      if (node.type === "function" && GRADIENTS.has(node.name)) {
        this.gradient(node.args);
        continue;
      }
      this.color([node]);
    }
  }

  private gradient(args: readonly CssNode[]): void {
    const parts = splitCommas(args);
    if (parts.length > GRADIENT_STOP_LIMIT)
      fail(`a gradient takes at most ${GRADIENT_STOP_LIMIT} stops`);
    for (const part of parts) {
      if (part.length === 0) fail("empty gradient argument");
      for (const node of part) {
        if (node.type === "ident" && GRADIENT_KEYWORDS.has(node.value.toLowerCase())) continue;
        if (node.type === "number") {
          if (node.unit !== "" && !LENGTH_UNITS.has(node.unit) && !ANGLE_UNITS.has(node.unit)) {
            fail(`unit ${node.unit} not allowed in a gradient`);
          }
          const scale = node.unit === "rem" || node.unit === "em" ? 16 : 1;
          const limit = node.unit === "%" ? 1000 : MATH_LITERAL_LIMIT;
          if (Math.abs(node.value * scale) > limit) {
            fail(`${formatNumber(node.value)}${node.unit} is out of range in a gradient`);
          }
          continue;
        }
        if (node.type === "function" && MATH_FUNCTIONS.has(node.name)) {
          this.boundedMath(node, new Set([...LENGTH_UNITS, ...ANGLE_UNITS]));
          continue;
        }
        this.color([node]);
      }
    }
  }
}

/** Fails on `initial`, `inherit`, `unset`, `revert` or `revert-layer` anywhere in a value. */
function rejectCssWideKeywords(nodes: readonly CssNode[]): void {
  for (const node of nodes) {
    if (node.type === "ident" && CSS_WIDE_KEYWORDS.has(node.value.toLowerCase())) {
      fail(`${node.value} is not a theme value`);
    }
    if (node.type === "function" || node.type === "group") rejectCssWideKeywords(node.args);
  }
}

/**
 * Checks a theme's value for a token of `kind` and writes it back out in the host's own
 * syntax: dangerous text (`url(`, `@`, `;`, braces, comments, `!important`, ...),
 * values over {@link THEME_LIMITS}.valueLength, `var()` of anything but a known token
 * and values outside the kind's grammar or the token's {@link TokenConstraint} fail.
 *
 * @returns The value as the host writes it and the tokens it reads, or why it failed.
 */
export function validateTokenValue(
  kind: ValueKind,
  value: unknown,
  context: ValueContext,
  constraint: TokenConstraint = {},
): ValueResult {
  if (typeof value !== "string") return { ok: false, reason: "not a string" };
  if (value.length > THEME_LIMITS.valueLength) {
    return { ok: false, reason: `longer than ${THEME_LIMITS.valueLength} characters` };
  }
  if (constraint.internal) return { ok: false, reason: "internal, not themable" };
  if (CONTROL_CHARACTER.test(value)) return { ok: false, reason: "control characters" };
  const forbidden = FORBIDDEN_VALUE.exec(value);
  if (forbidden) return { ok: false, reason: `${JSON.stringify(forbidden[0])} is not allowed` };
  if (value.trim() === "") return { ok: false, reason: "empty" };
  try {
    const nodes = parseValue(value);
    rejectCssWideKeywords(nodes);
    const checker = new ValueChecker(context, constraint, undefined, INTERVAL_KINDS.has(kind));
    let output = nodes;
    switch (kind) {
      case "color":
        checker.color(nodes);
        break;
      case "image":
        checker.image(nodes);
        break;
      case "channels":
        checker.channelTriple(nodes);
        break;
      case "length":
        checker.length(nodes);
        break;
      case "number":
        checker.number(nodes);
        break;
      case "percentage":
        checker.percentage(nodes);
        break;
      case "alpha":
        checker.alpha(nodes);
        break;
      case "font":
        output = checker.font(nodes);
        break;
      case "shadow":
        checker.shadow(nodes);
        break;
      case "keyword":
        checker.keyword(nodes);
        break;
      case "duration":
        checker.duration(nodes);
        break;
      case "easing":
        checker.easing(nodes);
        break;
    }
    return { ok: true, value: serialize(output), references: [...new Set(checker.references)] };
  } catch (error) {
    if (error instanceof ValueError) return { ok: false, reason: error.message };
    throw error;
  }
}

/** A resolved value's interval, or why it leaves its token's range. */
export type MeasureResult = { ok: true; interval: Interval } | { ok: false; reason: string };

const INTERVAL_UNITS: Readonly<Partial<Record<ValueKind, ReadonlySet<string>>>> = {
  length: LENGTH_UNITS,
  number: new Set(),
  duration: new Set(["ms", "s"]),
  percentage: new Set(["%"]),
};

/**
 * Checks a value of an {@link INTERVAL_KINDS} kind once the tokens it reads are resolved
 * (`bounds`: each one's interval, undefined for its absolute range): every math function
 * in it against its range, and the whole against the token's absolute range
 * ({@link tokenRange}) and the calc() cap, without widening. `value` is one
 * {@link validateTokenValue} accepted (or a registry default).
 *
 * @returns The value's interval, for the tokens that read it.
 */
export function measureTokenValue(
  id: string,
  kind: ValueKind,
  value: string,
  bounds: (id: string) => Interval | undefined,
  check = true,
): MeasureResult {
  const constraint = TOKEN_CONSTRAINTS[id] ?? {};
  const units =
    kind === "length" && constraint.viewportUnits ? VIEWPORT_LENGTH_UNITS : INTERVAL_UNITS[kind];
  if (!units) return { ok: false, reason: `${kind} has no interval` };
  try {
    const nodes = parseValue(value);
    // `check` false (a registry default, trusted): its interval only, for its readers.
    const checker = new ValueChecker({ isKnownToken: () => true }, constraint, bounds);
    switch (check ? kind : undefined) {
      case "length":
        checker.length(nodes);
        break;
      case "number":
        checker.number(nodes);
        break;
      case "duration":
        checker.duration(nodes);
        break;
      case "percentage":
        checker.percentage(nodes);
        break;
    }
    const interval = checker.valueInterval(nodes, units);
    if (!check) {
      return {
        ok: true,
        interval: interval.infinite ? { ...interval, hi: Number.POSITIVE_INFINITY } : interval,
      };
    }
    if (interval.infinite && !constraint.allowInfinity) fail("infinity is not allowed here");
    const range = tokenRange(id, kind);
    const limit: readonly [number, number] = [
      Math.max(range[0], -MATH_LITERAL_LIMIT),
      Math.min(range[1], MATH_LITERAL_LIMIT),
    ];
    checkRange(interval, limit, `--${id}`);
    // Read through a var(), an infinite value (the pill) is unbounded.
    return {
      ok: true,
      interval: interval.infinite ? { ...interval, hi: Number.POSITIVE_INFINITY } : interval,
    };
  } catch (error) {
    if (error instanceof ValueError) return { ok: false, reason: error.message };
    throw error;
  }
}

/**
 * The ids in `graph` (id to the ids its value reads) that are on a reference cycle, a
 * token reading itself included. CSS makes every token on a cycle invalid.
 */
export function referenceCycles(graph: ReadonlyMap<string, readonly string[]>): Set<string> {
  return new Set(cycleComponents(graph).keys());
}

/**
 * The ids in `graph` that are on a reference cycle, each to the index of its strongly
 * connected component: two ids share an index when each reaches the other.
 */
export function cycleComponents(
  graph: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
  // Tarjan's strongly connected components: a component of two or more, or a self-loop.
  const onCycle = new Map<string, number>();
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  let counter = 0;
  let components = 0;
  const connect = (id: string): void => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);
    for (const next of graph.get(id) ?? []) {
      if (!index.has(next)) {
        connect(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id)!, index.get(next)!));
      }
    }
    if (low.get(id) !== index.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    if (component.length > 1 || (graph.get(id) ?? []).includes(id)) {
      for (const entry of component) onCycle.set(entry, components);
      components += 1;
    }
  };
  for (const id of graph.keys()) if (!index.has(id)) connect(id);
  return onCycle;
}
