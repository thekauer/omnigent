// The settings JSON editor's Monaco surface (theming plan M10b): JSONC with the settings
// schema's completions and hovers, the problems as markers, and Cmd/Ctrl+S to save.
// Lazy: it brings Monaco with it.

import { useEffect, useMemo, useRef, useState } from "react";
import { Editor, type OnMount } from "@monaco-editor/react";

import { useResolvedThemeMode } from "@/components/theme/useResolvedThemeMode";
import { codeFontFamilyForEditor, readCodeFont } from "@/lib/codeFontPreferences";
import type { SettingsDiagnostic } from "@/theme/settingsLanguage";
import { themeService } from "@/theme/themeService";

import { ensureLanguage, ensureMonacoReady, type MonacoModule } from "../monacoSetup";
import { useMonacoTheme } from "../monacoTheme";
import {
  installSettingsJsonLanguage,
  markSettingsModel,
  SETTINGS_JSON_LANGUAGE,
  setSettingsMarkers,
} from "./settingsJsonMonaco";
import { OverflowWidgets } from "./OverflowWidgets";

type EditorInstance = Parameters<OnMount>[0];

export interface SettingsJsonEditorProps {
  /** The text when the editor opens; later edits stay in the editor. */
  defaultValue: string;
  /** The problems to mark, as the dialog checked them. */
  diagnostics: readonly SettingsDiagnostic[];
  onChange: (text: string) => void;
  onSave: () => void;
  /** Where the editor reports itself, for the dialog's jump to a problem. */
  onReady?: (reveal: (offset: number) => void) => void;
}

export function SettingsJsonEditor({
  defaultValue,
  diagnostics,
  onChange,
  onSave,
  onReady,
}: SettingsJsonEditorProps) {
  const theme = useMonacoTheme(useResolvedThemeMode());
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const editorRef = useRef<EditorInstance | null>(null);
  const monacoRef = useRef<MonacoModule | null>(null);
  // The hover and suggestions render outside the dialog's box (OverflowWidgets.tsx).
  const [overflowWidgets, setOverflowWidgets] = useState<HTMLDivElement | null>(null);
  const latest = useRef({ onSave, onChange });
  latest.current = { onSave, onChange };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([ensureMonacoReady(), ensureLanguage(SETTINGS_JSON_LANGUAGE)]).then(
      () => {
        if (!cancelled) setReady(true);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (monaco && model) setSettingsMarkers(monaco, model, diagnostics);
  }, [diagnostics]);

  const options = useMemo(() => {
    const font = readCodeFont();
    return {
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      fontSize: font.sizePx,
      fontFamily: codeFontFamilyForEditor(font.family),
      tabSize: 2,
      insertSpaces: true,
      // Keys and values are strings: suggest inside them as VS Code's settings.json does.
      quickSuggestions: { other: true, strings: true, comments: false },
      ariaLabel: "Settings JSON",
      fixedOverflowWidgets: true,
      overflowWidgetsDomNode: overflowWidgets ?? undefined,
    } as const;
  }, [overflowWidgets]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    installSettingsJsonLanguage(monaco, () => themeService.getSettingsSchema());
    const model = editor.getModel();
    if (model) {
      const unmark = markSettingsModel(model);
      model.onWillDispose(unmark);
      setSettingsMarkers(monaco, model, diagnostics);
    }
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => latest.current.onSave());
    onReady?.((offset) => {
      const position = editor.getModel()?.getPositionAt(offset);
      if (!position) return;
      editor.setPosition(position);
      editor.revealPositionInCenter(position);
      editor.focus();
    });
    editor.focus();
  };

  let content;
  if (failed) {
    content = (
      <div className="flex h-full items-center justify-center text-destructive text-ui">
        Failed to load the editor.
      </div>
    );
  } else if (!ready || !overflowWidgets) {
    content = (
      <div className="flex h-full items-center justify-center text-muted-foreground text-ui">
        Loading…
      </div>
    );
  } else {
    content = (
      <Editor
        height="100%"
        theme={theme}
        language={SETTINGS_JSON_LANGUAGE}
        path="omnigent-settings/settings.json"
        defaultValue={defaultValue}
        options={options}
        onMount={handleMount}
        onChange={(value) => latest.current.onChange(value ?? "")}
      />
    );
  }
  // The node first, at a fixed place, so it stays the one the editor was created with.
  return (
    <>
      <OverflowWidgets onNode={setOverflowWidgets} />
      {content}
    </>
  );
}
