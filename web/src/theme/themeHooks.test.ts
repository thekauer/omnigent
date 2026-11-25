import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// The public theme hooks (docs/extending/theme_hooks.md) are a contract: each one the
// doc lists must exist in the source, so renaming one fails here first.
const WEB_ROOT = resolve(__dirname, "../..");
const doc = readFileSync(resolve(WEB_ROOT, "../docs/extending/theme_hooks.md"), "utf8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.(test|stories)\.tsx?$/.test(name) ? [path] : [];
  });
}

const source = sources(resolve(WEB_ROOT, "src"))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const css = readFileSync(resolve(WEB_ROOT, "src/index.css"), "utf8");

/** The first-column entries of the doc's table under `heading`. */
function tableHooks(heading: string): string[] {
  const section = doc.split(`## ${heading}`)[1]?.split("\n## ")[0] ?? "";
  return [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
}

describe("theme hooks", () => {
  it("lists the data-slot hooks the source sets", () => {
    const slots = tableHooks("`data-slot` hooks");
    expect(slots).toEqual(
      expect.arrayContaining(["sidebar-section-label", "view-title", "user-bubble", "rail-tab"]),
    );
    for (const slot of slots) {
      // `data-slot="x"`, `data-slot={cond ? "x" : "y"}` or a spread `{ "data-slot": "x" }`.
      const set = new RegExp(`data-slot(="|=\\{[^}]*"|": ")${slot}"`);
      expect(set.test(source), slot).toBe(true);
    }
  });

  it("lists classes the stylesheet or the source defines", () => {
    const classes = tableHooks("Classes");
    expect(classes).toEqual(expect.arrayContaining([".ui-label", ".ui-scroll", ".sidebar-row"]));
    for (const name of classes) {
      const bare = name.slice(1);
      expect(css.includes(name) || source.includes(bare), name).toBe(true);
    }
    // The hook classes themselves live in index.css and read the tokens.
    expect(css).toMatch(/\.ui-label \{[^}]*var\(--ui-label-transform\)/);
    expect(css).toMatch(/\.ui-scroll \{[^}]*var\(--ui-scrollbar-width\)/);
  });
});
