import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { BUILT_IN_RAIL_TABS } from "@/shell/railTabs";
import { RailViewRegistry } from "@/shell/railViews";
import { WorkspaceBridge } from "@/shell/workspaceBridge";
import { parseContributions } from "@/vscodeExtensions/contributions";
import { createExtensionRuntime } from "@/vscodeExtensions/extensionHost";
import { validateManifest } from "@/vscodeExtensions/manifest";
import { memoryExtensionState } from "@/test/builtInExtensions";
import { BUILT_IN_EXTENSIONS, builtInExtensions } from ".";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const folders = readdirSync(ROOT).filter((entry) => statSync(path.join(ROOT, entry)).isDirectory());

const TEST_FILE = /\.test\.[^/]+$/;
const SOURCE_FILE = /\.tsx?$/;
const MANIFEST = "package.json";

/** Every file under `directory`. */
function allFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? allFiles(full) : [full];
  });
}

/** The extension's own modules: TypeScript sources other than tests. */
function isSource(file: string): boolean {
  return SOURCE_FILE.test(file) && !TEST_FILE.test(file);
}

/**
 * What the bundle may load from an extension folder: its TypeScript sources and
 * manifest. Tests run only under vitest; any other file is a way around the check.
 */
function fileViolation(folder: string, file: string): string | undefined {
  if (isSource(file) || TEST_FILE.test(file)) return undefined;
  if (path.relative(folder, file) === MANIFEST) return undefined;
  return "a file the boundary check can't read; only .ts/.tsx sources, tests and package.json";
}

/** Every module a source names: static, side-effect, type-only and dynamic imports, and re-exports. */
function importSpecifiers(text: string): string[] {
  return ts.preProcessFile(text, true, true).importedFiles.map((file) => file.fileName);
}

/**
 * Loads the import scanner doesn't see as a plain string: `import.meta.glob`,
 * `import()` of anything but a string literal, `new URL(..., import.meta.url)`
 * and triple-slash references.
 */
function hiddenLoads(text: string): string[] {
  const found: string[] = [];
  const info = ts.preProcessFile(text, true, true);
  for (const reference of info.referencedFiles) {
    found.push(`/// <reference path="${reference.fileName}">`);
  }
  for (const reference of info.typeReferenceDirectives) {
    found.push(`/// <reference types="${reference.fileName}">`);
  }
  const source = ts.createSourceFile("source.tsx", text, ts.ScriptTarget.Latest, true);
  const isImportMeta = (node: ts.Node): node is ts.MetaProperty =>
    ts.isMetaProperty(node) &&
    node.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.name.text === "meta";
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isImportMeta(node.expression)) {
      if (node.name.text.startsWith("glob")) found.push(`import.meta.${node.name.text}`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (!argument || !ts.isStringLiteral(argument)) {
        found.push(`import(${argument ? argument.getText(source) : ""})`);
      }
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL" &&
      node.arguments?.some(
        (argument) =>
          ts.isPropertyAccessExpression(argument) &&
          isImportMeta(argument.expression) &&
          argument.name.text === "url",
      )
    ) {
      found.push(`new URL(..., import.meta.url)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The file a relative import loads: as written, or with a TypeScript extension or index added. */
function resolveImport(resolved: string, exists: (file: string) => boolean): string {
  const candidates = [
    resolved,
    ...[".ts", ".tsx"].map((extension) => resolved + extension),
    ...["index.ts", "index.tsx"].map((index) => path.join(resolved, index)),
  ];
  return candidates.find(exists) ?? resolved;
}

const isFile = (file: string) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

/** Why `specifier` in `file` leaves the extension API, if it does. */
function boundaryViolation(
  folder: string,
  file: string,
  specifier: string,
  exists: (file: string) => boolean = isFile,
): string | undefined {
  if (specifier === "omnigent" || specifier === "@/vscodeExtensions/builtinApi") return undefined;
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return "app or package import";
  const target = resolveImport(path.resolve(path.dirname(file), specifier), exists);
  const inside = path.relative(folder, target);
  if (inside.startsWith("..") || path.isAbsolute(inside)) return "leaves the extension folder";
  if (TEST_FILE.test(target)) return "loads a test file, which the check doesn't scan";
  if (inside !== MANIFEST && !SOURCE_FILE.test(target)) {
    return "loads a file that isn't TypeScript, which the check doesn't scan";
  }
  return undefined;
}

/** Every way a source in `folder` reaches past the API. */
function sourceViolations(
  folder: string,
  file: string,
  text: string,
  exists: (file: string) => boolean = isFile,
): string[] {
  return [
    ...importSpecifiers(text).flatMap((specifier) => {
      const why = boundaryViolation(folder, file, specifier, exists);
      return why === undefined ? [] : [`imports ${specifier}: ${why}`];
    }),
    ...hiddenLoads(text).map((load) => `uses ${load}`),
  ];
}

describe("built-in import boundary check", () => {
  const folder = path.join(ROOT, "omnigent.example");
  const file = path.join(folder, "extension.ts");
  const existing = new Set(
    ["model.ts", "view.tsx", "lib/index.ts", "model.test.ts", "helper.js", "data.json"].map(
      (name) => path.join(folder, name),
    ),
  );
  const exists = (candidate: string) => existing.has(candidate);
  const violations = (source: string) =>
    importSpecifiers(source).flatMap((specifier) => {
      const why = boundaryViolation(folder, file, specifier, exists);
      return why === undefined ? [] : [specifier];
    });

  it("catches every import form that reaches app code", () => {
    expect(
      violations(`
        import { a } from "./../../shell/x";
        import "@/store/chatStore";
        import('@/store/chatStore');
        const lazy = () => import("../omnigent.other/extension");
        export { b } from "@/lib/utils";
        export * from 'react';
        import type { C } from "@/lib/types";
        import d = require("@/lib/d");
      `),
    ).toEqual([
      "./../../shell/x",
      "@/store/chatStore",
      "@/store/chatStore",
      "../omnigent.other/extension",
      "@/lib/utils",
      "react",
      "@/lib/types",
      "@/lib/d",
    ]);
  });

  it("allows the API, its binding and files of the extension itself", () => {
    expect(
      sourceViolations(
        folder,
        file,
        `
        import type * as Omnigent from "omnigent";
        import { bindExtensionApi } from "@/vscodeExtensions/builtinApi";
        import manifest from "./package.json";
        import { model } from "./lib/../model";
        import { View } from "./view";
        import { lib } from "./lib";
        const later = () => import("./model");
      `,
        exists,
      ),
    ).toEqual([]);
  });

  it.each([
    ["a test file", `import { fixture } from "./model.test";`, /loads a test file/],
    ["a test file by extension", `import "./model.test.ts";`, /loads a test file/],
    ["a JavaScript file", `import { helper } from "./helper.js";`, /isn't TypeScript/],
    ["a JSON file other than the manifest", `import data from "./data.json";`, /isn't TypeScript/],
    ["import.meta.glob", `const all = import.meta.glob("../../store/*.ts");`, /import\.meta\.glob/],
    ["import.meta.globEager", `const all = import.meta.globEager("../*.ts");`, /globEager/],
    ["a template-literal import()", "const m = import(`@/store/chatStore`);", /import\(`/],
    ["a computed import()", `const name = "@/store"; const m = import(name);`, /import\(name\)/],
    [
      "new URL(..., import.meta.url)",
      `const url = new URL("../../store/chatStore.ts", import.meta.url);`,
      /new URL/,
    ],
    ["/// <reference path>", `/// <reference path="../../store/chatStore.ts" />`, /reference path/],
    ["/// <reference types>", `/// <reference types="vite/client" />`, /reference types/],
  ])("rejects %s", (_name, source, expected) => {
    // A template literal also reads as a plain import, so it can be reported twice.
    expect(sourceViolations(folder, file, source, exists)).toContainEqual(
      expect.stringMatching(expected),
    );
  });

  it("accepts only sources, tests and the manifest as files", () => {
    expect(fileViolation(folder, path.join(folder, "model.ts"))).toBeUndefined();
    expect(fileViolation(folder, path.join(folder, "view.test.tsx"))).toBeUndefined();
    expect(fileViolation(folder, path.join(folder, "package.json"))).toBeUndefined();
    for (const name of ["helper.js", "helper.mjs", "data.json", "lib/package.json", "style.css"]) {
      expect(fileViolation(folder, path.join(folder, name)), name).toBeDefined();
    }
  });
});

describe("built-in extensions", () => {
  it("has one registry entry per folder, named publisher.name", () => {
    expect(BUILT_IN_EXTENSIONS).toHaveLength(folders.length);
    for (const folder of folders) {
      const manifest = JSON.parse(readFileSync(path.join(ROOT, folder, "package.json"), "utf8"));
      expect(`${manifest.publisher}.${manifest.name}`).toBe(folder);
      expect(manifest.publisher).toBe("omnigent");
    }
  });

  it.each(folders)("%s has a valid manifest and contributions without warnings", (folder) => {
    const raw = JSON.parse(readFileSync(path.join(ROOT, folder, "package.json"), "utf8"));
    const { manifest, problems, warnings } = validateManifest(raw, folder);
    expect(problems).toEqual([]);
    expect(warnings).toEqual([]);
    const parsed = parseContributions(manifest!.id, manifest!.contributes, {
      builtIn: true,
      builtInTabs: BUILT_IN_RAIL_TABS,
    });
    expect(parsed.warnings).toEqual([]);
    // The entry the manifest names exists.
    expect(statSync(path.join(ROOT, folder, manifest!.browser!)).isFile()).toBe(true);
  });

  it.each(folders)(
    "%s only uses the extension API: no React, store or other app imports",
    (folder) => {
      const directory = path.join(ROOT, folder);
      for (const file of allFiles(directory)) {
        const where = path.relative(ROOT, file);
        expect(fileViolation(directory, file), where).toBeUndefined();
        if (!isSource(file)) continue;
        expect(sourceViolations(directory, file, readFileSync(file, "utf8")), where).toEqual([]);
      }
    },
  );

  it("leaves out a built-in whose manifest fails its checks, and logs it", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const descriptions = builtInExtensions([
      { manifest: { name: "Bad Name" }, module: { activate: () => {} } },
      ...BUILT_IN_EXTENSIONS,
    ]);
    expect(descriptions.map((description) => description.id)).toEqual([
      "omnigent.agents",
      "omnigent.changes",
      "omnigent.content-search",
      "omnigent.tasks",
    ]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("invalid built-in extension"));
    error.mockRestore();
  });

  it("registers the built-in views synchronously at startup, before activation settles", async () => {
    const registry = new RailViewRegistry();
    const runtime = createExtensionRuntime({
      registry,
      bridge: new WorkspaceBridge(),
      hostOptions: { extensionState: memoryExtensionState() },
    });
    // No await yet: the first render already finds the built-in tabs' views.
    expect(registry.get("omnigent.changes.view")).toMatchObject({ builtInTab: "changes" });
    expect(registry.get("omnigent.agents.view")).toMatchObject({ builtInTab: "subagents" });
    expect(registry.get("omnigent.content-search.view")).toMatchObject({
      builtInTab: "content-search",
    });
    await runtime.builtInsStarted;
    expect(runtime.host.isActive("omnigent.changes")).toBe(true);
    expect(registry.get("omnigent.changes.view")?.tree).toBeDefined();
    expect(runtime.host.isActive("omnigent.agents")).toBe(true);
    expect(runtime.host.isActive("omnigent.content-search")).toBe(true);
    expect(runtime.host.isActive("omnigent.tasks")).toBe(true);
    expect(registry.get("omnigent.tasks.view")).toMatchObject({ builtInTab: "tasks" });
    expect(registry.get("omnigent.tasks.view")?.plan).toBeDefined();
    await runtime.dispose();
    expect(registry.get("omnigent.changes.view")).toBeUndefined();
  });

  it("shows a failed built-in as an error state, with the failure logged", async () => {
    const registry = new RailViewRegistry();
    const logged = vi.fn();
    const changes = builtInExtensions().find((extension) => extension.id === "omnigent.changes")!;
    const runtime = createExtensionRuntime({
      registry,
      bridge: new WorkspaceBridge(),
      builtIns: [
        {
          ...changes,
          load: () =>
            Promise.resolve({
              activate: () => {
                throw new Error("boom");
              },
            }),
        },
      ],
      hostOptions: {
        extensionState: memoryExtensionState(),
        console: { error: logged, warn: vi.fn(), info: vi.fn() },
      },
    });
    await runtime.builtInsStarted;
    expect(registry.get("omnigent.changes.view")).toMatchObject({
      loading: false,
      error: "activation failed",
    });
    expect(logged).toHaveBeenCalledWith(
      "[omnigent-extensions] omnigent.changes: activate failed",
      expect.any(Error),
    );
    await runtime.dispose();
  });
});
