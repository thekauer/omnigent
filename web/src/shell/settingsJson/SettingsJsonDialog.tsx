// The settings JSON dialog (theming plan M10b): the theme options, style variants and colour
// customizations as one JSON document, as VS Code's settings.json. Problems show as typed
// (once typing pauses); Save stores the text, and a text with syntax errors keeps the last
// good values applying until it is fixed.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { closeSettingsJsonEditor, useSettingsJsonEditorStore } from "@/store/settingsJsonEditor";
import type { SettingsDiagnostic } from "@/theme/settingsLanguage";
import { themeService, useThemeCustomizationsHidden } from "@/theme/themeService";

const SettingsJsonEditor = lazy(() =>
  import("./SettingsJsonEditor").then((module) => ({ default: module.SettingsJsonEditor })),
);

/** How long typing pauses before the text is checked. */
const CHECK_DELAY_MS = 250;
/** The most problems listed under the editor (the markers show all). */
const MAX_LISTED = 20;

/** Line and column (1-based) of `offset`. */
function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - before.lastIndexOf("\n") };
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

export function SettingsJsonDialog() {
  const open = useStore(useSettingsJsonEditorStore, (state) => state.open);
  const hidden = useThemeCustomizationsHidden();
  // A product that turns customizations off has nothing here to edit.
  const shown = open && !hidden;
  return (
    <Dialog open={shown} onOpenChange={(next) => !next && closeSettingsJsonEditor()}>
      {shown && <SettingsJsonDialogBody />}
    </Dialog>
  );
}

function SettingsJsonDialogBody() {
  const [initial] = useState(() => themeService.getSettingsText());
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [diagnostics, setDiagnostics] = useState<SettingsDiagnostic[]>(() =>
    themeService.checkSettings(initial),
  );
  const [status, setStatus] = useState<string | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reveal = useRef<((offset: number) => void) | null>(null);
  useEffect(() => () => clearTimeout(pending.current), []);
  // The schema follows the themes and the product's locks: check again when they change.
  useEffect(
    () =>
      themeService.onDidChange(() => {
        clearTimeout(pending.current);
        pending.current = setTimeout(
          () => setDiagnostics(themeService.checkSettings(latestText.current)),
          CHECK_DELAY_MS,
        );
      }),
    [],
  );
  const latestText = useRef(text);
  latestText.current = text;

  const change = (next: string) => {
    setText(next);
    setStatus(null);
    clearTimeout(pending.current);
    pending.current = setTimeout(
      () => setDiagnostics(themeService.checkSettings(next)),
      CHECK_DELAY_MS,
    );
  };
  const save = () => {
    clearTimeout(pending.current);
    const current = latestText.current;
    const result = themeService.saveSettings(current);
    setDiagnostics(result.diagnostics);
    if (!result.saved) {
      setStatus("Not saved: the settings are too long.");
      return;
    }
    setSaved(current);
    setStatus(
      themeService.isSettingsTextValid()
        ? "Saved."
        : "Saved with syntax errors: the last good settings apply until they're fixed.",
    );
  };

  const listed = useMemo(
    () =>
      [...diagnostics]
        .sort(
          (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.offset - b.offset,
        )
        .slice(0, MAX_LISTED),
    [diagnostics],
  );
  const dirty = text !== saved;
  const errors = diagnostics.filter((entry) => entry.severity === "error").length;

  return (
    <DialogContent
      data-testid="settings-json-dialog"
      className="flex max-h-[90vh] flex-col gap-3 sm:max-w-3xl"
      onEscapeKeyDown={(event) => {
        // Escape closes the editor's open suggestions first, as in the editor elsewhere.
        if (document.querySelector(".monaco-editor .suggest-widget.visible"))
          event.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>Settings (JSON)</DialogTitle>
        <DialogDescription>
          Theme options, style variants and color customizations. Unset keys keep the theme's own.
          Press Ctrl+Space for suggestions; hover a key for what it does.
        </DialogDescription>
      </DialogHeader>
      <div
        data-testid="settings-json-editor"
        className="h-[50vh] min-h-64 rounded-md border border-border"
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-muted-foreground text-ui">
              Loading…
            </div>
          }
        >
          <SettingsJsonEditor
            defaultValue={initial}
            diagnostics={diagnostics}
            onChange={change}
            onSave={save}
            onReady={(revealAt) => {
              reveal.current = revealAt;
            }}
          />
        </Suspense>
      </div>
      {listed.length > 0 && (
        <ul
          data-testid="settings-json-problems"
          aria-label="Problems"
          className="max-h-32 overflow-auto text-xs"
        >
          {listed.map((entry) => {
            const { line, column } = lineColumn(text, entry.offset);
            return (
              <li key={`${entry.offset}:${entry.message}`} data-severity={entry.severity}>
                <button
                  type="button"
                  className={
                    entry.severity === "error"
                      ? "text-left text-destructive hover:underline"
                      : "text-left text-muted-foreground hover:underline"
                  }
                  onClick={() => reveal.current?.(entry.offset)}
                >
                  Ln {line}, Col {column}: {entry.message}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <DialogFooter className="items-center gap-2 sm:justify-between">
        <span
          role="status"
          data-testid="settings-json-status"
          className="text-muted-foreground text-xs"
        >
          {status ??
            (dirty
              ? errors > 0
                ? `Unsaved changes, ${errors} ${errors === 1 ? "error" : "errors"}.`
                : "Unsaved changes."
              : "")}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={closeSettingsJsonEditor}
            data-testid="settings-json-close"
          >
            {dirty ? "Discard" : "Close"}
          </Button>
          <Button onClick={save} disabled={!dirty} data-testid="settings-json-save">
            Save
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
