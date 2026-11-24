// Reads an extension's `contributes` (views, commands, menus) from its manifest
// into checked plain data. Problems are warnings: the rest still loads.
import { isExtensionViewId } from "@/shell/railTabs";
import { isRailViewIconName } from "@/shell/railViewIcons";
import { appShortcutsOwning, BUILT_IN_CHORD_OVERRIDES } from "./appKeyChords";
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
  /** A filter field drawn above the rows, with optional extra fields (such as globs). */
  readonly filter?: {
    readonly placeholder: string;
    readonly ariaLabel: string;
    readonly fields?: readonly SearchInputFieldContribution[];
  };
  /** A query form drawn in place of the title bar. */
  readonly searchInput?: SearchInputContribution;
  /** The view's title bar is the host's location bar for `TreeView.location`. */
  readonly location?: boolean;
}

/** Menu entries the host draws itself: the filter's fields toggle and the Open In menu. */
export const TOGGLE_FILTER_FIELDS_COMMAND = "omnigent.toggleFilterFields";
export const OPEN_IN_SUBMENU = "omnigent.openIn";

export interface SearchInputOptionContribution {
  readonly id: string;
  readonly title: string;
}

export interface SearchInputFieldContribution {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string | undefined;
}

/** `searchInput` of a view: the query box, its option toggles and the extra fields. */
export interface SearchInputContribution {
  readonly placeholder: string;
  readonly ariaLabel: string;
  /** The submit button's label. */
  readonly submitTitle: string;
  readonly options: readonly SearchInputOptionContribution[];
  readonly fields: readonly SearchInputFieldContribution[];
  /** The button that shows the fields: its tooltip and accessible label. */
  readonly fieldsToggle: { readonly title: string; readonly ariaLabel: string } | undefined;
  /** A note under the fields. */
  readonly fieldsHint: string | undefined;
  /** A note at the bottom of the form. */
  readonly hint: string | undefined;
}

export interface KeybindingContribution {
  readonly command: string;
  /** The parsed key: lower-case modifiers and the key, such as `ctrl+shift+f`. */
  readonly key: string;
  /** Used on macOS when set. */
  readonly mac: string | undefined;
  readonly when: WhenClause | undefined;
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
  readonly keybindings: readonly KeybindingContribution[];
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
  keybindings: [],
});

const MAX_HINT_LENGTH = 300;
const MAX_INPUT_ENTRIES = 8;
const INPUT_ENTRY_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const KEY_MODIFIERS = new Set(["ctrl", "shift", "alt", "cmd", "meta"]);
/** A key chord such as `ctrl+shift+f`: modifiers, then one letter, digit or F-key. */
const KEY_CHORD = /^(?:(?:ctrl|shift|alt|cmd|meta)\+)*(?:[a-z0-9]|f[1-9]|f1[0-2])$/;

/** A keybinding's key, normalized (lower case, `meta` as `cmd`), or undefined when malformed. */
export function normalizeKeyChord(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const chord = value
    .trim()
    .toLowerCase()
    .replace(/\bmeta\+/g, "cmd+");
  if (!KEY_CHORD.test(chord)) return undefined;
  const parts = chord.split("+");
  const modifiers = parts.slice(0, -1);
  if (new Set(modifiers).size !== modifiers.length) return undefined;
  if (!modifiers.every((modifier) => KEY_MODIFIERS.has(modifier))) return undefined;
  return chord;
}

/**
 * Whether a normalized chord leaves typing alone: it holds Ctrl, Cmd or Alt, or
 * presses an F-key. A bare or Shift-only letter or digit would swallow text.
 */
export function isCommandChord(chord: string): boolean {
  const parts = chord.split("+");
  const key = parts.at(-1) ?? "";
  if (/^f(?:[1-9]|1[0-2])$/.test(key)) return true;
  return parts.slice(0, -1).some((modifier) => modifier !== "shift");
}

/** Why a chord can't be contributed (a bare key, or one the app owns), or undefined when it can. */
function keyChordProblem(
  chord: string,
  mac: boolean,
  allowed: readonly string[],
): string | undefined {
  if (!isCommandChord(chord)) {
    return `needs Ctrl, Cmd or Alt, or an F-key, so it doesn't swallow typing`;
  }
  const owners = appShortcutsOwning(chord, mac);
  // An override lifts only the owners it names; every other owner is named in the warning.
  if (owners.length === 0 || owners.every((owner) => allowed.includes(owner.id))) return undefined;
  const names = owners.map((owner) => `"${owner.label}" (${owner.id})`);
  return owners.length === 1
    ? `is the app's ${names[0]} shortcut`
    : `is the app's ${names.slice(0, -1).join(", ")} and ${names.at(-1)} shortcuts`;
}

function searchInputOf(
  value: unknown,
  where: string,
  warnings: string[],
): SearchInputContribution | undefined {
  if (!isRecord(value)) {
    warnings.push(`${where}: "searchInput" must be an object`);
    return undefined;
  }
  const placeholder = textOf(value.placeholder, MAX_TITLE_LENGTH);
  if (placeholder === undefined) {
    warnings.push(`${where}: "searchInput.placeholder" must be a non-empty string`);
    return undefined;
  }
  const entries = <T>(
    raw: unknown,
    name: string,
    read: (entry: Record<string, unknown>, id: string) => T | undefined,
  ): T[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      warnings.push(`${where}: "searchInput.${name}" must be an array`);
      return [];
    }
    const seen = new Set<string>();
    return raw.slice(0, MAX_INPUT_ENTRIES).flatMap((entry: unknown, index) => {
      const id = isRecord(entry) ? entry.id : undefined;
      if (!isRecord(entry) || typeof id !== "string" || !INPUT_ENTRY_ID.test(id) || seen.has(id)) {
        warnings.push(`${where}: "searchInput.${name}[${index}]" needs a unique "id"`);
        return [];
      }
      seen.add(id);
      const parsed = read(entry, id);
      if (parsed === undefined) {
        warnings.push(`${where}: "searchInput.${name}[${index}]" needs a title`);
        return [];
      }
      return [parsed];
    });
  };
  const options = entries(value.options, "options", (entry, id) => {
    const title = textOf(entry.title, MAX_TITLE_LENGTH);
    return title === undefined ? undefined : { id, title };
  });
  const fields = entries(value.fields, "fields", (entry, id) => {
    const label = textOf(entry.label, MAX_TITLE_LENGTH);
    return label === undefined
      ? undefined
      : { id, label, placeholder: textOf(entry.placeholder, MAX_TITLE_LENGTH) };
  });
  const toggle = isRecord(value.fieldsToggle) ? value.fieldsToggle : undefined;
  const toggleTitle = toggle ? textOf(toggle.title, MAX_TITLE_LENGTH) : undefined;
  return {
    placeholder,
    ariaLabel: textOf(value.ariaLabel, MAX_TITLE_LENGTH) ?? placeholder,
    submitTitle: textOf(value.submitTitle, MAX_NAME_LENGTH) ?? "Search",
    options: Object.freeze(options),
    fields: Object.freeze(fields),
    fieldsToggle:
      fields.length > 0
        ? {
            title: toggleTitle ?? "Show fields",
            ariaLabel:
              (toggle && textOf(toggle.ariaLabel, MAX_TITLE_LENGTH)) ??
              toggleTitle ??
              "Show fields",
          }
        : undefined,
    fieldsHint: textOf(value.fieldsHint, MAX_HINT_LENGTH),
    hint: textOf(value.hint, MAX_HINT_LENGTH),
  };
}

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

/** `filter.fields`: up to four `{ id, label, placeholder? }` text fields under the filter. */
function filterFieldsOf(
  raw: unknown,
  where: string,
  warnings: string[],
): SearchInputFieldContribution[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push(`${where}: "filter.fields" must be an array`);
    return [];
  }
  const fields: SearchInputFieldContribution[] = [];
  raw.slice(0, 4).forEach((field: unknown, index) => {
    const record = isRecord(field) ? field : {};
    const id = textOf(record.id, MAX_TITLE_LENGTH);
    const label = textOf(record.label, MAX_TITLE_LENGTH);
    if (!id || fields.some((existing) => existing.id === id)) {
      warnings.push(`${where}: "filter.fields[${index}]" needs a unique "id"`);
      return;
    }
    if (!label) {
      warnings.push(`${where}: "filter.fields[${index}]" needs a label`);
      return;
    }
    fields.push({ id, label, placeholder: textOf(record.placeholder, MAX_TITLE_LENGTH) });
  });
  return fields;
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
              const fields = filterFieldsOf(record.fields, where, warnings);
              filter = {
                placeholder,
                ariaLabel: textOf(record.ariaLabel, MAX_TITLE_LENGTH) ?? placeholder,
                ...(fields.length === 0 ? {} : { fields }),
              };
            }
          }
          const searchInput =
            entry.searchInput === undefined
              ? undefined
              : searchInputOf(entry.searchInput, where, warnings);
          views.push({
            id,
            name: name.trim().slice(0, MAX_NAME_LENGTH),
            icon: iconOf(entry.icon, where, warnings),
            order: views.length,
            ...(builtInTab === undefined ? {} : { builtInTab }),
            ...(filter === undefined ? {} : { filter }),
            ...(searchInput === undefined ? {} : { searchInput }),
            ...(entry.location === true ? { location: true } : {}),
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
          if (
            item.submenu !== undefined &&
            item.submenu !== OPEN_IN_SUBMENU &&
            !submenus.some((sub) => sub.id === item.submenu)
          ) {
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
  const keybindings: KeybindingContribution[] = [];
  if (raw.keybindings !== undefined) {
    if (!Array.isArray(raw.keybindings)) {
      warnings.push('"contributes.keybindings" must be an array');
    } else {
      raw.keybindings.slice(0, MAX_ENTRIES).forEach((entry: unknown, index) => {
        const where = `contributes.keybindings[${index}]`;
        if (!isRecord(entry) || typeof entry.command !== "string" || entry.command === "") {
          warnings.push(`${where}: "command" must be a non-empty string`);
          return;
        }
        const key = normalizeKeyChord(entry.key);
        if (key === undefined) {
          warnings.push(`${where}: invalid key ${JSON.stringify(entry.key)}`);
          return;
        }
        const mac = entry.mac === undefined ? undefined : normalizeKeyChord(entry.mac);
        if (entry.mac !== undefined && mac === undefined) {
          warnings.push(`${where}: invalid mac key ${JSON.stringify(entry.mac)}`);
          return;
        }
        const allowed = options.builtIn
          ? (BUILT_IN_CHORD_OVERRIDES[`${extensionId} ${entry.command}`] ?? [])
          : [];
        const otherProblem = keyChordProblem(key, false, allowed);
        const macProblem = keyChordProblem(mac ?? key, true, allowed);
        if (otherProblem !== undefined || macProblem !== undefined) {
          const [chord, problem] =
            otherProblem !== undefined ? [key, otherProblem] : [mac ?? key, macProblem];
          warnings.push(`${where}: key "${chord}" ${problem}; the keybinding is ignored`);
          return;
        }
        keybindings.push({
          command: entry.command,
          key,
          mac,
          when: whenOf(entry.when, where, warnings),
        });
      });
    }
  }
  return {
    contributions: Object.freeze({
      keybindings: Object.freeze(keybindings),
      views: Object.freeze(views),
      commands: Object.freeze(commands),
      viewTitleMenu: Object.freeze(viewTitleMenu),
      submenus: Object.freeze(submenus),
    }),
    warnings,
  };
}
