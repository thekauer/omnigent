import { describe, expect, it, vi } from "vitest";
import { ContextKeyService } from "./contextKeys";
import { normalizeKeyChord, parseContributions } from "./contributions";
import { chordOfEvent, INPUT_FOCUS_CONTEXT_KEY, KeybindingService } from "./keybindings";

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
        key: "ctrl+shift+9",
        mac: "cmd+shift+9",
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
        { command: "a", key: "ctrl+alt+shift+k" },
        { command: "b", key: "ctrl+enter" },
        { command: "c", key: "ctrl+k", mac: "nope" },
        { key: "ctrl+k" },
        { command: "d", key: "alt+shift+9", when: "a &&" },
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
    expect(linux.press({ code: "Digit9", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(linux.executeCommand).not.toHaveBeenCalled();
    linux.contextKeys.set("view.pub.ext.view.available", true);
    expect(linux.press({ code: "Digit9", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(linux.executeCommand).toHaveBeenCalledWith("pub.ext.view.focus");
    // The macOS chord is not Linux's.
    expect(linux.press({ code: "Digit9", metaKey: true, shiftKey: true })).toBe(false);

    const mac = service(true);
    mac.contextKeys.set("view.pub.ext.view.available", true);
    expect(mac.press({ code: "Digit9", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(mac.press({ code: "Digit9", metaKey: true, shiftKey: true })).toBe(true);
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
      expect(press({ code: "Digit9", ctrlKey: true, shiftKey: true, ...extra })).toBe(false);
    }
    expect(press({ code: "Digit9", ctrlKey: true })).toBe(false);
    expect(executeCommand).not.toHaveBeenCalled();
    remove();
    expect(press({ code: "Digit9", ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it("logs a failing command against its extension", async () => {
    const { contextKeys, executeCommand, logError, press } = service(false);
    contextKeys.set("view.pub.ext.view.available", true);
    executeCommand.mockRejectedValueOnce(new Error("boom"));
    press({ code: "Digit9", ctrlKey: true, shiftKey: true });
    await vi.waitFor(() =>
      expect(logError).toHaveBeenCalledWith(
        "pub.ext: keybinding pub.ext.view.focus failed",
        expect.any(Error),
      ),
    );
  });
});

describe("keybinding guards", () => {
  const parse = (extensionId: string, key: string, mac?: string, builtIn = false) =>
    parseContributions(
      extensionId,
      { keybindings: [{ command: `${extensionId}.run`, key, mac }] },
      { builtIn },
    );

  it("refuses chords without Ctrl, Cmd or Alt unless they press an F-key", () => {
    for (const key of ["k", "shift+k", "1", "shift+1"]) {
      const { contributions, warnings } = parse("pub.ext", key);
      expect(contributions.keybindings).toEqual([]);
      expect(warnings[0]).toMatch(/needs Ctrl, Cmd or Alt, or an F-key/);
    }
    for (const key of ["f6", "shift+f7", "ctrl+alt+shift+k", "alt+shift+9"]) {
      expect(parse("pub.ext", key).contributions.keybindings).toHaveLength(1);
    }
    // The macOS chord is checked too.
    expect(parse("pub.ext", "ctrl+alt+shift+k", "k").warnings[0]).toMatch(/needs Ctrl/);
  });

  it("refuses chords the app owns, on either platform, naming the shortcut", () => {
    const cases: [string, string | undefined, RegExp][] = [
      ["ctrl+k", "cmd+alt+shift+9", /palette\.commands/],
      ["ctrl+alt+shift+9", "cmd+k", /palette\.commands/],
      ["ctrl+shift+f", "cmd+shift+f", /workspace\.toggleFullScreen/],
      ["alt+3", "ctrl+alt+shift+3", /workspace\.tab/],
      ["ctrl+c", "cmd+alt+shift+9", /edit/],
      ["ctrl+shift+a", "cmd+alt+shift+9", /session\.archive/],
    ];
    for (const [key, mac, owner] of cases) {
      const { contributions, warnings } = parse("pub.ext", key, mac);
      expect(contributions.keybindings).toEqual([]);
      expect(warnings[0]).toMatch(owner);
    }
  });

  it("lets only the allowlisted built-in take an app chord", () => {
    const search = parseContributions(
      "omnigent.content-search",
      {
        keybindings: [
          {
            command: "omnigent.content-search.view.focus",
            key: "ctrl+shift+f",
            mac: "cmd+shift+f",
          },
          { command: "omnigent.content-search.other", key: "ctrl+shift+f" },
        ],
      },
      { builtIn: true },
    );
    expect(search.contributions.keybindings.map((binding) => binding.command)).toEqual([
      "omnigent.content-search.view.focus",
    ]);
    // Not as a non-built-in with the same id, nor for a chord outside the override.
    expect(
      parse("omnigent.content-search", "ctrl+shift+f", "cmd+shift+f").contributions.keybindings,
    ).toEqual([]);
  });

  function serviceWith(key: string, isMac = false) {
    const contextKeys = new ContextKeyService();
    const executeCommand = vi.fn(() => Promise.resolve(undefined));
    const target = new EventTarget() as unknown as Window;
    const keybindings = new KeybindingService({
      contextKeys,
      executeCommand,
      logError: vi.fn(),
      isMac,
      target,
    });
    keybindings.add("pub.ext", parse("pub.ext", key).contributions.keybindings);
    const press = (init: KeyboardEventInit & { code: string }, from?: HTMLElement) => {
      const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
      if (from) Object.defineProperty(event, "target", { value: from });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const focus = (element: HTMLElement) => {
      const event = new FocusEvent("focusin");
      Object.defineProperty(event, "target", { value: element });
      target.dispatchEvent(event);
    };
    return { contextKeys, executeCommand, press, focus };
  }

  it("sets inputFocus while a text field has focus, and keeps non-Ctrl/Cmd chords out of it", () => {
    const { contextKeys, press, focus } = serviceWith("f6");
    const input = document.createElement("input");
    const button = document.createElement("button");
    focus(input);
    expect(contextKeys.get(INPUT_FOCUS_CONTEXT_KEY)).toBe(true);
    expect(press({ code: "F6" }, input)).toBe(false);
    focus(button);
    expect(contextKeys.get(INPUT_FOCUS_CONTEXT_KEY)).toBeUndefined();
    expect(press({ code: "F6" }, button)).toBe(true);

    const alt = serviceWith("alt+shift+9");
    expect(alt.press({ code: "Digit9", altKey: true, shiftKey: true }, input)).toBe(false);
    const ctrl = serviceWith("ctrl+alt+shift+k");
    expect(ctrl.press({ code: "KeyK", ctrlKey: true, altKey: true, shiftKey: true }, input)).toBe(
      true,
    );
  });

  it("treats AltGr off macOS as typing, not Ctrl+Alt", () => {
    const altGr = { code: "KeyK", ctrlKey: true, altKey: true, shiftKey: true };
    const withAltGraph = (init: typeof altGr) =>
      ({ ...init, getModifierState: (key: string) => key === "AltGraph" }) as never;
    expect(chordOfEvent(withAltGraph(altGr))).toBeUndefined();
    expect(chordOfEvent(withAltGraph(altGr), true)).toBe("ctrl+shift+alt+k");
    const { press, executeCommand } = serviceWith("ctrl+alt+shift+k");
    expect(
      press({ ...altGr, modifierAltGraph: true } as KeyboardEventInit & { code: string }),
    ).toBe(false);
    expect(press(altGr)).toBe(true);
    expect(executeCommand).toHaveBeenCalledOnce();
  });
});

describe("macOS text editing and browser chords", () => {
  const parse = (key: string, mac?: string) =>
    parseContributions("pub.ext", { keybindings: [{ command: "pub.ext.run", key, mac }] });

  it("refuses Cocoa's Control-letter editing keys as macOS chords only", () => {
    for (const letter of ["a", "e", "k", "d", "h", "f", "b", "n", "p", "t", "o", "y", "v", "l"]) {
      const { contributions, warnings } = parse("ctrl+alt+shift+9", `ctrl+${letter}`);
      expect(contributions.keybindings).toEqual([]);
      expect(warnings[0]).toMatch(/edit\.macControl/);
    }
    // Off macOS Ctrl+E is free, and ⌘E stays free on macOS.
    expect(parse("ctrl+e", "cmd+e").contributions.keybindings).toHaveLength(1);
  });

  it("refuses the browser's own page chords, and bare F5, F11 and F12", () => {
    for (const [key, mac] of [
      ["ctrl+s", "cmd+alt+shift+9"],
      ["ctrl+alt+shift+9", "cmd+p"],
      ["ctrl+o", undefined],
      ["ctrl+alt+shift+9", "cmd+i"],
      ["f5", undefined],
      ["shift+f5", undefined],
      ["f11", undefined],
      ["f12", undefined],
    ] as const) {
      const { contributions, warnings } = parse(key, mac);
      expect(contributions.keybindings).toEqual([]);
      expect(warnings[0]).toMatch(/browser/);
    }
    for (const key of ["f6", "ctrl+f5", "alt+f12", "ctrl+shift+f11"]) {
      expect(parse(key).contributions.keybindings).toHaveLength(1);
    }
  });

  it("names every owner of a chord several shortcuts share", () => {
    const owners = (warning: string | undefined) =>
      [...(warning ?? "").matchAll(/\(([a-zA-Z.]+)\)/g)].map((match) => match[1]);
    // Ctrl+N is both the window keys' new window and the app's new session.
    const { warnings } = parse("ctrl+n", "cmd+alt+shift+9");
    expect(owners(warnings[0]).sort()).toEqual(["session.new", "window"]);
    expect(warnings[0]).toMatch(/ and .* shortcuts;/);
    // A single owner reads as before.
    expect(parse("ctrl+alt+shift+9", "ctrl+l").warnings[0]).toMatch(
      /is the app's "macOS Control-key text editing" \(edit\.macControl\) shortcut;/,
    );
  });
});

describe("macOS text fields", () => {
  function macService(key: string, mac: string) {
    const contextKeys = new ContextKeyService();
    const executeCommand = vi.fn(() => Promise.resolve(undefined));
    const target = new EventTarget() as unknown as Window;
    const keybindings = new KeybindingService({
      contextKeys,
      executeCommand,
      logError: vi.fn(),
      isMac: true,
      target,
    });
    const { contributions } = parseContributions("pub.ext", {
      keybindings: [{ command: "pub.ext.run", key, mac }],
    });
    expect(contributions.keybindings).toHaveLength(1);
    keybindings.add("pub.ext", contributions.keybindings);
    const press = (init: KeyboardEventInit & { code: string }, from: HTMLElement) => {
      const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
      Object.defineProperty(event, "target", { value: from });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return { press, executeCommand };
  }

  it("lets only Cmd chords run from a text field, so Control keys keep editing", () => {
    const input = document.createElement("input");
    const button = document.createElement("button");
    const control = macService("ctrl+alt+shift+9", "ctrl+alt+shift+k");
    const chord = { code: "KeyK", ctrlKey: true, altKey: true, shiftKey: true };
    expect(control.press(chord, input)).toBe(false);
    expect(control.executeCommand).not.toHaveBeenCalled();
    expect(control.press(chord, button)).toBe(true);

    const cmd = macService("ctrl+alt+shift+9", "cmd+alt+shift+k");
    expect(cmd.press({ code: "KeyK", metaKey: true, altKey: true, shiftKey: true }, input)).toBe(
      true,
    );
  });
});

describe("inputFocus past the extensions' context key cap", () => {
  it("is a host key the full store still takes, and errors in the listeners are logged", () => {
    const contextKeys = new ContextKeyService();
    for (let index = 0; index < 500; index++) contextKeys.set(`ext.key${index}`, true);
    expect(() => contextKeys.set("ext.one-more", true)).toThrow(/too many context keys/);
    const logError = vi.fn();
    const target = new EventTarget() as unknown as Window;
    const executeCommand = vi.fn(() => Promise.resolve(undefined));
    const keybindings = new KeybindingService({
      contextKeys,
      executeCommand,
      logError,
      isMac: false,
      target,
    });
    keybindings.add(
      "pub.ext",
      parseContributions("pub.ext", { keybindings: [{ command: "pub.ext.run", key: "f6" }] })
        .contributions.keybindings,
    );
    const input = document.createElement("input");
    const focusIn = new FocusEvent("focusin");
    Object.defineProperty(focusIn, "target", { value: input });
    expect(() => target.dispatchEvent(focusIn)).not.toThrow();
    expect(contextKeys.get(INPUT_FOCUS_CONTEXT_KEY)).toBe(true);
    // Host keys don't use up the extensions' room either.
    contextKeys.set("ext.key0", undefined);
    expect(() => contextKeys.set("ext.replacement", true)).not.toThrow();

    // A store that throws anyway is logged, and the key press goes on.
    vi.spyOn(contextKeys, "setHost").mockImplementation(() => {
      throw new Error("store broke");
    });
    const button = document.createElement("button");
    const key = new KeyboardEvent("keydown", { code: "F6", cancelable: true });
    Object.defineProperty(key, "target", { value: button });
    expect(() => target.dispatchEvent(key)).not.toThrow();
    expect(key.defaultPrevented).toBe(true);
    expect(executeCommand).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith("could not set inputFocus", expect.any(Error));
  });
});

describe("KeybindingService scope", () => {
  function scoped(scope: "window" | "appRoot" | undefined) {
    const contextKeys = new ContextKeyService();
    contextKeys.set("ready", true);
    const executeCommand = vi.fn(() => Promise.resolve(undefined));
    const keybindings = new KeybindingService({
      contextKeys,
      executeCommand,
      logError: vi.fn(),
      isMac: false,
      target: window,
      scope,
    });
    const { contributions } = parseContributions("pub.ext", {
      keybindings: [{ command: "pub.ext.find", key: "ctrl+shift+9", when: "ready" }],
    });
    keybindings.add("pub.ext", contributions.keybindings);
    const root = document.createElement("div");
    root.className = "omnigent-app";
    const inner = document.createElement("div");
    const appInput = document.createElement("input");
    inner.append(appInput);
    root.append(inner);
    const hostInput = document.createElement("input");
    document.body.append(root, hostInput);
    const press = (target: EventTarget) => {
      const event = new KeyboardEvent("keydown", {
        code: "Digit9",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const cleanup = () => {
      keybindings.dispose();
      root.remove();
      hostInput.remove();
    };
    return { contextKeys, executeCommand, root, inner, appInput, hostInput, press, cleanup };
  }

  it.each([undefined, "window"] as const)(
    "dispatches from anywhere in the window (%s)",
    (scope) => {
      const s = scoped(scope);
      try {
        expect(s.press(s.hostInput)).toBe(true);
        expect(s.press(document.body)).toBe(true);
        expect(s.press(s.inner)).toBe(true);
        expect(s.executeCommand).toHaveBeenCalledTimes(3);
      } finally {
        s.cleanup();
      }
    },
  );

  it("scoped to app roots, leaves keys pressed elsewhere on the page to it", () => {
    const s = scoped("appRoot");
    try {
      // The host page's own field and its body keep the chord, unprevented.
      s.hostInput.focus();
      expect(s.press(s.hostInput)).toBe(false);
      expect(s.contextKeys.lookup()(INPUT_FOCUS_CONTEXT_KEY)).toBeUndefined();
      s.hostInput.blur();
      expect(s.press(document.body)).toBe(false);
      expect(s.press(window)).toBe(false);
      expect(s.executeCommand).not.toHaveBeenCalled();
      // Inside the app root, including its own fields, it runs.
      expect(s.press(s.inner)).toBe(true);
      s.appInput.focus();
      expect(s.contextKeys.lookup()(INPUT_FOCUS_CONTEXT_KEY)).toBe(true);
      expect(s.press(s.appInput)).toBe(true);
      expect(s.executeCommand).toHaveBeenCalledTimes(2);
      // A detached root no longer counts.
      s.root.remove();
      expect(s.press(s.inner)).toBe(false);
      expect(s.executeCommand).toHaveBeenCalledTimes(2);
    } finally {
      s.cleanup();
    }
  });
});
