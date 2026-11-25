// Validation of theme values that reach CSS. Pure: shared by the browser and Node (the
// dev plugin, M6), with no DOM access.
//
// For now it holds the part the syntax themes need (`registerSyntaxTheme`): their
// colours and font styles end up verbatim in inline `style` strings (Shiki's tokens,
// @pierre/diffs' theme styles), so anything but a plain colour could inject CSS
// properties. The theme contribution API (M6) adds the token kinds here.

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
  const fail = (reason: string): never => {
    throw new PlainDataError(reason);
  };
  const copy = (current: unknown, depth: number, at: string): PlainData => {
    nodes += 1;
    if (nodes > limits.nodes) fail(`more than ${limits.nodes} values`);
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number") {
      return Number.isFinite(current) ? current : fail(`${at}: not a finite number`);
    }
    if (typeof current === "string") {
      chars += current.length;
      if (chars > limits.chars) fail(`more than ${limits.chars} characters`);
      return current;
    }
    if (typeof current !== "object") return fail(`${at}: not JSON data`);
    if (depth >= limits.depth) fail(`${at}: nested deeper than ${limits.depth}`);
    if (seen.has(current)) fail(`${at}: a cycle`);
    seen.add(current);
    if (Array.isArray(current)) {
      const length = Object.getOwnPropertyDescriptor(current, "length")?.value as number;
      if (length > limits.nodes) fail(`${at}: more than ${limits.nodes} entries`);
      const items: PlainData[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, index);
        if (!descriptor) fail(`${at}[${index}]: a hole`);
        if (!("value" in descriptor!)) fail(`${at}[${index}]: an accessor`);
        items.push(copy(descriptor!.value, depth + 1, `${at}[${index}]`));
      }
      seen.delete(current);
      return items;
    }
    const prototype = Object.getPrototypeOf(current) as unknown;
    if (prototype !== Object.prototype && prototype !== null) fail(`${at}: not a plain object`);
    const result = nullMap<PlainData>();
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string") fail(`${at}: a symbol key`);
      const name = key as string;
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (!descriptor || !descriptor.enumerable) continue;
      if (!("value" in descriptor)) fail(`${at}.${name.slice(0, 64)}: an accessor`);
      chars += name.length;
      if (chars > limits.chars) fail(`more than ${limits.chars} characters`);
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
