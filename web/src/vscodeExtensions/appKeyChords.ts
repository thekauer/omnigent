// The key chords the app already owns, in contributed-keybinding terms
// (`ctrl+shift+f`), so an extension can't bind one and swallow the app's
// shortcut. Read from the app's shortcut registries (the global one and the
// workspace sidebar's), plus the chords the app shows but matches elsewhere, the
// browser's own page chords, and the text-editing chords every page keeps.
import type { Chord } from "@/lib/shortcuts/chord";
import { SHORTCUT_BINDINGS, type ShortcutEnvironment } from "@/lib/shortcuts/registry";
import { WORKSPACE_SIDEBAR_BINDINGS } from "@/shell/workspaceTabs/workspaceSidebarShortcuts";

/** Modifiers in the order contributed chords compare in. */
const MODIFIER_ORDER = ["ctrl", "shift", "alt", "cmd"] as const;

/** A chord with its modifiers in a fixed order (`ctrl+shift+alt+cmd+key`). */
export function canonicalKeyChord(chord: string): string {
  const parts = chord.split("+");
  const key = parts.at(-1) ?? "";
  const modifiers = new Set(parts.slice(0, -1));
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

interface OwnedChord {
  /** The registry id, or a short name for chords outside the registries. */
  readonly id: string;
  readonly label: string;
  readonly chords: (environment: ShortcutEnvironment) => Chord[];
}

const mod = (key: string, extra: Partial<Chord> = {}): Chord => ({ mod: true, key, ...extra });
const bare = (key: string, extra: Partial<Chord> = {}): Chord => ({ key, ...extra });

/**
 * Cocoa's Control-letter text editing on macOS (⌃A line start, ⌃E line end, ⌃K kill,
 * ⌃Y yank, ⌃D/⌃H delete, ⌃F/⌃B/⌃N/⌃P move, ⌃T transpose, ⌃O open line, ⌃V page
 * down, ⌃L center). Every text field takes them, so no extension may.
 */
export const MAC_CONTROL_EDITING_KEYS: readonly string[] = Object.freeze([
  "a",
  "e",
  "k",
  "d",
  "h",
  "f",
  "b",
  "n",
  "p",
  "t",
  "o",
  "y",
  "v",
  "l",
]);

/**
 * Chords the app owns outside the registries: session actions its menus show
 * and match by hand, the browser and desktop shell's window and tab chords, and
 * text editing.
 */
const OTHER_OWNED: readonly OwnedChord[] = [
  { id: "session.pin", label: "Pin session", chords: () => [mod("p", { alt: true })] },
  { id: "session.archive", label: "Archive session", chords: () => [mod("a", { shift: true })] },
  { id: "session.fork", label: "Fork session", chords: () => [mod("f", { alt: true })] },
  {
    id: "window",
    label: "Window and tab keys",
    chords: () => [
      mod("t"),
      mod("t", { shift: true }),
      mod("w"),
      mod("w", { shift: true }),
      mod("q"),
      mod("r"),
      mod("l"),
      mod("n"),
    ],
  },
  {
    id: "browser",
    label: "Browser page keys",
    // Save, print, open, page info; reload and hard reload; full screen; developer tools.
    chords: () => [
      mod("s"),
      mod("p"),
      mod("o"),
      mod("i"),
      bare("f5"),
      bare("f5", { shift: true }),
      bare("f11"),
      bare("f12"),
    ],
  },
  {
    id: "edit",
    label: "Text editing",
    chords: () => [
      mod("a"),
      mod("c"),
      mod("v"),
      mod("x"),
      mod("z"),
      mod("z", { shift: true }),
      mod("y"),
    ],
  },
  {
    id: "edit.macControl",
    label: "macOS Control-key text editing",
    chords: (environment) =>
      environment.mac ? MAC_CONTROL_EDITING_KEYS.map((key) => bare(key, { ctrl: true })) : [],
  },
];

const OWNED: readonly OwnedChord[] = [
  ...SHORTCUT_BINDINGS,
  ...WORKSPACE_SIDEBAR_BINDINGS,
  ...OTHER_OWNED,
];

/** A registry chord as a contributed chord on one platform, or undefined for keys extensions can't bind. */
function toKeyChord(chord: Chord, mac: boolean): string | undefined {
  let key: string | undefined;
  if (chord.code !== undefined) {
    const match = /^(?:Key([A-Z])|Digit([0-9])|(F(?:[1-9]|1[0-2])))$/.exec(chord.code);
    key = match ? (match[1] ?? match[2] ?? match[3])!.toLowerCase() : undefined;
  } else if (chord.key !== undefined && /^(?:[a-z0-9]|f(?:[1-9]|1[0-2]))$/i.test(chord.key)) {
    key = chord.key.toLowerCase();
  }
  if (key === undefined) return undefined;
  const modifiers = [
    chord.ctrl || (!mac && chord.mod) ? "ctrl" : "",
    chord.shift ? "shift" : "",
    chord.alt ? "alt" : "",
    mac && chord.mod ? "cmd" : "",
  ].filter(Boolean);
  return [...modifiers, key].join("+");
}

const ownedByPlatform = new Map<boolean, Map<string, readonly OwnedChord[]>>();

/**
 * Every chord the app owns on a platform, in any shell (browser, desktop, with or
 * without menus), with all of its owners in registry order.
 */
function ownedChords(mac: boolean): Map<string, readonly OwnedChord[]> {
  const cached = ownedByPlatform.get(mac);
  if (cached) return cached;
  const owned = new Map<string, OwnedChord[]>();
  for (const native of [false, true]) {
    for (const desktopMenu of [false, true]) {
      const environment: ShortcutEnvironment = { mac, native, desktopMenu };
      for (const binding of OWNED) {
        for (const chord of binding.chords(environment)) {
          const keyChord = toKeyChord(chord, mac);
          if (keyChord === undefined) continue;
          const owners = owned.get(keyChord);
          if (!owners) owned.set(keyChord, [binding]);
          else if (!owners.includes(binding)) owners.push(binding);
        }
      }
    }
  }
  ownedByPlatform.set(mac, owned);
  return owned;
}

export interface AppShortcutOwner {
  readonly id: string;
  readonly label: string;
}

/** Every app shortcut a contributed chord would take on a platform; empty when it is free. */
export function appShortcutsOwning(chord: string, mac: boolean): readonly AppShortcutOwner[] {
  return (ownedChords(mac).get(canonicalKeyChord(chord)) ?? []).map((owner) => ({
    id: owner.id,
    label: owner.label,
  }));
}

/**
 * Built-in keybindings that take an app chord on purpose, as `<extension id>
 * <command>` to the app shortcut ids they replace. Content search's ⌘⇧F / Ctrl+Shift+F
 * is the editors' Find in Files, over the workspace's full-screen toggle.
 */
export const BUILT_IN_CHORD_OVERRIDES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "omnigent.content-search omnigent.content-search.view.focus": Object.freeze([
    "workspace.toggleFullScreen",
  ]),
});
