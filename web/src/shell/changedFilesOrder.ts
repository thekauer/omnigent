// The order of a changed-files list, shared by the file viewer's prev/next, the
// Files tree and the review views (the Changes tab sorts the same way on its own).
import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";
import type { ChangedSort } from "@/lib/changedSort";

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Minimal file shape the comparator needs. Both `WorkspaceChangedFile`
 * (Changed list) and `WorkspaceFile` (All tree) satisfy it, so the two views
 * order files identically for a given sort.
 */
export interface SortableFile {
  name: string;
  path: string;
  bytes: number | null;
  modified_at: number | null;
}

export function compareChangedFiles(sort: ChangedSort) {
  return (a: SortableFile, b: SortableFile): number => {
    if (sort === "recent") {
      const am = a.modified_at;
      const bm = b.modified_at;
      if (am === null && bm === null) return a.path.localeCompare(b.path);
      if (am === null) return 1;
      if (bm === null) return -1;
      if (am !== bm) return bm - am;
      return a.path.localeCompare(b.path);
    }
    if (sort === "size") {
      const ab = a.bytes;
      const bb = b.bytes;
      if (ab === null && bb === null) return a.path.localeCompare(b.path);
      if (ab === null) return 1;
      if (bb === null) return -1;
      if (ab !== bb) return bb - ab;
      return a.path.localeCompare(b.path);
    }
    if (sort === "type") {
      const ae = fileExtension(a.name);
      const be = fileExtension(b.name);
      if (ae !== be) return ae.localeCompare(be);
      return a.path.localeCompare(b.path);
    }
    return a.path.localeCompare(b.path);
  };
}

export function groupChangedFiles(files: WorkspaceChangedFile[], sort: ChangedSort) {
  const groups = new Map<string, WorkspaceChangedFile[]>();
  for (const file of files) {
    const root = file.repository_root ?? "";
    const group = groups.get(root) ?? [];
    group.push(file);
    groups.set(root, group);
  }
  return [...groups]
    .sort(([left], [right]) => (left === "" ? 1 : right === "" ? -1 : left.localeCompare(right)))
    .map(([root, groupFiles]) => ({ root, files: groupFiles.sort(compareChangedFiles(sort)) }));
}
