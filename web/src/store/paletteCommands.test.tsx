import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { SearchIcon } from "lucide-react";
import {
  groupsOfMount,
  mountedSourceKey,
  usePaletteCommands,
  usePaletteCommandsStore,
  type PaletteCommand,
} from "./paletteCommands";
import {
  createWorkbenchScope,
  standaloneWorkbenchScope,
  WorkbenchScopeProvider,
  type WorkbenchScope,
} from "@/workbench/workbenchScope";

const MOUNT = standaloneWorkbenchScope.id;

const command = (id: string): PaletteCommand => ({
  id,
  label: `Command ${id}`,
  icon: SearchIcon,
  keywords: [],
  run: vi.fn(),
});

afterEach(() => usePaletteCommandsStore.setState({ groups: {} }));

describe("usePaletteCommands", () => {
  it("offers a group while mounted and withdraws it on unmount", () => {
    const commands = [command("a")];
    const { unmount } = renderHook(() => usePaletteCommands("list", "Pull requests", commands));
    expect(usePaletteCommandsStore.getState().groups).toEqual({
      [mountedSourceKey(MOUNT, "list")]: { heading: "Pull requests", commands },
    });
    unmount();
    expect(usePaletteCommandsStore.getState().groups).toEqual({});
  });

  it("replaces the group when commands change and withdraws it when they run out", () => {
    const first = [command("a")];
    const second = [command("b")];
    const { rerender } = renderHook(
      ({ commands }) => usePaletteCommands("list", "Pull requests", commands),
      { initialProps: { commands: first } },
    );
    rerender({ commands: second });
    expect(
      usePaletteCommandsStore.getState().groups[mountedSourceKey(MOUNT, "list")]?.commands,
    ).toBe(second);
    rerender({ commands: [] });
    expect(usePaletteCommandsStore.getState().groups).toEqual({});
  });

  it("keeps other sources' groups", () => {
    const { unmount } = renderHook(() => usePaletteCommands("one", "One", [command("a")]));
    renderHook(() => usePaletteCommands("two", "Two", [command("b")]));
    unmount();
    expect(Object.keys(usePaletteCommandsStore.getState().groups)).toEqual([
      mountedSourceKey(MOUNT, "two"),
    ]);
  });

  it("offers a source under each mount, so the same source on two apps stays apart", () => {
    const first = createWorkbenchScope("/one");
    const second = createWorkbenchScope("/two");
    const wrapper = (scope: WorkbenchScope) =>
      function Wrapper({ children }: { children: ReactNode }) {
        return <WorkbenchScopeProvider scope={scope}>{children}</WorkbenchScopeProvider>;
      };
    const firstCommands = [command("a")];
    const secondCommands = [command("b")];
    renderHook(() => usePaletteCommands("list", "Pull requests", firstCommands), {
      wrapper: wrapper(first),
    });
    renderHook(() => usePaletteCommands("list", "Pull requests", secondCommands), {
      wrapper: wrapper(second),
    });

    const groups = usePaletteCommandsStore.getState().groups;
    expect(groupsOfMount(groups, first.id)).toEqual({
      [mountedSourceKey(first.id, "list")]: { heading: "Pull requests", commands: firstCommands },
    });
    expect(groupsOfMount(groups, second.id)[mountedSourceKey(second.id, "list")]?.commands).toBe(
      secondCommands,
    );
    expect(groupsOfMount(groups, MOUNT)).toEqual({});
  });
});
