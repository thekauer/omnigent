import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEV_EXTENSIONS_ENDPOINT,
  isValidEngineRange,
  omnigentExtensionsDev,
  parseDevPaths,
  readDevExtension,
  scanDevExtensions,
  servableExtensionFiles,
} from "../../vite.omnigentExtensions";

const VALID_MANIFEST = {
  name: "sample",
  publisher: "acme",
  version: "1.2.3",
  engines: { omnigent: "^0.24.0" },
  browser: "./src/extension.js",
  activationEvents: ["onStartupFinished"],
};

let workspace: string;

function makeExtension(
  folderName: string,
  manifest: Record<string, unknown> | string | null,
  files: Record<string, string> = {
    "src/extension.js": 'import * as omnigent from "omnigent";\nexport function activate() {}\n',
  },
): string {
  const folder = path.join(workspace, folderName);
  mkdirSync(folder, { recursive: true });
  if (manifest !== null) {
    writeFileSync(
      path.join(folder, "package.json"),
      typeof manifest === "string" ? manifest : JSON.stringify(manifest),
    );
  }
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), content);
  }
  return folder;
}

function errorFor(folder: string): string {
  const result = readDevExtension(folder);
  if (!("error" in result)) throw new Error(`expected ${folder} to be invalid`);
  return result.error;
}

beforeAll(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "omnigent-ext-test-"));
  mkdirSync(path.join(workspace, "outside"), { recursive: true });
  writeFileSync(
    path.join(workspace, "outside", "secret.js"),
    'export const secret = "TOP-SECRET";\n',
  );
});

const secretFile = () => path.join(workspace, "outside", "secret.js");

async function startServer(paths: string[], root = path.join(workspace, "app")) {
  mkdirSync(root, { recursive: true });
  const registryModule = path.join(root, "registry.js");
  writeFileSync(registryModule, "export const getExtensionApi = (id) => ({ id });\n");
  writeFileSync(path.join(root, "index.html"), "<!doctype html>");
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1" },
    plugins: [omnigentExtensionsDev({ paths, apiRegistryModule: registryModule, quiet: true })],
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("manifest validation", () => {
  it("accepts a valid extension and derives a publisher.name id", () => {
    const folder = makeExtension("valid", VALID_MANIFEST);
    const result = readDevExtension(folder);
    expect("extension" in result && result.extension).toMatchObject({
      id: "acme.sample",
      version: "1.2.3",
      activationEvents: ["onStartupFinished"],
      entryUrl: expect.stringMatching(/^\/@fs\/.*\/valid\/src\/extension\.js$/),
    });
  });

  it.each([
    ["name", { name: undefined }, '"name"'],
    ["uppercase name", { name: "Sample" }, '"name"'],
    ["publisher", { publisher: undefined }, '"publisher"'],
    ["version", { version: "1" }, '"version"'],
    ["engines", { engines: undefined }, '"engines.omnigent" is required'],
    ["engines range", { engines: { omnigent: "latest" } }, '"engines.omnigent" must be a semver'],
    ["engines type", { engines: { omnigent: 24 } }, '"engines.omnigent" must be a semver'],
    ["browser", { browser: undefined }, '"browser" must name'],
    ["browser entry", { browser: "./missing.js" }, "does not exist"],
    ["browser escape", { browser: "../valid/src/extension.js" }, "must stay inside"],
    ["activationEvents type", { activationEvents: "onStartupFinished" }, '"activationEvents"'],
  ])("rejects a bad %s with a clear message", (label, patch, message) => {
    const folder = makeExtension(`bad-${label.replace(/\s+/g, "-")}`, {
      ...VALID_MANIFEST,
      ...patch,
    });
    const error = errorFor(folder);
    expect(error).toContain(folder);
    expect(error).toContain(message);
  });

  it("reports every problem at once", () => {
    const folder = makeExtension("many-problems", { browser: "./src/extension.js" });
    const error = errorFor(folder);
    for (const field of ['"name"', '"publisher"', '"version"', '"engines.omnigent"']) {
      expect(error).toContain(field);
    }
  });

  it("rejects a missing folder, a missing package.json and invalid JSON", () => {
    expect(errorFor(path.join(workspace, "nope"))).toContain("folder does not exist");
    expect(errorFor(makeExtension("no-manifest", null))).toContain("cannot read package.json");
    expect(errorFor(makeExtension("bad-json", "{"))).toContain("cannot read package.json");
  });

  it("rejects a browser entry that is a symlink to a file outside the folder", () => {
    const folder = makeExtension("symlinked-entry", VALID_MANIFEST, {});
    mkdirSync(path.join(folder, "src"), { recursive: true });
    symlinkSync(secretFile(), path.join(folder, "src", "extension.js"));
    const error = errorFor(folder);
    expect(error).toContain('"browser" entry ./src/extension.js is a symlink to a file outside');
  });

  it("accepts a symlinked entry that stays inside the folder, by its real path", () => {
    const folder = makeExtension("symlinked-inside", { ...VALID_MANIFEST, browser: "./main.js" });
    symlinkSync(path.join(folder, "src", "extension.js"), path.join(folder, "main.js"));
    const result = readDevExtension(folder);
    expect("extension" in result && result.extension.entryPath).toBe(
      path.join(folder, "src", "extension.js"),
    );
  });

  it("lists only the extension's own servable files", () => {
    const folder = makeExtension("servable", VALID_MANIFEST, {
      "src/extension.js": "export function activate() {}\n",
      "src/features/a.js": "export {};\n",
      "src/notes.txt": "not importable",
      "node_modules/dep/index.js": "export {};\n",
      ".git/hooks/x.js": "export {};\n",
    });
    symlinkSync(secretFile(), path.join(folder, "src", "leak.js"));
    symlinkSync(path.join(workspace, "outside"), path.join(folder, "src", "linked-dir"));
    expect(servableExtensionFiles(folder)).toEqual(
      ["package.json", "src/extension.js", "src/features/a.js"].map((file) =>
        path.join(folder, file),
      ),
    );
  });

  it("warns about unsupported activation events without rejecting", () => {
    const folder = makeExtension("odd-events", {
      ...VALID_MANIFEST,
      activationEvents: ["onCommand:x"],
    });
    const result = readDevExtension(folder);
    expect("extension" in result).toBe(true);
    expect(result.warnings).toEqual([expect.stringContaining('"onCommand:x" is not supported')]);
  });

  it("rejects a duplicate id across folders", () => {
    const first = makeExtension("dup-a", VALID_MANIFEST);
    const second = makeExtension("dup-b", VALID_MANIFEST);
    const scan = scanDevExtensions([first, second]);
    expect(scan.extensions).toHaveLength(1);
    expect(scan.errors).toEqual([expect.stringContaining("duplicate id acme.sample")]);
  });

  it("rejects a duplicate id in another case", () => {
    const first = makeExtension("dup-c", VALID_MANIFEST);
    const second = makeExtension("dup-d", { ...VALID_MANIFEST, publisher: "ACME" });
    const scan = scanDevExtensions([first, second]);
    expect(scan.extensions).toHaveLength(1);
    expect(scan.errors).toEqual([expect.stringContaining("duplicate id ACME.sample")]);
  });

  it("parses the path list and engine ranges", () => {
    expect(parseDevPaths(`a${path.delimiter}${path.delimiter} /abs/b `, "/cwd")).toEqual([
      "/cwd/a",
      "/abs/b",
    ]);
    expect(parseDevPaths(undefined)).toEqual([]);
    for (const range of ["^0.24.0", "~1.2", ">=0.24.0 <0.26.0", "*", "0.24.0"]) {
      expect(isValidEngineRange(range)).toBe(true);
    }
    for (const range of ["latest", "", "^x.y"]) expect(isValidEngineRange(range)).toBe(false);
  });
});

describe("dev server", () => {
  let server: ViteDevServer;
  let baseUrl: string;
  let extensionFolder: string;

  beforeAll(async () => {
    extensionFolder = makeExtension("served", VALID_MANIFEST, {
      "src/extension.js":
        'import * as omnigent from "omnigent";\nimport { helper } from "./helper.js";\nexport function activate() { return [omnigent, helper]; }\n',
      "src/helper.js": 'import { window } from "omnigent";\nexport const helper = window;\n',
      "src/leaky.js": 'export { secret } from "./leak.js";\n',
      "node_modules/dep/index.js": "export const dep = 1;\n",
    });
    symlinkSync(secretFile(), path.join(extensionFolder, "src", "leak.js"));
    ({ server, baseUrl } = await startServer([extensionFolder, path.join(workspace, "nope")]));
  });

  afterAll(async () => {
    await server?.close();
  });

  it("allows only the extension's own files in server.fs.allow", () => {
    const allow = server.config.server.fs.allow;
    expect(allow).toContain(path.join(extensionFolder, "src/extension.js"));
    expect(allow).toContain(path.join(extensionFolder, "src/helper.js"));
    expect(allow).not.toContain(extensionFolder);
    expect(allow.some((entry) => entry.includes("node_modules/dep"))).toBe(false);
    expect(allow.some((entry) => entry.startsWith(path.join(workspace, "outside")))).toBe(false);
  });

  it("refuses a symlinked file inside the folder that points outside it", async () => {
    const urls = [
      `/@fs${path.join(extensionFolder, "src/leak.js")}`,
      `/@fs${path.join(extensionFolder, "src/leak.js")}?import`,
      `/@fs${path.join(extensionFolder, "src/%6Ceak.js")}`,
    ];
    const responses = await Promise.all(
      urls.map(async (url) => {
        const response = await globalThis.fetch(`${baseUrl}${url}`);
        return { url, status: response.status, body: await response.text() };
      }),
    );
    for (const { url, status, body } of responses) {
      expect(status, url).toBe(403);
      expect(body).not.toContain("TOP-SECRET");
    }
  });

  it("refuses an import that resolves through a symlink to outside the folder", async () => {
    const response = await globalThis.fetch(
      `${baseUrl}/@fs${path.join(extensionFolder, "src/leaky.js")}`,
    );
    expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain("TOP-SECRET");
    await expect(
      server.pluginContainer.resolveId("./leak.js", path.join(extensionFolder, "src/leaky.js")),
    ).rejects.toThrow(/outside the extension folder/);
  });

  it("does not serve the extension's node_modules", async () => {
    const response = await globalThis.fetch(
      `${baseUrl}/@fs${path.join(extensionFolder, "node_modules/dep/index.js")}`,
    );
    expect(response.status).toBe(403);
  });

  it("lists valid extensions and errors at the dev endpoint", async () => {
    const response = await globalThis.fetch(`${baseUrl}${DEV_EXTENSIONS_ENDPOINT}`);
    const body = (await response.json()) as {
      extensions: { id: string }[];
      errors: string[];
    };
    expect(body.extensions.map((extension) => extension.id)).toEqual(["acme.sample"]);
    expect(body.errors).toEqual([expect.stringContaining("folder does not exist")]);
  });

  it("exposes the list through the virtual module", async () => {
    const result = await server.transformRequest("virtual:omnigent-dev-extensions");
    // Inlined as JSON text (parsed by the page), so its quotes are escaped.
    expect(result?.code).toContain(JSON.stringify('"id":"acme.sample"').slice(1, -1));
    expect(result?.code).toContain("devExtensionErrors");
  });

  it("serves the entry with omnigent resolved to a per-extension API module", async () => {
    const entryUrl = `/@fs${path.join(extensionFolder, "src/extension.js")}`;
    const entry = await globalThis.fetch(`${baseUrl}${entryUrl}`);
    expect(entry.status).toBe(200);
    const code = await entry.text();
    const apiImport = /from "([^"]*omnigent-api:acme\.sample[^"]*)"/.exec(code);
    expect(apiImport).not.toBeNull();

    // Nested modules of the same extension get the same API module.
    const helper = await globalThis.fetch(
      `${baseUrl}/@fs${path.join(extensionFolder, "src/helper.js")}`,
    );
    expect(await helper.text()).toContain(apiImport![1]);

    const apiModule = await globalThis.fetch(`${baseUrl}${apiImport![1]}`);
    const apiCode = await apiModule.text();
    expect(apiCode).toContain('getExtensionApi("acme.sample")');
    for (const name of ["window", "sessions", "Disposable", "EventEmitter"]) {
      expect(apiCode).toContain(`export const ${name} = api.${name};`);
    }
  });

  it("does not resolve omnigent for app modules", async () => {
    expect(
      await server.pluginContainer.resolveId("omnigent", path.join(workspace, "app", "main.js")),
    ).toBeNull();
  });
});

describe("dev server node_modules and /@fs imports", () => {
  let server: ViteDevServer;
  let baseUrl: string;
  let extensionFolder: string;
  const fetchText = async (url: string) => {
    const response = await globalThis.fetch(`${baseUrl}${url}`);
    return { status: response.status, body: await response.text() };
  };

  beforeAll(async () => {
    extensionFolder = makeExtension("deps", VALID_MANIFEST, {
      "src/extension.js": "export function activate() {}\n",
      // A real package (not a symlink) that re-exports a file outside the folder.
      "node_modules/pkg2/package.json": JSON.stringify({
        name: "pkg2",
        version: "1.0.0",
        type: "module",
        main: "index.js",
      }),
      "node_modules/pkg2/index.js": 'export { secret } from "../../../outside/secret.js";\n',
      "src/bare.js": 'export { secret } from "pkg2";\n',
      "src/deep.js": 'export { secret } from "../node_modules/pkg2/index.js";\n',
      "src/fs-outside.js": `export { secret } from "/@fs${secretFile()}";\n`,
      "src/fs-own.js": `export { helper } from "/@fs${path.join(workspace, "deps", "src", "own.js")}";\n`,
      "src/own.js": "export const helper = 1;\n",
      "src/id-bare.js": 'export { secret } from "/@id/pkg2";\n',
    });
    ({ server, baseUrl } = await startServer([extensionFolder], path.join(workspace, "app-deps")));
  });

  afterAll(async () => {
    await server?.close();
  });

  it("does not pre-bundle a package from the extension's node_modules", async () => {
    const importer = await fetchText(`/@fs${path.join(extensionFolder, "src/bare.js")}`);
    expect(importer.body).not.toContain("TOP-SECRET");
    // Whatever URL the import was rewritten to, it must not hand out the secret.
    const depUrl = /from "([^"]*\.vite\/deps\/[^"]*)"/.exec(importer.body)?.[1];
    const depUrls = [depUrl, "/node_modules/.vite/deps/pkg2.js"].filter(
      (candidate): candidate is string => candidate !== undefined,
    );
    const deps = await Promise.all(depUrls.map(fetchText));
    deps.forEach((dep, index) => expect(dep.body, depUrls[index]).not.toContain("TOP-SECRET"));
    expect(importer.status).not.toBe(200);
    const optimizer = server.environments.client.depsOptimizer;
    expect(Object.keys(optimizer?.metadata.discovered ?? {})).not.toContain("pkg2");
    expect(Object.keys(optimizer?.metadata.optimized ?? {})).not.toContain("pkg2");
    await expect(
      server.pluginContainer.resolveId("pkg2", path.join(extensionFolder, "src/bare.js")),
    ).rejects.toThrow(/only "omnigent" and its own files/);
  });

  it("refuses a relative import into the extension's node_modules", async () => {
    const importer = await fetchText(`/@fs${path.join(extensionFolder, "src/deep.js")}`);
    expect(importer.status).not.toBe(200);
    await expect(
      server.pluginContainer.resolveId(
        "../node_modules/pkg2/index.js",
        path.join(extensionFolder, "src/deep.js"),
      ),
    ).rejects.toThrow(/node_modules/);
  });

  it("keeps the dep optimizer from bundling any file in an extension folder", () => {
    const plugins = server.config.optimizeDeps.rolldownOptions?.plugins;
    const guard = (Array.isArray(plugins) ? plugins : [plugins]).find(
      (plugin): plugin is { name: string; load: (id: string) => unknown } =>
        typeof plugin === "object" &&
        plugin !== null &&
        "name" in plugin &&
        plugin.name === "omnigent-extensions-no-prebundle",
    );
    expect(guard).toBeDefined();
    expect(() => guard!.load(path.join(extensionFolder, "node_modules/pkg2/index.js"))).toThrow(
      /refused to pre-bundle/,
    );
    expect(guard!.load(path.join(workspace, "app-deps", "registry.js"))).toBeNull();
  });

  it("refreshes the allow list when a source file changes", async () => {
    const own = path.join(extensionFolder, "src/own.js");
    const allow = server.config.server.fs.allow;
    allow.splice(allow.indexOf(own), 1);
    expect(allow).not.toContain(own);
    server.watcher.emit("all", "change", own);
    expect(allow).toContain(own);
  });

  it("checks /@fs/ and /@id/ imports from extension files", async () => {
    const files = ["src/fs-outside.js", "src/id-bare.js"];
    const importers = await Promise.all(
      files.map((file) => fetchText(`/@fs${path.join(extensionFolder, file)}`)),
    );
    importers.forEach((importer, index) => {
      expect(importer.status, files[index]).not.toBe(200);
      expect(importer.body, files[index]).not.toContain("TOP-SECRET");
    });
    await expect(
      server.pluginContainer.resolveId(
        `/@fs${secretFile()}`,
        path.join(extensionFolder, "src/fs-outside.js"),
      ),
    ).rejects.toThrow(/outside the extension folder/);
    // An /@fs/ import of the extension's own file still works.
    expect((await fetchText(`/@fs${path.join(extensionFolder, "src/fs-own.js")}`)).status).toBe(
      200,
    );
  });
});

describe("dev server workers and /@ ids", () => {
  let server: ViteDevServer;
  let baseUrl: string;
  let extensionFolder: string;
  const fetchText = async (url: string) => {
    const response = await globalThis.fetch(`${baseUrl}${url}`);
    return { status: response.status, body: await response.text() };
  };
  const fsUrl = (file: string) => `/@fs${path.join(extensionFolder, file)}`;
  /** Fetches a worker URL the module at `file` creates, then everything the worker imports. */
  const fetchWorker = async (file: string) => {
    let importer = await fetchText(fsUrl(file));
    expect(importer.status, file).toBe(200);
    // A `?worker` import goes through a wrapper module that constructs the worker.
    const wrapperUrl = /from\s*["'](\/@fs\/[^"']*\?worker)["']/.exec(importer.body)?.[1];
    if (wrapperUrl !== undefined) {
      importer = await fetchText(wrapperUrl);
      expect(importer.status, wrapperUrl).toBe(200);
    }
    const workerUrl = /["'](\/@fs\/[^"']*worker\.js\?worker_file[^"']*)["']/.exec(
      importer.body,
    )?.[1];
    expect(workerUrl, importer.body).toBeDefined();
    const worker = await fetchText(workerUrl!);
    expect(worker.status, worker.body).toBe(200);
    const imports = [...worker.body.matchAll(/import\s*(?:[^"']*from\s*)?["']([^"']+)["']/g)].map(
      (match) => match[1]!,
    );
    expect(imports.some((url) => url.includes("vite/dist/client/env.mjs"))).toBe(true);
    const served = await Promise.all(imports.map(fetchText));
    served.forEach((response, index) => expect(response.status, imports[index]).toBe(200));
    expect(worker.body).toContain("workerHelper");
  };

  beforeAll(async () => {
    extensionFolder = makeExtension("workers", VALID_MANIFEST, {
      "src/extension.js": "export function activate() {}\n",
      "src/worker.js": 'import { helper } from "./workerHelper.js";\nself.postMessage(helper);\n',
      "src/workerHelper.js": "export const helper = 1;\n",
      "src/query-worker.js":
        'import MyWorker from "./worker.js?worker";\nexport const start = () => new MyWorker();\n',
      "src/url-worker.js":
        'export const start = () => new Worker(new URL("./worker.js", import.meta.url), { type: "module" });\n',
      "src/vite-client.js": 'import "/@vite/env";\nexport {};\n',
      // Root-relative: from the app root, /@x/../../ is the test workspace.
      "src/at-escape.js":
        'import secret from "/@x/../../outside/secret.js?raw";\nexport { secret };\n',
    });
    ({ server, baseUrl } = await startServer(
      [extensionFolder],
      path.join(workspace, "app-workers"),
    ));
  });

  afterAll(async () => {
    await server?.close();
  });

  it("serves a ?worker import built from the extension's own files", async () => {
    await fetchWorker("src/query-worker.js");
  });

  it("serves a new Worker(new URL(...)) built from the extension's own files", async () => {
    await fetchWorker("src/url-worker.js");
  });

  it("lets Vite's own client ids through", async () => {
    expect((await fetchText(fsUrl("src/vite-client.js"))).status).toBe(200);
  });

  it("checks any other /@ specifier like a path", async () => {
    const importer = await fetchText(fsUrl("src/at-escape.js"));
    expect(importer.status).not.toBe(200);
    expect(importer.body).not.toContain("TOP-SECRET");
    await expect(
      server.pluginContainer.resolveId(
        "/@x/../../outside/secret.js?raw",
        path.join(extensionFolder, "src/at-escape.js"),
      ),
    ).rejects.toThrow(/outside the extension folder/);
  });
});

describe("dev server rescans", () => {
  it("picks up a fixed, removed and re-added package.json without a restart", async () => {
    const folder = makeExtension("rescanned", "{ broken", {
      "src/extension.js": "export function activate() {}\n",
    });
    const entry = path.join(folder, "src", "extension.js");
    const { server, baseUrl } = await startServer([folder], path.join(workspace, "app-rescan"));
    const listed = async () => {
      const response = await globalThis.fetch(`${baseUrl}${DEV_EXTENSIONS_ENDPOINT}`);
      return ((await response.json()) as { extensions: { id: string }[] }).extensions.map(
        (extension) => extension.id,
      );
    };
    const waitFor = (check: () => Promise<void> | void) =>
      vi.waitFor(check, { timeout: 10_000, interval: 50 });
    try {
      expect(await listed()).toEqual([]);
      expect(server.config.server.fs.allow).not.toContain(entry);

      writeFileSync(path.join(folder, "package.json"), JSON.stringify(VALID_MANIFEST));
      await waitFor(async () => expect(await listed()).toEqual(["acme.sample"]));
      expect(server.config.server.fs.allow).toContain(entry);
      expect((await globalThis.fetch(`${baseUrl}/@fs${entry}`)).status).toBe(200);

      unlinkSync(path.join(folder, "package.json"));
      await waitFor(async () => expect(await listed()).toEqual([]));
      expect(server.config.server.fs.allow).not.toContain(entry);

      writeFileSync(path.join(folder, "package.json"), JSON.stringify(VALID_MANIFEST));
      await waitFor(async () => expect(await listed()).toEqual(["acme.sample"]));
      expect(server.config.server.fs.allow).toContain(entry);

      // A new source file becomes importable without touching the manifest.
      const added = path.join(folder, "src", "added.js");
      writeFileSync(added, "export {};\n");
      await waitFor(() => expect(server.config.server.fs.allow).toContain(added));
    } finally {
      await server.close();
    }
  }, 30_000);
});

describe("nested extension folders", () => {
  it("binds a file to the deepest declared folder that contains it", async () => {
    const parent = makeExtension("nest-parent", { ...VALID_MANIFEST, name: "parent" });
    const child = makeExtension("nest-parent/plugins/child", { ...VALID_MANIFEST, name: "child" });
    const { server } = await startServer([parent, child], path.join(workspace, "app-nested"));
    try {
      const resolve = (file: string) => server.pluginContainer.resolveId("omnigent", file);
      expect((await resolve(path.join(child, "src/extension.js")))?.id).toBe(
        "\0omnigent-api:acme.child",
      );
      expect((await resolve(path.join(parent, "src/extension.js")))?.id).toBe(
        "\0omnigent-api:acme.parent",
      );
    } finally {
      await server.close();
    }
  });
});
