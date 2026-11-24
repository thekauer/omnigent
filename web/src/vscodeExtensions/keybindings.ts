// Contributed keybindings, as VS Code's keybinding service: one capture listener
// on the window runs the command of the first binding whose key and `when`
// clause match, so a binding also works from editors and terminals. While focus
// is in a text field (`inputFocus`), only Ctrl or Cmd chords run, so typing,
// including Option and AltGr characters, reaches the field. On macOS only Cmd
// chords run there: Control-letter keys are Cocoa's text editing (⌃A, ⌃E, ⌃K...).
import { isMacPlatform, isTextEntry } from "@/lib/hotkeys";
import { canonicalKeyChord } from "./appKeyChords";
import type { ContextKeyService } from "./contextKeys";
import type { KeybindingContribution } from "./contributions";

/** Context key set while keyboard focus is in a field that takes typed text. */
export const INPUT_FOCUS_CONTEXT_KEY = "inputFocus";

export interface KeybindingServiceOptions {
  contextKeys: ContextKeyService;
  executeCommand: (command: string) => Promise<unknown>;
  logError: (message: string, error?: unknown) => void;
  isMac?: boolean;
  target?: Pick<Window, "addEventListener" | "removeEventListener">;
}

type KeyEventLike = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "repeat" | "isComposing"
> &
  Partial<Pick<KeyboardEvent, "getModifierState">>;

/**
 * The chord of a key event in keybinding terms (`ctrl+shift+f`), from its physical key.
 * Off macOS, AltGr reports as Ctrl+Alt but types a character, so it is no chord.
 */
export function chordOfEvent(event: KeyEventLike, mac = false): string | undefined {
  const { code } = event;
  if (!mac && event.getModifierState?.("AltGraph")) return undefined;
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F(?:[1-9]|1[0-2])$/.test(code)) key = code.toLowerCase();
  if (key === undefined) return undefined;
  const modifiers = [
    event.ctrlKey ? "ctrl" : "",
    event.shiftKey ? "shift" : "",
    event.altKey ? "alt" : "",
    event.metaKey ? "cmd" : "",
  ].filter(Boolean);
  return [...modifiers, key].join("+");
}

/**
 * Whether a chord may run while a text field has focus: it holds Cmd, or off macOS
 * Ctrl, which typing never does. On macOS Control-letter keys edit text.
 */
function passesTextField(chord: string, mac: boolean): boolean {
  return chord.includes("cmd+") || (!mac && chord.startsWith("ctrl+"));
}

function takesText(element: unknown): boolean {
  return (
    typeof HTMLElement !== "undefined" && element instanceof HTMLElement && isTextEntry(element)
  );
}

interface Binding {
  readonly extensionId: string;
  readonly command: string;
  readonly chord: string;
  /** The chord on macOS. */
  readonly macChord: string;
  readonly when: KeybindingContribution["when"];
}

export class KeybindingService {
  private readonly options: KeybindingServiceOptions;
  private readonly bindings: Binding[] = [];
  private readonly target: Pick<Window, "addEventListener" | "removeEventListener"> | undefined;
  private listening = false;

  constructor(options: KeybindingServiceOptions) {
    this.options = options;
    this.target = options.target ?? (typeof window === "undefined" ? undefined : window);
  }

  /** Keeps `inputFocus` in step with focus: set while a text field has it. */
  private readonly onFocusIn = (event: FocusEvent): void => {
    this.setInputFocus(takesText(event.target));
  };

  private readonly onFocusOut = (event: FocusEvent): void => {
    this.setInputFocus(takesText(event.relatedTarget));
  };

  /** A host key, outside the extensions' cap; an error is logged, never thrown into the page. */
  private setInputFocus(focused: boolean): void {
    try {
      this.options.contextKeys.setHost(INPUT_FOCUS_CONTEXT_KEY, focused ? true : undefined);
    } catch (error) {
      this.options.logError(`could not set ${INPUT_FOCUS_CONTEXT_KEY}`, error);
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    try {
      this.handleKeyDown(event);
    } catch (error) {
      this.options.logError("keybinding dispatch failed", error);
    }
  };

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.repeat || event.isComposing) return;
    const mac = this.options.isMac ?? isMacPlatform();
    const chord = chordOfEvent(event, mac);
    if (chord === undefined) return;
    // The event's own target decides, so a stale or extension-set key can't let typing through.
    const inputFocus = takesText(event.target);
    this.setInputFocus(inputFocus);
    if (inputFocus && !passesTextField(chord, mac)) return;
    const lookup = this.options.contextKeys.lookup();
    const binding = this.bindings.find(
      (candidate) =>
        (mac ? candidate.macChord : candidate.chord) === chord &&
        (!candidate.when || candidate.when.evaluate(lookup)),
    );
    if (!binding) return;
    event.preventDefault();
    event.stopPropagation();
    let running: Promise<unknown>;
    try {
      running = this.options.executeCommand(binding.command);
    } catch (error) {
      running = Promise.reject(error);
    }
    running.catch((error: unknown) => {
      this.options.logError(`${binding.extensionId}: keybinding ${binding.command} failed`, error);
    });
  }

  /** Adds an extension's keybindings; returns their removal. */
  add(extensionId: string, contributions: readonly KeybindingContribution[]): () => void {
    const added = contributions.map((contribution) => ({
      extensionId,
      command: contribution.command,
      chord: canonicalKeyChord(contribution.key),
      macChord: canonicalKeyChord(contribution.mac ?? contribution.key),
      when: contribution.when,
    }));
    this.bindings.push(...added);
    if (added.length > 0 && !this.listening && this.target) {
      this.listening = true;
      this.target.addEventListener("keydown", this.onKeyDown, true);
      this.target.addEventListener("focusin", this.onFocusIn as EventListener, true);
      this.target.addEventListener("focusout", this.onFocusOut as EventListener, true);
    }
    return () => {
      for (const binding of added) {
        const index = this.bindings.indexOf(binding);
        if (index >= 0) this.bindings.splice(index, 1);
      }
    };
  }

  dispose(): void {
    this.bindings.length = 0;
    if (this.listening) {
      this.target?.removeEventListener("keydown", this.onKeyDown, true);
      this.target?.removeEventListener("focusin", this.onFocusIn as EventListener, true);
      this.target?.removeEventListener("focusout", this.onFocusOut as EventListener, true);
    }
    this.listening = false;
  }
}
