/** Standard mounted Sidebar with a fresh query cache for each test; `setOpen` rerenders it. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarDataProvider } from "@/hooks/useSidebarData";
import { CapabilitiesProvider } from "@/lib/CapabilitiesContext";
import { FALLBACK_SERVER_INFO, type ServerInfo } from "@/lib/capabilities";
import { Sidebar } from "@/shell/Sidebar";
import { type WorkbenchScope, WorkbenchScopeProvider } from "@/workbench/workbenchScope";

/**
 * `info` is the server info served; else `features` serves the fallback info with
 * those flags; with neither, info stays loading.
 */
export function renderSidebar(
  props: {
    open?: boolean;
    onClose?: () => void;
    route?: string;
    dragProgress?: number | null;
    features?: Record<string, boolean>;
    info?: ServerInfo;
    /** The mount the sidebar belongs to (its layout); the window's when omitted. */
    workbenchScope?: WorkbenchScope;
  } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const info =
    props.info ??
    (props.features ? { ...FALLBACK_SERVER_INFO, features: props.features } : "loading");
  const onClose = props.onClose ?? vi.fn();
  const sidebar = (open: boolean) => (
    <MemoryRouter initialEntries={[props.route ?? "/"]}>
      <Sidebar open={open} onClose={onClose} dragProgress={props.dragProgress} />
    </MemoryRouter>
  );
  const tree = (open: boolean) => (
    <QueryClientProvider client={qc}>
      <CapabilitiesProvider info={info}>
        <SidebarDataProvider>
          <TooltipProvider>
            {props.workbenchScope ? (
              <WorkbenchScopeProvider scope={props.workbenchScope}>
                {sidebar(open)}
              </WorkbenchScopeProvider>
            ) : (
              sidebar(open)
            )}
          </TooltipProvider>
        </SidebarDataProvider>
      </CapabilitiesProvider>
    </QueryClientProvider>
  );
  const view = render(tree(props.open ?? true));
  return { ...view, setOpen: (open: boolean) => view.rerender(tree(open)) };
}
