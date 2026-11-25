// The shape of a theme token: one CSS custom property the host defines, documents
// and lets themes set. A token's id is its public CSS variable name without the
// leading `--`, shared by the built-in palettes, extensions and product config.

/**
 * What a token's value is. `image` accepts any `background-image` value, colours
 * included; `channels` is an `R G B` triple for `rgb(var(--x) / alpha)`; `font` a
 * font-family list; `shadow` a `box-shadow` list; `keyword` a single CSS keyword.
 */
export type TokenKind =
  | "color"
  | "image"
  | "channels"
  | "length"
  | "number"
  | "percentage"
  | "font"
  | "shadow"
  | "keyword";

/** The registry module a token belongs to. */
export type TokenGroup = "workbench" | "status" | "chart" | "shape" | "typography" | "elevation";

/**
 * An `@property` syntax for a token registered with the browser. A registered token
 * computes to a plain value (`calc(0.5rem * 0.75)` reads `6px`), so tokens that
 * alias it read the same value they had as literals.
 */
export type TokenSyntax = "<length>" | "<number>" | "<percentage>";

/**
 * Per-mode defaults, as written into the generated stylesheet.
 *
 * `light` is declared on `:root` (so dark mode inherits it unless `dark` is set) and
 * `dark` on `.dark`. A missing `light` leaves the token unset in light mode; a
 * missing `dark` keeps the light value in dark mode. A value may reference other
 * tokens with `var()`; such a token is derived (see `isDerivedValue`).
 */
export interface TokenDefaults {
  light?: string;
  dark?: string;
}

export interface TokenDef {
  /** The CSS custom property name without `--`, e.g. `primary-cta`. */
  id: string;
  group: TokenGroup;
  kind: TokenKind;
  description: string;
  /**
   * The `PaletteTokens` key, for tokens every palette sets. Their defaults are the
   * default palette's values (`PALETTES[0]` in `lib/themePalette.ts`), so `default`
   * stays unset.
   */
  palette?: string;
  /** Defaults for tokens no palette sets. */
  default?: TokenDefaults;
  /** Registers the token with `@property`; see `TokenSyntax`. */
  syntax?: TokenSyntax;
}

/** The `@property` initial value per syntax: only used outside every theme root. */
export const SYNTAX_INITIAL_VALUES: Readonly<Record<TokenSyntax, string>> = {
  "<length>": "0px",
  "<number>": "0",
  "<percentage>": "0%",
};

/** Whether a token value references another token, so it resolves where it is declared. */
export function isDerivedValue(value: string): boolean {
  return /var\(\s*--/.test(value);
}

/** A token as a group module writes it: the module fills in `group`, and `kind` defaults to colour. */
export type TokenInput = Omit<TokenDef, "group" | "kind"> & { kind?: TokenKind };

/** The group's tokens, with `kind` defaulting to `color`. */
export function defineTokens(
  group: TokenGroup,
  tokens: readonly TokenInput[],
): readonly TokenDef[] {
  return tokens.map((token) => ({ ...token, group, kind: token.kind ?? "color" }));
}
