// The raw colours, radii and text sizes each UI source still holds, for
// `noRawColors.test.ts`. Counts may only go down: lower an entry when a file loses
// some (the test says which), and never add a file. Regenerate the list with
// `UPDATE_RAW_COLOR_ALLOWLIST=1 vitest run src/theme/noRawColors.test.ts`.

/**
 * Counts per category: hex, palette classes and variables, `rounded-[…]`, `text-[Npx]`,
 * colour functions, and named colours used as colours.
 */
export type RawCounts = Partial<
  Record<"hex" | "palette" | "rounded" | "textPx" | "colorFunction" | "named", number>
>;

/**
 * Directories of test support only (fixtures and helpers that only tests import; the
 * guard checks that), which it skips. A folder is not skipped for its name alone.
 */
export const RAW_COLOR_TEST_DIRECTORIES: readonly string[] = [
  "test/",
  "components/composer/engine/testing/",
];

/**
 * Files (or directories, ending in `/`) whose raw colours are data, not styling: the
 * definitions themes start from, or colours keyed by data. Each says why. A file that
 * also holds logic or UI code marks its data instead, between `raw-colors-data: <why>`
 * and `raw-colors-data-end` comments, so the rest of it is still checked.
 */
export const RAW_COLOR_EXEMPT: Readonly<Record<string, string>> = {
  // The token defaults themselves, generated from theme/tokens/.
  "themeTokens.generated.css": "generated token defaults",
  // Tailwind's palette names, for the token defaults that read its steps (tw()).
  "theme/tokens/tailwindPalette.ts": "Tailwind palette names",
  // The built-in palettes: the colours every palette token takes per palette.
  "lib/themePalette.ts": "palette definitions",
  // The vendored file tree's own stylesheet, bridged by fileTreeStyle.ts.
  "components/file-tree/vendored/file-tree.css": "vendored stylesheet",
  // The pre-M1 index.css values the registry test compares the defaults with (test data).
  "theme/tokens/legacyIndexCss.fixture.json": "test fixture of the pre-registry values",
  // File-type icon colours keyed by file type, a copy of the vendored tree's palette.
  "components/file-tree/fileTypeIconPalette.ts": "file-type icon palette",
};

export const RAW_COLOR_ALLOWLIST: Readonly<Record<string, RawCounts>> = {
  "canvas/SessionCard.tsx": { textPx: 1 },
  "components/AgentInfo.tsx": { palette: 6, rounded: 1, textPx: 6 },
  "components/ai-elements/conversation.tsx": { hex: 1 },
  "components/ai-elements/MermaidError.tsx": { hex: 1 },
  "components/ai-elements/pullRequestRefs.ts": { hex: 3 },
  "components/ai-elements/shimmer.tsx": { hex: 2 },
  "components/blocks/ApprovalCard.tsx": { palette: 6 },
  "components/blocks/ChatMarkdown.tsx": { hex: 1 },
  "components/blocks/SlashCommandCard.tsx": { palette: 2 },
  "components/blocks/SmartRoutingCard.tsx": { textPx: 1 },
  "components/blocks/StatusBlocks.tsx": { palette: 6, rounded: 5, textPx: 3 },
  "components/blocks/TerminalCommandCard.tsx": { palette: 4 },
  "components/blocks/TerminalView.tsx": { palette: 4 },
  "components/BrowserPane/designTools/core/marks.ts": { hex: 7 },
  "components/chat/chatBubbleParts.tsx": { palette: 1, textPx: 1 },
  "components/chat/UndeliveredMessageNotice.tsx": { textPx: 2 },
  "components/composer/BackgroundTaskIndicator.tsx": { hex: 2 },
  "components/composer/ChatComposer.tsx": { rounded: 1 },
  "components/composer/ComposerAddMenu.tsx": { rounded: 1 },
  "components/composer/ComposerContextRing.tsx": { palette: 1 },
  "components/composer/ComposerPrLink.tsx": { hex: 1 },
  "components/composer/RunWorkflowMenu.tsx": { rounded: 1 },
  "components/ComposerAgentIcon.tsx": { hex: 1 },
  "components/FileMentionMenu.tsx": { palette: 6, rounded: 1, textPx: 3 },
  "components/FindBar.tsx": { textPx: 1 },
  "components/icons/NessieIcon.tsx": { hex: 2 },
  "components/ImageLightbox.tsx": { palette: 1 },
  "components/KeyboardShortcut.tsx": { palette: 3 },
  "components/ModelValueCombobox.tsx": { rounded: 1 },
  "components/OmniGlassSurface.tsx": { colorFunction: 2 },
  "components/onboarding/AnimatedOmnigentPanel.css": { hex: 1 },
  "components/onboarding/BlobGraphic.css": { hex: 1, colorFunction: 3 },
  "components/onboarding/BlobGraphic.tsx": { colorFunction: 3 },
  "components/onboarding/ImportContextModal.tsx": { rounded: 1, textPx: 1 },
  "components/PermissionsModal.tsx": { hex: 2, rounded: 1 },
  "components/PresenceAvatars.tsx": { palette: 1 },
  "components/ProjectIconPicker.tsx": { textPx: 2 },
  "components/scheduled/AutomationsIntro.tsx": { rounded: 1 },
  "components/scheduled/RunPullRequests.tsx": { hex: 1 },
  "components/scheduled/ScheduledTaskRow.tsx": { textPx: 2 },
  "components/scheduled/TriggerTemplateFields.tsx": { palette: 9 },
  "components/scheduled/triggerTemplates.ts": { palette: 8 },
  "components/SlashCommandMenu.tsx": { palette: 5, rounded: 2 },
  "components/theme/ThemeColorPicker.tsx": { hex: 11, colorFunction: 1 },
  "components/ui/button.tsx": { rounded: 5 },
  "components/ui/context-menu.tsx": { rounded: 2 },
  "components/ui/dialog.tsx": { hex: 1, rounded: 1 },
  "components/ui/dropdown-menu.tsx": { rounded: 2 },
  "components/ui/glass-surface/GlassSurface.css": { hex: 6, colorFunction: 8, named: 8 },
  "components/ui/glass-surface/GlassSurface.jsx": { hex: 2, colorFunction: 1, named: 3 },
  "components/ui/input-group.tsx": { rounded: 3 },
  "components/ui/quick-pick/match.ts": { hex: 1 },
  "components/ui/scroll-area.tsx": { rounded: 1 },
  "components/ui/select.tsx": { rounded: 2 },
  "components/usage/UsageSessionTable.tsx": { textPx: 2 },
  "components/VideoPlayer.tsx": { palette: 1 },
  "components/workflows/taskParts.tsx": { textPx: 1 },
  "components/workflows/WorkflowAutomations.tsx": { textPx: 1 },
  "components/workflows/WorkflowRow.tsx": { textPx: 1 },
  "hooks/useCommandPaletteHotkey.ts": { hex: 3 },
  "hooks/useSuppressBrowserView.ts": { hex: 1 },
  "index.css": { hex: 38, colorFunction: 20, named: 1 },
  "lib/customTheme.ts": { hex: 2 },
  "lib/gitProviders.ts": { hex: 1 },
  "lib/pullRequestReference.ts": { hex: 1 },
  "lib/workflow.ts": { hex: 1 },
  "pages/ApprovePage.tsx": { palette: 2 },
  "pages/CanvasPage.tsx": { palette: 1 },
  "pages/ChatIndicators.tsx": { rounded: 1 },
  "pages/InboxPage.tsx": { palette: 1 },
  "pages/onboarding/ServerSelectStep.tsx": { textPx: 1 },
  "pages/onboarding/SetupTerminalStep.tsx": { palette: 2, textPx: 1, colorFunction: 3 },
  "pages/PoliciesPage.tsx": { textPx: 3 },
  "pages/settings/HarnessFixDialog.tsx": { rounded: 2 },
  "pages/settings/search/catalog/appearance.ts": { hex: 1 },
  "pages/settings/SettingsHarnessesSection.tsx": { rounded: 1 },
  "pages/TaskDetailPage.tsx": { palette: 3 },
  "pages/TasksPage.tsx": { rounded: 1 },
  "projectHome/ProjectSessionPanel.tsx": { rounded: 1 },
  "shell/addCommentButtonStyles.ts": { palette: 4 },
  "shell/AppShell.tsx": { palette: 1 },
  "shell/BrowseLocationBar.tsx": { textPx: 1 },
  "shell/ChangedFileRow.tsx": { textPx: 2 },
  "shell/ChangesReviewComparison.tsx": { textPx: 2 },
  "shell/ChatHeader.tsx": { palette: 3 },
  "shell/CodeViewer.tsx": { colorFunction: 4 },
  "shell/codeViewerHelpers.ts": { hex: 3 },
  "shell/codeViewerRendering.tsx": { palette: 3 },
  "shell/CommentsPanel.tsx": { textPx: 7, colorFunction: 1, named: 1 },
  "shell/ConversationBreadcrumb.tsx": { textPx: 2 },
  "shell/CopyPathButton.tsx": { palette: 2 },
  "shell/extensionViews/ExtensionRailView.tsx": { textPx: 3 },
  "shell/extensionViews/SessionTreeRow.tsx": { textPx: 1 },
  "shell/extensionViews/ViewGraph.tsx": { textPx: 4 },
  "shell/extensionViews/ViewPullRequests.tsx": { palette: 1 },
  "shell/fileTreeRows.tsx": { textPx: 2 },
  "shell/FileViewer.tsx": { textPx: 1 },
  "shell/ForkSessionDialog.tsx": { palette: 1, textPx: 1 },
  "shell/HarnessCredentialForm.tsx": { palette: 2, textPx: 1 },
  "shell/HarnessSetupDialog.tsx": { palette: 4 },
  "shell/HeaderProjectTag.tsx": { textPx: 1 },
  "shell/HostLabel.tsx": { palette: 1, textPx: 1 },
  "shell/htmlCommentBridge.ts": { colorFunction: 2 },
  "shell/MarkdownRichTextViewer.tsx": { hex: 1 },
  "shell/mobileGlass.ts": { palette: 2 },
  "shell/MobileHeaderButton.tsx": { rounded: 1 },
  "shell/NewChatDialog.tsx": { hex: 1, rounded: 2, textPx: 2 },
  "shell/ProjectPicker.tsx": { textPx: 2 },
  "shell/PullRequestLabels.tsx": { hex: 1 },
  "shell/PullRequestPanelDetails.tsx": { hex: 1, textPx: 1, colorFunction: 1 },
  "shell/railTabs.ts": { textPx: 1 },
  "shell/Sidebar.tsx": { palette: 1, rounded: 4, textPx: 3 },
  "shell/SidebarEditRow.tsx": { rounded: 1 },
  "shell/SidebarServerPicker.tsx": { rounded: 2 },
  "shell/sidebarStyles.ts": { rounded: 1 },
  "shell/TableBubbleMenu.tsx": { rounded: 1, textPx: 4 },
  "shell/TabStripScroller.tsx": { hex: 4 },
  "shell/terminalStatus.tsx": { palette: 3 },
  "shell/tiptapMarkdownPatches.ts": { hex: 3 },
  "shell/WorkspacePanel.tsx": { hex: 1 },
  "shell/WorkspacePathField.tsx": { rounded: 1 },
  "shell/WorkspacePicker.tsx": { rounded: 1 },
  "shell/workspaceTabs/placeTitle.ts": { hex: 1 },
  "shell/workspaceTabs/recentPullRequestRow.ts": { hex: 1 },
  "shell/workspaceTabs/WorkspaceStripTab.tsx": { named: 1 },
  "theme/noRawColors.allowlist.ts": { rounded: 1 },
};
