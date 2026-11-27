// @vitest-environment node
// The settings language in Monaco, against a stand-in for Monaco's API: the providers answer
// only for the settings models, and diagnostics become markers (a lock drawn faded).
import { describe, expect, it, vi } from "vitest";

import { buildSettingsSchema } from "@/theme/themeSettingsSchema";

import type { MonacoModule } from "../monacoSetup";
import {
  installSettingsJsonLanguage,
  markSettingsModel,
  setSettingsMarkers,
} from "./settingsJsonMonaco";

function fakeModel(uri: string, text: string) {
  const positionAt = (offset: number) => {
    const before = text.slice(0, offset);
    return { lineNumber: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
  };
  return {
    uri: { toString: () => uri },
    getValue: () => text,
    getPositionAt: positionAt,
    getOffsetAt: ({ lineNumber, column }: { lineNumber: number; column: number }) =>
      text
        .split("\n")
        .slice(0, lineNumber - 1)
        .join("\n").length +
      (lineNumber > 1 ? 1 : 0) +
      column -
      1,
  };
}

function fakeMonaco() {
  const providers: Record<string, { provideCompletionItems?: unknown; provideHover?: unknown }> =
    {};
  const setModelMarkers = vi.fn();
  const monaco = {
    languages: {
      registerCompletionItemProvider: (_language: string, provider: object) => {
        providers.completion = provider;
      },
      registerHoverProvider: (_language: string, provider: object) => {
        providers.hover = provider;
      },
      CompletionItemKind: { Property: 9, Value: 12 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
    MarkerTag: { Unnecessary: 1 },
    editor: { setModelMarkers },
  };
  return { monaco: monaco as unknown as MonacoModule, providers, setModelMarkers };
}

const schema = buildSettingsSchema({
  tokens: [],
  themeScopes: [],
  optionScopes: [],
  variants: [
    {
      name: "header",
      label: "Header",
      description: "The header.",
      values: [
        { value: "glass", label: "Glass" },
        { value: "solid", label: "Solid" },
      ],
    },
  ],
  locks: { tokens: {}, options: {}, variants: {} },
  hideCustomizations: false,
});

describe("the settings language in Monaco", () => {
  it("completes and describes the settings models only", () => {
    const { monaco, providers } = fakeMonaco();
    installSettingsJsonLanguage(monaco, () => schema);
    const text = '{ "omnigent.style.header": "" }';
    const settings = fakeModel("settings", text);
    const other = fakeModel("other", text);
    const unmark = markSettingsModel(settings as never);
    const complete = providers.completion as {
      provideCompletionItems: (
        model: unknown,
        position: unknown,
      ) => { suggestions: { label: string; detail?: string; range: unknown }[] };
    };
    const position = settings.getPositionAt(text.indexOf('""') + 1);
    expect(complete.provideCompletionItems(other, position).suggestions).toEqual([]);
    const suggestions = complete.provideCompletionItems(settings, position).suggestions;
    expect(suggestions.map((item) => [item.label, item.detail])).toEqual([
      ['"glass"', "Glass"],
      ['"solid"', "Solid"],
    ]);
    expect(suggestions[0]!.range).toEqual({
      startLineNumber: 1,
      startColumn: 28,
      endLineNumber: 1,
      endColumn: 30,
    });
    const hover = providers.hover as {
      provideHover: (model: unknown, position: unknown) => { contents: { value: string }[] } | null;
    };
    expect(hover.provideHover(settings, settings.getPositionAt(5))?.contents[0]?.value).toContain(
      "The header.",
    );
    unmark();
    expect(hover.provideHover(settings, settings.getPositionAt(5))).toBeNull();
  });

  it("turns diagnostics into markers, a lock faded", () => {
    const { monaco, setModelMarkers } = fakeMonaco();
    const model = fakeModel("settings", '{\n  "a": 1\n}');
    setSettingsMarkers(monaco, model as never, [
      { offset: 4, length: 3, severity: "warning", message: "Unknown setting" },
      { offset: 4, length: 6, severity: "info", message: "Set by product", unnecessary: true },
    ]);
    expect(setModelMarkers.mock.calls[0]![2]).toEqual([
      expect.objectContaining({ startLineNumber: 2, startColumn: 3, endColumn: 6, severity: 4 }),
      expect.objectContaining({ severity: 2, tags: [1], message: "Set by product" }),
    ]);
  });
});
