import { describe, expect, it } from "vitest";
import {
  childrenOf,
  formOf,
  groupMatches,
  problemMessage,
  queryOf,
  statusMessage,
  treeItemFor,
} from "./searchModel";

const states = { None: 0, Collapsed: 1, Expanded: 2 } as never;
const match = (path: string, line: number) => ({
  path,
  line,
  column: 2,
  preview: { text: ` hit ${line}`, matches: [[1, 4]] as [number, number][] },
});

describe("Content search model", () => {
  it("turns the form's value into the query and globs it sends", () => {
    const form = formOf({
      query: " q ",
      options: { caseSensitive: true, wholeWord: false, regex: true },
      fields: { include: "src/**" },
    });
    expect(form).toEqual({
      query: " q ",
      caseSensitive: true,
      wholeWord: false,
      regex: true,
      include: "src/**",
      exclude: "",
    });
    expect(queryOf(form)).toEqual({
      pattern: " q ",
      isRegExp: true,
      isCaseSensitive: true,
      isWordMatch: false,
    });
  });

  it("words each problem as the classic alerts did", () => {
    expect(problemMessage("tooLong", true)).toBe(
      "This search is too long to match whole words. Shorten it, or turn off Whole word.",
    );
    // Without Whole word, a long search is simply too long.
    expect(problemMessage("tooLong")).toBe("This search is too long. Shorten it.");
    expect(problemMessage("unopenedGroup")).toMatch(
      /^This expression closes a group it never opened/,
    );
    expect(problemMessage("verbose")).toMatch(
      /^Whole word can’t be used with verbose mode \(\?x\)/,
    );
    expect(problemMessage(undefined)).toBeUndefined();
  });

  it("groups matches by file and draws each as a text match opening its position", () => {
    const roots = groupMatches([match("b.ts", 2), match("a.ts", 9), match("b.ts", 7)]);
    expect(roots.map((root) => root.kind === "file" && root.path)).toEqual(["b.ts", "a.ts"]);
    expect(treeItemFor(roots[0], states)).toMatchObject({
      label: "b.ts",
      iconPath: "file",
      resourceUri: { path: "b.ts" },
      collapsibleState: 2,
    });
    const [first, second] = childrenOf(roots[0]);
    expect(childrenOf(first)).toEqual([]);
    expect(treeItemFor(second, states)).toEqual({
      id: "match:b.ts:7:2",
      label: { label: " hit 7", highlights: [[1, 4]] },
      resourceUri: { path: "b.ts" },
      line: 7,
      accessibilityInformation: { label: "Open b.ts at line 7" },
      command: {
        command: "omnigent.openFile",
        title: "Open",
        arguments: ["b.ts", { line: 7, column: 2 }],
      },
    });
  });

  it("says what the results area shows: the prompt, the error, the counts and warnings", () => {
    expect(statusMessage(undefined, false).message).toBe("Enter text and press Enter to search.");
    expect(statusMessage({ query: "x", error: "boom" }, false)).toEqual({
      message: "boom",
      severity: "error",
    });
    expect(statusMessage({ query: "x", error: "boom" }, true).message).toBeUndefined();
    const result = (matches: ReturnType<typeof match>[], limitHit = false, message?: string) => ({
      query: "x",
      result: { matches, limitHit, message },
    });
    expect(statusMessage(result([]), false).message).toBe("No matches for “x”.");
    expect(
      statusMessage(result([match("a", 1), match("a", 2), match("b", 1)]), false).message,
    ).toBe("3 matching lines in 2 files for “x”.");
    expect(statusMessage(result([match("a", 1)], true), false).message).toBe(
      "1 matching lines in 1 files for “x”.\nShowing the first 1 matching lines. Narrow your query for more results.",
    );
    expect(statusMessage(result([], true, "Skipped a folder."), false).message).toBe(
      "No matches for “x”.\nSkipped a folder.",
    );
  });
});
