// Plain text as markdown, for hovers and descriptions that must draw exactly what they hold.

/** `text` as markdown that draws exactly that text: no image, link, tag or block starts. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*_[\]<>|~]/g, (char) => `\\${char}`)
    .replace(/^(\s*)([#>+-]|\d+\.)/gm, "$1\\$2");
}
