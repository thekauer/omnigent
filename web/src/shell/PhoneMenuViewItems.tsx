// The secondary side bar's other views in a phone's chat header menu (layout plan L9): every view
// with a tab in the right panel that isn't a built-in tab (the menu lists those itself), each
// opening its drawer. The rail's own rule decides which: active, shown, in the container.

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useDefaultHiddenViews } from "@/workbench/defaultHiddenViews";
import { isViewHidden, useViewsLayout } from "@/workbench/viewsLayout";
import { useWorkbenchScope } from "@/workbench/workbenchScope";
import { DEFAULT_RAIL_VIEW_ICON, railViewIcon } from "./railViewIcons";
import { hasRailTab, type RailView, useRailViews } from "./railViews";
import { TAB_BADGE_BASE } from "./railTabs";

/** The views a phone's menu lists after the built-in tabs. */
export function usePhoneMenuViews(): readonly RailView[] {
  const { views } = useRailViews();
  const layout = useViewsLayout();
  const { productLayout: policy } = useWorkbenchScope();
  const defaults = useDefaultHiddenViews();
  return views.filter((view) =>
    hasRailTab(view, (candidate) => isViewHidden(candidate, layout, policy, defaults)),
  );
}

export function PhoneMenuViewItems({
  views,
  onOpenView,
}: {
  views: readonly RailView[];
  onOpenView: (viewId: string) => void;
}) {
  return (
    <>
      {views.map((view) => {
        const Icon = railViewIcon(view.icon) ?? DEFAULT_RAIL_VIEW_ICON;
        return (
          <DropdownMenuItem
            key={view.id}
            data-phone-menu-view={view.id}
            onSelect={() => onOpenView(view.id)}
            className="mobile-touch-target gap-2.5 px-2.5 py-2 text-ui"
          >
            <Icon className="size-4" aria-hidden />
            {view.title ?? view.name}
            {view.badge && view.badge.value > 0 && (
              <span className={cn(TAB_BADGE_BASE, "ml-auto bg-muted text-muted-foreground")}>
                {view.badge.value}
              </span>
            )}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
