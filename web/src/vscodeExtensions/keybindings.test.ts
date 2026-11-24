import { describe, expect, it, vi } from "vitest";
import { ContextKeyService } from "./contextKeys";
import { normalizeKeyChord, parseContributions } from "./contributions";
import { chordOfEvent, KeybindingService } from "./keybindings";

function service(isMac: boolean) {
  const contextKeys = new ContextKeyService();
  const executeCommand = vi.fn(() => Promise.resolve(undefined));
  const logError = vi.fn();
  const target = new EventTarget() as unknown as Window;
  const keybindings = new KeybindingService({
    contextKeys,
    executeCommand,
    logError,
    isMac,
    target,
  });
  const { contributions } = parseContributions("pub.ext", {
    keybindings: [
      {
        command: "pub.ext.view.focus",
        key: "ctrl+shift+f",
        mac: "cmd+shift+f",
        when: "view.pub.ext.view.available",
      },
    ],
  });
  const remove = keybindings.add("pub.ext", contributions.keybindings);
  const press = (init: KeyboardEventInit & { code: string }) => {
    const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { contextKeys, executeCommand, logError, keybindings, remove, press };
}

describe("key chords", () => {
  it("reads a key event's chord from its physical key, modifiers in a fixed order", () => {
    expect(chordOfEvent({ code: "KeyF", ctrlKey: true, shiftKey: true } as KeyboardEvent)).toBe(
      "ctrl+shift+f",
    );
    expect(chordOfEvent({ code: "Digit3", metaKey: true } as KeyboardEvent)).toBe("cmd+3");
    expect(chordOfEvent({ code: "F12", altKey: true } as KeyboardEvent)).toBe("alt+f12");
    expect(chordOfEvent({ code: "Enter" } as KeyboardEvent)).toBeUndefined();
  });

  it("normalizes contributed keys and refuses malformed ones", () => {
    expect(normalizeKeyChord("Ctrl+Shift+F")).toBe("ctrl+shift+f");
    expect(normalizeKeyChord("meta+k")).toBe("cmd+k");
    for (const bad of ["ctrl+", "ctrl+ctrl+f", "hyper+f", "ctrl+enter", 3]) {
      expect(normalizeKeyChord(bad)).toBeUndefined();
    }
  });

  it("parses contributes.keybindings, warning about bad entries", () => {
    const { contributions, warnings } = parseContributions("pub.ext", {
      keybindings: [
        { command: "a", key: "ctrl+k" },
        { command: "b", key: "ctrl+enter" },
        { command: "c", key: "ctrl+k", mac: "nope" },
        { key: "ctrl+k" },
        { command: "d", key: "alt+1", when: "a &&" },
      ],
    });
    expect(contributions.keybindings.map((binding) => binding.command)).toEqual(["a", "d"]);
    expect(warnings).toHaveLength(4);
    expect(contributions.keybindings[1].when?.evaluate(() => true)).toBe(false);
  });
});

describe("KeybindingService", () => {
  it("runs the command for the platform's chord while its when clause holds", () => {
    const linux = service(false);
    expect(linux.press({ code: "KeyF", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(linux.executeCommand).not.toHaveBeenCalled();
    linux.contextKeys.set("view.pub.ext.view.available", true);
    expect(linux.press({ code: "KeyF", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(linux.executeCommand).toHaveBeenCalledWith("pub.ext.view.focus");
    // The macOS chord is not Linux's.
    expect(linux.press({ code: "KeyF", metaKey: true, shiftKey: true })).toBe(false);

    const mac = service(true);
    mac.contextKeys.set("view.pub.ext.view.available", true);
    expect(mac.press({ code: "KeyF", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(mac.press({ code: "KeyF", metaKey: true, shiftKey: true })).toBe(true);
    expect(mac.executeCommand).toHaveBeenCalledOnce();
  });

  it("ignores repeats, composition, other modifiers and removed bindings", () => {
    const { contextKeys, executeCommand, press, remove } = service(false);
    contextKeys.set("view.pub.ext.view.available", true);
    for (const extra of [
      { repeat: true },
      { isComposing: true },
      { altKey: true },
      { metaKey: true },
    ]) {
      expect(press({ code: "KeyF", ctrlKey: true, shiftKey: true, ...extra })).toBe(false);
    }
    expect(press({ code: "KeyF", ctrlKey: true })).toBe(false);
    expect(executeCommand).not.toHaveBeenCalled();
    remove();
    expect(press({ code: "KeyF", ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it("logs a failing command against its extension", async () => {
    const { contextKeys, executeCommand, logError, press } = service(false);
    contextKeys.set("view.pub.ext.view.available", true);
    executeCommand.mockRejectedValueOnce(new Error("boom"));
    press({ code: "KeyF", ctrlKey: true, shiftKey: true });
    await vi.waitFor(() =>
      expect(logError).toHaveBeenCalledWith(
        "pub.ext: keybinding pub.ext.view.focus failed",
        expect.any(Error),
      ),
    );
  });
});
