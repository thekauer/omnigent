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
}

export interface CommandContribution {
  readonly command: string;
  readonly title: string;
  readonly icon: string | undefined;
  /** When set, a button for the command is a toggle, pressed while this holds. */
  readonly toggled: WhenClause | undefined;
}

export interface MenuItemContribution {
  readonly command: string;
  readonly when: WhenClause | undefined;
  readonly group: string | undefined;
}

export interface ExtensionContributions {
  readonly views: readonly ViewContribution[];
  readonly commands: readonly CommandContribution[];
  readonly viewTitleMenu: readonly MenuItemContribution[];
}

const MAX_NAME_LENGTH = 40;
const MAX_TITLE_LENGTH = 80;
const MAX_ENTRIES = 50;

export const EMPTY_CONTRIBUTIONS: ExtensionContributions = Object.freeze({
  views: [],
  commands: [],
  viewTitleMenu: [],
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
export function parseContributions(
  extensionId: string,
  raw: unknown,
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
          views.push({
            id,
            name: name.trim().slice(0, MAX_NAME_LENGTH),
            icon: iconOf(entry.icon, where, warnings),
            order: views.length,
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

  const viewTitleMenu: MenuItemContribution[] = [];
  if (raw.menus !== undefined) {
    if (!isRecord(raw.menus)) {
      warnings.push('"contributes.menus" must be an object');
    } else {
      for (const [menu, entries] of Object.entries(raw.menus)) {
        if (menu !== "view/title") {
          warnings.push(`contributes.menus: menu "${menu}" is not supported yet; ignoring it`);
          continue;
        }
        if (!Array.isArray(entries)) {
          warnings.push(`contributes.menus["${menu}"] must be an array`);
          continue;
        }
        entries.slice(0, MAX_ENTRIES).forEach((entry: unknown, index) => {
          const where = `contributes.menus["${menu}"][${index}]`;
          if (!isRecord(entry) || typeof entry.command !== "string" || entry.command === "") {
            warnings.push(`${where}: "command" must be a non-empty string`);
            return;
          }
          if (entry.group !== undefined && typeof entry.group !== "string") {
            warnings.push(`${where}: "group" must be a string`);
            return;
          }
          viewTitleMenu.push({
            command: entry.command,
            when: whenOf(entry.when, where, warnings),
            group: entry.group,
          });
        });
      }
    }
  }
  return {
    contributions: Object.freeze({
      views: Object.freeze(views),
      commands: Object.freeze(commands),
      viewTitleMenu: Object.freeze(viewTitleMenu),
    }),
    warnings,
  };
}
