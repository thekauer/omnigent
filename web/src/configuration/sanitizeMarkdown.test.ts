import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { sanitizeMarkdown } from "./configurationContributions";

/** The node types a sanitized description must not hold: they load URLs or draw HTML. */
const UNSAFE = new Set(["image", "imageReference", "html", "definition"]);

function unsafeNodes(markdown: string): string[] {
  const found: string[] = [];
  const walk = (node: { type: string; children?: unknown[] }) => {
    if (UNSAFE.has(node.type)) found.push(node.type);
    for (const child of node.children ?? []) walk(child as { type: string; children?: unknown[] });
  };
  walk(unified().use(remarkParse).parse(markdown) as { type: string; children?: unknown[] });
  return found;
}

describe("sanitizeMarkdown", () => {
  it.each([
    "![a](https://evil.example/x.png)",
    "![a [b] c](https://evil.example/x.png)",
    "![ref]\n\n[ref]: https://evil.example/x.png",
    "![ref][ref]\n\n[ref]: https://evil.example/x.png",
    "\\![a](https://evil.example/x.png)",
    "\\\\![a](https://evil.example/x.png)",
    "<img src=https://evil.example/x.png>",
    "text ![](https://evil.example/x.png 'title') more",
    "!<b>[x](https://evil.example/p.png)",
    "!<span></span>[x](https://evil.example/p.png)",
    "<<img>img src=https://evil.example/p.png>",
    "!<br/>[x][r]\n\n[r]<b>: https://evil.example/q.png",
    "&#33;[x](https://evil.example/e.png)",
    "!\\[x](https://evil.example/n.png)",
    "> [r]: https://evil.example/bq.png\n\n!\\[x][r]",
    "- [r]: https://evil.example/li.png\n\n![x][r]",
  ])("leaves no image or HTML in %j", (markdown) => {
    expect(unsafeNodes(sanitizeMarkdown(markdown))).toEqual([]);
  });

  it("keeps links and text", () => {
    expect(sanitizeMarkdown("See [the docs](https://example.com) and `code`.")).toBe(
      "See [the docs](https://example.com) and `code`.",
    );
  });

  it("keeps code spans and blocks as written", () => {
    expect(sanitizeMarkdown("Use `![code](span)` or `<b>`.")).toBe("Use `![code](span)` or `<b>`.");
    expect(sanitizeMarkdown("```\n![x](y) <b>\n```")).toBe("```\n![x](y) <b>\n```");
  });

  it("escapes tags, images and entities instead of stripping them", () => {
    expect(sanitizeMarkdown("!<b>[x](https://evil.example/p.png)")).toBe(
      "\\!\\<b>[x](https://evil.example/p.png)",
    );
    expect(sanitizeMarkdown("a <b>bold</b> &amp; b!")).toBe("a \\<b>bold\\</b> \\&amp; b\\!");
  });

  it("holds against random combinations of markdown's image syntax", () => {
    const pieces = [
      "![",
      "!",
      "[",
      "]",
      "(",
      ")",
      "\\",
      "<",
      ">",
      "img ",
      "x",
      " ",
      "\n",
      "]: ",
      "https://evil.example/x.png",
      "'t'",
      "`",
      "<b>",
      "</b>",
      "<br/>",
      "&#33;",
      "&lt;",
      "> ",
      "- ",
      "    ",
      "[r]",
      "[r]: ",
    ];
    // A fixed seed: the same strings each run.
    let seed = 42;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    for (let round = 0; round < 4000; round += 1) {
      const length = 1 + (next() % 16);
      const markdown = Array.from({ length }, () => pieces[next() % pieces.length]).join("");
      const left = unsafeNodes(sanitizeMarkdown(markdown));
      if (left.length > 0) throw new Error(`${JSON.stringify(markdown)} kept ${left.join(", ")}`);
    }
  });
});
