// The views of the built-in extensions' view containers, read from their manifests: a side
// bar drawn before the extension host registered them (a test, a page without the host) still
// draws its built-in views, with the same contributions the host registers.
import { parseContributions } from "@/vscodeExtensions/contributions";
import type { RailViewContribution } from "@/shell/railViews";
import automationsManifest from "./omnigent.automations/package.json";
import canvasManifest from "./omnigent.canvas/package.json";
import conversationsManifest from "./omnigent.conversations/package.json";
import inboxManifest from "./omnigent.inbox/package.json";

const MANIFESTS: readonly { readonly id: string; readonly manifest: unknown }[] = [
  { id: "omnigent.conversations", manifest: conversationsManifest },
  { id: "omnigent.inbox", manifest: inboxManifest },
  { id: "omnigent.automations", manifest: automationsManifest },
  { id: "omnigent.canvas", manifest: canvasManifest },
];

let views: ReadonlyMap<string, readonly RailViewContribution[]> | undefined;

function readViews(): ReadonlyMap<string, readonly RailViewContribution[]> {
  const byContainer = new Map<string, RailViewContribution[]>();
  for (const { id, manifest } of MANIFESTS) {
    const { contributions } = parseContributions(
      id,
      (manifest as { contributes?: unknown }).contributes,
      { builtIn: true },
    );
    for (const view of contributions.views) {
      const list = byContainer.get(view.containerId) ?? [];
      list.push(
        Object.freeze({
          id: view.id,
          extensionId: id,
          name: view.name,
          icon: view.icon,
          containerId: view.containerId,
          ...(view.when === undefined ? {} : { when: view.when }),
          ...(view.visibility === undefined ? {} : { visibility: view.visibility }),
          ...(view.builtInView === undefined ? {} : { builtInView: view.builtInView }),
          ...(view.initialSize === undefined ? {} : { initialSize: view.initialSize }),
        }),
      );
      byContainer.set(view.containerId, list);
    }
  }
  return byContainer;
}

/** The built-in views of `containerId`, in manifest order (none for another container). */
export function builtInContainerViews(containerId: string): readonly RailViewContribution[] {
  views ??= readViews();
  return views.get(containerId) ?? [];
}

/** Every built-in container's views, in manifest order. */
export function allBuiltInContainerViews(): readonly RailViewContribution[] {
  views ??= readViews();
  return [...views.values()].flat();
}
