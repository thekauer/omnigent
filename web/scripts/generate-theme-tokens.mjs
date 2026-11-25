import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { PALETTES, PALETTE_TOKEN_CSS_NAMES } from "../src/lib/themePalette.ts";
import { TOKEN_MODE_PROBE_ATTRIBUTE } from "../src/theme/tokenModeProbe.ts";
import {
  DEFAULT_TOKENS,
  SYNTAX_INITIAL_VALUES,
  UNSET_VALUE,
  isDerivedValue,
} from "../src/theme/tokens/registry.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "src/themeTokens.generated.css");
const check = process.argv.slice(2).includes("--check");
const unexpectedArgs = process.argv.slice(2).filter((argument) => argument !== "--check");

if (unexpectedArgs.length > 0) {
  throw new Error(`Unknown arguments: ${unexpectedArgs.join(", ")}`);
}

const MODES = ["light", "dark"];

const prettierConfig = await resolveConfig(outputPath);
const printWidth = prettierConfig?.printWidth ?? 80;

// A custom property keeps the whitespace of its value as written: Prettier would wrap a
// long value over several lines, and the computed value (what `getPropertyValue` reads)
// would keep those line breaks. So a value stays on one line, with single spaces.
function customProperty(name, value) {
  const line = `  --${name}: ${value.replace(/\s+/g, " ").trim()};`;
  return line.length > printWidth ? `  /* prettier-ignore */\n${line}` : line;
}

function declaration(token, value) {
  // A shadow list stays on one line even when it is short enough not to wrap.
  const line = customProperty(token.id, value);
  return token.kind === "shadow" && !line.includes("prettier-ignore")
    ? `  /* prettier-ignore */\n${line}`
    : line;
}

function rule(selector, declarations) {
  return `${selector} {\n${declarations.join("\n")}\n}`;
}

// A token without a default in either mode is reset on the top root, so its readers'
// `var()` fallbacks apply there. In the embed `:root` is the app's scope root, and the
// reset keeps a host page's variable of the same name from inheriting into the app.
function isUnset(token) {
  return token.default?.light === undefined && token.default?.dark === undefined;
}

// Registry defaults: light on `:root` (dark mode inherits it unless the token sets
// a dark value) and dark on `.dark`, as the hand-written blocks they replace.
function defaultRules() {
  return MODES.map((mode) =>
    rule(
      mode === "light" ? ":root" : ".dark",
      DEFAULT_TOKENS.flatMap((token) => {
        if (token.default?.[mode] !== undefined) return [declaration(token, token.default[mode])];
        return mode === "light" && isUnset(token) ? [declaration(token, UNSET_VALUE)] : [];
      }),
    ),
  );
}

// Registered tokens compute to plain values, so their aliases read those values.
function propertyRules() {
  return DEFAULT_TOKENS.filter((token) => token.syntax).map(
    (token) =>
      `@property --${token.id} {\n  syntax: "${token.syntax}";\n  inherits: true;\n  initial-value: ${token.initial ?? SYNTAX_INITIAL_VALUES[token.syntax]};\n}`,
  );
}

// A root's value in a mode: dark mode inherits the light default unless it sets one.
function modeValue(token, mode) {
  return mode === "dark" ? (token.default?.dark ?? token.default?.light) : token.default?.light;
}

// Derived defaults again on the theme roots below the top one (the embed's inner
// root, a child of its scope root) and on palette-stamped roots, so a token computed
// from other tokens resolves against that root's own values. A dark root gets the
// light formula of a token without a dark default, as it would inherit it.
const DERIVED_SELECTORS = {
  light: ":root:not(.dark)[data-theme], :root > :not(.dark)[data-theme]",
  dark: ":root.dark, :root > .dark",
};

function derivedRules() {
  return MODES.map((mode) =>
    rule(
      DERIVED_SELECTORS[mode],
      DEFAULT_TOKENS.filter((token) => {
        const value = modeValue(token, mode);
        return value !== undefined && isDerivedValue(value);
      }).map((token) => declaration(token, modeValue(token, mode))),
    ),
  );
}

// Tokens read by script in either mode (`perMode`): both modes' defaults again on a
// probe element (`theme/tokenValues.ts`), which reads the mode the theme root isn't in.
// A slot unset in a mode is unset on its probe, not inherited from the root.
function probeRules() {
  return MODES.map((mode) =>
    rule(
      `[${TOKEN_MODE_PROBE_ATTRIBUTE}="${mode}"]`,
      DEFAULT_TOKENS.filter((token) => token.perMode).map((token) =>
        declaration(token, modeValue(token, mode) ?? UNSET_VALUE),
      ),
    ),
  );
}

function selectorFor(palette, mode) {
  if (palette.id === "omni") {
    return mode === "light" ? ":root:not(.dark):not([data-theme])" : ".dark:not([data-theme])";
  }
  return mode === "light"
    ? `:root:not(.dark)[data-theme="${palette.id}"]`
    : `.dark[data-theme="${palette.id}"]`;
}

function paletteRules(palette, mode) {
  const selector = selectorFor(palette, mode);
  const tokens = palette.tokens[mode];
  const declarations = Object.entries(PALETTE_TOKEN_CSS_NAMES).map(([key, cssName]) =>
    customProperty(cssName, tokens[key]),
  );
  return [rule(selector, declarations)];
}

function customRules(mode) {
  const selector =
    mode === "light" ? ':root:not(.dark)[data-theme="custom"]' : '.dark[data-theme="custom"]';
  const declarations = Object.values(PALETTE_TOKEN_CSS_NAMES).map((cssName) =>
    customProperty(cssName, `var(--custom-${mode}-${cssName})`),
  );
  return [rule(selector, declarations)];
}

const rules = [
  ...propertyRules(),
  ...defaultRules(),
  ...PALETTES.flatMap((palette) => MODES.flatMap((mode) => paletteRules(palette, mode))),
  ...MODES.flatMap(customRules),
  ...derivedRules(),
  ...probeRules(),
];

const source = `/* Generated by scripts/generate-theme-tokens.mjs from src/theme/tokens/registry.ts. */\n\n${rules.join("\n\n")}\n`;
const formatted = await format(source, {
  ...prettierConfig,
  parser: "css",
});

if (check) {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== formatted) {
    console.error("Theme token CSS is stale. Run `just generate-theme-tokens`.");
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, formatted);
  console.log(`Generated ${outputPath}`);
}
