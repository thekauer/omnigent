// The built-in extensions, bundled with the app and activated at startup in every
// build. Each lives in its own folder with a package.json manifest, shaped like a
// dev extension's, and an entry module that only uses the extension API.
import type { ExtensionDescription } from "@/vscodeExtensions/host";
import { validateManifest } from "@/vscodeExtensions/manifest";
import * as agents from "./omnigent.agents/extension";
import agentsManifest from "./omnigent.agents/package.json";
import * as changes from "./omnigent.changes/extension";
import changesManifest from "./omnigent.changes/package.json";
import * as contentSearch from "./omnigent.content-search/extension";
import contentSearchManifest from "./omnigent.content-search/package.json";

export interface BuiltInExtension {
  readonly manifest: unknown;
  readonly module: { activate: (context: never) => unknown; deactivate?: () => unknown };
}

export const BUILT_IN_EXTENSIONS: readonly BuiltInExtension[] = Object.freeze([
  { manifest: agentsManifest, module: agents },
  { manifest: changesManifest, module: changes },
  { manifest: contentSearchManifest, module: contentSearch },
]);

/** The built-ins as the host loads them; a manifest that fails its checks is logged and left out. */
export function builtInExtensions(
  extensions: readonly BuiltInExtension[] = BUILT_IN_EXTENSIONS,
): ExtensionDescription[] {
  const descriptions: ExtensionDescription[] = [];
  for (const { manifest: raw, module } of extensions) {
    const { manifest, problems, warnings } = validateManifest(raw, "built-in extension");
    for (const warning of warnings) console.warn(`[omnigent-extensions] ${warning}`);
    if (!manifest) {
      console.error(`[omnigent-extensions] invalid built-in extension: ${problems.join("; ")}`);
      continue;
    }
    descriptions.push({
      id: manifest.id,
      version: manifest.version,
      activationEvents: manifest.activationEvents,
      entryUrl: `builtin:${manifest.id}`,
      load: () => Promise.resolve(module),
      builtIn: true,
      ...(manifest.contributes === undefined ? {} : { contributes: manifest.contributes }),
    });
  }
  return descriptions;
}
