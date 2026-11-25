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
  colors: unknown,
  tokenColors: unknown,
): ValidSyntaxTheme & { issues: string[] } {
  const issues: string[] = [];
  const keptColors: Record<string, string> = {};
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
