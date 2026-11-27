// The settings JSON language in Monaco (theming plan M10b): the theme service's language
// service (`theme/settingsLanguage.ts`) as completion and hover providers and markers, for
// the settings editor's models only. Shiki's `jsonc` grammar tokenizes; Monaco's JSON
// worker stays out (monacoSetup ships no language workers).

import type { MonacoModule } from "../monacoSetup";
import {
  type SettingsDiagnostic,
  settingsCompletions,
  settingsHover,
} from "@/configuration/settingsLanguage";
import type { SettingsSchemaNode } from "@/configuration/settingsSchema";

export const SETTINGS_JSON_LANGUAGE = "jsonc";
export const SETTINGS_JSON_MARKER_OWNER = "omnigent-settings";

type Model = ReturnType<MonacoModule["editor"]["createModel"]>;

/** The settings editor's models, by URI: the providers answer only for them. */
const settingsModels = new Set<string>();
let installed: MonacoModule | null = null;
let schemaSource: () => SettingsSchemaNode = () => ({});

export function markSettingsModel(model: Model): () => void {
  const key = model.uri.toString();
  settingsModels.add(key);
  return () => settingsModels.delete(key);
}

/** A span of the text as a Monaco range. */
function rangeOf(model: Model, offset: number, length: number) {
  const start = model.getPositionAt(offset);
  const end = model.getPositionAt(offset + length);
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
}

/** Installs the providers once; `schema` is read at each request, so it follows the service. */
export function installSettingsJsonLanguage(
  monaco: MonacoModule,
  schema: () => SettingsSchemaNode,
): void {
  schemaSource = schema;
  if (installed === monaco) return;
  installed = monaco;
  monaco.languages.registerCompletionItemProvider(SETTINGS_JSON_LANGUAGE, {
    triggerCharacters: ['"', ":"],
    provideCompletionItems(model, position) {
      if (!settingsModels.has(model.uri.toString())) return { suggestions: [] };
      const offset = model.getOffsetAt(position);
      const items = settingsCompletions(model.getValue(), offset, schemaSource());
      return {
        suggestions: items.map((item) => ({
          label: item.label,
          kind:
            item.kind === "property"
              ? monaco.languages.CompletionItemKind.Property
              : monaco.languages.CompletionItemKind.Value,
          detail: item.detail,
          documentation: item.documentation ? { value: item.documentation } : undefined,
          insertText: item.insertText,
          insertTextRules: item.snippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          range: rangeOf(model, item.offset, item.length),
        })),
      };
    },
  });
  monaco.languages.registerHoverProvider(SETTINGS_JSON_LANGUAGE, {
    provideHover(model, position) {
      if (!settingsModels.has(model.uri.toString())) return null;
      const hover = settingsHover(model.getValue(), model.getOffsetAt(position), schemaSource());
      if (!hover) return null;
      return {
        range: rangeOf(model, hover.offset, hover.length),
        contents: [{ value: hover.contents }],
      };
    },
  });
}

/** Monaco's marker for a diagnostic: errors, warnings and information, a lock drawn faded. */
export function settingsMarker(monaco: MonacoModule, model: Model, diagnostic: SettingsDiagnostic) {
  const severity = {
    error: monaco.MarkerSeverity.Error,
    warning: monaco.MarkerSeverity.Warning,
    info: monaco.MarkerSeverity.Info,
  }[diagnostic.severity];
  // A zero-length span (the whole text) marks the first character.
  const length = Math.max(diagnostic.length, 1);
  return {
    ...rangeOf(model, diagnostic.offset, length),
    severity,
    message: diagnostic.message,
    source: "settings",
    ...(diagnostic.unnecessary ? { tags: [monaco.MarkerTag.Unnecessary] } : {}),
  };
}

export function setSettingsMarkers(
  monaco: MonacoModule,
  model: Model,
  diagnostics: readonly SettingsDiagnostic[],
): void {
  monaco.editor.setModelMarkers(
    model,
    SETTINGS_JSON_MARKER_OWNER,
    diagnostics.map((diagnostic) => settingsMarker(monaco, model, diagnostic)),
  );
}
