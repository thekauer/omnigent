// An embed's sidebar keeps its own collapse and expand preferences in its own layout state, and
// the standalone app's state (the window's proxy) never changes for it.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Conversation } from "@/hooks/useConversations";
import { sidebarConfig } from "@/lib/sidebarConfig";
import { conversationPage } from "@/test/sidebarMockHelpers";
import { LAYOUT_SLOTS, standaloneLayoutState } from "@/workbench/layoutState";
import { createWorkbenchScope, WorkbenchScopeProvider } from "@/workbench/workbenchScope";

vi.mock("@/hooks/useScopeCache", () => import("@/test/mockScopeCache"));
vi.mock("@/components/PermissionsModal", () => ({ PermissionsModal: () => null }));
vi.mock("@/hooks/useConversations", async () => {
  const { conversationHooksMock } = await import("@/test/sidebarMockHelpers");
  return {
    ...conversationHooksMock(),
    usePinnedConversations: () => ({
      data: { conversations: [], filterHonored: true },
      isSuccess: true,
    }),
    useProjects: () => ({ data: [{ id: "p_repro", name: "Repro 2506" }] }),
    useProjectSessions: vi.fn(),
  };
});

import { SidebarDataProvider } from "@/hooks/useSidebarData";
import { useConversations, useProjectSessions } from "@/hooks/useConversations";
import { Sidebar } from "./Sidebar";

function conv(id: string, project?: string): Conversation {
  return {
    id,
    object: "conversation",
    title: id,
    created_at: 0,
    updated_at: 0,
    labels: project ? { omni_project: project } : {},
    permission_level: null,
    agent_name: null,
  } as unknown as Conversation;
}

const header = () => screen.getByRole("button", { name: "Repro 2506" });

beforeEach(() => {
  localStorage.clear();
  vi.mocked(useConversations).mockReturnValue(
    conversationPage([conv("sibling_b", "Repro 2506")], { first_id: null, last_id: null }),
  );
  vi.mocked(useProjectSessions).mockReturnValue({
    data: {
      pages: [
        { data: [conv("sibling_c", "Repro 2506")], first_id: null, last_id: null, has_more: false },
      ],
      pageParams: [undefined],
    },
    isLoading: false,
    isError: false,
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  } as unknown as ReturnType<typeof useProjectSessions>);
});

afterEach(cleanup);

describe("an inactive embed's sidebar", () => {
  it("reads its own expanded projects and writes its own changes, never the window's", () => {
    // The standalone app is the window's active mount; the embed is not.
    const embed = createWorkbenchScope("/sidebar-embed");
    embed.state.set(LAYOUT_SLOTS.expandedProjects, ["Repro 2506"]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <WorkbenchScopeProvider scope={embed}>
          <SidebarDataProvider config={sidebarConfig}>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/c/sibling_b"]}>
                <Routes>
                  <Route path="/" element={<Sidebar open onClose={vi.fn()} />} />
                  <Route path="/c/:conversationId" element={<Sidebar open onClose={vi.fn()} />} />
                </Routes>
              </MemoryRouter>
            </TooltipProvider>
          </SidebarDataProvider>
        </WorkbenchScopeProvider>
      </QueryClientProvider>,
    );

    // The embed's own folder state opens the folder; the window's (empty) does not.
    expect(header()).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(header());
    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(embed.state.get(LAYOUT_SLOTS.expandedProjects)).toEqual([]);
    expect(standaloneLayoutState.get(LAYOUT_SLOTS.expandedProjects)).toBeUndefined();
  });

  it("hides a navigation entry from its own menu into its own layout state", () => {
    const embed = createWorkbenchScope("/sidebar-embed-nav");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <WorkbenchScopeProvider scope={embed}>
          <SidebarDataProvider config={sidebarConfig}>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/c/sibling_b"]}>
                <Routes>
                  <Route path="/c/:conversationId" element={<Sidebar open onClose={vi.fn()} />} />
                </Routes>
              </MemoryRouter>
            </TooltipProvider>
          </SidebarDataProvider>
        </WorkbenchScopeProvider>
      </QueryClientProvider>,
    );
    fireEvent.contextMenu(screen.getByTestId("sidebar-primary-nav"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /New session/ }));
    expect(embed.state.get(LAYOUT_SLOTS.hiddenNavigationEntries)).toEqual(["omnigent.newSession"]);
    expect(standaloneLayoutState.get(LAYOUT_SLOTS.hiddenNavigationEntries)).toBeUndefined();
  });
});
