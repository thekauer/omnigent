// The `when` clause of each built-in rail tab's view, read from the built-in manifests: the
// shell gates the tabs by these clauses (layout plan L3), the same ones the views register
// with, so the gating has one source even before the extension host started.
import { parseWhen, type WhenClause } from "@/vscodeExtensions/when";
import agentsManifest from "./omnigent.agents/package.json";
import changesManifest from "./omnigent.changes/package.json";
import contentSearchManifest from "./omnigent.content-search/package.json";
import filesManifest from "./omnigent.files/package.json";
import pullRequestsManifest from "./omnigent.pull-requests/package.json";
import tasksManifest from "./omnigent.tasks/package.json";

interface ManifestView {
  readonly builtInTab?: string;
  readonly when?: string;
}

const MANIFESTS: readonly unknown[] = [
  agentsManifest,
  changesManifest,
  contentSearchManifest,
  filesManifest,
  pullRequestsManifest,
  tasksManifest,
];

let clauses: ReadonlyMap<string, WhenClause | undefined> | undefined;

function readClauses(): ReadonlyMap<string, WhenClause | undefined> {
  const byTab = new Map<string, WhenClause | undefined>();
  for (const manifest of MANIFESTS) {
    const views = (manifest as { contributes?: { views?: Record<string, ManifestView[]> } })
      .contributes?.views;
    for (const entries of Object.values(views ?? {})) {
      for (const view of entries) {
        if (view.builtInTab === undefined) continue;
        byTab.set(view.builtInTab, view.when === undefined ? undefined : parseWhen(view.when));
      }
    }
  }
  return byTab;
}

/** The `when` of the built-in view standing in for `tab`; undefined when it has none. */
export function builtInTabWhen(tab: string): WhenClause | undefined {
  clauses ??= readClauses();
  return clauses.get(tab);
}
