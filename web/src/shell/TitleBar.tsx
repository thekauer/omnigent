// The title bar part (layout plan L7): `[data-part="titlebar"]` above the workbench, with its
// `left`, `center` and `right` regions. Each draws the built-in items its manifest names (the
// brand, the command center, the layout controls, the account), then other extensions'
// `titleBar/*` command buttons, then `window.createTitleBarItem` text items.

import { PanelLeftIcon, PanelRightIcon, SearchIcon } from "lucide-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { COMMAND_PALETTE_KEYS, shortcutText } from "@/components/KeyboardShortcut";
import omnigentWordmark from "@/assets/omnigent-wordmark.svg";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { configurationService } from "@/configuration/configurationService";
import { useBranding, useLogoUrl } from "@/lib/branding";
import { Link } from "@/lib/routing";
import { cn } from "@/lib/utils";
import type { TitleBarItemKind } from "@/vscodeExtensions/contributions";
import { currentExtensionHost } from "@/vscodeExtensions/extensionHost";
import { type LayoutService, Parts, partHook } from "@/workbench/layoutService";
import { useWorkbenchScope } from "@/workbench/workbenchScope";
import {
  builtInTitleBarEntries,
  TITLE_BAR_REGIONS,
  type TitleBarItemSnapshot,
  type TitleBarMenuEntry,
  useContributedTitleBarEntries,
  useTitleBarItems,
  useTitleBarSetting,
} from "@/workbench/titleBar";
import { useProductHidesPart } from "@/workbench/productLayout";
import { whenHolds, workbenchContext } from "@/workbench/workbenchContext";
import { DEFAULT_RAIL_VIEW_ICON, railViewIcon } from "./railViewIcons";
import { SidebarServerPicker } from "./SidebarServerPicker";
import { usePartVisible } from "./useWorkbenchParts";

const ITEM_BUTTON =
  "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-(--radius-otto-button) px-2 text-ui text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

function runCommand(command: string, args: readonly unknown[] = []): void {
  void currentExtensionHost()
    ?.commands.execute(command, [...args], () => {})
    .catch((error: unknown) => console.error(`[titlebar] ${command} failed`, error));
}

/** A built-in item's `when` reads settings (`config.<key>`) and the shell's keys. */
function builtInHolds(entry: TitleBarMenuEntry): boolean {
  return whenHolds(entry.when, workbenchContext.snapshot(), (key) =>
    key.startsWith("config.")
      ? configurationService.getValue(key.slice("config.".length))
      : undefined,
  );
}

/** The configuration's version, so the built-in items' `when` follow any setting they read. */
function useConfigurationVersion(): number {
  return useSyncExternalStore(
    (listener) => configurationService.onDidChangeConfiguration(listener),
    () => configurationService.getVersion(),
    () => 0,
  );
}

export function TitleBar({ onOpenCommandCenter }: { onOpenCommandCenter: () => void }) {
  useConfigurationVersion();
  const contributed = useContributedTitleBarEntries();
  const items = useTitleBarItems();
  const builtIns = builtInTitleBarEntries().filter(builtInHolds);
  return (
    <TooltipProvider>
      <div
        data-part={partHook(Parts.TITLEBAR_PART)}
        role="region"
        aria-label="Title bar"
        className="titlebar absolute inset-x-0 top-0 z-30 grid h-(--ui-titlebar-height,48px) grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border bg-sidebar px-3"
      >
        {TITLE_BAR_REGIONS.map((region) => (
          <div
            key={region}
            data-slot={`titlebar-${region}`}
            role="group"
            aria-label={REGION_LABELS[region]}
            className={cn(
              // Each region clips what overflows it; the center, as wide as its items, clips
              // past a margin that keeps their edges' antialiasing.
              "flex min-w-0 items-center gap-1",
              region === "center"
                ? "justify-center overflow-clip [overflow-clip-margin:4px]"
                : "overflow-x-clip",
              region === "right" && "justify-end",
            )}
          >
            {builtIns
              .filter((entry) => entry.region === region)
              .map((entry) => (
                <BuiltInItem
                  key={entry.builtInItem}
                  kind={entry.builtInItem!}
                  onOpenCommandCenter={onOpenCommandCenter}
                />
              ))}
            {contributed
              .filter((entry) => entry.region === region && entry.active)
              .map((entry) => (
                <CommandButton key={`${entry.extensionId} ${entry.command}`} entry={entry} />
              ))}
            {(items.get(region) ?? []).map((item) => (
              <TextItem key={item.key} item={item} />
            ))}
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}

const REGION_LABELS = {
  left: "Title bar start",
  center: "Title bar center",
  right: "Title bar end",
} as const;

function WithTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function BuiltInItem({
  kind,
  onOpenCommandCenter,
}: {
  kind: TitleBarItemKind | undefined;
  onOpenCommandCenter: () => void;
}) {
  switch (kind) {
    case "brand":
      return <Brand />;
    case "commandCenter":
      return (
        <button
          type="button"
          data-titlebar-item="commandCenter"
          onClick={onOpenCommandCenter}
          className={cn(
            ITEM_BUTTON,
            "w-[min(28rem,40vw)] justify-start border border-border bg-background/60",
          )}
        >
          <SearchIcon className="ui-icon size-4" aria-hidden />
          <span className="truncate">Search or run a command</span>
          <kbd className="ml-auto font-mono text-xs text-muted-foreground">
            {shortcutText(COMMAND_PALETTE_KEYS)}
          </kbd>
        </button>
      );
    case "layoutControls":
      return <LayoutControls />;
    case "account":
      return <SidebarServerPicker placement="titlebar" />;
    default:
      return null;
  }
}

function Brand() {
  const branding = useBranding();
  const logoUrl = useLogoUrl("main");
  return (
    <Link
      to="/"
      data-titlebar-item="brand"
      aria-label={branding.app_name ?? "Omnigent"}
      className="flex min-w-0 shrink-0 items-center gap-2 rounded-none px-1 transition-opacity hover:opacity-70"
    >
      {logoUrl && <img src={logoUrl} alt="" className="size-5 object-contain" />}
      {branding.app_name ? (
        <span className="truncate font-(family-name:--ui-app-name-font) text-(length:--ui-app-name-size) font-(weight:--ui-app-name-weight) tracking-(--ui-app-name-tracking)">
          {branding.app_name}
        </span>
      ) : logoUrl ? null : (
        <img src={omnigentWordmark} alt="Omnigent" className="h-[15px] w-auto dark:invert" />
      )}
    </Link>
  );
}

/** Which side bars the shell draws, kept current (a part registering changes the layout). */
function useDrawnParts(layoutService: LayoutService): string {
  return useSyncExternalStore(
    (listener) => layoutService.onDidChangeLayout(listener),
    () =>
      [Parts.SIDEBAR_PART, Parts.AUXILIARYBAR_PART]
        .filter((part) => layoutService.hasPart(part))
        .join(" "),
    () => "",
  );
}

function LayoutControls() {
  // This mount's own layout.
  const layoutService = useWorkbenchScope().layout;
  const drawn = useDrawnParts(layoutService);
  const sideBar = usePartVisible(Parts.SIDEBAR_PART);
  const auxiliaryBar = usePartVisible(Parts.AUXILIARYBAR_PART);
  const controls = [
    {
      part: Parts.SIDEBAR_PART,
      label: "Toggle Primary Side Bar",
      icon: PanelLeftIcon,
      on: sideBar,
    },
    {
      part: Parts.AUXILIARYBAR_PART,
      label: "Toggle Secondary Side Bar",
      icon: PanelRightIcon,
      on: auxiliaryBar,
    },
  ] as const;
  return (
    <div data-titlebar-item="layoutControls" className="flex items-center gap-0.5">
      {controls
        .filter((control) => drawn.split(" ").includes(control.part))
        .map(({ part, label, icon: Icon, on }) => (
          <WithTooltip key={part} label={label}>
            <button
              type="button"
              aria-label={label}
              aria-pressed={on}
              onClick={() => layoutService.togglePart(part)}
              className={cn(ITEM_BUTTON, "w-8 px-0")}
            >
              <Icon className="ui-icon size-4" aria-hidden />
            </button>
          </WithTooltip>
        ))}
    </div>
  );
}

function CommandButton({ entry }: { entry: TitleBarMenuEntry }) {
  const Icon = entry.icon ? (railViewIcon(entry.icon) ?? DEFAULT_RAIL_VIEW_ICON) : undefined;
  const label = entry.tooltip ?? entry.title;
  return (
    <WithTooltip label={label}>
      <button
        type="button"
        aria-label={label}
        data-titlebar-command={entry.command}
        onClick={() => runCommand(entry.command)}
        className={cn(ITEM_BUTTON, Icon && "w-8 px-0")}
      >
        {Icon ? (
          <Icon className="ui-icon size-4" aria-hidden />
        ) : (
          <span className="max-w-48 truncate">{entry.title}</span>
        )}
      </button>
    </WithTooltip>
  );
}

function TextItem({ item }: { item: TitleBarItemSnapshot }) {
  const style = item.color ? { color: item.color } : undefined;
  const body = item.command ? (
    <button
      type="button"
      data-titlebar-text-item={item.key}
      style={style}
      onClick={() => runCommand(item.command!.command, item.command!.arguments)}
      className={ITEM_BUTTON}
    >
      <span className="max-w-48 truncate">{item.text}</span>
    </button>
  ) : (
    <span
      data-titlebar-text-item={item.key}
      style={style}
      className="max-w-48 truncate px-2 text-ui text-muted-foreground"
    >
      {item.text}
    </span>
  );
  return item.tooltip ? <WithTooltip label={item.tooltip}>{body}</WithTooltip> : body;
}

/**
 * The title bar's actionable items a phone folds into the chat header's menu (the bar is never
 * drawn there): other extensions' `titleBar/*` commands, then text items with a command, region
 * by region. None unless the bar is on (`window.titleBar.visible`, not removed by the product).
 * The built-in items have phone forms of their own (the drawer's search, account and toggle).
 */
export function useFoldedTitleBarItems(): readonly FoldedTitleBarItem[] {
  const on = useTitleBarSetting();
  const removed = useProductHidesPart(Parts.TITLEBAR_PART);
  const contributed = useContributedTitleBarEntries();
  const items = useTitleBarItems();
  if (!on || removed) return [];
  const folded: FoldedTitleBarItem[] = [];
  for (const region of TITLE_BAR_REGIONS) {
    for (const entry of contributed) {
      if (entry.region !== region || !entry.active) continue;
      folded.push({
        key: `command ${entry.extensionId} ${entry.command}`,
        label: entry.title,
        icon: entry.icon,
        run: () => runCommand(entry.command),
      });
    }
    for (const item of items.get(region) ?? []) {
      const command = item.command;
      if (!command) continue;
      folded.push({
        key: `text ${item.key}`,
        label: item.text,
        run: () => runCommand(command.command, command.arguments),
      });
    }
  }
  return folded;
}

export interface FoldedTitleBarItem {
  readonly key: string;
  readonly label: string;
  readonly icon?: string;
  readonly run: () => void;
}

/** The folded title bar items as menu rows, after a separator when `separated`. */
export function FoldedTitleBarMenuItems({
  items,
  separated,
}: {
  items: readonly FoldedTitleBarItem[];
  separated: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <>
      {separated && <DropdownMenuSeparator />}
      {items.map((item) => {
        const Icon = item.icon ? (railViewIcon(item.icon) ?? DEFAULT_RAIL_VIEW_ICON) : undefined;
        return (
          <DropdownMenuItem
            key={item.key}
            data-titlebar-folded-item={item.key}
            onSelect={item.run}
            className="mobile-touch-target gap-2.5 px-2.5 py-2 text-ui"
          >
            {Icon && <Icon className="size-4" aria-hidden />}
            {item.label}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
