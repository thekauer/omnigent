// VS Code workbench colour ids a theme's `colors` may use for Omnigent tokens (theming
// decision 4), so a stock VS Code colour theme partly imports. Curated: only ids whose
// meaning matches the token's. Pure data, shared by the browser and the dev plugin.
//
// Entries apply in order and a later one overwrites an earlier one's token, so the broad
// ids (`foreground`, `editor.background`) come first and the specific ones after them.
// An Omnigent token id written in `colors` itself, and `omnigent.tokens`, beat every alias.

/** A VS Code colour id and the Omnigent tokens it sets. */
export type ColorAlias = readonly [vscodeId: string, tokens: readonly string[]];

const ANSI = [
  ["Black", "black"],
  ["Red", "red"],
  ["Green", "green"],
  ["Yellow", "yellow"],
  ["Blue", "blue"],
  ["Magenta", "magenta"],
  ["Cyan", "cyan"],
  ["White", "white"],
] as const;

export const VSCODE_COLOR_ALIASES: readonly ColorAlias[] = [
  // The workbench at large.
  ["foreground", ["foreground", "card-foreground", "popover-foreground"]],
  ["descriptionForeground", ["muted-foreground"]],
  ["disabledForeground", ["foreground-tertiary"]],
  ["focusBorder", ["ring", "sidebar-ring"]],
  ["contrastBorder", ["border-strong"]],
  ["errorForeground", ["destructive"]],
  ["textLink.foreground", ["link"]],
  ["selection.background", ["selection-background"]],
  ["widget.border", ["border"]],
  ["editor.background", ["background", "code-bg", "viewer-background"]],
  ["editor.foreground", ["foreground"]],
  ["editorWidget.background", ["card", "card-solid", "popover"]],
  ["editorWidget.foreground", ["card-foreground", "popover-foreground"]],
  ["editorWidget.border", ["border"]],
  ["panel.background", ["card", "card-solid"]],
  ["panel.border", ["border"]],
  ["menu.background", ["popover", "menu-surface-bg"]],
  ["menu.foreground", ["popover-foreground"]],
  ["menu.border", ["menu-surface-border"]],
  ["dropdown.background", ["popover"]],
  ["dropdown.foreground", ["popover-foreground"]],
  ["dropdown.border", ["menu-surface-border"]],
  ["input.border", ["input"]],
  ["button.background", ["primary"]],
  ["button.foreground", ["primary-foreground"]],
  ["button.border", ["button-border"]],
  ["button.secondaryBackground", ["secondary"]],
  ["button.secondaryForeground", ["secondary-foreground"]],
  ["badge.background", ["accent"]],
  ["badge.foreground", ["accent-foreground"]],
  ["list.hoverBackground", ["muted", "sidebar-accent"]],
  ["list.activeSelectionBackground", ["sidebar-active"]],
  ["list.activeSelectionForeground", ["sidebar-active-foreground"]],
  ["editorHoverWidget.background", ["tooltip-bg"]],
  ["progressBar.background", ["brand-accent"]],
  // The sidebar.
  ["sideBar.background", ["sidebar", "sidebar-background"]],
  ["sideBar.foreground", ["sidebar-foreground"]],
  ["sideBar.border", ["sidebar-border"]],
  ["sideBarSectionHeader.foreground", ["sidebar-foreground"]],
  // The activity bar: its icons, the active one's background and edge, and its count badges.
  ["activityBar.foreground", ["ui-activitybar-active-foreground"]],
  ["activityBar.inactiveForeground", ["ui-activitybar-foreground"]],
  ["activityBar.activeBackground", ["ui-activitybar-active-background"]],
  ["activityBar.activeBorder", ["ui-activitybar-active-border"]],
  ["activityBarBadge.background", ["ui-activitybar-badge-background"]],
  ["activityBarBadge.foreground", ["ui-activitybar-badge-foreground"]],
  // The code surfaces.
  ["editor.selectionBackground", ["code-selection"]],
  ["editor.lineHighlightBackground", ["viewer-active-line"]],
  ["editor.findMatchBackground", ["viewer-search-match-selected"]],
  ["editor.findMatchHighlightBackground", ["viewer-search-match"]],
  ["editor.selectionHighlightBackground", ["viewer-selection-match"]],
  ["editorGutter.background", ["viewer-gutter-background"]],
  ["editorLineNumber.foreground", ["viewer-gutter-foreground"]],
  ["editorLineNumber.activeForeground", ["viewer-gutter-active-foreground"]],
  ["scrollbarSlider.background", ["ui-scrollbar-thumb"]],
  ["scrollbarSlider.hoverBackground", ["ui-scrollbar-thumb-hover"]],
  // Diffs and the file tree's git decorations.
  ["diffEditor.insertedTextBackground", ["diff-addition-base"]],
  ["diffEditor.removedTextBackground", ["diff-deletion-base"]],
  ["gitDecoration.addedResourceForeground", ["file-tree-git-added", "diff-stat-added"]],
  ["gitDecoration.modifiedResourceForeground", ["file-tree-git-modified"]],
  ["gitDecoration.deletedResourceForeground", ["file-tree-git-deleted", "diff-stat-deleted"]],
  ["gitDecoration.renamedResourceForeground", ["file-tree-git-renamed"]],
  ["gitDecoration.untrackedResourceForeground", ["file-tree-git-untracked"]],
  ["gitDecoration.ignoredResourceForeground", ["file-tree-git-ignored"]],
  // Status colours.
  ["editorError.foreground", ["ui-danger-text"]],
  ["editorWarning.foreground", ["ui-warning-text"]],
  ["editorInfo.foreground", ["ui-info-text"]],
  ["charts.red", ["status-red"]],
  ["charts.green", ["status-green"]],
  ["charts.yellow", ["status-yellow"]],
  ["charts.blue", ["status-blue"]],
  // The terminal.
  ["terminal.background", ["terminal-background"]],
  ["terminal.foreground", ["terminal-foreground"]],
  ["terminalCursor.foreground", ["terminal-cursor"]],
  ["terminalCursor.background", ["terminal-cursor-accent"]],
  ["terminal.selectionBackground", ["terminal-selection"]],
  ["terminal.border", ["terminal-border"]],
  ...ANSI.flatMap(([vscode, slot]): ColorAlias[] => [
    [`terminal.ansi${vscode}`, [`terminal-ansi-${slot}`]],
    [`terminal.ansiBright${vscode}`, [`terminal-ansi-bright-${slot}`]],
  ]),
];

/** The aliases by VS Code id. */
export const VSCODE_COLOR_ALIAS_MAP: ReadonlyMap<string, readonly string[]> = new Map(
  VSCODE_COLOR_ALIASES,
);

/** The order an alias applies in (a later one overwrites an earlier one's tokens). */
export const VSCODE_COLOR_ALIAS_ORDER: ReadonlyMap<string, number> = new Map(
  VSCODE_COLOR_ALIASES.map(([id], index) => [id, index]),
);
