// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { UiTheme } from "./themeContributions";
import { type LayerValue, registryDefault, resolveTokenLayers } from "./resolveTokens";
import { getToken, TOKENS } from "./tokens/registry";
import {
  INTERVAL_KINDS,
  TOKEN_CONSTRAINTS,
  tokenRange,
  validateTokenValue,
  type ValueContext,
} from "./validate";

const registryOnly: ValueContext = { isKnownToken: (id) => getToken(id) !== undefined };

/** A layer as a theme writes it: each value through the parse-time validator. */
function layerOf(values: Record<string, string>): Record<string, LayerValue> {
  const layer: Record<string, LayerValue> = {};
  for (const [id, value] of Object.entries(values)) {
    const result = validateTokenValue(
      getToken(id)!.kind,
      value,
      registryOnly,
      TOKEN_CONSTRAINTS[id],
    );
    if (!result.ok) throw new Error(`${id}: ${value}: ${result.reason}`);
    layer[id] = { value: result.value, references: result.references };
  }
  return layer;
}

function rejectedOf(layers: Record<string, string>[], mode: UiTheme = "dark"): string[] {
  return resolveTokenLayers(layers.map(layerOf), mode).rejected.map((entry) => entry.token);
}

describe("resolveTokenLayers", () => {
  it("passes the registry's own default formulas written by a theme, in both modes", () => {
    for (const mode of ["light", "dark"] as const) {
      const values: Record<string, string> = {};
      for (const token of TOKENS) {
        const fallback = registryDefault(token.id, mode);
        if (!INTERVAL_KINDS.has(token.kind) || fallback === undefined) continue;
        if (TOKEN_CONSTRAINTS[token.id]?.internal) continue;
        values[token.id] = fallback;
        // One at a time over the defaults, and all of them together.
        expect(rejectedOf([{ [token.id]: fallback }], mode)).toEqual([]);
      }
      expect(Object.keys(values).length).toBeGreaterThan(40);
      expect(rejectedOf([values], mode)).toEqual([]);
    }
  });

  it("passes proportional formulas a density or shape theme writes", () => {
    expect(
      rejectedOf([
        {
          "ui-row-line": "22px",
          "ui-row-height": "calc(var(--ui-row-line) + 12px)",
          "ui-control-h-sm": "calc(var(--ui-row-height) - 6px)",
          "ui-control-h-md": "var(--ui-row-height)",
          "ui-control-h-lg": "calc(var(--ui-row-height) + 4px)",
          "ui-header-height": "calc(var(--ui-row-height) + 14px)",
          "ui-tabstrip-height": "calc(var(--ui-header-height) + var(--ui-border-width))",
          "ui-view-title-height": "calc(var(--ui-row-height) * 1.25)",
          "ui-radius-base": "0px",
          "ui-bubble-radius": "calc(var(--ui-radius-base) * 1.5)",
          "ui-sheet-radius": "calc(var(--ui-radius-base) * 1.5)",
          "ui-label-size": "calc(var(--text-sm) * 0.9)",
          "ui-label-tracking": "0.04em",
          "ui-label-weight": "var(--ui-weight-strong)",
        },
      ]),
    ).toEqual([]);
    // The same formulas over the default row line.
    expect(rejectedOf([{ "ui-row-height": "calc(var(--ui-row-line) + 8px)" }])).toEqual([]);
  });

  it("falls back to the next layer's value, not the default, for a value left out", () => {
    const { values, rejected } = resolveTokenLayers(
      [
        layerOf({ "ui-row-height": "34px" }),
        layerOf({ "ui-row-height": "calc(var(--ui-radius-base) * 100)" }),
      ],
      "dark",
    );
    expect(values["ui-row-height"]).toBe("34px");
    expect(rejected).toEqual([
      expect.objectContaining({
        token: "ui-row-height",
        layer: 1,
        reason: expect.stringMatching(/out of range/),
      }),
    ]);
  });

  it("reads a lower layer's value through the layer above", () => {
    // The customization's row height reads the theme's row line, not the default's.
    expect(
      rejectedOf([
        { "ui-row-line": "300px" },
        { "ui-row-height": "calc(var(--ui-row-line) + 120px)" },
      ]),
    ).toEqual(["ui-row-height"]);
    expect(
      rejectedOf([
        { "ui-row-line": "30px" },
        { "ui-row-height": "calc(var(--ui-row-line) + 120px)" },
      ]),
    ).toEqual([]);
  });

  it("leaves out reference cycles, and a fallback that closes one", () => {
    expect(
      rejectedOf([
        { "ui-radius-sm": "var(--ui-radius-md)", "ui-radius-md": "var(--ui-radius-sm)" },
      ]).sort(),
    ).toEqual(["ui-radius-md", "ui-radius-sm"]);
    // The top layer's md is out of range; its fallback reads sm, which reads md: that
    // fallback is dropped, and md takes its default.
    const { values, rejected } = resolveTokenLayers(
      [
        layerOf({ "ui-radius-md": "var(--ui-radius-sm)" }),
        layerOf({ "ui-radius-sm": "var(--ui-radius-md)", "ui-radius-md": "var(--ui-radius-pill)" }),
      ],
      "dark",
    );
    expect(values["ui-radius-md"]).toBeUndefined();
    expect(values["ui-radius-sm"]).toBe("var(--ui-radius-md)");
    expect(rejected.map((entry) => entry.reason).join("\n")).toMatch(/reference cycle/);
  });

  describe("a locked layer", () => {
    /** `layers` with the last one as the product's locks. */
    const resolveLocked = (layers: Record<string, string>[], mode: UiTheme = "dark") =>
      resolveTokenLayers(layers.map(layerOf), mode, { locked: layers.length - 1 });
    const reasons = (result: ReturnType<typeof resolveLocked>) =>
      Object.fromEntries(result.rejected.map((entry) => [entry.token, entry.reason]));

    it("never takes a lower layer's value for a locked token", () => {
      const result = resolveLocked([
        { "ui-row-height": "20px" },
        { "ui-row-height": "10px" },
        { "ui-row-height": "34px" },
      ]);
      expect(result.values["ui-row-height"]).toBe("34px");
      expect(result.rejected).toEqual([]);
    });

    it("drops the value that pushes a lock out of range, not the lock", () => {
      const result = resolveLocked([
        { "ui-row-line": "20px" },
        { "ui-row-line": "400px", "ui-row-height": "10px" },
        { "ui-row-height": "calc(var(--ui-row-line) + 8px)" },
      ]);
      expect(result.values["ui-row-height"]).toBe("calc(var(--ui-row-line) + 8px)");
      // The user's row line goes; the theme's (below it) applies.
      expect(result.values["ui-row-line"]).toBe("20px");
      expect(reasons(result)).toEqual({
        "ui-row-line": expect.stringMatching(/pushes the product's --ui-row-height out of range/),
      });
      expect(result.rejected[0]!.layer).toBe(1);
    });

    it("blames a multi-hop chain the lock reads, highest layer first", () => {
      const result = resolveLocked([
        { "ui-radius-base": "400px" },
        { "ui-radius-md": "calc(var(--ui-radius-base) * 1)" },
        { "ui-row-height": "calc(var(--ui-row-line) + 8px)", "ui-row-line": "var(--ui-radius-md)" },
      ]);
      // The lock reads row line (also locked), which reads radius md, which reads the base.
      expect(result.values["ui-row-height"]).toBe("calc(var(--ui-row-line) + 8px)");
      expect(result.values["ui-row-line"]).toBe("var(--ui-radius-md)");
      // The highest layer's link goes first: radius md takes its default, which reads
      // the base at a fraction, and the locks fit again.
      expect(result.values["ui-radius-md"]).toBeUndefined();
      expect(reasons(result)["ui-radius-md"]).toMatch(/pushes the product's --ui-row-/);
      const deeper = resolveLocked([
        { "ui-radius-base": "530px" },
        { "ui-radius-md": "var(--ui-radius-base)" },
        { "ui-row-height": "calc(var(--ui-radius-md) + 8px)" },
      ]);
      // Without the link, md's default (0.75 of the base) still reads the base too far:
      // the next layer's base goes too, and then the link fits again and is put back.
      expect(deeper.values["ui-row-height"]).toBe("calc(var(--ui-radius-md) + 8px)");
      expect(deeper.values["ui-radius-md"]).toBe("var(--ui-radius-base)");
      expect(Object.keys(reasons(deeper))).toEqual(["ui-radius-base"]);
    });

    it("blames a cycle a lock closes through a var() fallback", () => {
      const result = resolveLocked([
        { ring: "var(--accent, var(--primary))", accent: "var(--primary)" },
        { primary: "var(--ring, #000000)" },
      ]);
      expect(result.values.primary).toBe("var(--ring, #000000)");
      // Leaving out the ring ends both cycles; the accent stays.
      expect(result.values.accent).toBe("var(--primary)");
      expect(Object.keys(reasons(result))).toEqual(["ring"]);
    });

    it("drops the values that close a cycle with a lock, never the lock", () => {
      const result = resolveLocked([
        { ring: "#ff8800" },
        { ring: "var(--primary)", primary: "#123456" },
        { primary: "var(--ring)" },
      ]);
      expect(result.values.primary).toBe("var(--ring)");
      expect(result.values.ring).toBe("#ff8800");
      expect(reasons(result)).toEqual({
        ring: "closes a reference cycle with the product's --primary",
      });
    });

    it("drops one link of a longer cycle through a lock, not every link", () => {
      const result = resolveLocked([
        { ring: "var(--accent)", accent: "var(--primary)", primary: "#123456" },
        { primary: "var(--ring)" },
      ]);
      expect(result.values.primary).toBe("var(--ring)");
      expect(result.values.ring).toBe("var(--accent)");
      expect(result.values.accent).toBeUndefined();
      expect(Object.keys(reasons(result))).toEqual(["accent"]);
      // The same with the links in the user's layer.
      const user = resolveLocked([
        {},
        { ring: "var(--accent)", accent: "var(--primary)", "sidebar-ring": "#ff0000" },
        { primary: "var(--ring)" },
      ]);
      expect(user.values.primary).toBe("var(--ring)");
      expect(user.values["sidebar-ring"]).toBe("#ff0000");
      expect(Object.keys(reasons(user))).toHaveLength(1);
    });

    it("keeps both locks one user value breaks, whichever is named first", () => {
      const locks = {
        "ui-row-height": "calc(var(--ui-radius-base) + 8px)",
        "ui-row-line": "calc(var(--ui-radius-base) * 1)",
      };
      const swapped = {
        "ui-row-line": locks["ui-row-line"],
        "ui-row-height": locks["ui-row-height"],
      };
      for (const lock of [locks, swapped]) {
        const result = resolveLocked([{}, { "ui-radius-base": "399px" }, lock]);
        expect(result.values["ui-row-height"]).toBe(locks["ui-row-height"]);
        expect(result.values["ui-row-line"]).toBe(locks["ui-row-line"]);
        expect(Object.keys(reasons(result))).toEqual(["ui-radius-base"]);
      }
    });

    it("blames a user value behind a theme value it pushed out of range", () => {
      // The user's base pushes the theme's row line out of range; the line's default
      // then breaks nothing, but the lock reads the line at 21 times: still the user's.
      const result = resolveLocked([
        { "ui-row-line": "calc(var(--ui-radius-base) * 1)" },
        { "ui-radius-base": "401px" },
        { "ui-row-height": "calc(var(--ui-row-line) * 21)" },
      ]);
      expect(result.values["ui-row-height"]).toBe("calc(var(--ui-row-line) * 21)");
      expect(result.values["ui-row-line"]).toBe("calc(var(--ui-radius-base) * 1)");
      expect(result.values["ui-radius-base"]).toBeUndefined();
      expect(reasons(result)).toEqual({
        "ui-radius-base": "pushes the product's --ui-row-height out of range in dark",
      });
    });

    it("blames a user value whose theme fallback's default closes a cycle with a lock", () => {
      // 399px pushes the theme's row height out of range; its default reads the row
      // line, the lock, which reads the row height.
      const result = resolveLocked([
        { "ui-row-height": "calc(var(--ui-radius-base) + 8px)" },
        { "ui-radius-base": "399px" },
        { "ui-row-line": "calc(var(--ui-row-height) - 8px)" },
      ]);
      expect(result.values["ui-row-line"]).toBe("calc(var(--ui-row-height) - 8px)");
      expect(result.values["ui-row-height"]).toBe("calc(var(--ui-radius-base) + 8px)");
      expect(Object.keys(reasons(result))).toEqual(["ui-radius-base"]);
    });

    it("drops only the theme value when that alone lets the lock fit", () => {
      const result = resolveLocked([
        { "ui-row-line": "400px" },
        { "ui-radius-base": "1px" },
        { "ui-row-height": "calc(var(--ui-row-line) + var(--ui-radius-base))" },
      ]);
      expect(result.values["ui-row-height"]).toBe(
        "calc(var(--ui-row-line) + var(--ui-radius-base))",
      );
      expect(result.values["ui-radius-base"]).toBe("1px");
      expect(reasons(result)).toEqual({
        "ui-row-line": "pushes the product's --ui-row-height out of range in dark",
      });
    });

    it("keeps a lock and its fallback-read color against a user cycle through it", () => {
      const result = resolveLocked([
        { accent: "#00ff00" },
        { accent: "var(--sidebar, var(--ring))" },
        { ring: "var(--accent)", sidebar: "#ffffff" },
      ]);
      expect(result.values.ring).toBe("var(--accent)");
      expect(result.values.sidebar).toBe("#ffffff");
    });

    it("gives a lock that fails on its own its default, never a lower layer's value", () => {
      const cycle = resolveLocked([
        { ring: "#123456", primary: "#654321" },
        { ring: "var(--primary)", primary: "var(--ring)" },
      ]);
      expect(cycle.values.primary).toBeUndefined();
      expect(cycle.values.ring).toBeUndefined();
      const range = resolveLocked([
        { "ui-row-height": "30px" },
        { "ui-row-height": "calc(var(--ui-row-line) + 390px)" },
      ]);
      expect(range.values["ui-row-height"]).toBeUndefined();
      expect(reasons(range)["ui-row-height"]).toMatch(/out of range/);
    });
  });

  it("takes non-static inputs at their worst case", () => {
    // Tailwind's spacing step up to 16px, the text sizes up to 200px, an em up to 64px.
    expect(rejectedOf([{ "ui-row-height": "calc(var(--spacing) * 25)" }])).toEqual([]);
    expect(rejectedOf([{ "ui-row-height": "calc(var(--spacing) * 26)" }])).toEqual([
      "ui-row-height",
    ]);
    expect(rejectedOf([{ "ui-row-height": "calc(var(--text-sm) * 2)" }])).toEqual([]);
    expect(rejectedOf([{ "ui-row-height": "calc(var(--text-sm) * 2 + 1px)" }])).toEqual([
      "ui-row-height",
    ]);
    expect(rejectedOf([{ "ui-row-height": "calc(var(--ui-row-line) + 5em)" }])).toEqual([]);
    expect(rejectedOf([{ "ui-row-height": "calc(var(--ui-row-line) + 6em)" }])).toEqual([
      "ui-row-height",
    ]);
  });

  it("checks numbers and durations against their absolute ranges", () => {
    expect(rejectedOf([{ "ui-elevation": "calc(var(--ui-elevation) * 1)" }])).toEqual([
      "ui-elevation",
    ]);
    expect(rejectedOf([{ "ui-label-weight": "calc(var(--ui-weight-strong) + 100)" }])).toEqual([]);
    expect(rejectedOf([{ "ui-label-weight": "calc(var(--ui-weight-strong) * 2)" }])).toEqual([
      "ui-label-weight",
    ]);
  });
});

// A seeded generator of length formulas over a pool of length tokens, evaluated exactly.
type Expression =
  | { type: "px"; value: number }
  | { type: "var"; id: string }
  | { type: "scale"; operand: Expression; factor: number }
  | { type: "sum"; left: Expression; right: Expression; sign: 1 | -1 }
  | { type: "min" | "max"; left: Expression; right: Expression };

const POOL = [
  "ui-radius-base",
  "ui-radius-xs",
  "ui-radius-sm",
  "ui-radius-md",
  "ui-radius-lg",
  "ui-radius-xl",
  "ui-radius-12",
  "ui-row-line",
  "ui-border-width",
  "ui-view-title-gap",
];

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function generate(next: () => number, depth: number, withHull: boolean): Expression {
  const pick = next();
  if (depth <= 0 || pick < 0.25) return { type: "px", value: Math.round(next() * 3000) };
  if (pick < 0.5) return { type: "var", id: POOL[Math.floor(next() * POOL.length)]! };
  if (pick < 0.7) {
    const factor = Math.round((0.25 + next() * 3.75) * 4) / 4;
    return { type: "scale", operand: generate(next, depth - 1, withHull), factor };
  }
  if (pick < 0.9 || !withHull) {
    return {
      type: "sum",
      left: generate(next, depth - 1, withHull),
      right: generate(next, depth - 1, withHull),
      sign: next() < 0.7 ? 1 : -1,
    };
  }
  return {
    type: next() < 0.5 ? "min" : "max",
    left: generate(next, depth - 1, withHull),
    right: generate(next, depth - 1, withHull),
  };
}

function write(expression: Expression, top = true): string {
  switch (expression.type) {
    case "px":
      return `${expression.value}px`;
    case "var":
      return `var(--${expression.id})`;
    case "scale":
      return wrap(`${write(expression.operand, false)} * ${expression.factor}`, top);
    case "sum":
      return wrap(
        `${write(expression.left, false)} ${expression.sign === 1 ? "+" : "-"} ${write(expression.right, false)}`,
        top,
      );
    default:
      return `${expression.type}(${write(expression.left, false)}, ${write(expression.right, false)})`;
  }
}

function wrap(text: string, top: boolean): string {
  return top ? `calc(${text})` : `(${text})`;
}

// The pool's defaults, in px (16px per rem): all static, so the intervals are exact.
const DEFAULT_PX: Readonly<Record<string, (value: (id: string) => number) => number>> = {
  "ui-radius-base": () => 8,
  "ui-radius-xs": (value) => value("ui-radius-base") * 0.25,
  "ui-radius-sm": (value) => value("ui-radius-base") * 0.5,
  "ui-radius-md": (value) => value("ui-radius-base") * 0.75,
  "ui-radius-lg": (value) => value("ui-radius-base"),
  "ui-radius-xl": (value) => value("ui-radius-base") * 1.4,
  "ui-radius-12": (value) => value("ui-radius-base") * 1.5,
  "ui-row-line": () => 20,
  "ui-border-width": () => 1,
  "ui-view-title-gap": () => 2,
};

function evaluate(expression: Expression, value: (id: string) => number): number {
  switch (expression.type) {
    case "px":
      return expression.value;
    case "var":
      return value(expression.id);
    case "scale":
      return evaluate(expression.operand, value) * expression.factor;
    case "sum":
      return evaluate(expression.left, value) + expression.sign * evaluate(expression.right, value);
    case "min":
      return Math.min(evaluate(expression.left, value), evaluate(expression.right, value));
    case "max":
      return Math.max(evaluate(expression.left, value), evaluate(expression.right, value));
  }
}

describe("resolveTokenLayers fuzz", () => {
  for (const withHull of [false, true]) {
    it(`keeps only values whose computed value is in range${withHull ? " (min/max)" : ""}`, () => {
      const next = random(withHull ? 7 : 3);
      let kept = 0;
      let dropped = 0;
      for (let round = 0; round < 300; round += 1) {
        const expressions: Record<string, Expression> = {};
        const written: Record<string, string> = {};
        for (const id of POOL) {
          if (next() < 0.5) continue;
          const expression = generate(next, 3, withHull);
          const value = write(expression);
          const parsed = validateTokenValue("length", value, registryOnly, TOKEN_CONSTRAINTS[id]);
          if (!parsed.ok) continue;
          expressions[id] = expression;
          written[id] = value;
        }
        const { values, rejected } = resolveTokenLayers([layerOf(written)], "dark");
        const onCycle = new Set(
          rejected.filter((entry) => /cycle/.test(entry.reason)).map((entry) => entry.token),
        );
        // The computed value of every token, as CSS would compute what was kept.
        const memo = new Map<string, number>();
        const visiting = new Set<string>();
        const value = (id: string): number => {
          if (memo.has(id)) return memo.get(id)!;
          if (visiting.has(id)) throw new Error(`a kept cycle through ${id}`);
          visiting.add(id);
          const result =
            values[id] !== undefined ? evaluate(expressions[id]!, value) : DEFAULT_PX[id]!(value);
          visiting.delete(id);
          memo.set(id, result);
          return result;
        };
        for (const id of Object.keys(written)) {
          if (values[id] === undefined) {
            dropped += 1;
            if (!withHull) {
              // Exact without min/max: a value left out (not for a cycle) really leaves its range.
              let computed: number | undefined;
              try {
                computed = evaluate(expressions[id]!, value);
              } catch {
                computed = undefined;
              }
              if (computed !== undefined && !onCycle.has(id)) {
                const [lo, hi] = tokenRange(id, "length");
                expect(computed < lo - 1e-6 || computed > hi + 1e-6, `${id}: ${written[id]}`).toBe(
                  true,
                );
              }
            }
            continue;
          }
          kept += 1;
          const [lo, hi] = tokenRange(id, "length");
          const computed = value(id);
          expect(computed, `${id}: ${written[id]}`).toBeGreaterThanOrEqual(lo - 1e-6);
          expect(computed, `${id}: ${written[id]}`).toBeLessThanOrEqual(
            Math.min(hi, 10_000) + 1e-6,
          );
        }
      }
      // Both outcomes are exercised.
      expect(kept).toBeGreaterThan(100);
      expect(dropped).toBeGreaterThan(100);
    });
  }
});

// Random layered token graphs: a theme, the user's customizations and the product's locks.
describe("resolveTokenLayers with locks, fuzz", () => {
  const COLORS = ["ring", "accent", "primary", "sidebar", "sidebar-ring"];
  const color = (next: () => number): string => {
    const pick = () => COLORS[Math.floor(next() * COLORS.length)]!;
    const roll = next();
    if (roll < 0.3)
      return `#${Math.floor(next() * 0xffffff)
        .toString(16)
        .padStart(6, "0")}`;
    if (roll < 0.7) return `var(--${pick()})`;
    return `var(--${pick()}, var(--${pick()}))`;
  };
  // Tokens with small ranges (32px, 400px) read from ones with large ranges, so a value
  // a layer below writes often pushes a lock, or a value the lock reads, out of range.
  const LENGTHS = [
    "ui-radius-base",
    "ui-radius-md",
    "ui-radius-sm",
    "ui-row-line",
    "ui-border-width",
    "ui-view-title-gap",
  ];
  const length = (next: () => number): Expression => {
    const pick = (): Expression => ({
      type: "var",
      id: LENGTHS[Math.floor(next() * LENGTHS.length)]!,
    });
    const px = (): Expression => ({
      type: "px",
      value: Math.round(next() < 0.8 ? next() * 40 : next() * 450),
    });
    const roll = next();
    if (roll < 0.25) return px();
    if (roll < 0.45) return pick();
    if (roll < 0.7) {
      const factor = [1, 2, 8, 21][Math.floor(next() * 4)]!;
      return { type: "scale", operand: pick(), factor };
    }
    if (roll < 0.85) return { type: "sum", left: pick(), right: pick(), sign: 1 };
    return { type: "sum", left: pick(), right: px(), sign: next() < 0.8 ? 1 : -1 };
  };
  /** A layer of random values; each token written with `chance`. */
  const randomLayer = (next: () => number, chance: number) => {
    const written: Record<string, string> = {};
    const expressions: Record<string, Expression> = {};
    for (const id of LENGTHS) {
      if (next() >= chance) continue;
      const expression = length(next);
      const value = write(expression);
      if (!validateTokenValue("length", value, registryOnly, TOKEN_CONSTRAINTS[id]).ok) continue;
      written[id] = value;
      expressions[id] = expression;
    }
    for (const id of COLORS) if (next() < chance) written[id] = color(next);
    return { written, expressions };
  };
  /** The tokens `lock` may read through any layer's value or a default. */
  const closureOf = (layers: readonly Record<string, LayerValue>[], value: LayerValue) => {
    const closure = new Set<string>();
    const stack = [...value.references];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (closure.has(id)) continue;
      closure.add(id);
      stack.push(
        ...[...(registryDefault(id, "dark") ?? "").matchAll(/var\(\s*--([A-Za-z0-9-]+)/g)].map(
          (m) => m[1]!,
        ),
      );
      for (const layer of layers) stack.push(...(layer[id]?.references ?? []));
    }
    return closure;
  };

  it("never gives up a lock while a theme or user value in its closure applies", () => {
    let held = 0;
    let lost = 0;
    let blamed = 0;
    for (let seed = 1; seed <= 1500; seed += 1) {
      const next = random(seed * 7919);
      const generated = [randomLayer(next, 0.5), randomLayer(next, 0.5), randomLayer(next, 0.3)];
      const layers = generated.map(({ written }) => layerOf(written));
      const result = resolveTokenLayers(layers, "dark", { locked: 2 });
      // Locks alone: what the product's own values do.
      const alone = resolveTokenLayers([{}, {}, layers[2]!], "dark", { locked: 2 });
      blamed += result.rejected.filter((entry) => /product's/.test(entry.reason)).length;
      for (const [id, lock] of Object.entries(layers[2]!)) {
        if (result.values[id] === lock.value) {
          held += 1;
          continue;
        }
        lost += 1;
        const closure = closureOf(layers, lock);
        const applied = [...closure].filter(
          (ref) =>
            result.values[ref] !== undefined && result.values[ref] !== layers[2]![ref]?.value,
        );
        // It may fail only as it fails with no other layer's value at all.
        expect(alone.values[id], `seed ${seed}: --${id} lost with ${applied.join(", ")}`).not.toBe(
          lock.value,
        );
      }
      // And what is kept is in range, on no cycle: the kept formulas' exact values.
      const expressionOf = (id: string): Expression | undefined => {
        for (let layer = 2; layer >= 0; layer -= 1) {
          if (generated[layer]!.written[id] === result.values[id]) {
            return generated[layer]!.expressions[id];
          }
        }
        return undefined;
      };
      const memo = new Map<string, number>();
      const visiting = new Set<string>();
      const value = (id: string): number => {
        if (memo.has(id)) return memo.get(id)!;
        if (visiting.has(id)) throw new Error(`seed ${seed}: a kept cycle through ${id}`);
        visiting.add(id);
        const expression = result.values[id] === undefined ? undefined : expressionOf(id);
        const computed = expression ? evaluate(expression, value) : DEFAULT_PX[id]!(value);
        visiting.delete(id);
        memo.set(id, computed);
        return computed;
      };
      for (const id of LENGTHS) {
        // A default is trusted: only the values kept are checked.
        if (result.values[id] === undefined) continue;
        const [lo, hi] = tokenRange(id, "length");
        const computed = value(id);
        expect(computed, `seed ${seed}: --${id}`).toBeGreaterThanOrEqual(lo - 1e-6);
        expect(computed, `seed ${seed}: --${id}`).toBeLessThanOrEqual(Math.min(hi, 10_000) + 1e-6);
      }
    }
    // Every outcome is exercised.
    expect(held).toBeGreaterThan(1000);
    expect(lost).toBeGreaterThan(100);
    expect(blamed).toBeGreaterThan(200);
    // About 0.3s alone; the whole suite's load can stretch it far past the 5s default.
  }, 60_000);
});

describe("resolveTokenLayers with locks, timing", () => {
  const timed = (layers: Record<string, string>[]) => {
    const values = layers.map((written) => {
      const layer: Record<string, LayerValue> = {};
      for (const [id, value] of Object.entries(written)) {
        const result = validateTokenValue(
          getToken(id)!.kind,
          value,
          registryOnly,
          TOKEN_CONSTRAINTS[id],
        );
        if (result.ok) layer[id] = { value: result.value, references: result.references };
      }
      return layer;
    });
    const locked = values.length - 1;
    resolveTokenLayers(values, "dark", { locked });
    const start = performance.now();
    const result = resolveTokenLayers(values, "dark", { locked });
    const ms = performance.now() - start;
    const alone = resolveTokenLayers(
      [...values.slice(0, -1).map(() => ({})), values[locked]!],
      "dark",
      {
        locked,
      },
    );
    for (const [id, lock] of Object.entries(values[locked]!)) {
      if (result.values[id] !== lock.value) expect(alone.values[id]).not.toBe(lock.value);
    }
    return ms;
  };
  const colors = TOKENS.filter((token) => token.kind === "color").map((token) => token.id);
  const lengths = TOKENS.filter((token) => token.kind === "length").map((token) => token.id);

  it("resolves a document of rings of references through many locks in time", () => {
    const theme: Record<string, string> = {};
    const user: Record<string, string> = {};
    const lock: Record<string, string> = {};
    colors.forEach((id, index) => {
      const after = colors[(index + 1) % colors.length]!;
      const before = colors[(index + colors.length - 1) % colors.length]!;
      theme[id] = `var(--${before}, #000000)`;
      user[id] = `var(--${after}, var(--${before}))`;
      if (index % 3 === 0) lock[id] = `var(--${after})`;
    });
    lengths.forEach((id, index) => {
      const after = lengths[(index + 1) % lengths.length]!;
      theme[id] = `calc(var(--${after}) * 1)`;
      user[id] = `calc(var(--${after}) + 1px)`;
      if (index % 4 === 0) lock[id] = `calc(var(--${after}) * 2)`;
    });
    // Measured at 10 to 25ms; the bound only catches a blow-up.
    expect(timed([theme, user, lock])).toBeLessThan(1500);
  }, 30_000);

  it("resolves many user cycles and lock cycles in time", () => {
    const half = Math.floor(colors.length / 2);
    const user: Record<string, string> = {};
    const lock: Record<string, string> = {};
    for (let index = 0; index + 1 < half; index += 2) {
      user[colors[index]!] = `var(--${colors[index + 1]})`;
      user[colors[index + 1]!] = `var(--${colors[index]})`;
    }
    for (let index = half; index + 1 < colors.length; index += 2) {
      lock[colors[index]!] = `var(--${colors[index + 1]})`;
      user[colors[index + 1]!] = `var(--${colors[index]})`;
    }
    expect(timed([{}, user, lock])).toBeLessThan(1500);
  }, 30_000);
});
