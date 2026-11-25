// The dev plugin's theme contributions: theme files read and checked at scan time and
// inlined into the virtual module, fonts and brand images served by exact allow-list
// (checked, sanitized), and edits handed to the page without a reload.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  FIXTURE_CONTRIBUTES,
  FIXTURE_FONT_BYTES,
  FIXTURE_LOGO_SVG,
  FULL_DARK_THEME,
  FULL_LIGHT_THEME,
  INVALID_THEME,
  VSCODE_DARK_THEME,
} from "@/test/themeFixtures";
import {
  DEV_EXTENSION_ASSETS_PATH,
  DEV_EXTENSION_FILES_EVENT,
  omnigentExtensionsDev,
  readDevExtension,
} from "../../vite.omnigentExtensions";

let workspace: string;
let folder: string;

function write(file: string, content: string | Uint8Array): void {
  mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
  writeFileSync(path.join(folder, file), content);
}

beforeAll(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "omnigent-theme-ext-test-"));
  folder = path.join(workspace, "fixture-themes");
  write(
    "package.json",
    JSON.stringify({
      name: "fixture-themes",
      publisher: "acme",
      version: "1.0.0",
      engines: { omnigent: "^0.24.0" },
      browser: "./src/extension.js",
      activationEvents: ["onStartupFinished"],
      contributes: FIXTURE_CONTRIBUTES,
    }),
  );
  write("src/extension.js", "export function activate() {}\n");
  write("themes/full-dark.json", JSON.stringify(FULL_DARK_THEME));
  write("themes/full-light.json", JSON.stringify(FULL_LIGHT_THEME));
  write("themes/invalid.json", JSON.stringify(INVALID_THEME));
  write("themes/vscode-dark.json", JSON.stringify(VSCODE_DARK_THEME));
  write("fonts/fixture-sans.woff2", FIXTURE_FONT_BYTES);
  write("brand/logo.svg", FIXTURE_LOGO_SVG);
  write("brand/secret.svg", "<svg>not referenced</svg>");
  mkdirSync(path.join(workspace, "outside"), { recursive: true });
  writeFileSync(path.join(workspace, "outside", "secret.json"), '{"secret": "TOP-SECRET"}');
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function scan() {
  const result = readDevExtension(folder);
  if ("error" in result) throw new Error(result.error);
  return result;
}

describe("theme files at scan time", () => {
  it("inlines the theme files and lists the checked assets", () => {
    const { extension, warnings, assets } = scan();
    expect(Object.keys(extension.files!).sort()).toEqual([
      "brand/logo.svg",
      "fonts/fixture-sans.woff2",
      "themes/full-dark.json",
      "themes/full-light.json",
      "themes/invalid.json",
      "themes/vscode-dark.json",
    ]);
    expect(extension.files!["themes/full-dark.json"]).toEqual({
      kind: "json",
      data: FULL_DARK_THEME,
    });
    const logo = extension.files!["brand/logo.svg"];
    expect(logo).toMatchObject({ kind: "asset", type: "image/svg+xml" });
    const url = (logo as { url: string }).url;
    expect(url).toMatch(
      /^\/__omnigent\/extension-assets\/acme\.fixture-themes\/[0-9a-f]{8}\/brand\/logo\.svg$/,
    );
    // The sanitized SVG is what is served.
    expect(new TextDecoder().decode(assets.get(url)!.body)).not.toContain("onload");
    // The invalid theme's problems are warnings, the stock theme's partial import a note.
    const text = warnings.join("\n");
    expect(text).toMatch(/theme invalid: colors.background: "url\(" is not allowed/);
    expect(text).toMatch(/theme vscode-dark: \d+ VS Code colour id\(s\) have no Omnigent token/);
    expect(text).toMatch(/brand\/logo.svg: dropped onload/);
    expect(text).not.toMatch(/theme full-dark/);
  });

  it("keeps out what the folder doesn't really hold, and assets that fail their checks", () => {
    const escape = path.join(workspace, "escape");
    mkdirSync(path.join(escape, "src"), { recursive: true });
    mkdirSync(path.join(escape, "fonts"), { recursive: true });
    writeFileSync(path.join(escape, "src/extension.js"), "export function activate() {}\n");
    symlinkSync(path.join(workspace, "outside", "secret.json"), path.join(escape, "theme.json"));
    writeFileSync(path.join(escape, "fonts/fake.woff2"), "not a font");
    writeFileSync(
      path.join(escape, "package.json"),
      JSON.stringify({
        name: "escape",
        publisher: "acme",
        version: "1.0.0",
        engines: { omnigent: "^0.24.0" },
        browser: "./src/extension.js",
        activationEvents: ["*"],
        contributes: {
          themes: [{ id: "t", uiTheme: "dark", path: "./theme.json" }],
          fonts: [{ family: "Fake", src: "./fonts/fake.woff2" }],
        },
      }),
    );
    const result = readDevExtension(escape);
    if ("error" in result) throw new Error(result.error);
    expect(result.extension.files).toBeUndefined();
    expect(result.assets.size).toBe(0);
    const text = result.warnings.join("\n");
    expect(text).toMatch(/theme.json resolves outside the extension folder/);
    expect(text).toMatch(/fonts\/fake.woff2: not a WOFF2 font/);
  });
});

describe("the dev server", () => {
  let server: ViteDevServer;
  let baseUrl: string;

  beforeAll(async () => {
    const root = path.join(workspace, "app");
    mkdirSync(root, { recursive: true });
    const registryModule = path.join(root, "registry.js");
    writeFileSync(registryModule, "export const getExtensionApi = (id) => ({ id });\n");
    writeFileSync(path.join(root, "index.html"), "<!doctype html>");
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      server: { port: 0, host: "127.0.0.1" },
      plugins: [
        omnigentExtensionsDev({ paths: [folder], apiRegistryModule: registryModule, quiet: true }),
      ],
    });
    await server.listen();
    const address = server.httpServer!.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it("serves exactly the allowed assets, with their types", async () => {
    const files = scan().extension.files!;
    const font = (files["fonts/fixture-sans.woff2"] as { url: string }).url;
    const logo = (files["brand/logo.svg"] as { url: string }).url;
    const fontResponse = await globalThis.fetch(`${baseUrl}${font}`);
    expect(fontResponse.status).toBe(200);
    expect(fontResponse.headers.get("content-type")).toBe("font/woff2");
    expect(new Uint8Array(await fontResponse.arrayBuffer())).toEqual(FIXTURE_FONT_BYTES);
    const logoResponse = await globalThis.fetch(`${baseUrl}${logo}`);
    expect(logoResponse.headers.get("content-type")).toBe("image/svg+xml");
    expect(logoResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(logoResponse.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
    expect(await logoResponse.text()).not.toContain("onload");
    const refused = await Promise.all(
      [
        logo.replace("logo.svg", "secret.svg"),
        logo.replace(/\/[0-9a-f]{8}\//, "/00000000/"),
        `${DEV_EXTENSION_ASSETS_PATH}acme.fixture-themes/themes/full-dark.json`,
      ].map(async (url) => {
        const response = await globalThis.fetch(`${baseUrl}${url}`);
        return { url, status: response.status, body: await response.text() };
      }),
    );
    for (const { url, status, body } of refused) {
      expect(status, url).toBe(404);
      expect(body).not.toContain("TOP-SECRET");
    }
    // A traversal is resolved by the URL before it reaches the server, never into the folder.
    const traversal = await globalThis.fetch(
      `${baseUrl}${DEV_EXTENSION_ASSETS_PATH}acme.fixture-themes/x/../../../outside/secret.json`,
    );
    expect(await traversal.text()).not.toContain("TOP-SECRET");
    const post = await globalThis.fetch(`${baseUrl}${font}`, { method: "POST" });
    expect(post.status).not.toBe(200);
  });

  it("inlines the theme files into the virtual module", async () => {
    const result = await server.transformRequest("virtual:omnigent-dev-extensions");
    expect(result?.code).toContain('"themes/full-dark.json":{"kind":"json","data":{');
    expect(result?.code).toContain('"kind":"asset"');
  });

  it("hands an edited theme file to the page without a reload", async () => {
    const send = vi.spyOn(server.ws, "send");
    const edited = {
      ...FULL_DARK_THEME,
      colors: { ...FULL_DARK_THEME.colors, background: "#000001" },
    };
    write("themes/full-dark.json", JSON.stringify(edited));
    server.watcher.emit("all", "change", path.join(folder, "themes/full-dark.json"));
    const event = send.mock.calls
      .map(
        ([payload]) =>
          payload as unknown as {
            type: string;
            event?: string;
            data?: { files: Record<string, { data?: unknown }> };
          },
      )
      .find((payload) => payload.type === "custom" && payload.event === DEV_EXTENSION_FILES_EVENT);
    expect(event?.data?.files["themes/full-dark.json"]?.data).toEqual(edited);
    expect(
      send.mock.calls.some(([payload]) => (payload as { type?: string }).type === "full-reload"),
    ).toBe(false);
    send.mockRestore();
  });
});
