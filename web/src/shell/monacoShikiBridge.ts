// Shiki's themes and grammars in Monaco, as @shikijs/monaco's `shikiToMonaco` does, but
// installed once: `shikiToMonaco` wraps `editor.setTheme` and `editor.create` again on
// every call and resets the global theme to the first loaded one, so each new language
// or theme stacked a wrapper and flashed the editors. Here new themes and languages join
// the same mapping, and the current theme stays.

import { textmateThemeToMonacoTheme } from "@shikijs/monaco";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api.js";
import type { BundledLanguage, BundledTheme, HighlighterGeneric } from "shiki";

type Monaco = typeof MonacoApi;
type MonacoTheme = MonacoApi.editor.IStandaloneThemeData;

/** The parts of a Shiki highlighter the bridge uses. */
export type BridgedHighlighter = Pick<
  HighlighterGeneric<BundledLanguage, BundledTheme>,
  "getLoadedThemes" | "getLoadedLanguages" | "getTheme" | "setTheme" | "getLanguage"
>;
type RuleStack = Parameters<ReturnType<BridgedHighlighter["getLanguage"]>["tokenizeLine2"]>[1];

/** Keeps Monaco in step with a highlighter's loaded themes and languages. */
export interface ShikiMonacoBridge {
  /** Defines the themes and attaches the languages loaded since the last sync. */
  sync: () => void;
}

// vscode-textmate's encoded token metadata (EncodedTokenMetadata).
const FONT_STYLE_MASK = 0b0111_1000_0000_0000;
const FONT_STYLE_OFFSET = 11;
const FOREGROUND_MASK = 0b1111_1111_1000_0000_0000_0000;
const FOREGROUND_OFFSET = 15;
const FONT_STYLE_BITS = [
  [1, "italic"],
  [2, "bold"],
  [4, "underline"],
  [8, "strikethrough"],
] as const;
const FONT_STYLE_WORDS: readonly string[] = FONT_STYLE_BITS.map(([, word]) => word);
const TOKENIZE_MAX_LINE_LENGTH = 20_000;
const TOKENIZE_TIME_LIMIT_MS = 500;

function normalizeColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  let hex = (color.startsWith("#") ? color.slice(1) : color).toLowerCase();
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
  return hex;
}

function fontStyleWords(fontStyle: string | undefined): string {
  if (!fontStyle) return "";
  const words = new Set(
    fontStyle
      .split(/[\s,]+/)
      .map((word) => word.trim().toLowerCase())
      .map((word) => (word === "line-through" ? "strikethrough" : word)),
  );
  return FONT_STYLE_WORDS.filter((word) => words.has(word)).join(" ");
}

function fontStyleFromBits(bits: number): string {
  return FONT_STYLE_BITS.filter(([bit]) => bits & bit)
    .map(([, word]) => word)
    .join(" ");
}

function colorStyleKey(color: string, fontStyle: string): string {
  return fontStyle ? `${color}|${fontStyle}` : color;
}

class TokenizerState {
  readonly ruleStack: RuleStack;
  constructor(ruleStack: RuleStack) {
    this.ruleStack = ruleStack;
  }
  clone(): TokenizerState {
    return new TokenizerState(this.ruleStack);
  }
  equals(other: unknown): boolean {
    return other === this;
  }
}

/**
 * Wraps `monaco.editor.setTheme` and `create` once, so the Shiki theme a Monaco theme
 * name stands for drives tokenization, and defines the highlighter's themes.
 */
export function createShikiMonacoBridge(
  highlighter: BridgedHighlighter,
  monaco: Monaco,
): ShikiMonacoBridge {
  const themes = new Map<string, MonacoTheme>();
  const tokenizedLanguages = new Set<string>();
  const colorMap: string[] = [];
  const colorStyleToScope = new Map<string, string>();

  const setMonacoTheme = monaco.editor.setTheme.bind(monaco.editor);
  monaco.editor.setTheme = (themeName: string) => {
    const theme = themes.get(themeName);
    // A theme the highlighter hasn't loaded keeps the current one
    // rather than throwing inside an editor's render.
    if (!theme) {
      console.warn(`[monaco] unknown theme ${themeName}`);
      return;
    }
    const { colorMap: colors } = highlighter.setTheme(themeName);
    colorMap.length = 0;
    colorMap.push(...colors);
    colorStyleToScope.clear();
    for (const rule of theme.rules) {
      const color = normalizeColor(rule.foreground);
      if (!color) continue;
      const key = colorStyleKey(color, fontStyleWords(rule.fontStyle));
      if (!colorStyleToScope.has(key)) colorStyleToScope.set(key, rule.token);
    }
    setMonacoTheme(themeName);
  };
  const create = monaco.editor.create;
  monaco.editor.create = (element, options, override) => {
    if (options?.theme) monaco.editor.setTheme(options.theme);
    return create(element, options, override);
  };

  function tokenizer(language: string): MonacoApi.languages.TokensProvider {
    return {
      getInitialState: () => new TokenizerState(null),
      tokenize(line, state) {
        const previous = state as TokenizerState;
        if (line.length >= TOKENIZE_MAX_LINE_LENGTH) {
          return { endState: previous, tokens: [{ startIndex: 0, scopes: "" }] };
        }
        const result = highlighter
          .getLanguage(language)
          .tokenizeLine2(line, previous.ruleStack, TOKENIZE_TIME_LIMIT_MS);
        if (result.stoppedEarly) {
          console.warn(`Time limit reached when tokenizing line: ${line.slice(0, 100)}`);
        }
        const tokens: MonacoApi.languages.IToken[] = [];
        for (let index = 0; index < result.tokens.length; index += 2) {
          const metadata = result.tokens[index + 1];
          const color = normalizeColor(
            colorMap[(metadata & FOREGROUND_MASK) >>> FOREGROUND_OFFSET] || "",
          );
          const fontStyle = fontStyleFromBits((metadata & FONT_STYLE_MASK) >>> FONT_STYLE_OFFSET);
          const scope = color ? (colorStyleToScope.get(colorStyleKey(color, fontStyle)) ?? "") : "";
          tokens.push({ startIndex: result.tokens[index], scopes: scope });
        }
        return { endState: new TokenizerState(result.ruleStack), tokens };
      },
    };
  }

  function sync(): void {
    for (const name of highlighter.getLoadedThemes()) {
      if (themes.has(name)) continue;
      // @shikijs/monaco types its result against monaco-editor-core, which isn't installed.
      const theme = textmateThemeToMonacoTheme(highlighter.getTheme(name)) as MonacoTheme;
      themes.set(name, theme);
      monaco.editor.defineTheme(name, theme);
    }
    const known = new Set(monaco.languages.getLanguages().map((language) => language.id));
    for (const language of highlighter.getLoadedLanguages()) {
      if (tokenizedLanguages.has(language) || !known.has(language)) continue;
      tokenizedLanguages.add(language);
      monaco.languages.setTokensProvider(language, tokenizer(language));
    }
  }

  sync();
  // As shikiToMonaco does on its first call: a global theme before any editor sets one.
  const [first] = highlighter.getLoadedThemes();
  if (first) monaco.editor.setTheme(first);

  // Monaco, Shiki and the diffs keep a loaded theme for good (none of them can drop
  // one), so an unregistered theme stays defined; nothing names it again.
  return { sync };
}
