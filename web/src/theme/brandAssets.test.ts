import { describe, expect, it } from "vitest";

import { checkBrandFile, checkFontFile, sanitizeSvg } from "./brandAssets";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("sanitizeSvg", () => {
  it("keeps a plain logo as it is", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><path d="M0 0h10v10z" fill="url(#g)"/><use href="#g"/></svg>';
    expect(sanitizeSvg(svg)).toEqual({ ok: true, svg, issues: [] });
  });

  it("drops scripts, foreignObject, styles, handlers and external references", () => {
    const result = sanitizeSvg(
      [
        '<?xml version="1.0"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
        "<script>alert(1)</script>",
        '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>',
        "<style>@import url(https://example.com/x.css)</style>",
        '<a href="https://example.com"><text>link</text></a>',
        '<image href="https://example.com/x.png"/>',
        '<use href="https://example.com/sprite.svg#a"/>',
        '<use xlink:href="data:image/svg+xml,&lt;svg/&gt;"/>',
        '<rect fill="url(https://example.com/x)" width="1" height="1" onclick="x()"/>',
        '<path d="M0" style="fill: red" filter="url(#f)"/>',
        '<circle r="1" href="javascript:alert(1)"/>',
        '<circle r="1" href="&#106;avascript:alert(1)"/>',
        "<!-- a comment -->",
        "</svg>",
      ].join(""),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><use/><use/><rect width="1" height="1"/><path d="M0" style="fill: red" filter="url(#f)"/><circle r="1"/><circle r="1"/></svg>',
    );
    expect(result.issues.join("\n")).toMatch(/onload/);
    expect(result.issues.join("\n")).toMatch(/<script>/);
    expect(result.issues.join("\n")).toMatch(/<foreignObject>/);
    expect(result.issues.join("\n")).toMatch(/<style>/);
  });

  it("rejects document types, entities, CDATA and malformed markup", () => {
    for (const svg of [
      '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>',
      "<svg><![CDATA[x]]></svg>",
      "<svg>&nbsp;</svg>",
      "<svg><g></svg>",
      "<svg></g>",
      "<html><svg/></html>",
      "<svg/><svg/>",
      "<svg><?php ?></svg>",
      "text<svg/>",
      "<svg",
    ]) {
      expect(sanitizeSvg(svg).ok, svg).toBe(false);
    }
  });
});

describe("asset checks", () => {
  it("takes WOFF2 fonts by signature and size", () => {
    expect(checkFontFile(bytes("wOF2rest")).ok).toBe(true);
    expect(checkFontFile(bytes("wOFFrest"))).toEqual({ ok: false, reason: "not a WOFF2 font" });
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(bytes("wOF2"));
    expect(checkFontFile(big).ok).toBe(false);
  });

  it("takes PNG, WebP and sanitized SVG brand images, by signature", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    expect(checkBrandFile("logo.png", png)).toMatchObject({ ok: true, type: "image/png" });
    expect(checkBrandFile("logo.png", bytes("<svg/>")).ok).toBe(false);
    expect(checkBrandFile("logo.webp", bytes("RIFF0000WEBPVP8 "))).toMatchObject({ ok: true });
    const svg = checkBrandFile("logo.svg", bytes('<svg><g onclick="x"/></svg>'));
    expect(svg).toMatchObject({ ok: true, type: "image/svg+xml" });
    if (svg.ok) expect(new TextDecoder().decode(svg.body)).toBe("<svg><g/></svg>");
    expect(checkBrandFile("logo.gif", bytes("GIF89a")).ok).toBe(false);
    expect(checkBrandFile("logo.svg", new Uint8Array([0xff, 0xfe])).ok).toBe(false);
  });
});
