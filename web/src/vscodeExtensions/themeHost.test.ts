// The extension host hands an extension's theme contributions and files to the theme
// service before it activates, removes them on teardown, and runs the built-in
// `omnigent.selectColorTheme` command.

import { describe, expect, it, vi } from "vitest";

import { WorkspaceBridge } from "@/shell/workspaceBridge";
import { FIXTURE_CONTRIBUTES, FIXTURE_EXTENSION_ID, fixtureFiles } from "@/test/themeFixtures";

import { registerBuiltInCommands, SELECT_COLOR_THEME_COMMAND } from "./builtinCommands";
import { CommandRegistry } from "./commands";
import { ContextKeyService } from "./contextKeys";
import { parseContributions } from "./contributions";
import { ExtensionHost } from "./host";
import { hostServices } from "./testServices";

describe("theme contributions in the extension host", () => {
  it("reads them with the other contributions", () => {
    const { contributions, warnings } = parseContributions(FIXTURE_EXTENSION_ID, {
      ...FIXTURE_CONTRIBUTES,
      themes: [...FIXTURE_CONTRIBUTES.themes, { id: "broken", uiTheme: "sepia", path: "./x.json" }],
    });
    expect(contributions.theming.themes.map((theme) => theme.id)).toEqual([
      "full-dark",
      "full-light",
      "invalid",
      "vscode-dark",
    ]);
    expect(contributions.theming.colors[0]?.token).toBe("x-acme-fixture-themes-glow");
    expect(warnings).toEqual(['contributes.themes[4]: "uiTheme" must be light or dark']);
  });

  it("hands them and the files to the theme service, and takes them back on dispose", async () => {
    const removed = vi.fn();
    const addExtension = vi.fn(() => removed);
    const host = new ExtensionHost({
      services: hostServices({ themes: { addExtension } }),
      console: { error: () => {}, warn: () => {}, info: () => {} },
      importModule: async () => ({ activate: () => {} }),
    });
    await host.start([
      {
        id: FIXTURE_EXTENSION_ID,
        version: "1.0.0",
        activationEvents: ["*"],
        entryUrl: "/fixture.js",
        contributes: FIXTURE_CONTRIBUTES,
        files: fixtureFiles(),
      },
    ]);
    expect(addExtension).toHaveBeenCalledWith(
      expect.objectContaining({
        id: FIXTURE_EXTENSION_ID,
        version: "1.0.0",
        files: fixtureFiles(),
        contributions: expect.objectContaining({ themes: expect.any(Array) }),
      }),
    );
    await host.dispose();
    expect(removed).toHaveBeenCalledOnce();
  });

  it("runs omnigent.selectColorTheme against the theme service", async () => {
    const commands = new CommandRegistry();
    const themes = { select: vi.fn(), getActive: vi.fn(() => null) };
    registerBuiltInCommands(commands, {
      contextKeys: new ContextKeyService(),
      workspace: new WorkspaceBridge(),
      themes,
    });
    await commands.execute(
      SELECT_COLOR_THEME_COMMAND,
      [`${FIXTURE_EXTENSION_ID}/full-dark`],
      () => {},
    );
    expect(themes.select).toHaveBeenCalledWith(`${FIXTURE_EXTENSION_ID}/full-dark`);
    await commands.execute(SELECT_COLOR_THEME_COMMAND, [], () => {});
    expect(themes.select).toHaveBeenLastCalledWith(null);
    await expect(commands.execute(SELECT_COLOR_THEME_COMMAND, [42], () => {})).rejects.toThrow(
      /needs a theme id/,
    );
  });
});
