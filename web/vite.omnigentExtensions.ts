// Dev-server loading of VS Code-style web extensions from local folders.
//
// OMNIGENT_WEB_EXTENSION_DEV_PATHS lists extension folders (path-delimiter
// separated). Each folder's package.json is validated; valid extensions are
// exposed to the UI through `virtual:omnigent-dev-extensions`, their browser
// entries are served through Vite (`/@fs/...`), and a bare `import "omnigent"`
// inside an extension folder resolves to an API module bound to that extension.
//
// Trust model: a dev-path extension is trusted local code, like VS Code's
// --extensionDevelopmentPath. The guards below stop accidents and plain HTTP
// requests for files outside the extension's own sources: a realpath check of
// the browser entry, a server.fs.allow list of just its own files, a 403 for any
// request whose real path leaves its folder, refusal of bare imports other than
// `omnigent` and of imports resolving outside the folder (Vite's own client ids
// excepted), and an optimizer guard. They are not a sandbox: CSS @import, `?raw`
// of files inside the folder, hardlinks and crafted transforms are out of scope.
// The real boundary is the isolated host (see docs/extending/vscode_style_extensions.md).

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { normalizePath, type Plugin, type ResolvedConfig, type ViteDevServer } from "vite";
import {
  COMMAND_TOKEN_HEADER,
  createCommandEndpoint,
  createCommandToken,
  NodeExtensionHost,
  type NodeExtensionHostOptions,
} from "./vite.omnigentNodeExtensions";
import { isValidEngineRange, validateManifest } from "./src/vscodeExtensions/manifest";
import { checkBrandFile, checkFontFile } from "./src/theme/brandAssets";
import { parseThemeContributions } from "./src/theme/themeContributions";
import { parseThemeFile } from "./src/theme/themeFile";
import { getToken } from "./src/theme/tokens/registry";
import { THEME_LIMITS, TOKEN_CONSTRAINTS } from "./src/theme/validate";

export const DEV_PATHS_ENV = "OMNIGENT_WEB_EXTENSION_DEV_PATHS";
export const DEV_EXTENSIONS_MODULE = "virtual:omnigent-dev-extensions";
export const DEV_EXTENSIONS_ENDPOINT = "/__omnigent/extensions";
/** Where the theme contributions' fonts and brand images are served, by exact allow-list. */
export const DEV_EXTENSION_ASSETS_PATH = "/__omnigent/extension-assets/";
/** The HMR event that carries an extension's edited theme files. */
export const DEV_EXTENSION_FILES_EVENT = "omnigent-extensions:files";
const RESOLVED_DEV_EXTENSIONS_MODULE = `\0${DEV_EXTENSIONS_MODULE}`;
const API_MODULE_PREFIX = "\0omnigent-api:";

/** Re-exported names of the per-extension module; mirrors OMNIGENT_API_EXPORT_NAMES. */
export const OMNIGENT_API_EXPORTS = [
  "version",
  "Disposable",
  "EventEmitter",
  "SessionHeaderItemAlignment",
  "window",
  "sessions",
  "commands",
  "hosts",
  "workspace",
  "git",
  "pullRequests",
  "TreeItemCollapsibleState",
  "CancellationTokenSource",
  "ThemeColor",
  "ColorThemeKind",
] as const;

/** Files an extension may import; everything else in its folder is not served. */
const SERVABLE_FILE_PATTERN = /\.(?:m?js|json|css)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);
const MAX_SERVABLE_FILES = 5000;
/**
 * The only `/@` ids an extension file may import unchecked: what Vite itself
 * injects (the HMR client, the env shim of a worker) and the React refresh
 * runtime. Any other `/@...` specifier is resolved and checked like a path.
 */
const VITE_CLIENT_IDS = new Set(["/@vite/client", "/@vite/env", "/@react-refresh"]);

/** Real paths of Vite's client and env modules, which Vite injects as `/@fs/` imports. */
function viteClientFiles(): Set<string> {
  const vitePackageDir = path.dirname(
    createRequire(path.join(__dirname, "package.json")).resolve("vite/package.json"),
  );
  return new Set(
    ["dist/client/client.mjs", "dist/client/env.mjs"].flatMap((file) => {
      const real = realpathOrUndefined(path.join(vitePackageDir, file));
      return real === undefined ? [] : [real];
    }),
  );
}

/** A validated extension, as served to the UI (plain JSON). */
export interface DevExtension {
  id: string;
  publisher: string;
  name: string;
  version: string;
  displayName?: string;
  engines: { omnigent: string };
  activationEvents: string[];
  /** Absolute, real path of the extension folder. */
  directory: string;
  /** Absolute path of the browser entry. */
  entryPath: string;
  /** Absolute real path of the Node entry (`main`), run by the dev server; optional. */
  mainPath?: string;
  /** URL the browser imports the entry from. */
  entryUrl: string;
  /** `contributes` as written (an object); the page host checks its entries. */
  contributes?: Record<string, unknown>;
  /** Theme files (inlined JSON) and assets (served URLs), by normalized path. */
  files?: Record<string, DevExtensionFile>;
  /** Real paths of the files `files` came from, so an edit can refresh them. */
  sourceFiles?: string[];
}

export type DevExtensionFile =
  { kind: "json"; data: unknown } | { kind: "asset"; url: string; type: string };

/** A file the asset middleware serves: exactly these URLs, nothing else. */
export interface DevAsset {
  body: Uint8Array;
  type: string;
}

export interface DevExtensionScan {
  extensions: DevExtension[];
  errors: string[];
  warnings: string[];
  /** Served asset bytes by URL (never part of the JSON the endpoint returns). */
  assets: Map<string, DevAsset>;
}

export function parseDevPaths(raw: string | undefined, cwd = process.cwd()): string[] {
  if (!raw) return [];
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(cwd, entry));
}

export { isValidEngineRange };

function fsUrl(absolutePath: string): string {
  const posix = absolutePath.split(path.sep).join("/");
  return `/@fs${posix.startsWith("/") ? "" : "/"}${posix}`;
}

type ManifestResult =
  | { extension: DevExtension; warnings: string[]; assets: Map<string, DevAsset> }
  | { error: string; warnings: string[] };

/** Validates one extension folder; errors name the folder and every problem found. */
export function readDevExtension(folder: string): ManifestResult {
  const warnings: string[] = [];
  const failure = (problems: string[]): ManifestResult => ({
    error: `${folder}: invalid extension: ${problems.join("; ")}`,
    warnings,
  });
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    return failure(["folder does not exist"]);
  }
  const directory = realpathSync(folder);
  const manifestPath = path.join(directory, "package.json");
  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return failure(["package.json must contain a JSON object"]);
    }
    manifest = parsed as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return failure([`cannot read package.json (${reason})`]);
  }

  const validation = validateManifest(manifest, folder);
  warnings.push(...validation.warnings);
  const problems = [...validation.problems];
  // The shared validator reported a missing or non-string entry; check the files here.
  const named = (value: unknown): value is string =>
    typeof value === "string" && value.trim() !== "";
  const entryPath = named(manifest.browser)
    ? validateEntry("browser", manifest.browser, directory, problems, true)
    : undefined;
  const mainPath = named(manifest.main)
    ? validateEntry("main", manifest.main, directory, problems, false)
    : undefined;
  const valid = validation.manifest;
  if (problems.length > 0 || entryPath === undefined || valid === undefined) {
    return failure(problems);
  }
  const theming =
    valid.contributes === undefined
      ? undefined
      : readThemeFiles(valid.id, directory, valid.contributes, warnings);
  return {
    extension: {
      id: valid.id,
      publisher: valid.publisher,
      name: valid.name,
      version: valid.version,
      ...(valid.displayName === undefined ? {} : { displayName: valid.displayName }),
      engines: { omnigent: valid.engines.omnigent },
      activationEvents: [...valid.activationEvents],
      directory,
      entryPath,
      entryUrl: fsUrl(entryPath),
      ...(mainPath === undefined ? {} : { mainPath }),
      ...(valid.contributes === undefined ? {} : { contributes: valid.contributes }),
      ...(theming === undefined || Object.keys(theming.files).length === 0
        ? {}
        : { files: theming.files, sourceFiles: theming.sourceFiles }),
    },
    warnings,
    assets: theming?.assets ?? new Map(),
  };
}

/** Reads a file inside `directory` by its normalized path: real path inside, a file, capped. */
function readOwnFile(directory: string, relative: string, maxBytes: number): Buffer | string {
  const file = path.join(directory, ...relative.split("/"));
  const real = realpathOrUndefined(file);
  if (real === undefined) return "does not exist";
  if (!isOwnFile(real, directory)) return "resolves outside the extension folder";
  const stats = statSync(real);
  if (!stats.isFile()) return "is not a file";
  if (stats.size > maxBytes) return `is larger than ${maxBytes} bytes`;
  return readFileSync(real);
}

function assetUrl(extensionId: string, relative: string, body: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of body) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `${DEV_EXTENSION_ASSETS_PATH}${extensionId}/${hash.toString(16).padStart(8, "0")}/${relative}`;
}

/**
 * The theme contributions' files: each theme file read and checked (its problems are
 * warnings) and inlined, and each font and brand image checked and registered for the
 * asset middleware. Nothing else in the folder becomes servable through this.
 */
export function readThemeFiles(
  extensionId: string,
  directory: string,
  contributes: Record<string, unknown>,
  warnings: string[],
): {
  files: Record<string, DevExtensionFile>;
  sourceFiles: string[];
  assets: Map<string, DevAsset>;
} {
  const files: Record<string, DevExtensionFile> = {};
  const sourceFiles: string[] = [];
  const assets = new Map<string, DevAsset>();
  const warn = (message: string) => warnings.push(`${extensionId}: ${message}`);
  // The page reports the manifest's problems; here only the files'.
  const { contributions } = parseThemeContributions(extensionId, contributes, {
    isKnownToken: (id) => getToken(id) !== undefined,
  });
  const realOf = (relative: string) => {
    const joined = path.join(directory, ...relative.split("/"));
    return realpathOrUndefined(joined) ?? joined;
  };
  const addAsset = (
    relative: string,
    check: (bytes: Uint8Array) => ReturnType<typeof checkFontFile>,
    cap: number,
  ) => {
    if (files[relative]?.kind === "asset") return (files[relative] as { url: string }).url;
    const bytes = readOwnFile(directory, relative, cap);
    if (typeof bytes === "string") {
      warn(`${relative} ${bytes}`);
      return undefined;
    }
    const result = check(new Uint8Array(bytes));
    if (!result.ok) {
      warn(`${relative}: ${result.reason}; not served`);
      return undefined;
    }
    for (const issue of result.issues) warn(`${relative}: ${issue}`);
    const url = assetUrl(extensionId, relative, result.body);
    assets.set(url, { body: result.body, type: result.type });
    files[relative] = { kind: "asset", url, type: result.type };
    sourceFiles.push(realOf(relative));
    return url;
  };
  for (const font of contributions.fonts) {
    addAsset(font.src, checkFontFile, 2 * 1024 * 1024);
  }
  const colorTokens = new Map(
    contributions.colors.flatMap((color) => [
      [color.id, color.token],
      [color.fullId, color.token],
      [color.token, color.token],
    ]),
  );
  const fontFamilies = new Map(contributions.fonts.map((font) => [font.family, font.cssFamily]));
  for (const theme of contributions.themes) {
    const bytes = readOwnFile(directory, theme.path, THEME_LIMITS.jsonBytes);
    sourceFiles.push(realOf(theme.path));
    if (typeof bytes === "string") {
      warn(`theme ${theme.id}: ${theme.path} ${bytes}`);
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      warn(
        `theme ${theme.id}: ${theme.path} is not JSON (${error instanceof Error ? error.message : String(error)})`,
      );
      continue;
    }
    const parsed = parseThemeFile(data, {
      uiTheme: theme.uiTheme,
      context: {
        isKnownToken: (id) =>
          [...colorTokens.values()].includes(id) ||
          (getToken(id) !== undefined && !TOKEN_CONSTRAINTS[id]?.internal),
        fontFamily: (name) => fontFamilies.get(name),
      },
      extensionColors: colorTokens,
      assetUrl: (relative) =>
        addAsset(relative, (asset) => checkBrandFile(relative, asset), 512 * 1024),
    });
    for (const issue of parsed.issues) warn(`theme ${theme.id}: ${issue}`);
    if (parsed.unmapped.length > 0) {
      warn(
        `theme ${theme.id}: ${parsed.unmapped.length} VS Code colour id(s) have no Omnigent token (partial import)`,
      );
    }
    files[theme.path] = { kind: "json", data };
  }
  return { files, sourceFiles, assets };
}

/**
 * Checks a `browser` or `main` entry: an ES module whose real path is inside the
 * folder. Returns its real path, or records the problem.
 */
function validateEntry(
  field: "browser" | "main",
  value: unknown,
  directory: string,
  problems: string[],
  required: boolean,
): string | undefined {
  const example = field === "browser" ? "./src/extension.js" : "./src/node/extension.js";
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(
      required
        ? `"${field}" must name the ${field} entry file, for example "${example}"`
        : `"${field}" must be a file path such as "${example}" when present`,
    );
    return undefined;
  }
  const resolved = path.resolve(directory, value);
  if (!isInside(resolved, directory)) {
    problems.push(`"${field}" must stay inside the extension folder, got ${value}`);
  } else if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    problems.push(`"${field}" entry ${value} does not exist`);
  } else if (!isInside(realpathSync(resolved), directory)) {
    problems.push(`"${field}" entry ${value} is a symlink to a file outside the extension folder`);
  } else if (!/\.m?js$/.test(resolved)) {
    problems.push(`"${field}" entry ${value} must be an ES module (.js or .mjs)`);
  } else {
    return realpathSync(resolved);
  }
  return undefined;
}

export function scanDevExtensions(folders: readonly string[]): DevExtensionScan {
  const scan: DevExtensionScan = { extensions: [], errors: [], warnings: [], assets: new Map() };
  const seen = new Map<string, string>();
  for (const folder of folders) {
    const result = readDevExtension(folder);
    scan.warnings.push(...result.warnings);
    if ("error" in result) {
      scan.errors.push(result.error);
      continue;
    }
    // Ids compare case-insensitively, as VS Code's do.
    const previous = seen.get(result.extension.id.toLowerCase());
    if (previous !== undefined) {
      scan.errors.push(
        `${folder}: invalid extension: duplicate id ${result.extension.id} (already loaded from ${previous})`,
      );
      continue;
    }
    seen.set(result.extension.id.toLowerCase(), folder);
    scan.extensions.push(result.extension);
    for (const [url, asset] of result.assets) scan.assets.set(url, asset);
  }
  return scan;
}

function isInside(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function realpathOrUndefined(file: string): string | undefined {
  try {
    return realpathSync(file);
  } catch {
    return undefined;
  }
}

/** Strips Vite's query suffix and `/@fs` prefix from an importer id. */
function importerPath(importer: string): string {
  const withoutQuery = importer.split("?")[0] ?? importer;
  return withoutQuery.startsWith("/@fs/") ? withoutQuery.slice(4) : withoutQuery;
}

/**
 * Real paths of the files an extension can import: its own servable files,
 * skipping node_modules, .git, symlinked directories and symlinks that leave it.
 */
export function servableExtensionFiles(directory: string): string[] {
  const files: string[] = [];
  const pending = [directory];
  while (pending.length > 0 && files.length < MAX_SERVABLE_FILES) {
    const current = pending.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const file = path.join(current, name);
      let stats;
      try {
        stats = lstatSync(file);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(name)) pending.push(file);
        continue;
      }
      if (!SERVABLE_FILE_PATTERN.test(name)) continue;
      const real = stats.isSymbolicLink() ? realpathOrUndefined(file) : file;
      if (real !== undefined && isInside(real, directory) && statSync(real).isFile()) {
        files.push(real);
      }
    }
  }
  return [...new Set(files)].sort();
}

/** `file` is inside `directory` and not under a node_modules or .git folder of it. */
function isOwnFile(file: string, directory: string): boolean {
  return (
    isInside(file, directory) &&
    !path
      .relative(directory, file)
      .split(path.sep)
      .some((segment) => SKIPPED_DIRECTORIES.has(segment))
  );
}

/** A bare package specifier such as `pkg` or `@scope/pkg` (not a path or URL). */
function isBareSpecifier(id: string): boolean {
  return !/^[./]/.test(id) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(id);
}

/** The deepest of `directories` that contains `file`, so a nested folder wins. */
function deepestContaining<T>(
  file: string,
  items: readonly T[],
  directoryOf: (item: T) => string,
): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    const directory = directoryOf(item);
    if (!isInside(file, directory)) continue;
    if (best === undefined || directory.length > directoryOf(best).length) best = item;
  }
  return best;
}

/** Filesystem path a dev-server request URL names, if it names one. */
function requestPath(url: string, root: string): string | undefined {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return undefined;
  }
  if (pathname.startsWith("/@fs/")) return path.resolve(pathname.slice(4));
  if (pathname.startsWith("/@")) return undefined;
  return path.join(root, pathname);
}

export interface OmnigentExtensionsDevOptions {
  /** Extension folders; defaults to OMNIGENT_WEB_EXTENSION_DEV_PATHS. */
  paths?: readonly string[];
  /** Module the per-extension API module imports `getExtensionApi` from. */
  apiRegistryModule?: string;
  /** Silences the startup summary (tests). */
  quiet?: boolean;
  /** Options for the child process that runs `main` entries (tests). */
  nodeHost?: NodeExtensionHostOptions;
}

/** How long the Node host waits after a file change before restarting. */
const NODE_RESTART_DEBOUNCE_MS = 300;

export function omnigentExtensionsDev(options: OmnigentExtensionsDevOptions = {}): Plugin {
  const folders = options.paths ?? parseDevPaths(process.env[DEV_PATHS_ENV]);
  const apiRegistryModule =
    options.apiRegistryModule ?? path.resolve(__dirname, "src/vscodeExtensions/apiRegistry.ts");
  let scan: DevExtensionScan = scanDevExtensions(folders);
  let serving = false;
  let resolvedConfig: ResolvedConfig | undefined;
  // What this plugin added to server.fs.allow, so a rescan can replace it.
  let allowedFiles: string[] = [];
  let viteClient: Set<string> | undefined;
  // Node entries and the endpoint the page runs their commands through: dev only.
  const commandToken = createCommandToken();
  const nodeHost = new NodeExtensionHost(options.nodeHost);
  const nodeExtensions = () =>
    scan.extensions.flatMap(({ id, version, directory, mainPath }) =>
      mainPath === undefined ? [] : [{ id, version, directory, mainPath }],
    );
  const startNodeHost = () => void nodeHost.start(nodeExtensions());
  /** Restarts the Node host after edits, once its running commands finish or their grace ends. */
  const scheduleNodeRestart = () =>
    nodeHost.scheduleRestart(nodeExtensions(), NODE_RESTART_DEBOUNCE_MS);

  const report = () => {
    if (options.quiet) return;
    for (const extension of scan.extensions) {
      console.log(
        `[omnigent-extensions] loaded ${extension.id} ${extension.version} from ${extension.directory}`,
      );
    }
    for (const warning of scan.warnings) console.warn(`[omnigent-extensions] warning: ${warning}`);
    for (const error of scan.errors) console.error(`[omnigent-extensions] error: ${error}`);
  };

  const extensionFor = (importer: string): DevExtension | undefined =>
    deepestContaining(importerPath(importer), scan.extensions, (extension) => extension.directory);

  /** Replaces this plugin's server.fs.allow entries with the current extensions' files. */
  const refreshAllowList = () => {
    if (!serving || resolvedConfig === undefined) return;
    const allow = resolvedConfig.server.fs.allow;
    const previous = new Set(allowedFiles);
    const kept = allow.filter((entry) => !previous.has(entry));
    allowedFiles = scan.extensions.flatMap((extension) =>
      servableExtensionFiles(extension.directory).map((file) => normalizePath(file)),
    );
    allow.splice(0, allow.length, ...kept, ...allowedFiles);
  };

  /** A theme file, font or brand image an extension's contributions name. */
  const isThemeSource = (file: string) => {
    const resolved = realpathOrUndefined(file) ?? path.resolve(file);
    return scan.extensions.some((extension) => extension.sourceFiles?.includes(resolved));
  };

  /** Re-reads the theme files after an edit and hands the page the new ones (no reload). */
  const refreshThemeFiles = (server: ViteDevServer) => {
    const previous = new Map(scan.extensions.map((extension) => [extension.id, extension.files]));
    scan = scanDevExtensions(folders);
    report();
    const module = server.moduleGraph.getModuleById(RESOLVED_DEV_EXTENSIONS_MODULE);
    if (module) server.moduleGraph.invalidateModule(module);
    for (const extension of scan.extensions) {
      if (JSON.stringify(previous.get(extension.id)) === JSON.stringify(extension.files)) continue;
      server.ws.send({
        type: "custom",
        event: DEV_EXTENSION_FILES_EVENT,
        data: { id: extension.id, files: extension.files ?? {} },
      });
    }
  };

  const rescan = (server: ViteDevServer) => {
    scan = scanDevExtensions(folders);
    refreshAllowList();
    report();
    startNodeHost();
    const module = server.moduleGraph.getModuleById(RESOLVED_DEV_EXTENSIONS_MODULE);
    if (module) server.moduleGraph.invalidateModule(module);
    server.ws.send({ type: "full-reload" });
  };

  /** Each configured folder that exists, by declared and by real path. */
  const folderRoots = () =>
    folders.flatMap((folder) => {
      const real = realpathOrUndefined(folder);
      if (real === undefined) return [];
      const declared = path.resolve(folder);
      return declared === real
        ? [{ directory: real, real }]
        : [
            { directory: declared, real },
            { directory: real, real },
          ];
    });

  /** `file` (declared or real path) is in a configured extension folder. */
  const inAnyFolder = (file: string) =>
    folderRoots().some(({ directory, real }) => isInside(file, directory) || isInside(file, real));

  /** Why `file` must not be served: it is in an extension folder but really lives outside it. */
  const escapeReason = (file: string): string | undefined => {
    const root = deepestContaining(file, folderRoots(), ({ directory }) => directory);
    if (root === undefined) return undefined;
    const real = realpathOrUndefined(file);
    if (real === undefined || isInside(real, root.real)) return undefined;
    return `${file} resolves to ${real}, outside the extension folder ${root.real}`;
  };

  const guardMiddleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const file =
      req.url === undefined || resolvedConfig === undefined
        ? undefined
        : requestPath(req.url, resolvedConfig.root);
    const reason = file === undefined ? undefined : escapeReason(file);
    if (reason === undefined) return next();
    console.error(`[omnigent-extensions] refused to serve ${reason}`);
    res.statusCode = 403;
    res.end("Forbidden: extension file outside its folder");
  };

  return {
    name: "omnigent-extensions-dev",
    enforce: "pre",
    config() {
      if (folders.length === 0) return;
      // Defense in depth for the dep optimizer, which resolves and bundles a
      // package's imports without the resolveId guard below: it must never read a
      // file in an extension folder (its node_modules included). Extension
      // entries are loaded by dynamic URL, so the scanner cannot find them from
      // index.html either.
      return {
        optimizeDeps: {
          rolldownOptions: {
            plugins: [
              {
                name: "omnigent-extensions-no-prebundle",
                load(id: string) {
                  const file = importerPath(id);
                  if (path.isAbsolute(file) && inAnyFolder(file)) {
                    throw new Error(
                      `[omnigent-extensions] refused to pre-bundle ${file}: files in an extension folder are never optimized`,
                    );
                  }
                  return null;
                },
              },
            ],
          },
        },
      };
    },
    configResolved(config) {
      resolvedConfig = config;
      serving = config.command === "serve" && !config.isProduction;
      if (!serving) return;
      refreshAllowList();
      if (folders.length > 0) report();
    },
    configureServer(server) {
      // Registered before Vite's own middlewares, so it sees every file request.
      server.middlewares.use(guardMiddleware);
      server.middlewares.use(DEV_EXTENSION_ASSETS_PATH, (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const pathname = (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "";
        const asset = scan.assets.get(pathname);
        if (!asset) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        res.setHeader("Content-Type", asset.type);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "no-cache");
        // Opened as a document, an asset loads, styles and runs nothing: a brand SVG's
        // markup included, and the fonts and images alike, for consistency.
        res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'none'; sandbox");
        res.end(req.method === "HEAD" ? undefined : Buffer.from(asset.body));
      });
      server.middlewares.use(
        DEV_EXTENSIONS_ENDPOINT,
        createCommandEndpoint({ token: commandToken, host: nodeHost }),
      );
      server.httpServer?.on("close", () => {
        nodeHost.stop();
      });
      server.middlewares.use(DEV_EXTENSIONS_ENDPOINT, (req, res, next) => {
        if (req.method !== "GET") return next();
        res.setHeader("Content-Type", "application/json");
        const { extensions, errors, warnings } = scan;
        res.end(JSON.stringify({ extensions, errors, warnings }));
      });
      if (folders.length === 0) return;
      startNodeHost();
      const manifests = new Set(folders.map((folder) => path.resolve(folder, "package.json")));
      const isManifest = (file: string) =>
        manifests.has(path.resolve(file)) ||
        folderRoots().some(({ real }) => path.resolve(file) === path.join(real, "package.json"));
      const inFolder = (file: string) =>
        folderRoots().some(({ directory }) => isInside(path.resolve(file), directory));
      server.watcher.add([...folders, ...manifests]);
      server.watcher.on("all", (event, file) => {
        if (event !== "add" && event !== "change" && event !== "unlink") return;
        if (isManifest(file)) rescan(server);
        else if (isThemeSource(file)) refreshThemeFiles(server);
        // A new, replaced or removed source file changes what the extension may
        // import (a change can turn a file into a symlink); rebuilding is cheap.
        else if (inFolder(file)) {
          refreshAllowList();
          // Node has no hot reload: edits in a folder with a Node entry restart its host.
          const resolvedFile = path.resolve(file);
          if (nodeExtensions().some(({ directory }) => isInside(resolvedFile, directory))) {
            scheduleNodeRestart();
          }
        }
      });
    },
    async resolveId(id, importer) {
      if (id === DEV_EXTENSIONS_MODULE) return RESOLVED_DEV_EXTENSIONS_MODULE;
      if (importer === undefined) return null;
      const extension = extensionFor(importer);
      if (extension === undefined) return null;
      if (id === "omnigent") return `${API_MODULE_PREFIX}${extension.id}`;
      if (id.startsWith("\0") || id.startsWith("virtual:")) return null;
      const refuse = (why: string): never =>
        this.error(
          `${extension.id}: ${importerPath(importer)} imports ${id}, ${why}; an extension may import only "omnigent" and its own files`,
        );
      // Refused before resolving: resolving a bare package registers it with the
      // dep optimizer, which would bundle it (and what it imports) into
      // /node_modules/.vite/deps without this guard.
      if (id.startsWith("/@id/")) refuse("a Vite module id");
      if (VITE_CLIENT_IDS.has(id)) return null;
      if (isBareSpecifier(id)) refuse("a package");
      // Vite serves whatever an allowed module imports, so check the real target here.
      const resolved = await this.resolve(id, importer, { skipSelf: true });
      if (resolved === null || resolved.external || resolved.id.startsWith("\0")) return resolved;
      const resolvedPath = importerPath(resolved.id);
      // A target that does not exist (yet) is judged by its path.
      const target = realpathOrUndefined(resolvedPath) ?? path.resolve(resolvedPath);
      // Vite injects its env module into workers as a `/@fs/` import.
      viteClient ??= viteClientFiles();
      if (viteClient.has(target)) return resolved;
      if (!isInside(target, extension.directory)) {
        refuse(`which resolves to ${target}, outside the extension folder ${extension.directory}`);
      }
      if (!isOwnFile(target, extension.directory)) {
        refuse(`which resolves to ${target}, inside the extension's node_modules or .git`);
      }
      return resolved;
    },
    async load(id) {
      if (id === RESOLVED_DEV_EXTENSIONS_MODULE) {
        // The page learns which Node commands exist once the Node entries activated.
        if (serving) await nodeHost.ready;
        const commandEndpoint = serving
          ? {
              url: DEV_EXTENSIONS_ENDPOINT,
              token: commandToken,
              tokenHeader: COMMAND_TOKEN_HEADER,
              nodeCommands: nodeHost.allCommands(),
            }
          : null;
        const extensions = serving
          ? scan.extensions.map(
              ({
                id: extensionId,
                version,
                displayName,
                activationEvents,
                entryUrl,
                contributes,
                files,
              }) => ({
                id: extensionId,
                version,
                ...(displayName === undefined ? {} : { displayName }),
                activationEvents,
                entryUrl,
                ...(contributes === undefined ? {} : { contributes }),
                ...(files === undefined ? {} : { files }),
              }),
            )
          : [];
        return [
          // Parsed, not an object literal: a `"__proto__"` key in a theme file stays a key
          // (the page drops it with a warning) instead of becoming a prototype.
          `export const devExtensions = ${extensions.length === 0 ? "[]" : `JSON.parse(${JSON.stringify(JSON.stringify(extensions))})`};`,
          `export const devExtensionErrors = ${JSON.stringify(serving ? scan.errors : [])};`,
          `export const devCommandEndpoint = ${JSON.stringify(commandEndpoint)};`,
        ].join("\n");
      }
      if (id.startsWith(API_MODULE_PREFIX)) {
        const extensionId = id.slice(API_MODULE_PREFIX.length);
        return [
          `import { getExtensionApi } from ${JSON.stringify(apiRegistryModule)};`,
          `const api = getExtensionApi(${JSON.stringify(extensionId)});`,
          ...OMNIGENT_API_EXPORTS.map((name) => `export const ${name} = api.${name};`),
          "export default api;",
        ].join("\n");
      }
      if (serving && !id.startsWith("\0")) {
        const reason = escapeReason(importerPath(id));
        if (reason !== undefined) this.error(`refused to load ${reason}`);
      }
      return null;
    },
  };
}
