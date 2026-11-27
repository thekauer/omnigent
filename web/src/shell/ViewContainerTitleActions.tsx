// A view container's title actions (`contributes.menus["viewContainer/title"]`, layout plan L3):
// the buttons extensions put in the side bar's header row or the rail's tab strip. Nothing is
// drawn while a container has none.

import { cn } from "@/lib/utils";
import { useViewContainers } from "@/workbench/viewContainers";
import { ActionList } from "./extensionViews/ExtensionRailView";

export function ViewContainerTitleActions({
  containerId,
  className,
}: {
  containerId: string;
  className?: string;
}) {
  const { titleActions } = useViewContainers();
  // The header row has room for icon buttons only: an action without an icon draws the
  // generic one, its title its tooltip and name, never text over the host's buttons.
  const actions = (titleActions.get(containerId) ?? [])
    .filter((action) => action.group === "navigation")
    .map((action) => (action.icon === undefined ? { ...action, icon: "puzzle" } : action));
  if (actions.length === 0) return null;
  return (
    <div
      data-slot="view-container-actions"
      data-view-container={containerId}
      className={cn("flex shrink-0 items-center gap-[2px]", className)}
    >
      <ActionList actions={actions} />
    </div>
  );
}
