import { builtInThemeContributions } from "@/builtinExtensions/builtInThemes";
import { VARIANT_LABELS, VARIANT_NAMES, VARIANTS, type VariantName } from "@/theme/variants";

import { settingsEntry, settingsEntryFamily } from "./types";

// The built-in themes' names, as the colour theme select lists them (one per family),
// from the built-in theme extension's contributions: they follow its list.
const BUILT_IN_THEME_LABELS = [
  ...new Set(builtInThemeContributions().map((theme) => String(theme.label))),
];

export const THEME_MODE_ENTRY = settingsEntry({
  id: "theme-mode",
  section: "appearance",
  label: "Mode",
  description: "Follow your system, or force light or dark.",
  keywords: ["dark mode", "light mode", "theme", "system", "appearance", "databricks"],
  // As the radios name them; "Use Databricks setting" replaces System under a Databricks host.
  choices: ["System", "Use Databricks setting", "Light", "Dark"],
  parts: { databricksSettings: "Databricks appearance settings" },
  presence: { databricksSettings: { states: ["follows Databricks"] } },
});

export const TERMINAL_THEME_ENTRY = settingsEntry({
  id: "terminal-theme",
  section: "appearance",
  label: "Terminal theme",
  description: "Use a light or dark terminal, or match the app.",
  keywords: ["terminal", "dark", "light", "colors"],
  // As the terminal theme radios name them.
  choices: ["Match app", "Light", "Dark"],
});

export const COLOR_THEME_ENTRY = settingsEntry({
  id: "color-theme",
  section: "appearance",
  label: "Color theme",
  description: "Choose a preset, then tune it across light and dark mode.",
  keywords: ["theme", "palette", "colors", "accent", "tint", "contrast", "translucent"],
  // The select's built-in choices, as it lists them; extensions' themes are runtime choices.
  choices: BUILT_IN_THEME_LABELS,
  parts: {
    accent: "Accent",
    tint: "Background tint",
    contrast: "Theme contrast",
    translucentSidebars: "Translucent sidebars",
  },
  // A color's swatch is named with its hex value, such as "Accent: #3366FF".
  nameTemplates: {
    accent: { before: "Accent: " },
    tint: { before: "Background tint: " },
  },
  // The sub-labels the palette select and the contrast slider show beside them.
  partLabels: { "": "Current theme", contrast: "Contrast" },
  // The editable colours show for a built-in theme only.
  presence: {
    accent: { states: ["built-in theme"] },
    tint: { states: ["built-in theme"] },
    contrast: { states: ["built-in theme"] },
    translucentSidebars: { states: ["built-in theme"] },
  },
  // Extensions' themes, named by their contributions.
  overlays: { "": { runtimeChoices: {} } },
});

export const THEME_OPTIONS_ENTRY = settingsEntry({
  id: "theme-options",
  section: "appearance",
  label: "Theme options",
  description: "Choices the color theme offers, such as its accent and corners.",
  keywords: ["theme", "options", "accent", "corners", "style"],
  // One control per option the theme declares, named after it.
  parts: { option: "Theme option" },
  nameTemplates: { option: { before: "Theme option: " } },
  overlays: { option: { runtimeChoices: {} } },
  // Shown only for a theme with options, under the color theme picker.
  revealedBy: "color-theme",
});

/** The style variants' select: "Theme default" first, then the values as Settings names them. */
export const THEME_DEFAULT_VARIANT_LABEL = "Theme default";

/**
 * One row per style variant (density, labels, ...), under the color theme picker: a select
 * of "Theme default" and the variant's values.
 */
export const THEME_VARIANT_ENTRIES = settingsEntryFamily({
  key: "theme-variants",
  members: VARIANT_NAMES,
  build: (name: VariantName) => {
    const labels = VARIANT_LABELS[name];
    const values = labels.values as Record<string, string>;
    return settingsEntry({
      id: `theme-variant-${name}`,
      section: "appearance",
      label: labels.label,
      description: labels.description,
      keywords: ["style", "variant", "theme"],
      choices: [
        THEME_DEFAULT_VARIANT_LABEL,
        ...(VARIANTS[name] as readonly string[]).map((value) => values[value]!),
      ],
    });
  },
});

export const COLOR_CUSTOMIZATIONS_ENTRY = settingsEntry({
  id: "color-customizations",
  section: "appearance",
  label: "Advanced",
  description: "Color customizations as JSON, over every theme or one theme by its id.",
  keywords: [
    "color customizations",
    "colorCustomizations",
    "tokens",
    "json",
    "override",
    "advanced",
  ],
  parts: { editor: "Color customizations JSON", apply: "Apply color customizations" },
  presence: { editor: { states: ["expanded"] }, apply: { states: ["expanded"] } },
});

export const UI_FONT_SIZE_ENTRY = settingsEntry({
  id: "ui-font-size",
  section: "appearance",
  label: "Interface font size",
  description: "Sets interface and conversation text. Icons and spacing stay fixed.",
  keywords: ["font", "text size", "zoom", "type", "typography"],
  parts: {
    field: "Interface font size in pixels",
    decrease: "Decrease interface font size",
    increase: "Increase interface font size",
  },
  focus: "field",
});

export const UI_FONT_FAMILY_ENTRY = settingsEntry({
  id: "ui-font-family",
  section: "appearance",
  label: "Font family",
  description: "Use an installed font. Leave blank for the system default.",
  keywords: ["font", "typeface", "interface font", "typography"],
  parts: { field: "UI font family", reset: "Reset" },
  focus: "field",
});

export const CODE_FONT_SIZE_ENTRY = settingsEntry({
  id: "code-font-size",
  section: "appearance",
  label: "Code font size",
  description: "Size of code in the editor and terminal.",
  keywords: ["font", "editor", "terminal", "monospace", "typography"],
  parts: {
    field: "Code font size in pixels",
    decrease: "Decrease code font size",
    increase: "Increase code font size",
  },
  focus: "field",
});

export const CODE_FONT_FAMILY_ENTRY = settingsEntry({
  id: "code-font-family",
  section: "appearance",
  label: "Code font family",
  description: "Font for the editor and terminal. Leave blank for the default.",
  keywords: ["font", "monospace", "editor", "terminal", "typography"],
  parts: { field: "Code font family", reset: "Reset" },
  focus: "field",
});

export const CODE_FONT_WEIGHT_ENTRY = settingsEntry({
  id: "code-font-weight",
  section: "appearance",
  label: "Heavier code font",
  description: "Use heavier text in the editor and terminal.",
  keywords: ["bold", "weight", "font", "editor", "terminal"],
  parts: { toggle: "Use heavier code text" },
  focus: "toggle",
});

export const APPEARANCE_DATA_ENTRY = settingsEntry({
  id: "appearance-data",
  section: "appearance",
  label: "Settings data",
  description:
    "Export this device's appearance and preference settings to a file, import them from one, or reset appearance to its defaults.",
  keywords: ["export", "import", "backup", "restore", "reset", "defaults"],
  parts: {
    export: "Export",
    import: "Import",
    reset: "Reset to defaults",
    confirmReset: "Reset",
    chooseFile: "Choose file",
  },
  presence: {
    confirmReset: { overlay: "reset" },
    chooseFile: { overlay: "import" },
  },
  overlays: {
    reset: { dialogActions: ["Cancel"] },
    import: { dialogActions: ["Cancel"] },
  },
});

export const TRANSCRIPT_VIEW_DEFAULT_ENTRY = settingsEntry({
  id: "transcript-view-default",
  section: "appearance",
  label: "Default transcript view",
  description:
    "Open terminal-backed chats in Chat or Terminal view. In-chat choices are remembered for the current tab.",
  keywords: ["chat", "terminal", "transcript", "view"],
  choices: ["Chat", "Terminal"],
});

export const HIDE_UNCONFIGURED_HARNESSES_ENTRY = settingsEntry({
  id: "hide-unconfigured-harnesses",
  section: "appearance",
  label: "Hide unconfigured harnesses",
  description:
    "Hide harnesses that need a CLI install or sign-in on the selected host from the new-chat picker.",
  keywords: ["harness", "picker", "new chat", "setup", "hide"],
});

export const PEER_SESSION_MESSAGES_ENTRY = settingsEntry({
  id: "peer-session-messages",
  section: "appearance",
  label: "Messages from other sessions",
  description:
    "Collapse or hide messages that agents in other sessions send to a chat. The agent still reads them in full.",
  keywords: ["supervisor", "peer", "agents", "messages", "collapse", "hide", "other sessions"],
  choices: ["Collapse", "Show", "Hide"],
});

export const PICKER_VISIBILITY_ENTRY = settingsEntry({
  id: "picker-visibility",
  section: "appearance",
  label: "Show in agent pickers",
  description:
    "Choose this server's harnesses and agents for new chats, automations, and project defaults. Existing sessions stay unchanged; the selected entry stays visible.",
  keywords: ["agents", "harnesses", "picker", "hide", "show", "new chat"],
  parts: {
    edit: "Edit",
    showAll: "Show all",
    retry: "Retry",
    filter: "Filter harnesses and agents",
  },
  presence: {
    retry: { states: ["load failed"] },
    filter: { overlay: "edit" },
  },
  // Its list is this server's harnesses and agents; none of their names is searchable.
  overlays: { edit: { runtimeChoices: {} } },
});

export const SHOW_FINAL_ANSWER_ENTRY = settingsEntry({
  id: "show-final-answer",
  section: "appearance",
  label: "Show only the final answer",
  description:
    "Fold other agents' progress into the Worked row, keeping each turn's last message visible. Codex already folds completed turns.",
  keywords: ["fold", "progress", "narration", "worked", "transcript", "collapse"],
});

export const WORKSPACE_PANEL_DEFAULT_ENTRY = settingsEntry({
  id: "workspace-panel-default",
  section: "appearance",
  label: "Workspace panel",
  description:
    "Show the Workspace panel in new chats. Opening or closing it updates this default; existing chats keep their layout.",
  keywords: ["workspace", "panel", "rail", "collapsed", "open"],
  choices: ["Open", "Collapsed"],
});

export const WORKSPACE_TABS_ENTRY = settingsEntry({
  id: "workspace-tabs",
  section: "appearance",
  label: "Sidebar tabs",
  description: "Pin the pages you use most. Everything else stays in the + menu.",
  keywords: [
    "pin",
    "tabs",
    "workspace",
    "sidebar",
    "files",
    "changes",
    "pull requests",
    "agents",
    "tasks",
  ],
  parts: {
    pinFiles: "Pin Files",
    pinChanges: "Pin Changes",
    pinPullRequests: "Pin Pull Requests",
    pinAgents: "Pin Agents",
    pinTasks: "Pin Tasks",
  },
  focus: "pinFiles",
});

export const DEFAULT_WORKSPACE_TAB_ENTRY = settingsEntry({
  id: "default-workspace-tab",
  section: "appearance",
  label: "Default Workspace tab",
  description:
    "Open this tab first, including in existing chats after reopening or refreshing. Later choices are remembered; file links still open their target.",
  keywords: ["workspace", "tab", "default", "first"],
  choices: ["Files", "Changes", "Pull Requests", "Agents", "Tasks"],
  // Shown only while a tab is pinned; until then, its reveal goes to the pins.
  revealedBy: "workspace-tabs",
});

export const SESSION_ROW_QUICK_ACTIONS_ENTRY = settingsEntry({
  id: "session-row-quick-actions",
  section: "appearance",
  label: "Show Pin and Archive buttons on session rows",
  description: `Turn this off to keep Pin and Archive in the session row's "…" menu and right-click menu only, so they are harder to click by mistake.`,
  keywords: ["pin", "archive", "hover", "quick actions", "row buttons", "sidebar", "accidental"],
});

export const PROJECT_FOLDER_PAGINATION_ENTRY = settingsEntry({
  id: "project-folder-pagination",
  section: "appearance",
  label: 'Collapse project sessions behind "Show more"',
  description:
    "An expanded project folder lists its first sessions and a Show more row for the rest. Turn this off to list every session, loading more as you scroll.",
  keywords: ["project", "folder", "sessions", "show more", "pagination", "sidebar"],
  parts: { pageSize: 'Sessions to show before "Show more"' },
  presence: { pageSize: { states: ["collapsed"] } },
});

export const APPEARANCE_SETTINGS = [
  THEME_MODE_ENTRY,
  TERMINAL_THEME_ENTRY,
  COLOR_THEME_ENTRY,
  THEME_OPTIONS_ENTRY,
  ...THEME_VARIANT_ENTRIES.entries,
  COLOR_CUSTOMIZATIONS_ENTRY,
  UI_FONT_SIZE_ENTRY,
  UI_FONT_FAMILY_ENTRY,
  CODE_FONT_SIZE_ENTRY,
  CODE_FONT_FAMILY_ENTRY,
  CODE_FONT_WEIGHT_ENTRY,
  APPEARANCE_DATA_ENTRY,
  TRANSCRIPT_VIEW_DEFAULT_ENTRY,
  HIDE_UNCONFIGURED_HARNESSES_ENTRY,
  PICKER_VISIBILITY_ENTRY,
  SHOW_FINAL_ANSWER_ENTRY,
  PEER_SESSION_MESSAGES_ENTRY,
  WORKSPACE_PANEL_DEFAULT_ENTRY,
  WORKSPACE_TABS_ENTRY,
  DEFAULT_WORKSPACE_TAB_ENTRY,
  SESSION_ROW_QUICK_ACTIONS_ENTRY,
  PROJECT_FOLDER_PAGINATION_ENTRY,
] as const;
