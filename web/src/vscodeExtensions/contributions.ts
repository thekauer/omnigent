// Reads an extension's `contributes` (views, commands, menus) from its manifest
// into checked plain data. Problems are warnings: the rest still loads.
import { isExtensionViewId } from "@/shell/railTabs";
import { isRailViewIconName } from "@/shell/railViewIcons";
import { parseWhen, type WhenClause } from "./when";

/** The view container of the classic workspace rail. */
export const RIGHT_PANEL_CONTAINER = "omnigent.rightPanel";

export interface ViewContribution {
  readonly id: string;
  readonly name: string;
  readonly icon: string | undefined;
  readonly order: number;
  /** Built-in extensions only: the built-in tab id the view stands in for. */
  readonly builtInTab?: string;
  /** A filter field drawn above the rows. */
  readonly filter?: { readonly placeholder: string; readonly ariaLabel: string };
}

export interface CommandContribution {
  readonly command: string;
  readonly title: string;
  readonly icon: string | undefined;
  /** When set, a button for the command is a toggle, pressed while this holds. */
  readonly toggled: WhenClause | undefined;
}

export interface MenuItemContribution {
  /** The command the entry runs; empty for a submenu entry. */
  readonly command: string;
  /** Set for an entry that opens a submenu (`contributes.submenus`). */
  readonly submenu?: string;
  readonly when: WhenClause | undefined;
  readonly group: string | undefined;
  /** Omnigent: the button's tooltip instead of the command title. */
  readonly tooltip?: string;
  /** Omnigent: draws the button in the warning color. */
  readonly tone?: "warning";
}

export interface SubmenuContribution {
  readonly id: string;
  readonly label: string;
  readonly icon: string | undefined;
  readonly tooltip: string | undefined;
  readonly items: readonly MenuItemContribution[];
}

export interface ExtensionContributions {
  readonly views: readonly ViewContribution[];
  readonly commands: readonly CommandContribution[];
  readonly viewTitleMenu: readonly MenuItemContribution[];
  readonly submenus: readonly SubmenuContribution[];
}

export interface ParseContributionsOptions {
  /** Built-in extensions may bind a view to a built-in tab (`builtInTab`). */
  readonly builtIn?: boolean;
  /** The built-in tab ids a view may stand in for. */
  readonly builtInTabs?: readonly string[];
}

const MAX_NAME_LENGTH = 40;
const MAX_TITLE_LENGTH = 80;
const MAX_ENTRIES = 50;
const MAX_TOOLTIP_LENGTH = 200;

export const EMPTY_CONTRIBUTIONS: ExtensionContributions = Object.freeze({
  views: [],
  commands: [],
  viewTitleMenu: [],
  submenus: [],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function whenOf(value: unknown, where: string, warnings: string[]): WhenClause | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    warnings.push(`${where}: "when" must be a string`);
    return parseWhen("false");
  }
  try {
    return parseWhen(value);
  } catch (error) {
    warnings.push(`${where}: invalid when clause ${JSON.stringify(value)} (${String(error)})`);
    // An invalid clause never holds, as in VS Code.
    return parseWhen("false");
  }
}

function iconOf(value: unknown, where: string, warnings: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (isRailViewIconName(value)) return value;
  warnings.push(`${where}: unknown icon ${JSON.stringify(value)}; using the default`);
  return undefined;
}

/** Checks `contributes`; view ids must start with the extension id. */
function textOf(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : undefined;
}

/** One menu entry (`{ command | submenu, when?, group?, tooltip?, tone? }`), or undefined. */
function menuItemOf(
  entry: unknown,
  where: string,
  warnings: string[],
): MenuItemContribution | undefined {
  if (!isRecord(entry)) {
    warnings.push(`${where} must be an object`);
    return undefined;
  }
  const command = typeof entry.command === "string" ? entry.command : "";
  const submenu = typeof entry.submenu === "string" && entry.submenu !== "" ? entry.submenu : "";
  if (command === "" && submenu === "") {
    warnings.push(`${where}: "command" must be a non-empty string`);
    return undefined;
  }
  if (entry.group !== undefined && typeof entry.group !== "string") {
    warnings.push(`${where}: "group" must be a string`);
    return undefined;
  }
  if (entry.tone !== undefined && entry.tone !== "warning") {
    warnings.push(`${where}: "tone" must be "warning"; ignoring it`);
  }
  return {
    command: submenu === "" ? command : "",
    ...(submenu === "" ? {} : { submenu }),
    when: whenOf(entry.when, where, warnings),
    group: entry.group as string | undefined,
    ...(textOf(entry.tooltip, MAX_TOOLTIP_LENGTH) === undefined
      ? {}
      : { tooltip: textOf(entry.tooltip, MAX_TOOLTIP_LENGTH) }),
    ...(entry.tone === "warning" ? { tone: "warning" as const } : {}),
  };
}

export function parseContributions(
  extensionId: string,
  raw: unknown,
  options: ParseContributionsOptions = {},
): { contributions: ExtensionContributions; warnings: string[] } {
  const warnings: string[] = [];
  if (raw === undefined) return { contributions: EMPTY_CONTRIBUTIONS, warnings };
  if (!isRecord(raw)) {
    warnings.push('"contributes" must be an object');
    return { contributions: EMPTY_CONTRIBUTIONS, warnings };
  }
  const views: ViewContribution[] = [];
  if (raw.views !== undefined) {
    if (!isRecord(raw.views)) {
      warnings.push('"contributes.views" must be an object of view containers');
    } else {
      for (const [container, entries] of Object.entries(raw.views)) {
        if (container !== RIGHT_PANEL_CONTAINER) {
          warnings.push(`contributes.views: unknown view container "${container}"; ignoring it`);
          continue;
        }
        if (!Array.isArray(entries)) {
          warnings.push(`contributes.views["${container}"] must be an array`);
          continue;
        }
        entries.slice(0, MAX_ENTRIES).forEach((entry: unknown, index) => {
          const where = `contributes.views["${container}"][${index}]`;
          if (!isRecord(entry)) {
            warnings.push(`${where} must be an object`);
            return;
          }
          const { id, name } = entry;
          if (!isExtensionViewId(id) || !id.startsWith(`${extensionId}.`)) {
            warnings.push(`${where}: "id" must be "${extensionId}.<name>"`);
            return;
          }
          if (views.some((view) => view.id === id)) {
            warnings.push(`${where}: duplicate view id ${id}`);
            return;
          }
          if (typeof name !== "string" || name.trim() === "") {
            warnings.push(`${where}: "name" must be a non-empty string`);
            return;
          }
          let builtInTab: string | undefined;
          if (entry.builtInTab !== undefined) {
            if (!options.builtIn) {
              warnings.push(`${where}: "builtInTab" is for built-in extensions; ignoring it`);
            } else if (
              typeof entry.builtInTab !== "string" ||
              !(options.builtInTabs ?? []).includes(entry.builtInTab)
            ) {
              warnings.push(`${where}: unknown built-in tab ${JSON.stringify(entry.builtInTab)}`);
            } else if (views.some((view) => view.builtInTab === entry.builtInTab)) {
              warnings.push(`${where}: built-in tab ${entry.builtInTab} is already taken`);
            } else {
              builtInTab = entry.builtInTab;
            }
          }
          let filter: ViewContribution["filter"];
          if (entry.filter !== undefined) {
            const placeholder = isRecord(entry.filter)
              ? textOf(entry.filter.placeholder, MAX_TITLE_LENGTH)
              : undefined;
            if (placeholder === undefined) {
              warnings.push(`${where}: "filter.placeholder" must be a non-empty string`);
            } else {
              const record = entry.filter as Record<string, unknown>;
              filter = {
                placeholder,
                ariaLabel: textOf(record.ariaLabel, MAX_TITLE_LENGTH) ?? placeholder,
              };
            }
          }
          views.push({
            id,
            name: name.trim().slice(0, MAX_NAME_LENGTH),
            icon: iconOf(entry.icon, where, warnings),
            order: views.length,
            ...(builtInTab === undefined ? {} : { builtInTab }),
            ...(filter === undefined ? {} : { filter }),
          });
        });
      }
    }
  }

  const commands: CommandContribution[] = [];
  if (raw.commands !== undefined) {
    if (!Array.isArray(raw.commands)) {
      warnings.push('"contributes.commands" must be an array');
    } else {
      raw.commands.slice(0, MAX_ENTRIES).forEach((entry: unknown, index) => {
        const where = `contributes.commands[${index}]`;
        if (!isRecord(entry) || typeof entry.command !== "string" || entry.command === "") {
          warnings.push(`${where}: "command" must be a non-empty string`);
          return;
        }
        if (typeof entry.title !== "string" || entry.title.trim() === "") {
          warnings.push(`${where}: "title" must be a non-empty string`);
          return;
        }
        commands.push({
          command: entry.command,
          title: entry.title.trim().slice(0, MAX_TITLE_LENGTH),
          icon: iconOf(entry.icon, where, warnings),
          toggled: whenOf(entry.toggled, where, warnings),
        });
      });
    }
  }

  const submenus: SubmenuContribution[] = [];
  if (raw.submenus !== undefined) {
    if (!Array.isArray(raw.submenus)) {
      warnings.push('"contributes.submenus" must be an array');
    } else {
      raw.submenus.slice(0, MAX_ENTRIES).forEach((entry: unknown, index) => {
        const where = `contributes.submenus[${index}]`;
        if (!isRecord(entry) || typeof entry.id !== "string" || entry.id === "") {
          warnings.push(`${where}: "id" must be a non-empty string`);
          return;
        }
        const label = textOf(entry.label, MAX_TITLE_LENGTH);
        if (label === undefined) {
          warnings.push(`${where}: "label" must be a non-empty string`);
          return;
        }
        submenus.push({
          id: entry.id,
          label,
          icon: iconOf(entry.icon, where, warnings),
          tooltip: textOf(entry.tooltip, MAX_TOOLTIP_LENGTH),
          items: [],
        });
      });
    }
  }

  const viewTitleMenu: MenuItemContribution[] = [];
  if (raw.menus !== undefined) {
    if (!isRecord(raw.menus)) {
      warnings.push('"contributes.menus" must be an object');
    } else {
      for (const [menu, entries] of Object.entries(raw.menus)) {
        const submenuIndex = submenus.findIndex((submenu) => submenu.id === menu);
        if (menu !== "view/title" && submenuIndex === -1) {
          warnings.push(`contributes.menus: menu "${menu}" is not supported yet; ignoring it`);
          continue;
        }
        if (!Array.isArray(entries)) {
          warnings.push(`contributes.menus["${menu}"] must be an array`);
          continue;
        }
        const items: MenuItemContribution[] = [];
        entries.slice(0, MAX_ENTRIES).forEach((entry: unknown, index) => {
          const item = menuItemOf(entry, `contributes.menus["${menu}"][${index}]`, warnings);
          if (!item) return;
          if (item.submenu !== undefined && menu !== "view/title") {
            warnings.push(
              `contributes.menus["${menu}"][${index}]: nested submenus are not supported`,
            );
            return;
          }
          if (item.submenu !== undefined && !submenus.some((sub) => sub.id === item.submenu)) {
            warnings.push(
              `contributes.menus["${menu}"][${index}]: unknown submenu ${JSON.stringify(item.submenu)}`,
            );
            return;
          }
          items.push(item);
        });
        if (menu === "view/title") viewTitleMenu.push(...items);
        else submenus[submenuIndex] = { ...submenus[submenuIndex], items: Object.freeze(items) };
      }
    }
  }
  return {
    contributions: Object.freeze({
      views: Object.freeze(views),
      commands: Object.freeze(commands),
      viewTitleMenu: Object.freeze(viewTitleMenu),
      submenus: Object.freeze(submenus),
    }),
    warnings,
  };
}
