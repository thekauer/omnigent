// @vitest-environment node
import { FileIcon } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AVAILABLE,
  HIDDEN,
  mountedSourceKey,
  type PaletteCommand,
  unavailableBecause,
  usePaletteCommandsStore,
} from "@/store/paletteCommands";
import { standaloneWorkbenchScope } from "@/workbench/workbenchScope";

import { featurePaletteSource } from "./featurePaletteRows";

const command = (id: string, overrides: Partial<PaletteCommand> = {}): PaletteCommand => ({
  id,
  label: `Run ${id}`,
  icon: FileIcon,
  keywords: [id],
  run: vi.fn(),
  ...overrides,
});

const MOUNT = standaloneWorkbenchScope.id;

function offer(source: string, heading: string, commands: PaletteCommand[], mount = MOUNT) {
  usePaletteCommandsStore
    .getState()
    .register(mountedSourceKey(mount, source), { heading, commands });
}

afterEach(() => usePaletteCommandsStore.setState({ groups: {} }));

describe("featurePaletteSource", () => {
  it("lists each feature's runnable and explained commands under its heading", () => {
    offer("files", "Files", [
      command("open", { availability: AVAILABLE, nativeShortcut: { key: "o", mod: true } }),
      command("save", { availability: unavailableBecause("Nothing to save") }),
      command("hidden", { availability: HIDDEN }),
    ]);
    offer("review", "Review", [command("next")]);

    const rows = featurePaletteSource.rows(MOUNT);
    expect(rows.map((row) => [row.heading, row.label, row.disabledReason])).toEqual([
      ["Files", "Run open", undefined],
      ["Files", "Run save", "Nothing to save"],
      ["Review", "Run next", undefined],
    ]);
    expect(rows[0]!.shortcut?.at(-1)).toBe("O");
    // The same rows until a feature changes what it offers.
    expect(featurePaletteSource.rows(MOUNT)).toBe(rows);
    offer("review", "Review", [command("previous")]);
    expect(featurePaletteSource.rows(MOUNT)).not.toBe(rows);
  });

  it("leaves out settings and commands that ask which first, which need a page", () => {
    offer("view", "View", [
      command("plain"),
      command("choose", { options: () => [] }),
      command("wrap", {
        setting: {
          label: "Wrap lines",
          choices: [],
          current: () => undefined,
          choose: () => undefined,
        } as unknown as PaletteCommand["setting"],
      }),
    ]);
    expect(featurePaletteSource.rows(MOUNT).map((row) => row.label)).toEqual(["Run plain"]);
  });

  it("runs only the command offered now, and nothing once it's withdrawn or unavailable", () => {
    const first = command("go");
    offer("history", "Workspace", [first]);
    const [row] = featurePaletteSource.rows(MOUNT);

    const replaced = command("go");
    offer("history", "Workspace", [replaced]);
    expect(featurePaletteSource.command(row!.id, MOUNT)).toBe(replaced);

    offer("history", "Workspace", [command("go", { availability: unavailableBecause("Wait") })]);
    expect(featurePaletteSource.command(row!.id, MOUNT)).toBeNull();

    usePaletteCommandsStore.getState().unregister("history");
    expect(featurePaletteSource.command(row!.id, MOUNT)).toBeNull();
  });
});

describe("featurePaletteSource across mounts", () => {
  it("offers and runs only the rows of the mount asked", () => {
    offer("files", "Files", [command("open", { availability: AVAILABLE })]);
    offer("files", "Files", [command("close", { availability: AVAILABLE })], "workbench-2");

    const [ownRow] = featurePaletteSource.rows(MOUNT);
    const [otherRow] = featurePaletteSource.rows("workbench-2");
    expect(featurePaletteSource.rows(MOUNT).map((row) => row.label)).toEqual(["Run open"]);
    expect(featurePaletteSource.rows("workbench-2").map((row) => row.label)).toEqual(["Run close"]);
    // A row of one mount runs nothing from another's palette.
    expect(featurePaletteSource.command(otherRow!.id, MOUNT)).toBeNull();
    expect(featurePaletteSource.command(ownRow!.id, "workbench-2")).toBeNull();
    expect(featurePaletteSource.command(ownRow!.id, MOUNT)).not.toBeNull();
  });
});
