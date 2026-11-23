import { useSyncExternalStore } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sessionHeaderItems, type SessionHeaderItemRegistry } from "./sessionHeaderItems";

const ITEM_CLASS =
  "hidden h-6 shrink-0 items-center whitespace-nowrap px-1 text-sm tabular-nums text-muted-foreground md:inline-flex";

/**
 * Extension-contributed header items, in display order. Desktop only, like the
 * agent info button it sits beside. Renders nothing (no wrapper) when empty.
 */
export function SessionHeaderItems({
  registry = sessionHeaderItems,
}: {
  registry?: SessionHeaderItemRegistry;
}) {
  const items = useSyncExternalStore(registry.subscribe, registry.getSnapshot);
  return items.map((item) => {
    const label = (
      <span
        key={item.key}
        data-testid={`session-header-item-${item.key}`}
        data-extension-id={item.extensionId}
        className={ITEM_CLASS}
        // Focusable only when there is a tooltip to reveal from the keyboard.
        tabIndex={item.tooltip ? 0 : undefined}
      >
        {item.text}
      </span>
    );
    if (!item.tooltip) return label;
    return (
      <Tooltip key={item.key}>
        <TooltipTrigger asChild>{label}</TooltipTrigger>
        <TooltipContent>{item.tooltip}</TooltipContent>
      </Tooltip>
    );
  });
}
