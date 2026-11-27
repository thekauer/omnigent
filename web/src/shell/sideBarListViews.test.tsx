import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { layoutService, Parts } from "@/workbench/layoutService";
import { builtInViewComponent } from "./builtInViews";
import "./sideBarListViews";
import type * as ScheduledTasksApi from "@/lib/scheduledTasksApi";

const listScheduledTasks = vi.hoisted(() => vi.fn());
vi.mock("@/lib/scheduledTasksApi", async (original) => ({
  ...(await original<typeof ScheduledTasksApi>()),
  listScheduledTasks,
}));

let visible = false;
let removePart: () => void = () => {};
beforeEach(() => {
  visible = false;
  listScheduledTasks.mockReset();
  listScheduledTasks.mockResolvedValue([{ id: "task-1", name: "Nightly report" }]);
  removePart = layoutService.registerPart(Parts.SIDEBAR_PART, {
    isVisible: () => visible,
    setHidden: (hidden) => {
      visible = !hidden;
      layoutService.partChanged(Parts.SIDEBAR_PART);
    },
  });
});
afterEach(() => {
  cleanup();
  removePart();
});

describe("the Automations container's compact list", () => {
  it("fetches only while the side bar shows, without the page's poll", async () => {
    const AutomationsList = builtInViewComponent("automationsList")!;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AutomationsList
            view={{
              id: "omnigent.automations.list",
              extensionId: "omnigent.automations",
              name: "Automations",
              icon: undefined,
            }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(listScheduledTasks).not.toHaveBeenCalled();
    act(() => layoutService.setPartHidden(false, Parts.SIDEBAR_PART));
    expect(await screen.findByRole("link", { name: "Nightly report" })).toHaveAttribute(
      "href",
      "/tasks/task-1",
    );
    expect(listScheduledTasks).toHaveBeenCalledTimes(1);
    const query = client.getQueryCache().getAll()[0];
    expect(query?.options).not.toHaveProperty("refetchInterval");
  });
});
