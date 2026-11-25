// The theme token registry: every CSS custom property the host themes, with its
// group, kind and per-mode defaults. `scripts/generate-theme-tokens.mjs` writes the
// defaults and the palette blocks from it into `themeTokens.generated.css`, and
// `lib/themePalette.ts` derives `PaletteTokens` from its palette tokens.
//
// `.ts` imports: the generator loads this module directly in Node.

import { CHART_TOKENS } from "./chart.ts";
import { ELEVATION_TOKENS } from "./elevation.ts";
import { SHAPE_TOKENS } from "./shape.ts";
import { STATUS_TOKENS } from "./status.ts";
import type { TokenDef } from "./types.ts";
import { TYPOGRAPHY_TOKENS } from "./typography.ts";
import { PALETTE_TOKENS, WORKBENCH_TOKENS } from "./workbench.ts";

export {
  isDerivedValue,
  SYNTAX_INITIAL_VALUES,
  type TokenDef,
  type TokenDefaults,
  type TokenGroup,
  type TokenKind,
  type TokenSyntax,
} from "./types.ts";
export { PALETTE_TOKENS } from "./workbench.ts";

type PaletteTokenDef = (typeof PALETTE_TOKENS)[number];

/** The `PaletteTokens` keys, in the generated stylesheet's order. */
export type PaletteTokenKey = PaletteTokenDef["palette"];

/** `PaletteTokens` key to CSS custom property name (without `--`). */
export type PaletteTokenCssNames = { readonly [D in PaletteTokenDef as D["palette"]]: D["id"] };

export const PALETTE_TOKEN_CSS_NAMES = Object.fromEntries(
  PALETTE_TOKENS.map((token) => [token.palette, token.id]),
) as PaletteTokenCssNames;

/** Every registered token: the palette tokens first, then the groups with host defaults. */
export const TOKENS: readonly TokenDef[] = [
  ...PALETTE_TOKENS.map((token): TokenDef => ({
    group: "workbench",
    kind: "kind" in token ? token.kind : "color",
    id: token.id,
    palette: token.palette,
    description: token.description,
  })),
  ...WORKBENCH_TOKENS,
  ...STATUS_TOKENS,
  ...CHART_TOKENS,
  ...SHAPE_TOKENS,
  ...TYPOGRAPHY_TOKENS,
  ...ELEVATION_TOKENS,
];

/** Tokens with host defaults (no palette sets them), in registry order. */
export const DEFAULT_TOKENS: readonly TokenDef[] = TOKENS.filter((token) => !token.palette);

const TOKENS_BY_ID = new Map(TOKENS.map((token) => [token.id, token]));

/** The registered token with this id (the CSS variable name without `--`), if any. */
export function getToken(id: string): TokenDef | undefined {
  return TOKENS_BY_ID.get(id);
}
