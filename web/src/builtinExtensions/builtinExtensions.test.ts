import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
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
      for (const file of sourceFiles(path.join(ROOT, folder))) {
        const imports = [...readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)].map(
          (match) => match[1],
        );
        for (const specifier of imports) {
          const allowed =
            specifier.startsWith("./") ||
            specifier === "omnigent" ||
            specifier === "@/vscodeExtensions/builtinApi";
          expect(allowed, `${path.relative(ROOT, file)} imports ${specifier}`).toBe(true);
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
    expect(descriptions.map((description) => description.id)).toEqual(["omnigent.changes"]);
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
    // No await yet: the first render already finds the Changes view.
    expect(registry.get("omnigent.changes.view")).toMatchObject({ builtInTab: "changes" });
    await runtime.builtInsStarted;
    expect(runtime.host.isActive("omnigent.changes")).toBe(true);
    expect(registry.get("omnigent.changes.view")?.tree).toBeDefined();
    await runtime.dispose();
    expect(registry.get("omnigent.changes.view")).toBeUndefined();
  });

  it("shows a failed built-in as an error state, with the failure logged", async () => {
    const registry = new RailViewRegistry();
    const logged = vi.fn();
    const [changes] = builtInExtensions();
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
