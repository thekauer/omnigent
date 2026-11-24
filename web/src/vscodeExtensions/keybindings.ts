// Contributed keybindings, as VS Code's keybinding service: one capture listener
// on the window runs the command of the first binding whose key and `when`
// clause match, so a binding also works from editors and terminals.
import { isMacPlatform } from "@/lib/hotkeys";
import type { ContextKeyService } from "./contextKeys";
import type { KeybindingContribution } from "./contributions";

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
>;

/** The chord of a key event in keybinding terms (`ctrl+shift+f`), from its physical key. */
export function chordOfEvent(event: KeyEventLike): string | undefined {
  const { code } = event;
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

/** A chord with its modifiers in a fixed order, to compare with {@link chordOfEvent}. */
function canonical(chord: string): string {
  const parts = chord.split("+");
  const key = parts.at(-1) ?? "";
  const modifiers = new Set(parts.slice(0, -1));
  return [
    ...["ctrl", "shift", "alt", "cmd"].filter((modifier) => modifiers.has(modifier)),
    key,
  ].join("+");
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

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.isComposing) return;
    const chord = chordOfEvent(event);
    if (chord === undefined) return;
    const lookup = this.options.contextKeys.lookup();
    const mac = this.options.isMac ?? isMacPlatform();
    const binding = this.bindings.find(
      (candidate) =>
        (mac ? candidate.macChord : candidate.chord) === chord &&
        (!candidate.when || candidate.when.evaluate(lookup)),
    );
    if (!binding) return;
    event.preventDefault();
    event.stopPropagation();
    this.options.executeCommand(binding.command).catch((error: unknown) => {
      this.options.logError(`${binding.extensionId}: keybinding ${binding.command} failed`, error);
    });
  };

  /** Adds an extension's keybindings; returns their removal. */
  add(extensionId: string, contributions: readonly KeybindingContribution[]): () => void {
    const added = contributions.map((contribution) => ({
      extensionId,
      command: contribution.command,
      chord: canonical(contribution.key),
      macChord: canonical(contribution.mac ?? contribution.key),
      when: contribution.when,
    }));
    this.bindings.push(...added);
    if (added.length > 0 && !this.listening && this.target) {
      this.listening = true;
      this.target.addEventListener("keydown", this.onKeyDown, true);
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
    if (this.listening) this.target?.removeEventListener("keydown", this.onKeyDown, true);
    this.listening = false;
  }
}
