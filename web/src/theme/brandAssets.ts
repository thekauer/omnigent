// Checks of the files a theme contribution ships besides JSON (theming plan, "Brand
// assets" and `contributes.fonts`): fonts must be WOFF2, brand images SVG, PNG or WebP
// within size caps, and an SVG is rebuilt from an allow-list of elements and attributes
// (no script, foreignObject, styles, event handlers, external references, `javascript:`
// or `data:` URLs). The host renders brand images as `<img>`, where an SVG runs no
// script anyway; the sanitizer is the second line. Pure, for the dev plugin.

import { THEME_CONTRIBUTION_LIMITS } from "./themeContributions.ts";

export type BrandAssetType = "image/svg+xml" | "image/png" | "image/webp";

/** A checked asset: the bytes to serve (a sanitized SVG's own) and their type. */
export type AssetCheck =
  | { ok: true; body: Uint8Array; type: BrandAssetType | "font/woff2"; issues: string[] }
  | { ok: false; reason: string };

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  return prefix.every((byte, index) => bytes[offset + index] === byte);
}

/** A `.woff2` font: the `wOF2` signature, at most the font cap. */
export function checkFontFile(bytes: Uint8Array): AssetCheck {
  if (bytes.length > THEME_CONTRIBUTION_LIMITS.fontBytes) {
    return { ok: false, reason: `larger than ${THEME_CONTRIBUTION_LIMITS.fontBytes} bytes` };
  }
  if (!startsWith(bytes, [0x77, 0x4f, 0x46, 0x32]))
    return { ok: false, reason: "not a WOFF2 font" };
  return { ok: true, body: bytes, type: "font/woff2", issues: [] };
}

/** A brand image by its extension: SVG (sanitized), PNG or WebP (by signature), capped. */
export function checkBrandFile(path: string, bytes: Uint8Array): AssetCheck {
  if (bytes.length > THEME_CONTRIBUTION_LIMITS.brandBytes) {
    return { ok: false, reason: `larger than ${THEME_CONTRIBUTION_LIMITS.brandBytes} bytes` };
  }
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "png") {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ? { ok: true, body: bytes, type: "image/png", issues: [] }
      : { ok: false, reason: "not a PNG image" };
  }
  if (extension === "webp") {
    return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
      ? { ok: true, body: bytes, type: "image/webp", issues: [] }
      : { ok: false, reason: "not a WebP image" };
  }
  if (extension === "svg") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { ok: false, reason: "not UTF-8 text" };
    }
    const result = sanitizeSvg(text);
    if (!result.ok) return result;
    return {
      ok: true,
      body: new TextEncoder().encode(result.svg),
      type: "image/svg+xml",
      issues: result.issues,
    };
  }
  return { ok: false, reason: "brand images are .svg, .png or .webp" };
}

const ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "symbol",
  "use",
  "title",
  "desc",
  "text",
  "tspan",
  "pattern",
  "filter",
  "fegaussianblur",
  "feoffset",
  "feblend",
  "fecolormatrix",
  "feflood",
  "fecomposite",
  "femerge",
  "femergenode",
]);
const NAMESPACES = new Set(["http://www.w3.org/2000/svg", "http://www.w3.org/1999/xlink"]);
const ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const ELEMENT_NAME = /^[A-Za-z][A-Za-z0-9_.:-]*$/;
const ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/;

function escapeText(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Why an attribute is dropped, or undefined when it may stay. */
function attributeProblem(name: string, value: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower.startsWith("on")) return "an event handler";
  // Presentation attributes style a logo; a style attribute is a whole CSS parser's worth.
  if (lower === "style") return "a style attribute";
  if (lower === "xmlns" || lower.startsWith("xmlns:")) {
    return NAMESPACES.has(value) ? undefined : "a foreign namespace";
  }
  const decoded = value.replace(/&#x?[0-9a-f]+;?/gi, "\u0000");
  if (/javascript:|data:|vbscript:/i.test(value) || decoded.includes("\u0000")) {
    return "a script or data URL (or an encoded one)";
  }
  if (lower === "href" || lower === "xlink:href") {
    return /^#[A-Za-z_][A-Za-z0-9_.-]*$/.test(value) ? undefined : "an external reference";
  }
  // Only local references: `url(#id)`.
  const urls = value.match(/url\([^)]*\)/gi) ?? [];
  const opened = value.match(/url\(/gi)?.length ?? 0;
  if (
    opened !== urls.length ||
    urls.some((url) => !/^url\(\s*(['"]?)#[A-Za-z_][A-Za-z0-9_.-]*\1\s*\)$/i.test(url))
  ) {
    return "an external url()";
  }
  // CSS images load what `url()` can't name: image-set("x.png" 1x) takes a bare string.
  if (/(?:image-set|image|src|cross-fade|element|paint)\s*\(/i.test(value)) {
    return "a CSS image function";
  }
  return undefined;
}

/**
 * Rebuilds an SVG from its allowed parts: the listed elements (others dropped with their
 * content), their attributes but event handlers, external references and URLs, and text.
 * A document type, entity declarations, CDATA and processing instructions reject it.
 *
 * @returns The rebuilt SVG and what it dropped, or why it was rejected.
 */
export function sanitizeSvg(
  text: string,
): { ok: true; svg: string; issues: string[] } | { ok: false; reason: string } {
  const issues: string[] = [];
  let source = text.replace(/^﻿/, "").trim();
  source = source.replace(/^<\?xml[^?]*\?>/, "").trim();
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<\?/i.test(source)) {
    return {
      ok: false,
      reason: "document types, entities, CDATA and processing instructions are not allowed",
    };
  }
  source = source.replace(/<!--[\s\S]*?-->/g, "");
  if (source.includes("<!--")) return { ok: false, reason: "an unterminated comment" };
  if (ENTITY.test(source)) return { ok: false, reason: "a named entity other than the XML five" };
  const out: string[] = [];
  const open: { name: string; kept: boolean }[] = [];
  let dropping = 0;
  let sawRoot = false;
  let index = 0;
  const tag =
    /<(\/?)([A-Za-z][A-Za-z0-9_.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
  const attribute = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  while (index < source.length) {
    const next = source.indexOf("<", index);
    const textEnd = next < 0 ? source.length : next;
    const chunk = source.slice(index, textEnd);
    if (chunk.includes(">")) return { ok: false, reason: "a stray >" };
    if (chunk.trim() !== "") {
      if (open.length === 0) return { ok: false, reason: "text outside the root element" };
      if (dropping === 0) out.push(escapeText(chunk));
    }
    if (next < 0) break;
    tag.lastIndex = next;
    const match = tag.exec(source);
    if (!match) return { ok: false, reason: `malformed markup at ${next}` };
    index = tag.lastIndex;
    const [, closing, rawName, attributes, selfClosing] = match;
    const name = rawName!;
    if (!ELEMENT_NAME.test(name)) return { ok: false, reason: "a malformed element name" };
    const local = name.toLowerCase();
    if (closing) {
      const top = open.pop();
      if (!top || top.name !== name) return { ok: false, reason: `mismatched </${name}>` };
      if (!top.kept) dropping -= 1;
      else if (dropping === 0) out.push(`</${name}>`);
      continue;
    }
    if (!sawRoot) {
      if (local !== "svg") return { ok: false, reason: "the root element is not <svg>" };
      sawRoot = true;
    } else if (open.length === 0) {
      return { ok: false, reason: "more than one root element" };
    }
    const kept = dropping === 0 && ELEMENTS.has(local);
    if (dropping === 0 && !kept) issues.push(`dropped <${name}> and its content`);
    if (kept) {
      const parts: string[] = [name];
      for (const [, attributeName, double, single] of attributes!.matchAll(attribute)) {
        const value = double ?? single ?? "";
        if (!ATTRIBUTE_NAME.test(attributeName!)) {
          issues.push(`dropped a malformed attribute on <${name}>`);
          continue;
        }
        const problem = attributeProblem(attributeName!, value);
        if (problem) {
          issues.push(`dropped ${attributeName} on <${name}>: ${problem}`);
          continue;
        }
        parts.push(`${attributeName}="${escapeAttribute(value)}"`);
      }
      out.push(`<${parts.join(" ")}${selfClosing ? "/" : ""}>`);
    }
    if (!selfClosing) {
      open.push({ name, kept });
      if (!kept) dropping += 1;
    }
  }
  if (!sawRoot) return { ok: false, reason: "no <svg> element" };
  if (open.length > 0) return { ok: false, reason: `unclosed <${open[open.length - 1]!.name}>` };
  return { ok: true, svg: out.join(""), issues };
}
