import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  createWorkbenchScope,
  releaseWorkbenchScope,
  type WorkbenchScope,
  WorkbenchScopeProvider,
} from "@/workbench/workbenchScope";

import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

const mounted: WorkbenchScope[] = [];

afterEach(() => {
  cleanup();
  for (const scope of mounted.splice(0)) releaseWorkbenchScope(scope);
  document.body.innerHTML = "";
});

/** An embed on the page: its own scope, whose overlays portal into its own element. */
function embed(name: string): { root: HTMLElement; wrapper: (props: { children: ReactNode }) => ReactNode } {
  const root = document.createElement("div");
  root.className = "omnigent-app";
  document.body.appendChild(root);
  const scope = createWorkbenchScope(`/${name}`);
  scope.overlayRoot.set(root);
  mounted.push(scope);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WorkbenchScopeProvider scope={scope}>
      <TooltipProvider>{children}</TooltipProvider>
    </WorkbenchScopeProvider>
  );
  return { root, wrapper };
}

describe("overlays of two embeds on one page", () => {
  it("portal a popover and a tooltip of each embed into that embed's own root", () => {
    const first = embed("overlay-first");
    const second = embed("overlay-second");
    const FirstWrapper = first.wrapper;
    const SecondWrapper = second.wrapper;
    render(
      <FirstWrapper>
        <Popover open>
          <PopoverTrigger>first trigger</PopoverTrigger>
          <PopoverContent>first popover</PopoverContent>
        </Popover>
        <Tooltip open>
          <TooltipTrigger>first tip trigger</TooltipTrigger>
          <TooltipContent>first tooltip</TooltipContent>
        </Tooltip>
      </FirstWrapper>,
    );
    render(
      <SecondWrapper>
        <Popover open>
          <PopoverTrigger>second trigger</PopoverTrigger>
          <PopoverContent>second popover</PopoverContent>
        </Popover>
        <Tooltip open>
          <TooltipTrigger>second tip trigger</TooltipTrigger>
          <TooltipContent>second tooltip</TooltipContent>
        </Tooltip>
      </SecondWrapper>,
    );
    expect(first.root.textContent).toContain("first popover");
    expect(first.root.textContent).toContain("first tooltip");
    expect(first.root.textContent).not.toContain("second");
    expect(second.root.textContent).toContain("second popover");
    expect(second.root.textContent).toContain("second tooltip");
    expect(second.root.textContent).not.toContain("first");
  });
});
