import { afterEach, describe, expect, it } from "vitest";

import { readThemeTokens, subscribeThemeTokens, TOKEN_MODE_PROBE_ATTRIBUTE } from "./tokenValues";

const style = document.createElement("style");

afterEach(() => {
  style.remove();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
});

describe("readThemeTokens", () => {
  it("reads tokens on the theme root, unset ones as empty", () => {
    document.documentElement.style.setProperty("--terminal-background", "#123456");
    expect(readThemeTokens(["terminal-background", "terminal-ansi-red"])).toEqual({
      "terminal-background": "#123456",
      "terminal-ansi-red": "",
    });
  });

  it("reads the other mode on a probe, and removes it", () => {
    style.textContent = `
      :root { --terminal-background: light-root; }
      [${TOKEN_MODE_PROBE_ATTRIBUTE}="dark"] { --terminal-background: dark-probe; }
      [${TOKEN_MODE_PROBE_ATTRIBUTE}="light"] { --terminal-background: light-probe; }
    `;
    document.head.append(style);
    expect(readThemeTokens(["terminal-background"], "dark")).toEqual({
      "terminal-background": "dark-probe",
    });
    // The root's own mode reads the root: a theme's value there wins over the defaults.
    expect(readThemeTokens(["terminal-background"], "light")).toEqual({
      "terminal-background": "light-root",
    });
    document.documentElement.className = "dark";
    expect(readThemeTokens(["terminal-background"], "light")).toEqual({
      "terminal-background": "light-probe",
    });
    expect(document.querySelector(`[${TOKEN_MODE_PROBE_ATTRIBUTE}]`)).toBeNull();
  });
});

describe("subscribeThemeTokens", () => {
  it("notifies on the root's class, palette and inline variables", async () => {
    let calls = 0;
    const unsubscribe = subscribeThemeTokens(() => {
      calls += 1;
    });
    document.documentElement.classList.add("dark");
    await Promise.resolve();
    document.documentElement.setAttribute("data-theme", "nord");
    await Promise.resolve();
    document.documentElement.style.setProperty("--syntax-theme-dark", "nord");
    await Promise.resolve();
    expect(calls).toBe(3);
    unsubscribe();
    document.documentElement.removeAttribute("data-theme");
    await Promise.resolve();
    expect(calls).toBe(3);
  });
});
