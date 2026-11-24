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

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Every module a source names: static, side-effect, type-only and dynamic imports, and re-exports. */
function importSpecifiers(text: string): string[] {
  return ts.preProcessFile(text, true, true).importedFiles.map((file) => file.fileName);
}

/** Why `specifier` in `file` leaves the extension API, if it does. */
function boundaryViolation(folder: string, file: string, specifier: string): string | undefined {
  if (specifier === "omnigent" || specifier === "@/vscodeExtensions/builtinApi") return undefined;
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return "app or package import";
  const resolved = path.resolve(path.dirname(file), specifier);
  const inside = path.relative(folder, resolved);
  return inside.startsWith("..") || path.isAbsolute(inside)
    ? "leaves the extension folder"
    : undefined;
}

describe("built-in import boundary check", () => {
  const folder = path.join(ROOT, "omnigent.example");
  const file = path.join(folder, "extension.ts");
  const violations = (source: string) =>
    importSpecifiers(source).flatMap((specifier) => {
      const why = boundaryViolation(folder, file, specifier);
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
      violations(`
        import type * as Omnigent from "omnigent";
        import { bindExtensionApi } from "@/vscodeExtensions/builtinApi";
        import manifest from "./package.json";
        import { model } from "./lib/../model";
      `),
    ).toEqual([]);
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
      for (const file of sourceFiles(directory)) {
        for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
          const why = boundaryViolation(directory, file, specifier);
          expect(why, `${path.relative(ROOT, file)} imports ${specifier}`).toBeUndefined();
        }
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
      "omnigent.changes",
      "omnigent.content-search",
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
    expect(registry.get("omnigent.content-search.view")).toMatchObject({
      builtInTab: "content-search",
    });
    await runtime.builtInsStarted;
    expect(runtime.host.isActive("omnigent.changes")).toBe(true);
    expect(registry.get("omnigent.changes.view")?.tree).toBeDefined();
    expect(runtime.host.isActive("omnigent.content-search")).toBe(true);
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
