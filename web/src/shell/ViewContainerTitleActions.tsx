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
  const actions = (titleActions.get(containerId) ?? []).filter(
    (action) => action.group === "navigation",
  );
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
