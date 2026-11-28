# Menus plan: every menu and action surface contributable (Stage 3)

Proposed, awaiting the user's review. No implementation before the decisions at the end are
answered. Stage 1 (theming) is [theming_plan.md](theming_plan.md), Stage 2 (layout) is
[layout_plan.md](layout_plan.md); the extension API is
[vscode_style_extensions.md](vscode_style_extensions.md); stable selectors are
[theme_hooks.md](theme_hooks.md).

## Status

The durable state to resume from. Update it in the same commit that lands each milestone.

| # | State | Notes |
|---|---|---|
| Plan | Proposed | Awaiting review of the decisions at the end of this doc. |
| MN0 to MN14 | Not started | |

Paths are relative to `web/src/` unless they start with `my-extensions/`, `docs/` or `omnigent/`.
Line numbers are from `fe8c061888`; "~" marks one read from a search offset.

## Context

- Roadmap: theming (done), layout (done), **menus everywhere** (this plan), then product config,
  then the trusted React tier (Theia-style: products and built-ins may supply React, third-party
  extensions stay plain data). No App Builder work.
- User preferences that shape every choice: VS Code's model and names; generic, product-level
  mechanisms; settings in the settings JSON, no new Settings UI rows; built-in UI is itself
  extensions, hideable or replaceable by products; development cost carries little weight.
- Lessons from the layout stage's validations, applied from the start here: a third party can't
  title, tooltip or icon another's command (the owner, the longest loaded extension id the
  command starts with, wins); dedupe never rewards the first to register; markdown and HTML are
  sanitized or refused; caps per extension; everything per mount; product locks never fail open.

## Findings: menus and actions today

Only four menus take contributions (`vscodeExtensions/contributions.ts:747-818`): `view/title`,
`viewContainer/title`, `sidebar/navigation`, `titleBar/left|center|right`, plus
`contributes.submenus` inside `view/title`. Every other key warns "not supported yet" (`:760`).
Everything else is hard-coded JSX or a per-feature model module.

### The contribution path

| Concern | Today | Where |
|---|---|---|
| Parse | Separate arrays per menu id; `MenuItemContribution { command, submenu?, when, group, tooltip?, tone?, builtInItem? }`; no `alt`, no `args`; 50 entries per menu | `vscodeExtensions/contributions.ts:109-122, 206, 747-818` |
| Store | `menus`, `containerMenus`, `navigation`, `titleBar`, `submenus` | `vscodeExtensions/viewsService.ts:380-389, 598-631` |
| Groups | `view/title` and `viewContainer/title` keep only `navigation` and `filter`; **any other group is dropped silently** (no "..." overflow) | `viewsService.ts:802`, `shell/ViewContainerTitleActions.tsx:15` |
| Order | Declaration order; `navigation` first, then group, then `@order` only in the title bar | `workbench/titleBar.ts:124-136` |
| Titles | The owning extension's command title, else the raw id; owner rule and one entry per command (`when` holds, then the owner, then first) | `viewsService.ts:332-367, 570-577` |
| Run | `executeCommand(command, [])`: **no arguments**, so a menu can't say which session, file or row | `viewsService.ts:772-780` |
| `when` | `key`, `!`, `==`, `!=`, `&&`, `||`, parens; 1024 chars, depth 32 | `vscodeExtensions/when.ts:24-26, 188` |
| Context keys | One store per window; `setContext` takes any key: **an extension can overwrite or delete a host key** (`config.*`, `omnigent.session.*`) that gates built-in items | `vscodeExtensions/contextKeys.ts:45-75` |
| Navigation `when` | Built-in rows evaluate against a caller-built key map, contributed rows against the context key store: two paths | `shell/Sidebar.tsx:1957, 1969-1978`, `viewsService.ts:907` |
| Keybindings | `contributes.keybindings` dispatch through `KeybindingService`; never shown in a menu | `vscodeExtensions/keybindings.ts:101, 180`, `contributions.ts:819-860` |
| Command Palette | A separate zustand store fed by host hooks; **extension commands never appear**; availability in code (`HIDDEN`, `unavailableBecause`), no `when` | `store/paletteCommands.ts:12-30, 33-84, 121, 163-184` |
| Toasts | sonner; host toasts pass inline `{ action, cancel }` closures; extensions get `showInformationMessage(message)` and `showErrorMessage(message)`, no buttons | `components/ui/toast.tsx:9-21`, `vscodeExtensions/api.ts:680-716` |
| Built-ins on the path | `omnigent.files`, `omnigent.changes`, `omnigent.agents` (`view/title`), `omnigent.conversations` (`sidebar/navigation`), `omnigent.workbench` (`titleBar/*`); `omnigent.openIn` and `omnigent.toggleFilterFields` are built-in only | `builtinExtensions/*/package.json`, `contributions.ts:61-63, 777-785` |
| Primitives | Radix `ContextMenu` and `DropdownMenu` wrappers with `*Shortcut` slots; `SessionActionMenuItem` rows; hand-rolled listboxes for slash and mention; `QuickPick` | `components/ui/context-menu.tsx:186`, `components/ui/dropdown-menu.tsx:206`, `components/SessionActionMenuItem.tsx:17-76`, `components/ui/quick-pick/QuickPick.tsx` |

Reusable model modules (one item list for a menu and ⌘K): `shell/fileCommands/model.ts:14-26, 92`,
`shell/workspaceCommands/model.ts:105, 391`, `components/composer/composerAddActions.ts`,
`canvas/canvasHeaderActions.ts`, `components/diff-review/diffReviewCommands.ts:180, 395`,
`shell/paneStrip/paneMenu.ts`, `components/chat/messageActions.ts`,
`components/chat/latestMessageCommands.ts`. They are the migration's natural seams.

### Inventory

Build: **JSX** items in the component, **Model** a local or shared item list, **Registry** the
contribution path. "Contributable" is today's answer.

| Surface | Where | Build | Items and handlers | Context | Contributable |
|---|---|---|---|---|---|
| Session row right-click and "..." | `shell/Sidebar.tsx:7284-7442` (menus), body `ConversationMenuItems` `:5560-6063`, draft row `:7063-7079`; quick pin and archive `:7295-7395`; kanban card `projectHome/ProjectKanbanBoard.tsx` ~609 | JSX, one body for both primitives (`dropdownBundle` `:5532`, `contextBundle` `:5540`) | Add nested agent, Open in grid (sub), Pin, Share, Fork, Rename, Mute, Mark unread/read, Create automation, Move up/down, Move to project (sub), Stop, Archive, Delete or Leave: closures (`onTogglePinned`, `setShareOpen`, `runArchive`, ...) | conversation, owner, archived, project, canStop | No |
| Project row right-click and "..." | `Sidebar.tsx:2521-2538`, `ProjectFolderMenu` `:8099-8137`, body `:7655-7733`; row actions `:7613-7650` | JSX | New session, Rename, Project settings, Move (sub), Delete: `actions.*` | projectId, name | No |
| Projects section header | `ProjectHeaderActions` `Sidebar.tsx:5034-5143` | JSX | Sort by (radio), Expand all, Collapse all, Select sessions; New project (dialog) | none | No |
| Session filter menu | `SessionFilterMenu` `Sidebar.tsx:4879-5030` | JSX | Filters and sort | none | No |
| Side bar navigation | `Sidebar.tsx:1745-1800, 1917-2028` | Registry (`sidebar/navigation`) | Built-in rows and contributed command rows; right-click shows and hides entries | `when` keys | Yes (commands only, no args) |
| Sessions "+" | `Sidebar.tsx:3915-3945` | JSX link | New session | none | No |
| Chat header session menu | `shell/HeaderConversationMenu.tsx:115`, items ~358-536, trigger `:562`; ⌘K mirror `shell/openSessionCommands.ts:89-218` | JSX plus a command switch (`runOpenSessionCommand` `:296-330`) | Add nested agent, Pin, Share, Fork, Export, Agent info, Rename, Mark unread, Create automation, Move to project (sub), Archive, Delete; archived sessions flip Archive | conversation, cwd, project, canShare, canFork | No |
| Chat header other | `shell/ChatHeader.tsx:364`; header items `:718` (`SessionHeaderItems.tsx:17-41`); fork kebab `:739-764`; phone menu `:768-857` with folded views `:416-547`; Share ~870-895; `HeaderProjectTag.tsx:50-83`; `ViewModeToggle.tsx` | JSX | Fork, Share, Agent info, view mode, the phone menu's views | session | Text chips only (`createSessionHeaderItem`, no command) |
| Message hover actions | `components/chat/chatBubbleParts.tsx:1446-1484` (user), `:1700-1745` (assistant); error notice `components/blocks/StatusBlocks.tsx:250, 383-498`; ⌘K `components/chat/TranscriptPaletteCommands.tsx:56-125` | JSX (`MessageAction` buttons, `components/ai-elements/message.tsx:107`) | Copy, Edit and resend, Copy link; Copy, Fork from here, Copy link; Retry, Fork | responseId, itemId, lifecycle | No; no message context menu exists |
| Selection popup | `components/chat/SelectionPopup.tsx:7`, used `pages/ChatPage.tsx:1929`, `components/chat/SideChatPane.tsx:689` | JSX | Reply, Ask in side chat | selection | No |
| Code block actions | `components/ai-elements/message.tsx:379, 583, 630, 649, 683-715`; file link menu `components/blocks/ChatMarkdown.tsx:571` | JSX overlay buttons | Copy, Wrap, Open in a new shell (`ShellCommandContext`, `shell/AppShell.tsx:2842-2860`), Download; file link Copy path | code, language | No |
| Composer "+" | `components/composer/ComposerAddMenu.tsx:167-374` (callers `pages/ChatPage.tsx:4799`, `shell/NewChatDialog.tsx:7824`, `SideChatPane.tsx:1666`) | Model (`composerAddActions.ts`) plus JSX | Attach, Side chat, Run a workflow, Goal, Plan mode, Work in a project | session, plan/goal state | No |
| Composer pickers | Permission `components/composer/ComposerControls.tsx:233-342`; harness and model `HarnessPicker.tsx:192-673`, `ComposerConfigSections.tsx:48-270`, `HarnessMenuRow.tsx:37`; `RunWorkflowMenu.tsx:70-107`; `HarnessConfigControls.tsx:68, 239` (Select) | Data pickers | Harness, model, effort, permission, workflow | session | No |
| Slash and mention | `components/SlashCommandMenu.tsx:29-44, 744`; `components/FileMentionMenu.tsx:76, 108` | Constant map plus skills; listbox | 13 slash commands, skills; files | query, cwd | No |
| File tree row | `shell/fileCommands/useFileCommandMenu.tsx:27-111`, `shell/fileTree/FilesTree.tsx:156, 512-528`, `shell/fileTreeRows.tsx:114-196` | Model (`fileCommands/model.ts`), run through `fileActionStore.ts` | Open, Open in new tab, Open folder as root, Open on code host, Copy path, Copy relative path, Copy previous path, Copy link, Reveal, Open in editors | `FileCommandTarget` (path, directory, hostId, conversationId, ...) | No |
| Open In | `shell/OpenInMenu.tsx:34, 78, 137`; file viewer `shell/FileViewer.tsx:1702, 2042` | Model (`CODE_EDITORS`) | Code editors, Reveal | path | Built-in only (`omnigent.openIn` in `view/title`) |
| Extension tree rows | `shell/extensionViews/ExtensionRailView.tsx` (row actions); `TreeItem.contextValue` parsed (`vscodeExtensions/treeView.ts:228`) but unused | Host row actions for resource rows | Copy, download, reveal | the item | No (`view/item/context` missing) |
| Diff review | File header `components/diff-review/DiffReview.tsx:2785` (used `:1912`), folder `DiffReviewTree.tsx:481-525`, base `DiffReviewBaseMenu.tsx:50-123`, toolbar `DiffReviewToolbar.tsx:154-181, 310-343`; sources `shell/ChangesReview.tsx:709-735`, `shell/PullRequestFileActions.tsx:17` | Host-injected `fileActions(file)` lists (`diffReviewFileAction.ts`) | Copy paths, Open in new tab, Open on code host, Open in editor, Reveal, View file, Mark viewed; folder Collapse, Copy; base; view options | file, folder, line | No; **no hunk actions exist** (`renderGutterUtility` is the only line hook) |
| Workspace tabs | `shell/workspaceTabs/WorkspaceStripTab.tsx:242-290`, items `shell/workspaceSidebar/useWorkspaceSidebarTabActions.ts:217-289` | Model (`workspaceCommands/model.ts`) | Close, Close others, Pin, Move left/right, Reopen closed | tabId, index, pinned | No |
| New tab "+" | `shell/workspaceTabs/newTabEntries.ts:17-27, 101` | Model | New tab places | none | No |
| Pane strip | `shell/paneStrip/PaneTitleStrip.tsx:421-557` | Model (`paneMenu.ts`) | Split right/down, Maximize, Move pane (sub), Swap, Close | pane key | No |
| Terminal | `shell/TerminalSplitControls.tsx:124-220`, `shell/NewTerminalButton.tsx:135-181`; xterm `components/blocks/TerminalView.tsx` has no menu | JSX | Split with a shell, New shell, Close | shell, conversation | No |
| Rail and activity bar menus | `shell/RailTabStripMenu.tsx:25-83`, `shell/ActivityBar.tsx:126-199`, `shell/ViewContainerViews.tsx:306-398`, `shell/viewMoves.tsx` | JSX (layout stage) | Views checklist, Hide, Move View..., Reset Location | view | No (host-owned) |
| Account menu | `shell/SidebarServerPicker.tsx:112, 217-387`; title bar `shell/TitleBar.tsx:160` | JSX | Settings, Managed servers, Recents, Add server, Sign out | server, user | No |
| Settings sidebar | `shell/settingsNav.tsx:42-80, 109-190, 262-286` | Literal list, flag-gated | Sections | flags | No (settings are `contributes.configuration` keys, not sections) |
| Command Palette | `shell/QuickPickCommandPalette.tsx:87`, legacy `shell/CommandPalette.tsx:86` (flag `quick_pick_palette`, `shell/AppShellOverlays.tsx:77-79`); about 30 `usePaletteCommands` sources | Registry of host rows | Every host command | per mount (`mountedSourceKey`) | No |
| Empty states | New session landing `shell/NewChatDialog.tsx:2320-2379`; transcript `components/chat/Transcript.tsx:464-475`; side chat `SideChatPane.tsx:646-648`; views `ExtensionRailView.tsx:469-480` | JSX; `viewsWelcome` for extension views | Buttons, command links | none | Extension views only |
| Toast actions | `shell/archiveUndoToast.tsx:120-121`, `shell/unpinUndoToast.tsx:64-70`, `shell/cloneRequests.ts:82`, `store/sandboxResume.ts:76`, `workbench/layoutCommands.ts:56` | Inline closures | Undo, View archived, Open, Retry | none | No |
| Title bar | `shell/TitleBar.tsx:62-332`, `workbench/titleBar.ts:42-136, 206-344` | Registry | Built-in items, `titleBar/*` command buttons, text items | none | Yes |
| Row menus elsewhere | `components/scheduled/ScheduledTaskRow.tsx:210-300`, `components/workflows/WorkflowRow.tsx:49-105`, `grid/GridWorkspace.tsx:144-198`, `pages/InboxPage.tsx`, `projectHome/ProjectHomeHeader.tsx`, `shell/extensionViews/ViewPlan.tsx:540`, `shell/TableBubbleMenu.tsx`, `components/HostBadge.tsx` | JSX | Run now, Edit, Share, Clone, Pause, Delete; workflow and grid Rename, Delete; ... | row | No |
| Native desktop menu | Out of `web/src`; bridge `lib/nativeBridge.ts:378-426` (`DESKTOP_COMMANDS`) | Native | close, new terminal, archive, pin, fork, tabs, quit | session state | No |

## Findings: VS Code and Theia

VS Code ([contribution points: menus](https://code.visualstudio.com/api/references/contribution-points#contributes.menus),
[when clause contexts](https://code.visualstudio.com/api/references/when-clause-contexts),
[custom layout](https://code.visualstudio.com/docs/configure/custom-layout)):

| Concept | VS Code | Use here |
|---|---|---|
| `contributes.menus` | Keyed by menu id; entry `{ command, alt?, when?, group? }` or `{ submenu, when?, group? }` | Same shape, one generic parser |
| Menu ids | `commandPalette`, `editor/title`, `editor/title/context`, `editor/title/run`, `editor/context`, `editor/lineNumber/context`, `explorer/context`, `view/title`, `view/item/context`, `viewContainer/title`, `scm/title`, `scm/resourceGroup/context`, `scm/resourceState/context`, `scm/change/title`, `terminal/context`, `terminal/title/context`, `timeline/item/context`, `comments/*`, `webview/context`, `accounts/context`, `file/newFile`, `extension/context`, `testing/item/context`, `notebook/*` | Same ids where Omnigent has the surface; Omnigent ids otherwise |
| `group` | `navigation` is first in context menus and is the inline group of title bars (`editor/title`, `view/title`); other groups go to the "..." overflow, sorted by name (`1_modification`, `9_cutcopypaste`), separated; `inline` in `view/item/context` draws on the row | Same rules |
| `@order` | `group@N` orders inside a group | Same |
| Submenus | `contributes.submenus: [{ id, label, icon? }]`, referenced by `{ submenu }`; nestable | Same; depth capped |
| `alt` | A second command shown while Alt is held (title bars, context menus) | Same |
| `when` per menu | Context keys per surface: `resourceScheme`, `resourceFilename`, `resourceExtname`, `explorerResourceIsFolder`, `editorLangId`, `view`, `viewItem` (`TreeItem.contextValue`), `scmProvider`, `scmResourceGroup`, `webviewId`, `webviewSection`, `terminalFocus` | Same idea: each menu documents its keys |
| Args | The surface's resource: `explorer/context` gets `(uri, selectedUris)`, `editor/title` the editor's `uri`, `view/item/context` the tree element, `scm/resourceState/context` the resource states, `webview/context` the merged `data-vscode-context` JSON | Plain-data args per menu (no `Uri`) |
| `commandPalette` | Every contributed command appears; `{ command, when: "false" }` hides it, any `when` gates it; `category` prefixes the title; `enablement` disables everywhere | Same |
| Webviews | `data-vscode-context` on elements (`webviewSection`, `preventDefaultContextMenuItems`) | No webviews: host-drawn surfaces supply their own keys and args |
| Keybinding labels | A menu row shows the command's first keybinding whose `when` holds | Same, over app shortcuts and extension keybindings |
| Hiding built-ins | Right-click a toolbar item (title bars, command center, layout controls): "Hide 'X'"; "Reset Menu"; "View: Reset All Menus"; stored as `menu.hiddenCommands` in storage, not settings. Context menu items can't be hidden; there is no user `menus.json` (the closest is `keybindings.json`'s `-command` removal) | Hide everywhere; defaults in the settings JSON (decision 7) |
| Layout and menu settings | "Customize Layout" (`workbench.action.customizeLayout`: parts, positions, modes), `workbench.editor.editorActionsLocation` (`default`, `titleBar`, `hidden`), `window.menuBarVisibility`, `window.commandCenter`, `workbench.layoutControl.enabled`/`.type` | Layout stage has the parts; this stage adds the actions location |
| Products | No product-level menu control (policies cover settings only) | Omnigent's `product.menus` (beyond VS Code) |

Theia ([commands, keybindings and menus](https://theia-ide.org/docs/commands_keybindings/)):
`MenuContribution.registerMenus(registry: MenuModelRegistry)`; a menu path is a string array
whose segments are groups (`[...MAIN_MENU_BAR, "2_edit"]`); `registerMenuAction(path, { commandId,
label?, icon?, order?, when?, alt? })`, `registerSubmenu(path, label)`, `registerMenuNode(path,
node)` for a custom node, and **`unregisterMenuAction` / `unregisterMenuNode`**, which is how a
product removes or replaces a built-in item. Toolbars are `TabBarToolbarContribution`
(`{ id, command, when, priority, group }`) and may be React (`render()`).
`ContextMenuRenderer.render({ menuPath, anchor, args, context })` passes args. What to take: the
trusted tier is code that registers, unregisters and renders nodes on the same model the plain
data fills; ids are paths of groups.

## Goals

1. One menu registry and one renderer for every menu, toolbar and action strip in the app, keyed by
   menu id, the four menus of today included.
2. VS Code's entry model: `group`, `@order`, `navigation` and `inline`, submenus, `when`, `alt`,
   args per menu, keybinding labels, the "..." overflow, `commandPalette`.
3. Every built-in item is a contribution of a built-in extension (manifest entries naming
   built-in commands), so the user can hide it and a product can hide, replace or lock it.
4. Extension commands in the Command Palette, gated by `commandPalette` `when`.
5. User hiding (gestures in layout state) and defaults and order (settings JSON).
6. Product control (`product.menus`) through the three product sources, per mount, never failing
   open.
7. A trusted-tier seam: host-drawn React items and dynamic submenus, built-ins only for now.
8. Today's look is the default: each migration milestone is 0 px on the harness, and the menus'
   item lists dump identical.

## Non-goals

- The trusted React tier for products (this plan reserves its seam only), product config beyond
  `product.menus`, App Builder.
- Slash commands and the composer's data pickers (harness, model, effort, permission): pickers of
  data, not command menus (decision 14). The composer's "+" menu and toolbar are in scope.
- New actions where none exist (hunk actions, an xterm context menu's items beyond copy and
  paste): menu ids are reserved or added empty.
- The native desktop app menu (ids reserved, decision 17).
- Host-owned layout menus (activity bar, tab strip views checklist, Move View): they manage
  views, not commands, and stay host-drawn.
- A Settings UI for menus.

## Proposed model

### Registry and entries

`web/src/menus/` (VS Code's `MenuRegistry` and `IMenuService`): `registerMenu(id, descriptor)`
(host only: the menu's context keys, args shape, whether it is a toolbar, its built-in groups),
`appendMenuItems(menuId, items, extensionId)` from `contributes.menus`, `getMenuActions(menuId,
context)` returning groups of resolved actions, `onDidChangeMenu(menuId)`. The four menus of today
move onto it; their behaviour stays.

| Field | Meaning | Notes |
|---|---|---|
| `command` | The command | Title, icon, `enablement` and `toggled` from the command's owner |
| `submenu` | A `contributes.submenus` id | Instead of `command`; nesting to depth 3 |
| `alt` | Command shown while Alt is held | Owner rules as `command` |
| `when` | Shown while it holds | Evaluated with the menu's context keys |
| `group` | `name@order` | `navigation` first; `inline` on rows; others sorted by name, separated |
| `tooltip`, `tone` | Omnigent's, as today | `tone` (warning, destructive) built-ins only for `destructive` |
| `builtInItem`, `builtInSubmenu` | A host-drawn item or dynamic submenu | Built-ins only (trusted seam) |

Commands gain VS Code's `category` and `enablement` (a `when` that disables the command in every
menu, the palette and keybindings).

Sorting is VS Code's: groups by name with `navigation` first, items by `@order` then title. A
toolbar menu (a descriptor flag) draws `navigation` inline and the rest in a "..." overflow;
`view/title`'s and `viewContainer/title`'s dropped groups become that overflow.

### Menu ids

VS Code ids where Omnigent has the surface; Omnigent ids in the same `area/place` style
(decision 1), documented in `vscode_style_extensions.md` with their context keys and args.

| Menu id | Surface | Kind | Context keys | Args | VS Code |
|---|---|---|---|---|---|
| `commandPalette` | ⌘K rows of contributed commands | gate | window keys | none | same |
| `view/title` (exists) | View title bars | toolbar | `view` | none | same |
| `view/item/context` | Tree view rows (right-click; `inline` on the row) | context, inline | `view`, `viewItem` | `{ view, item: { id, label, contextValue, resourceUri } }` | same |
| `viewContainer/title` (exists) | Container title bars | toolbar | `viewContainer` | none | same |
| `explorer/context` | Files tree rows | context | `explorerResourceIsFolder`, `resourceFilename`, `resourceExtname`, `resourcePath` | `{ path, isDirectory, relativePath }`, selection list | same |
| `editor/title` | File viewer title bar | toolbar | `resourceFilename`, `resourceExtname`, `editorLangId` | `{ path }` | same |
| `editor/context` | File viewer right-click | context | as above, `editorHasSelection` | `{ path, selection? }` | same |
| `editor/title/context` | Workspace strip tab right-click | context | `omnigent.tabKind`, `omnigent.tabPinned` | `{ tabId }` | same (editor tabs) |
| `scm/resourceState/context` | Changes and pull request file rows, diff review file header | context, inline | `scmResourceState` (A, M, D), `omnigent.diffSource` (`changes`, `pullRequest`) | `{ path, previousPath?, change }` | same |
| `scm/resourceFolder/context` | Diff review folder rows | context | `omnigent.diffSource` | `{ path }` | same |
| `scm/title` | Diff review toolbar | toolbar | `omnigent.diffSource` | none | same |
| `scm/change/title` | Reserved: hunk actions | toolbar | | `{ path, hunk }` | same |
| `terminal/context` | xterm right-click (new: Copy, Paste, Clear) | context | `terminalFocus` | `{ terminalId }` | same |
| `terminal/title/context` | Pane strip right-click | context | `omnigent.paneKind` | `{ paneId }` | same |
| `accounts/context` | Account menu | context | `omnigent.signedIn` | none | same |
| `file/newFile` analogue: `session/new` | Sessions "+" (a split button once it has entries) | context | | `{ projectId? }` | `file/newFile` |
| `session/context` | Session row right-click and "...", chat header session menu, kanban card (decision 2) | context, inline | `omnigent.sessionMenu` (`sidebar`, `header`, `kanban`), `omnigent.session.archived`, `.pinned`, `.owner`, `.running` | `{ sessionId }` | (none) |
| `project/context` | Project row right-click and "..." | context, inline | `omnigent.project.custom` | `{ projectId }` | (none) |
| `conversations/section/title` | Sessions and Projects section headers | toolbar | `omnigent.conversationSection` | none | (none) |
| `chat/title` | Chat header actions (the layout plan's Chat / Terminal toggle seat) | toolbar | `omnigent.session.*`, `omnigent.layoutWidth` | `{ sessionId }` | (none) |
| `chat/message/title` | Message hover toolbar | toolbar | `chatMessageRole` (`user`, `assistant`, `error`), `chatMessagePending` | `{ sessionId, messageId, role }` | (none) |
| `chat/message/context` | Message right-click (new) | context | as above | as above | (none) |
| `chat/codeBlock/title` | Code block action strip | toolbar | `chatCodeBlockLanguage` | `{ sessionId, messageId, language, code }` (decision 6) | (none) |
| `chat/selection` | Selection popup | toolbar | | `{ sessionId, text }` (decision 6) | (none) |
| `chat/input` | Composer toolbar | toolbar | `omnigent.chatInput.planActive`, `.goalActive` | `{ sessionId? }` | (none) |
| `chat/input/add` | Composer "+" menu | context | as above | as above | (none) |
| `workspace/newTab` | New tab "+" | context | | none | (none) |
| `automation/context`, `workflow/context`, `grid/context`, `inbox/item/context` | Row menus | context, inline | each row's state | `{ automationId }`, `{ workflowId }`, `{ gridId }`, `{ itemId }` | (none) |
| `sidebar/navigation` (exists), `titleBar/*` (exists) | As the layout stage | | | | (none) |
| `menuBar/*` | Reserved: the desktop app's menu | | | | VS Code's internal menubar |

The settings sidebar is not a menu: its sections become a built-in data list a product can hide
(decision 15). Empty states use `contributes.viewsWelcome` on host view ids
(`omnigent.chat.empty`, `omnigent.newSession.landing`, `omnigent.sideChat.empty`). Toasts get
VS Code's items, not a menu id (decision 16).

### Args and context

- Each menu's descriptor names its args; the renderer passes a frozen plain-data copy as the
  command's first argument, VS Code style, and the context keys as overrides of that evaluation
  only (as `view` today), never written to the window's store.
- Ids, not content: a session menu passes `sessionId`; an extension reads more through the API
  it already has. Content only where the user's gesture is the content (decision 6).
- Built-in commands take the same args from every menu, the palette and `executeCommand`:
  `omnigent.session.pin({ sessionId })` works from the row, the header and an extension. A
  destructive built-in (`delete`, `archive`, `stop`) keeps its host confirmation whoever calls it;
  the server's authorization is unchanged.

### Built-in items as contributions

Each surface's items move to a built-in extension's manifest, naming built-in commands, with
today's order expressed as `group@order`:

| Built-in extension | Menus | Commands (examples) |
|---|---|---|
| `omnigent.sessions` (new) | `session/context`, `session/new`, `chat/title` | `omnigent.session.pin`, `.share`, `.fork`, `.rename`, `.mute`, `.markUnread`, `.markRead`, `.createAutomation`, `.moveUp`, `.moveDown`, `.stop`, `.archive`, `.delete`, `.leave`, `.export`, `.addNestedAgent`, `.showAgentInfo`; dynamic `omnigent.session.moveToProject`, `omnigent.session.openInGrid` |
| `omnigent.projects` (new) | `project/context`, `conversations/section/title` | `omnigent.project.newSession`, `.rename`, `.openSettings`, `.delete`, `.sortBy`, `.expandAll`, `.collapseAll`, `.selectSessions`; dynamic `omnigent.project.move` |
| `omnigent.chat` (new) | `chat/message/*`, `chat/codeBlock/title`, `chat/selection`, `chat/input`, `chat/input/add` | `omnigent.chat.copyMessage`, `.editAndResend`, `.copyMessageLink`, `.forkFromHere`, `.retry`, `.copyCode`, `.toggleCodeWrap`, `.runCodeInShell`, `.reply`, `.askInSideChat`, `.attach`, `.newSideChat`, `.runWorkflow`, `.setGoal`, `.togglePlanMode`, `.workInProject` |
| `omnigent.files` (exists) | `explorer/context`, `editor/title`, `editor/context` | the `fileCommands/model.ts` ids as `omnigent.files.*` |
| `omnigent.changes` (exists) | `scm/*` | the review file actions as `omnigent.scm.*` |
| `omnigent.workspace` (new) | `editor/title/context`, `workspace/newTab`, `terminal/*` | tab, pane and shell commands from `workspaceCommands/model.ts` and `paneMenu.ts` |
| `omnigent.accounts` (new) | `accounts/context` | `omnigent.openSettings`, `omnigent.addServer`, `omnigent.signOut`; dynamic `omnigent.switchServer` |
| `omnigent.automations`, `omnigent.workflows`, `omnigent.grid`, `omnigent.inbox` | their row menus | row commands |

The per-feature model modules stay the source of truth for availability: a built-in command's
`enablement` and the menu's `when` read context keys each surface sets from its model, so ⌘K and
the menu still agree.

### User hiding and order

Follows the layout precedent (intent in settings, gestures in layout state, L11's
`workbench.view.defaultHidden` with stored choices over it):

| Kind | Store | Shape |
|---|---|---|
| Defaults and order (intent) | Settings JSON: `workbench.menus.customizations` (built-in `omnigent.workbench`, `defaultOverridable`) | `{ "<menuId>": { "hidden"?: ["<command or submenu id>" or "*" pattern], "order"?: { "<id>": "group@order" } } }` |
| Hide and show gestures | Layout state `workbench.menus.hidden` | `{ "<menuId>": { "<id>": true or false } }` over the setting's defaults |

- A toolbar button's right-click has "Hide '<title>'"; a context menu ends with "Customize
  menu...", a checklist quick pick of its items (decision 20); toolbars and menus get "Reset
  Menu"; "View: Reset All Menus" (`workbench.action.resetMenus`)
  clears the layout state slot; View: Reset Layout leaves menus alone (VS Code's split).
- Order only through the setting (no drag in menus, as VS Code).
- `configurationDefaults` can hide and order (DevHub's way), the user's settings over them.

### Product control

`product.menus` beside `product.layout`, same three sources (embed prop over `web/product.json`
over the server's `product: menus:` on `/v1/info`), per mount (layout L10):

```ts
interface ProductMenusConfig {
  hidden?: string[];            // "<menuId>:<id>" or patterns; removal from that menu
  hiddenCommands?: string[];    // ids or patterns: gone from every menu, ⌘K and keybindings, and refuse to run
  replace?: Record<string, string>; // built-in command -> product command, in place, everywhere
  order?: Record<string, Record<string, string>>; // menu -> id -> "group@order"
  contributions?: Record<string, { allow?: string[]; deny?: string[] }>; // per menu: extension id patterns
  lock?: boolean | string[];    // true or menu ids: no user hiding or reorder, the user's choices not read
}
```

- Layering per item: built-in or contributed entry < `configurationDefaults` < product `order`
  and defaults < the user's setting < the user's gestures < product `hidden`, `hiddenCommands`,
  `replace`, `lock`.
- Never fail open: a malformed `lock` locks every menu; a malformed `hiddenCommands` or
  `contributions.deny` entry that can't be parsed is reported and its menu takes no third-party
  contributions (closed), not "allow all"; budgets shared by server and web, over budget the
  remaining entries are treated as locks. The union of the sources applies for `hidden*`, as
  the layout's.
- A replaced command keeps the built-in's place and keybinding; its title, icon and `when` are
  the replacement's owner's; a replacement that isn't registered hides the item (closed).
- `hiddenCommands` also covers built-in commands an extension would run through
  `executeCommand`.

### Trusted-tier seam

- `builtInItem` (a host React control in a menu or toolbar: the Chat / Terminal segmented toggle,
  a model chip) and `builtInSubmenu` (a dynamic list: projects, grids, servers, editors), from an
  allowlisted host registry, built-ins only, as `builtInView` and the title bar's `builtInItem`.
- The trusted stage opens the same registry to products: Theia's `registerMenuNode` (a React
  node at a menu path) and `unregisterMenuAction` map to the registry's append, `replace` and
  `hidden`, so no second model.
- Third-party extensions stay plain data; a plain-data dynamic submenu provider for them is a
  later option (decision 13).

### Keybinding labels

One resolver, `lookupPrimaryKeybinding(command, context)`: the app's shortcut registry
(`lib/shortcuts/registry.ts`, a built-in command maps to its `ShortcutId`), then extension
keybindings, first whose `when` holds; drawn with `ContextMenuShortcut`/`DropdownMenuShortcut`
and in tooltips (`KeyboardShortcutTooltip`). Titles can't carry their own shortcut text (it is
drawn from the resolver only).

### Command Palette

- Every contributed command gets a ⌘K row (`Category: Title`, its icon, its keybinding) unless
  `commandPalette` hides it (`when`, `"false"`); `enablement` greys it with the host's
  "unavailable" state. A command that needs a menu's args (it declares
  `"omnigent.requiresArgs": true`, or VS Code's convention of being hidden from the palette) is
  hidden automatically.
- Rows from built-in commands keep today's palette registrations; the palette reads both stores.
  Per mount as today (`mountedSourceKey`).

### Embed and per mount

- The registry and the extension host stay one per window; evaluation, hidden gestures (the
  mount's layout state), `workbench.menus.customizations` (settings, per window as today) and
  `product.menus` (per mount) are each mount's.
- A menu runs its command in the mount that drew it: the mount activates first (layout L10), so
  window-level commands and the args agree.
- Menus portal into the mount's overlay root (`useOverlayRoot`).

### Security rules

| # | Rule |
|---|---|
| 1 | Title, icon, tooltip, `enablement` and `toggled` come from the command's owner (the longest loaded extension id it starts with); another extension's entry draws the owner's title and no tooltip of its own; host commands (`omnigent.*`, `workbench.*`) keep the host's |
| 2 | One entry per command per menu: the owner's entry wins, then a built-in's, never the first registered |
| 3 | In host menus a third party's entries draw after the built-in groups, in groups of their own, never interleaved (decision 4); a product may place them with `order` |
| 4 | Provenance: a third party's entry in a host menu shows its extension's name (decision 5) |
| 5 | Titles are plain text, single line, at most 80 characters, `\p{Cf}` and bidi controls stripped, no `$(icon)`, no markdown; tooltips plain text; a title equal (case-folded, confusables skeleton) to a built-in item's title in the same menu is refused |
| 6 | `tone: "destructive"` and the `navigation` group of host toolbars are for built-ins; a third party has at most 2 inline items per toolbar |
| 7 | Caps: 20 entries per extension per menu, 200 per menu, 10 submenus per extension, depth 3, 1024-character `when` (existing) |
| 8 | Ids: submenu ids start with the extension id; menu ids are host-registered; `omnigent.*` and `workbench.*` command ids reserved (existing) |
| 9 | Context keys: an extension's `setContext` may only write keys under its own id; host keys (`config.*`, `omnigent.*`, `view*`, the menus' keys) are refused (a deviation from VS Code: today an extension can overwrite or delete them, `contextKeys.ts:45-75`) |
| 10 | Args are frozen JSON copies of the documented shape; built-in commands validate them; destructive built-ins confirm in host UI whoever calls them |
| 11 | Welcome contents and toast messages: the existing settings markdown sanitizer (no images, HTML or reference definitions), command links only to registered commands; toast action titles as menu titles |
| 12 | Product `hidden`, `hiddenCommands` and `lock` fail closed (above) |
| 13 | Everything per mount: a menu opened in one embed never runs in another's context |

## Migration of each surface

| Today | Becomes | Milestone |
|---|---|---|
| `view/title`, `viewContainer/title`, `sidebar/navigation`, `titleBar/*` arrays | Menus of the registry; dropped groups become the "..." overflow; navigation's built-in `when` on the context key store | MN1, MN2 |
| ⌘K: host rows only | Plus contributed commands, `commandPalette` | MN4 |
| Session row, kebab, header menu, kanban card (`ConversationMenuItems`, `HeaderConversationMenu`) | `session/context` from `omnigent.sessions`; the two lists unify, places by `omnigent.sessionMenu` | MN5 |
| Project row, section header, filter | `project/context`, `conversations/section/title`; the filter stays host (a picker) | MN5 |
| Sessions "+" | `session/new` (a plain button while empty) | MN5 |
| Chat header buttons, phone menu | `chat/title` (the phone menu folds its items as the title bar's do) | MN7 |
| Message hover, error notice, selection popup, code block strip | `chat/message/title`, new `chat/message/context`, `chat/selection`, `chat/codeBlock/title` | MN7 |
| Composer "+" and toolbar | `chat/input/add`, `chat/input` (`composerAddActions.ts` as `enablement`) | MN8 |
| File row menu, Open In, file viewer, tree rows | `explorer/context`, `editor/title`, `editor/context`, `view/item/context` (`viewItem`, `inline`); Open In a `builtInSubmenu` | MN9 |
| Diff review file, folder, toolbar | `scm/resourceState/context`, `scm/resourceFolder/context`, `scm/title`; the sources' `fileActions` become `when` on `omnigent.diffSource` | MN10 |
| Workspace tabs, new tab, pane strip, terminal | `editor/title/context`, `workspace/newTab`, `terminal/title/context`, `terminal/context` | MN10 |
| Account menu, row menus (automations, workflows, grids, inbox) | `accounts/context` (servers as `builtInSubmenu`), `automation/context`, `workflow/context`, `grid/context`, `inbox/item/context` | MN11 |
| Settings sidebar | Built-in data list, product-hideable | MN11 |
| Empty states, toasts | `viewsWelcome` on host view ids; host toast actions as commands; `showInformationMessage(message, ...items)`, `showWarningMessage` | MN12 |

## Milestones

Each is one or more commits on a worktree of `extensible-ui`, landed as in the layout plan, with
review fixes in the same commit and an independent validation after MN4, MN8 and MN12 (each
finding fixed with a test, in its own commit). "0 px" means `verify.sh --screens --token-dump
--embed --compare verify/baselines` with the theming plan's tolerances; "menus identical" means
the MN0 menu dump.

| # | Milestone | Verified by |
|---|---|---|
| MN0 | Harness (`my-extensions/dev/verify/menus.py`, `--only-menus`): a menu dump `menus.json` (per screen and menu: items, groups, order, disabled, checked, shortcut labels, hooks) by opening each menu of the inventory on the mock backend; new screens with menus open (session row, header menu, project row, composer "+", message hover, code block, file row, tab, pane, account) in default light and dark; the fixture extension `verify/fixtures/menus-fixture` (`acme.menus-fixture`); baselines of today | Two runs: 0 px and identical dumps |
| MN1 | Registry (`web/src/menus/`): generic parse of any registered menu id, `alt`, `group@order`, nested submenus, `category`, `enablement`; owner and dedupe rules 1, 2, 7, 8; the four menus moved onto it; navigation's built-in `when` on the context key store; `setContext` ownership (rule 9) | Vitest: parse, sort, dedupe, caps, ownership, the old menus' tests unchanged; 0 px, menus identical |
| MN2 | Renderer: one `MenuView` for both Radix primitives (the `MenuComponents` bundle pattern of `Sidebar.tsx`), a toolbar with "..." overflow, `alt` on Alt, args and per-call context; keybinding resolver and labels; `data-menu`/`data-menu-item` hooks (`theme_hooks.md`) | Vitest and RTL; `--only-menus`: a fixture overflow entry in `view/title`, an `alt`, a keybinding label; 0 px |
| MN3 | User hiding and order: `workbench.menus.customizations`, layout state `workbench.menus.hidden`, Hide, Customize menu..., Reset Menu, View: Reset All Menus | Vitest; `--only-menus`: hide kept across a reload, reset, a setting's order; 0 px |
| MN4 | Command Palette: contributed commands, `commandPalette`, `category`, `enablement`, automatic hiding of arg-only commands, both palettes | Vitest; `--only-menus`: the fixture's command in ⌘K with its keybinding, hidden by `when`; 0 px. Then validation 1 |
| MN5 | Sessions and projects: `omnigent.sessions`, `omnigent.projects`, `session/context`, `project/context`, `conversations/section/title`, `session/new`; built-in commands with args; `builtInSubmenu` (move to project, open in grid) | Vitest for each command; the existing `tests/e2e_ui/sessions/test_sidebar_context_menu.py`, `test_header_session_menu.py`, `test_archived_session_header_menu.py`, `test_export_chat_menu.py` sources unchanged; 0 px, menus identical; `--only-menus`: a fixture entry in the row and header menus receiving `{ sessionId }` |
| MN6 | Product menus: `product.menus` from the three sources, server block and `/v1/info` (`openapi.json`), per mount, layering, fail-closed rules, budgets | Vitest, `embed.test.tsx`; pytest `test_server_config.py`, `test_openapi_drift.py`; `--only-menus`: a product hides Share everywhere (menus, ⌘K, keybinding), replaces Fork, locks `session/context`, denies the fixture in one menu, two embeds with two policies |
| MN7 | Chat: `omnigent.chat`; `chat/title`, `chat/message/title`, `chat/message/context`, `chat/codeBlock/title`, `chat/selection`; phone fold | Vitest and RTL; 0 px, menus identical; `--only-menus`: fixture entries with args |
| MN8 | Composer: `chat/input`, `chat/input/add` | `ComposerAddMenu.test.tsx` and `useComposerAddPaletteCommands.test.tsx` unchanged; 0 px. Then validation 2 |
| MN9 | Files and trees: `explorer/context`, `editor/title`, `editor/context`, `view/item/context` with `viewItem` and `inline`; Open In as `builtInSubmenu` | Vitest; `tests/browser_ui/files/test_open_in_menu.py` source unchanged; 0 px; `--only-menus`: a fixture tree's row action by `contextValue` |
| MN10 | Diff review, tabs, panes, terminal: `scm/*`, `editor/title/context`, `workspace/newTab`, `terminal/title/context`, `terminal/context` (Copy, Paste, Clear: a new menu, its own baseline) | Vitest; 0 px except the new terminal menu screen |
| MN11 | Account, row menus, settings sidebar list | Vitest; 0 px, menus identical |
| MN12 | Empty states and toasts: host `viewsWelcome` ids; `showInformationMessage`/`showWarningMessage`/`showErrorMessage` with items (VS Code's promise of the chosen item), host toast actions as commands | Vitest; 0 px; `--only-menus`: a fixture toast's button and a welcome on the new session landing. Then validation 3 |
| MN13 | API docs and typings: the mapping rows, every menu's keys and args in `vscode_style_extensions.md`, vendored `omnigent.d.ts`, `theme_hooks.md` | Typings check; docs review |
| MN14 | DevHub's menus in `my-extensions/dev`: the Chat / Terminal toggle in `chat/title` (a `builtInItem` until the trusted tier, or two toggled commands), the design's hidden items through `configurationDefaults` | `--only-menus` DevHub checks; `devhub-*` baselines; side-by-sides |

Order: MN0 > MN1 > MN2 > MN3 > MN4 > MN5 > MN6; MN7 to MN12 need MN6 (each adds product checks
for its menus) and are otherwise independent; MN13 follows each; MN14 needs MN7.

## Risks

| Risk | Mitigation |
|---|---|
| `Sidebar.tsx` (8900 lines) and `pages/ChatPage.tsx` (5400) hold the largest menus | Move item lists, not markup, first (the bundle pattern already shares one body); 0 px and the menu dump per commit |
| Availability logic lives in models and closures (`canStop`, `isOwner`, flags) | Each surface sets context keys from its model; the models stay the source; tests compare the menu dump |
| Duplicated lists today (sidebar vs header session menus) differ on purpose in places | One menu with `omnigent.sessionMenu` keys reproduces each place's list; the dump proves it |
| Args to built-in commands widen what an extension can do (`delete` any session by id) | Host confirmation for destructive commands, server authorization unchanged, `hiddenCommands` for products |
| Context key ownership (rule 9) breaks an extension that sets host keys | None of the vendored ones do; a warning names the key |
| Third-party items crowding host menus | Rules 3 to 7, product `contributions` |
| Radix menu focus and portals per mount | The renderer is the one place; the existing `useOverlayRoot`; the e2e menu tests' sources kept |
| ⌘K growing with every contributed command | `commandPalette` `when`, automatic hiding of arg-only commands, the existing search |
| Keybinding labels disagreeing with what a key does | One resolver used by dispatch and labels |
| Scope creep into pickers and slash commands | Non-goals; decision 14 |

## Decisions for the user

1. **Omnigent-only menu ids.** (a) VS Code's style without a prefix (`session/context`,
   `chat/message/title`), documented as Omnigent's; (b) prefixed (`omnigent/session/context`).
   Recommend (a): it reads like VS Code's and the host registers every id, so no clash.
2. **One session menu or several.** (a) One `session/context` for the row, its "...", the chat
   header's session menu and the kanban card, with an `omnigent.sessionMenu` key for the place;
   (b) separate ids per place (`session/context`, `session/title`). Recommend (a): one
   contribution reaches every place, as VS Code's `explorer/context` does.
3. **Chat menu ids.** (a) Omnigent `chat/*` ids; (b) VS Code's proposed chat menu ids where
   similar. Recommend (a): VS Code's chat menus are proposed API and keep changing.
4. **Third-party placement in host menus.** (a) After the built-in groups, in their own groups,
   unless a product's `order` places them; (b) free interleaving by `group` (VS Code). Recommend
   (a): it stops a contributed "Delete" next to the real one.
5. **Provenance hint.** (a) A third party's entry in a host menu shows its extension's name
   (secondary text in menus, the tooltip in toolbars); (b) none, as VS Code. Recommend (a).
6. **Content in args.** (a) Ids only, content through the API, except where the gesture is the
   content (`chat/codeBlock/title`'s `code`, `chat/selection`'s `text`); (b) ids only everywhere;
   (c) content everywhere (message text). Recommend (a).
7. **User hiding.** (a) Hide on every menu and toolbar, gestures in layout state, defaults and
   order in `workbench.menus.customizations` in the settings JSON; (b) VS Code's: toolbars only,
   layout state only. Recommend (a): the user asked for full customization, and
   `configurationDefaults` then lets an extension like DevHub hide built-in items.
8. **Reordering.** (a) Only through the setting (`group@order` per item); (b) also drag in
   toolbars. Recommend (a), as VS Code.
9. **Extension commands in ⌘K.** (a) Every contributed command, unless `commandPalette` hides it
   (VS Code); (b) opt in per command. Recommend (a).
10. **Product replace.** (a) `replace` maps a built-in command to a product's in place
    (menus, ⌘K, keybindings); (b) hide and add only. Recommend (a): Theia's unregister and
    register in one step, and a product keeps the built-in's position.
11. **Product lock.** (a) `lock` (all or per menu): no user hiding or order, stored choices not
    read, malformed means locked; (b) no lock. Recommend (a).
12. **Product contribution filter.** (a) `contributions` per menu with `allow`/`deny` extension
    patterns, default allow; (b) none. Recommend (a).
13. **Dynamic submenus.** (a) Host-drawn `builtInSubmenu` kinds, built-ins only (the trusted
    seam); (b) also a plain-data provider API for third parties now. Recommend (a), (b) later.
14. **Slash commands and composer pickers.** (a) Out of scope (data pickers; slash commands are a
    later chat contribution); (b) menus now (`chat/input/slash`). Recommend (a).
15. **Settings sidebar.** (a) A built-in data list a product can hide sections of, no third-party
    sections (settings are the settings JSON); (b) leave it hard-coded. Recommend (a).
16. **Toast actions.** (a) VS Code's `showInformationMessage(message, ...items)` (and warning,
    error), host toast actions as commands, no menu id; (b) a `notification/actions` menu.
    Recommend (a).
17. **Native desktop menu.** (a) Reserve `menuBar/*` only; (b) build it on the registry now.
    Recommend (a).
18. **Hunk actions.** (a) Reserve `scm/change/title` until hunk actions exist; (b) build hunk
    actions in this stage. Recommend (a).
19. **Context key ownership.** (a) Extensions may write only keys under their own id (rule 9,
    a deviation from VS Code); (b) any key, as VS Code and today. Recommend (a): host keys gate
    built-in items and product-visible state.
20. **Customize affordance in context menus.** (a) A "Customize menu..." row at the end of each
    context menu opening a checklist quick pick, plus "Hide" on toolbar buttons' right-click;
    (b) a hover "Hide" on every row. Recommend (a): no change to rows, so 0 px menus.
