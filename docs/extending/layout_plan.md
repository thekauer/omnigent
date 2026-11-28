# Layout plan: workbench parts, view containers, activity bar, title bar (Stage 2)

Approved by the user on 2026-11-27 with every recommended decision (end of this doc). Execute
milestone by milestone. Stage 1 (theming) is
[theming_plan.md](theming_plan.md); the extension API is
[vscode_style_extensions.md](vscode_style_extensions.md); stable selectors are
[theme_hooks.md](theme_hooks.md).

## Status

The durable state to resume from. Update it in the same commit that lands each milestone.

| # | State | Notes |
|---|---|---|
| Plan | Approved | 2026-11-27: all 14 recommended decisions (end of this doc). |
| L0 | Done | Harness (my-extensions `ebc9c42`, `e7a6b26`, `24a4a69`, `dev/verify/screens.py`): every shot also writes its layout to `layout.json` (`<selection>/<screen>`: each part found by today's hooks, `.app-shell`, `.conversations-sidebar`, `[data-slot=main-area]`, `header.chat-header`, the composer, `[data-slot=workspace-panel]`, `.omnigent-app`, plus every `[data-part]` as `part:<id>`, with its box, visibility, hooks and state attributes); `--compare` fails on a changed box, visibility, state or a removed hook and lists added hooks and `part:*` entries as additions (`layout.json.diff.txt`). New screens in default light and dark, each in a page of its own: `layout-sidebar-collapsed`, `layout-rail-open`, `layout-rail-closed`, `layout-band` (960x900), `layout-phone-drawer` (390x844), `layout-grid`, `layout-canvas`, `layout-embed-narrow` (a 1000px host box). Baselines of `1c665e0167`, identical for `85c0aaca0e`; two runs 0 px apart from the known flakes, identical dumps. Two harness races the dump caught are fixed (the running session's Tasks tab auto-open, the new-chat list still loading). |
| L1 | Done | The configuration registry (`web/src/configuration/`, VS Code's `IConfigurationRegistry` and `IConfigurationService`): `contributes.configuration` (one node or an array; `type` of the JSON Schema types, `enum`/`enumDescriptions` and their markdown forms, `default`, `minimum`/`maximum`, `items`, `scope` `application`/`window`/`resource` with VS Code's other scopes mapped, `order`, `deprecationMessage`; a third-party key starts with its extension id, built-ins may also mark a default `defaultOverridable: false`) and `contributes.configurationDefaults` (any setting key, last registered wins, checked against the setting's schema; no language overrides), parsed with the other contributions and registered by the host per extension. The configuration service layers registered default or override < product default (`setPolicy`, filled by L8) < the user's settings JSON < window memory < product lock, leaves out a value the schema doesn't take at every layer, writes the document in place (refused while it doesn't parse, or when locked) and fires one change event with the changed keys; `workspace.getConfiguration` reads every registered setting through it (plus VS Code's `inspect`), `config.*` context keys cover every primitive setting. The document's reader, editor and store (`settingsStore.ts`, its migrations in `legacySettings.ts`) and the language service (now booleans, numbers, integers, arrays, bounds, their snippets and boolean completions) are generic; the theme keys register through the built-in `omnigent.themes` extension with the theme service's detailed schema over them, so the editor's schema is the union. `omnigent.files.sortOrder`/`.showHidden` register through the built-in `omnigent.files` extension: the sort moved from `omnigent:files-panel-preferences` into the settings JSON (migrated once, the old key removed once written), showHidden is what a session starts from (the eye stays per session). Resetting the appearance keeps the document's other keys. Harness: 0 px but the known `dark-omni/dialog-new-project` 1 px, tokens, embed tokens and `layout.json` identical (327 shots); `--only-layout` 10/10 (my-extensions `layout.py`, its L1 checks; the L2 ones skip on this checkout). |
| L2 | Done | Workbench parts (`web/src/workbench/`): `layoutService` with VS Code's part ids (`workbench.parts.*`), `isVisible`, `setPartHidden`, `togglePart`, `getSize`/`setSize`, `getLocation`, `onDidChangePartVisibility`, `onDidChangeLayout`. AppShell registers the side bar, main and auxiliary bar (not on a grid route, which draws its own) with controllers over its own state and handlers (`shell/useWorkbenchParts.ts`): state, not markup, and no behaviour change; the state itself moves into the service when the activity bar needs it (L4). `data-part` hooks `sidebar`, `main` (also the grid's), `auxiliarybar` (classic and v2 rails) beside the old ones (`theme_hooks.md`); titlebar, activitybar, panel and statusbar reserved. Built-in commands `workbench.action.toggleSidebarVisibility`, `closeSidebar`, `toggleAuxiliaryBar`, `closeAuxiliaryBar` (the palette's `toggle-left-sidebar`/`toggle-right-sidebar` ids as aliases; shortcuts unchanged; a collapse is refused on /settings), context keys `sideBarVisible`, `auxiliaryBarVisible`. The layout state store `omnigent:layout-state` (`{ version: 1, state: { <slot>: value } }`, `layoutState.ts`) holds the panel sizes, the conversation list's view, collapsed sections, expanded projects and collapsed families, migrated from their five old keys (removed once the document is written; a newer version's document is never overwritten), and the side bar's desktop open state: written when it changes outside Settings, the canvas, a maximized rail, a peek and narrow windows (open, the default, is not stored), restored on load. Review fixes (the commit landing this row) also for L1: a refused settings write keeps the window's memory value, resetting a settings JSON that doesn't parse keeps the other settings' last good values, a third-party extension's `update` writes only its own settings. Harness: 0 px (14 px inside the spot masks), tokens and embed tokens identical, `layout.json` identical apart from 1898 hook additions (the `data-part` hooks and `part:*` entries); `--only-layout` 17/17 (L1 and L2 checks). Not in L2: "View: Reset Layout" (the store has `reset()`; no command yet). |
| L3 | Done | View containers (`web/src/workbench/viewContainers.ts`, VS Code's `IViewContainersRegistry`): `contributes.viewsContainers` with `activitybar`, `secondarySidebar` (the documented Omnigent key) and `panel` (reserved), ids under the extension's; the host's own `omnigent.rightPanel`; the built-in `omnigent.conversations` extension's container with the side bar's navigation and conversation list as `builtInView` views (`shell/builtInViews.ts`, built-ins only, memoized host components: the trusted tier's first seam). The view registry (`railViews.ts`) is generalized by container: `contributes.views[<any container>]` with `when`, `visibility` (`hidden`, `collapsed`), `contextualTitle` (kept, reserved until views move), `initialSize`; a view of a container nobody registered is refused when it registers. The side bar draws its container through `ViewContainerViews` (a built-in view as drawn, so the markup stays; a tree view as a pane whose header collapses it, kept in the layout state's `workbench.views`; the container's own extension's views first; a built-in container's manifest views until the host registered them); the rail draws every secondary side bar container's views as its tabs. `contributes.viewsWelcome` (command links, a lone link a button), `contributes.menus["viewContainer/title"]` (`viewContainer` key; the side bar's header row before its own buttons, the rail's trailing controls). Rail gating as `when`: the built-in rail views' manifests gate their tabs (`builtinExtensions/builtInTabWhen.ts`) on the shell's keys `omnigent.session.hasWorkspace`, `omnigent.session.hasTasks`, `omnigent.serverFeature.<flag>` (`workbench/workbenchContext.ts`, mirrored into the runtime's context keys); `view.<id>.visible`. Review fixes in the same commit (memoized built-in views, extension tabs validated as drawn, per-view manifest merge). Harness: 0 px (one screen inside the spot masks), tokens and embed tokens identical, `layout.json` identical apart from the L2 hook additions; `--only-layout` 25/25 with the fixture extension `my-extensions/dev/verify/fixtures/layout-fixture` (a view stacked under the sessions, its collapse kept across a reload, a container title action, a rail view gated by `when`). |
| L0-L2 validation | Done | The independent validation's findings, fixed in their own commit after L3: the product theme's locks are configuration locks (`theme/themeConfigurationLocks.ts`: variants and `hideCustomizations` lock their keys, a policy write guard refuses locked options and tokens inside the object settings); a lock always blocks writes (an invalid value applies the default, with a warning); the layout state is scoped per embed basename (`omnigent:layout-state@embed:<basename>`); a built-in's settings take no `configurationDefaults` unless they opt in (`defaultOverridable: true`: the Files keys; L4 and L5 add the layout intent keys); a third party's `description` is text in the editor's hovers, its `markdownDescription` markdown without images or raw HTML; a setting key belongs to the longest loaded extension id; an old key written after the migration wins over the document's slot, a non-integer version is corrupt; layout and sort writes that fall back to the window warn; `application` scope is enforced; the palette's toggles match their VS Code ids. Open: the layout service and the layout state are one per window, so two embeds mounted at once share them (L8, with the embed's sizing). |
| L4 | Done | The activity bar (`shell/ActivityBar.tsx`, `workbench/activityBar.ts`): `workbench.activityBar.location` (`default`, `top`, `bottom`, `hidden`; registered by the built-in `omnigent.workbench` extension, `hidden` by default, overridable by `configurationDefaults` and products), one item per side bar container with a view to show; a click shows the container and the side bar, the active item's click hides the side bar; views' badges roll up (tree view badges and built-in views' badge providers, `registerBuiltInViewBadge`); drag to reorder and hide from the right-click menu (layout state `workbench.activityBar`, hidden items keep their place, hiding the shown container shows the next); roving focus with the arrows, Home and End. At `default` it is the `[data-part="activitybar"]` beside the side bar with Accounts and Manage at its bottom (the side bar's footer goes); at `top` (also a phone's drawer at `default`) and `bottom` a row in the side bar, the footer kept. The side bar's open state and active container moved into the layout service (`isSideBarOpen`, `setSideBarOpen`, `getActiveViewContainer`, `openViewContainer`; the active one in the layout state `workbench.sideBar.activeViewContainer`); AppShell keeps peek, Settings and narrow-window logic over it. Built-in `omnigent.inbox`, `omnigent.automations` (when `omnigent.automations.enabled`) and `omnigent.canvas` (when `omnigent.serverFeature.canvas`) containers with compact host lists (`shell/sideBarListViews.tsx`; the automations list reads the page's query without its poll, only while the side bar shows). Commands `workbench.view.<container>`, `workbench.action.toggleActivityBarVisibility`, `focusActivityBar`, `resetLayout` ("View: Reset Layout" and "View: Toggle Activity Bar Visibility" in the ⌘K palette: the layout state goes, settings stay); context keys `activeViewlet`, `activityBarVisible`; a side bar view's `<view>.focus` shows its container. Review fixes in the same commit. Harness: 0 px with the bar hidden (the known `dark-github/terminal-command` flake aside), tokens and embed tokens identical, `layout.json` identical apart from the hook additions; new baselines `layout-activitybar`, `-inbox`, `-top`, `-bottom` (default light and dark); `--only-layout` 36/36 (L4: the items, the footer moved, the badge, click, collapse, keyboard, hide, `top` and `bottom`, Reset Layout from the palette). |
| L5 | Done | Side bars (`workbench/sideBars.ts`, the built-in `omnigent.workbench` manifest): `workbench.sideBar.location` (`left`, `right`: the activity bar and side bar on the right, the drawer, edge, resize and peek mirrored, the secondary side bar on the left with its edge, resize and slide mirrored and the chat header's offset on its side); `workbench.secondarySideBar.defaultVisibility` (the intent Appearance's Workspace panel row writes; the old `omnigent:default-workspace-panel` "open" carries into it; the rail's last toggle is layout state `workbench.auxiliaryBar.lastVisibility` until the intent changes); `omnigent.secondarySideBar.autoHideBelow` (narrowing past it closes the rail for the window, widening reopens what it closed). Width tokens (`theme/tokens/layout.ts`): `ui-sidebar-width`/`-min-width`/`-max-width`, `ui-auxiliarybar-width`/`-min-width`/`-max-width`, `ui-activitybar-width`, `ui-titlebar-height` (reserved), taking `vw`/`vh` (validated, `0..100`), lockable by products (`lockedTokens`), measured on the theme root (`workbench/layoutTokens.ts`, re-read on a theme change); a drag is layout state (the secondary side bar's stays per session), the edge's double-click returns to the token, View: Reset Layout too for the side bar. The navigation view draws the `sidebar/navigation` menu (`workbench/sidebarNavigation.ts`, decision 10): the sessions container's entries (`omnigent.newSession`, `omnigent.openAutomations`, `omnigent.openWorkflows`, `omnigent.openInbox`, `omnigent.openCanvas`, `omnigent.showExtensionPages`, `omnigent.openUsage`, built-in commands that open their pages) as the host's rows gated by `when`, other extensions' entries after them as command rows; right-clicking the navigation's padding or a command row hides and shows entries (layout state `omnigent.conversations.navigation.hidden`; a link keeps the browser's menu). `workbench.action.toggleMaximizedAuxiliaryBar`, and Close and Maximize as built-in commands with icons for `viewContainer/title` (no default entry: the rail's own Full screen button stays, so today's look does). Also fixed here: L4's raw radius and text size the theme's raw-value test flags (`rounded-(--radius-otto-button)`, the rail's badge base). Review fixes in the same commit. Harness: 0 px for every existing screen, tokens and embed tokens identical apart from the 8 new tokens per root (additions only; baselines updated), `layout.json` identical apart from the hook additions; new baselines `layout-sidebar-right`, `layout-sidebar-right-band` (default light and dark); `--only-layout` 43/43 (L5: the side bar on the right, the width token, a drag and the double-click, the navigation's menu and a contributed entry, autoHideBelow); `tests/browser_ui/test_sessions_appearance.py` 17/17. Open: the phone drawer's swipes and the macOS desktop app's title strip assume the left side bar (L9); widths are measured during render (cached per window size and root state). |
| L6 | Done | Moving views (`workbench/viewLocations.ts`, `shell/viewMoves.tsx`, VS Code's view descriptor service): a move is layout state `workbench.views.locations` (`{ view: container }`), applied when views are read (`viewContainerOf(view, locations)`), so the registry keeps each view's own container; a stored container that went away, or can't draw the view, falls back to it. "View: Move View..." (`workbench.action.moveView`, the view's id as its argument; `moveFocusedView`; in the ⌘K palette) picks the view, then another side bar container, a New Side Bar Entry (a generated container `workbench.view.generated.<view>`, there while a view is in it, named after its first view) or the Secondary Side Bar. Drag and drop: a stacked view's header in the side bar and an extension tab in the right panel drag onto an activity bar item (its container), the activity bar's empty part (a new entry), the side bar (the container it shows) or the right panel's tab strip (`[data-view-drop-target]` while over). Right-click: a view's header and tab Hide (never a side bar container's last shown view), Move View... and, once moved, Reset Location; the side bar's header row and the tab strip list their views, hidden ones too, to show them again (a link keeps the browser's menu). "View: Reset View Locations" (`workbench.action.resetViewLocations`). Differences from VS Code: a `builtInView` view moves between side bar containers only, a `builtInTab` view doesn't move, the secondary side bar is one container. `lockViewLocations` (`workbench/productLayout.ts`, filled by L8): no moving, hiding or dragging, and the user's stored moves and hidden views don't apply while it holds. Also: the New session and Canvas commands do what their rows do while the side bar is mounted (the list back on My sessions, the remembered canvas). Review fixes in the same commit (the last view's Hide, menus read their target from the menu's own event, a moved view is shown, drags whose source unmounted end). Harness: 0 px for every existing screen (the run on another port differed only in the footer's port digit; on the usual port 0 px), tokens and embed tokens identical, `layout.json` identical apart from the hook additions; `--only-layout` 52/52 (L6: Move View from the palette, kept across a reload; drags onto an activity bar item, the tab strip and the activity bar's empty part; Reset Location; Hide and show again; Reset View Locations). |
| L3-L5 validation | Done | The independent validation's 13 findings, fixed in their own commit after L6: another extension can't title a command that isn't its own (a host command keeps its title and icon), take a reserved navigation id in any case or repeat a navigation row; View: Reset Layout clears the layout's own slots, keeps the conversation list's preferences (view, order, folded sections) and offers to undo; activity bar badges cap and draw `99+`; a container title action without an icon draws one, its title as its name; the side bar's drag is measured from its own edge past the activity bar, its clamp keeps the chat 360px and its floor under its ceiling (on a phone the drawer goes over the chat), width tokens stay within 0..4000px; on the right the activity bar and side bar follow the chat in the document (no reversed row, Tab in screen order); the rail stays auto-hidden on a session switch below `autoHideBelow`; the old workspace panel key stays while the settings JSON refuses the intent; the extension pages entry shows only with pages and the sessions show with no activity bar; contributed markdown can't start an image of any form; the drawer's swipes are off with the side bar on the right (until L9). Harness: 0 px apart from the known flakes and `layout-sidebar-right-band` (3 antialiased px, delta 1, from the document order; light and dark recaptured), tokens and embed tokens identical, `layout.json` identical apart from the hook additions; `--only-layout` 52/52. |
| L7 | Done | The title bar (`shell/TitleBar.tsx`, `workbench/titleBar.ts`): `[data-part="titlebar"]` above the workbench, height `ui-titlebar-height`, off unless `window.titleBar.visible` (an Omnigent key; VS Code's custom title bar is always on), never on phones, not yet in the macOS desktop app (L9). Regions `left`, `center`, `right`, each drawing the built-in items, then other extensions' `titleBar/left`, `titleBar/center`, `titleBar/right` menu entries (command buttons gated by `when`, ordered by `group` and `@order`, one per command and region), then `window.createTitleBarItem(id?, region?, priority?)` text items. The built-in items are the built-in `omnigent.workbench` extension's entries naming host-drawn items (`builtInItem`, built-ins only): brand, command center (`window.commandCenter`, opens the palette), layout controls (`workbench.layoutControl.enabled`) and account. With the floating sheet the gap under the bar is the new `ui-sheet-gap-top-titlebar` token. Vendored typings and docs (`vscode_style_extensions.md`, `theme_hooks.md`). Review fixes in the same commit. Harness: 0 px for every existing screen with the bar hidden, tokens and embed tokens identical apart from the new token (additions only; baselines updated), `layout.json` identical apart from the hook additions; new baselines `layout-titlebar`, `layout-titlebar-sheet` (default light and dark); `--only-layout` 61/61 (L7: the regions, built-in items, a `titleBar/*` entry and a text item). |
| L8 | Done | Product layout and settings (`product/productConfig.ts`, `workbench/productLayout.ts`, server `product: settings:`/`layout:` on `/v1/info`, `openapi.json`): `OmnigentAppProps.product.settings` and `.layout` over `web/product.json` over the server's blocks. `settings.defaults` and `settings.locked` set and lock any registered key, checked against its schema; `layout.hiddenParts` (not the main part), `hiddenContainers` and `hiddenViews` (ids or `*` patterns, navigation entries' command ids too) remove what they name, `containerOrder` orders the activity bar, `lockViewLocations` (L6) keeps views in place. Each key fails open with a warning; budgets agree between the server and the web; a failed probe keeps the server's last-known values. Each mounted app has its own workbench (`workbench/workbenchScope.ts`): an embed's layout service and layout state (`omnigent:layout-state@embed:<basename>`), so two embeds, or an embed beside the standalone app, keep their own side bar, container, activity bar and moves; the window's commands and keybindings (the side bar toggles and the palette) reach the app last mounted or used, View: Reset Layout and its undo act on its layout state. Part sizes clamp to the embed's root (decision 14): tokens measured on it, `vw`/`vh` as its size, `autoHideBelow` its width. Still one per window: the side bar's dragged width, the product policy (mounts merge), the extension host, the phone breakpoint, and the chat's session runtime (two embeds on sessions load only the later one's transcript). Validation fixes in the same commit (Reset Layout through the active mount's store; keybindings to the active mount). Harness: 0 px (`layout-embed-narrow` 0 px on reruns), tokens and embed tokens identical, `layout.json` identical apart from the hook additions; `--only-layout` 69/69 (L8: defaults and locks, hidden entry and order, `lockViewLocations`, `autoHideBelow` and widths against the embed's root, two embeds, the server's layout kept across a failed probe); `--only-themes` 86/87 (the embed's settings JSON hover check is flaky on L6 too); pytest `test_server_config.py`, `test_openapi_drift.py` and the product/info tests of `test_app.py` 157 passed. |
| Harness flakes | Done | `--only-themes` "product (embed): the settings JSON hover shows whole": a real z-order bug. The overflow widgets node was a portal nested in the dialog's portal; with the editor chunk already loaded both mounted in one commit and React placed the nested node first, so the dialog (the same z-50, later in the document) drew over the hover. The node is now appended in a layout effect, after the dialog; the dialog's focus trap and `aria-hidden` are kept off it (`shell/settingsJson/OverflowWidgets.tsx`, RTL with the real dialog). `devhub-paper/panel-changes` 71 px: a stale baseline, not a regression: the same 71 antialiased icon pixels on every fork commit back to the one it was captured on, with the harness commit that captured it too; recaptured from a clean checkout of `ade0ead54b`. |
| L6-L8 validation | Done | The independent validation's findings, fixed in their own commits after L8, each with a test (`workbench/layoutValidation.test.tsx`): a product's `hiddenContainers` holds for the container's views wherever they go (moves, drags, stored or forged locations, generated entries, the Move View picker, focus, the rail's views per container also following `hiddenViews`); the settings markdown sanitizer escapes `!`, `<` and entities outside code, drops reference definitions from the parsed tree and escapes the whole text if the parser still finds an image, HTML or a definition, and the settings hover draws an extension's enum value and the document's key as text; View: Reset Layout's undo restores the mount it reset, in that mount's toaster; one `titleBar/*` and `sidebar/navigation` entry per command (an entry whose `when` holds, then the command owner's: the longest loaded extension id the command starts with), another extension's entry shows no tooltip of its own and takes the owner's title; the product's `hidden*` lists are the union of the sources and any `lockViewLocations: true` locks; at most 20 title bar menu entries and 20 text items per extension, clipping regions, truncated titles, ids `<extension id>:<id>`, a disposed item handle frees nothing twice; a product-removed built-in navigation entry's command doesn't run; invalid locks, locks past the budget and locks past the 500-entry limit lock their keys to their defaults (web and server, `locked_invalid` up to 5000 keys); the title bar is a labeled region with labeled groups (not a `banner`); Move Focused View finds built-in side bar views. Not done: a contributed navigation entry the product hides only leaves the side bar (its command is its extension's); per-mount product policy (L10). Review fixes in the second commit. Harness: `--only-layout` 69/69 (title bar item ids now `layout.fixture:cost`), `--only-themes` 87/87, screens 0 px apart from `devhub-paper/panel-changes` (71 px): not a stale baseline but a two-state flake, the run's capture is byte for byte the baseline it replaced in `6a04a7d`, so neither is recaptured; tokens and `layout.json` identical; vitest 26374 passed; pytest `test_server_config.py`, `test_openapi_drift.py` 144 passed. |
| L9 | Done | The narrow and mobile pass, per mount (decision 14). Each mount's breakpoints follow its own root (`LayoutService.getViewport`, `data-layout-width` on an embed's root; the standalone app the window's media queries; the desktop app always desktop): the md, band and phone rules, the floating sheet, the drawers and the title bar read the mount's layout, and an embed's first box opens its side bar on desktop; a hidden root keeps its last layout and size, a removed one drops it. The side bar's and the right panel's dragged widths are per mount (stores keyed by the mount's layout state), clamped and dragged against the mount's root and the panel's own box (validator item 6), `vw`/`vh` width tokens resolved against the caller's mount, the hooks re-rendering on the root's first measure. With the side bar on the right the phone drawer's swipes mirror, their edge zone measured on the mount's own box, and the macOS desktop app's title strip and traffic-light clearance follow the side bar's side (`data-window-corner`). Phones and the band draw no title bar: its command items fold into the chat header's phone menu, which also lists the secondary side bar container's other views, each opening a drawer of its own (cleared when the layout leaves the phone). The activity bar is `top` inside the band's side bar and the phone's drawer. The standalone document gets `data-omnigent-standalone`, and its phone layout sets `overscroll-behavior-x: none` (a browser's overscroll back navigation no longer leaves the app from a short or edge drag; an embed's host page keeps its own). Review fixes in their own commits. Harness: `--only-layout` 86/86 (L9: breakpoints and sizes against a 1400px embed in a 1800px window, two embeds' widths, the phone menu's views and folded title bar items, the swipes with the side bar on the right, the macOS title strip), `--only-themes` 87/87, screens 0 px apart from the `devhub-paper/panel-changes` flake; `layout-embed-narrow` (light and dark) recaptured: the 1000px embed now draws the mobile layout, as decision 14 says; new baselines `layout-phone-drawer-right`, `layout-mac`, `layout-mac-titlebar`, `layout-mac-sidebar-right` (default light and dark); vitest 26406 passed (the known `filesView` flake passes alone); `tests/browser_ui` under a clean environment with system Chrome: the swipe tests 6 passed (`test_short_vertical_and_edge_drags_leave_drawer_closed` included), the other mobile, sidebar and appearance tests 25 passed (`test_pull_request_summary_layout.py`'s 4 teardown errors, an unregistered Files listing request, are the same on the base). Open: only title bar items with a command fold into the phone menu (a text item without one stays off phones); an embed's first render reads the window for one frame before its root is measured; no product option keeps window-based breakpoints; on iOS the native edge-swipe gesture still comes from the left; the push panels' widths (file viewer, terminals, execution logs) and the comments panel's are still one per window and clamp to the window; `html:has(.app-shell) { overflow: hidden }` still applies to a host page that loads the standalone stylesheet. |
| L10 to L11 | Not started | |

Paths are relative to the omnigent repo root unless they start with `my-extensions/`.

## Context

- Roadmap after theming: **layout** (this plan), then menus everywhere, product config, and the
  trusted React tier (Theia-style: products and built-ins may supply React, third-party
  extensions stay plain data).
- Design driver: the DevHub redesign (`my-extensions/designs/omnigent-session-redesign/`). Its
  layout items left unmatched by M11: an icon rail (activity bar), a product top bar, a narrower
  sidebar, a hidden "New session" row; also the Inbox, Automations and Canvas sidebar views, the
  right panel's close and wide buttons, its auto-hide under 1180px and the Files tab removed.
- User preferences that shape every choice below: VS Code's model and names; generic,
  product-level mechanisms; settings in the settings JSON (M10b), no new Settings UI rows;
  built-in UI as extensions; development cost carries little weight.

## Findings: the layout today

| Area | Today | Where |
|---|---|---|
| Shell | One flex row: `aside.conversations-sidebar`, then a group with `[data-slot=main-area]` (chat header, the route's page, overlays) and the right rail | `web/src/shell/AppShell.tsx` (3900 lines; root ~3339, main area ~3439) |
| Left sidebar | Header row (brand, search, actions); a fixed primary nav (New session, Automations, Workflows, Inbox, Canvas, V1 extension pages, Usage); the conversation list (My sessions/Shared, Projects); the server picker footer (profile, settings) | `shell/Sidebar.tsx`, `extensions/ExtensionPrimaryNavigation.tsx` |
| Sidebar width | 320px default, min 220, max 50% of the window; dragged width in `omnigent:panel-size-preferences` | `hooks/useResizableSidebar.ts`, `lib/panelSizePreferences.ts` |
| Sidebar open | Not persisted; open on desktop, closed below md; narrowing closes and widening restores; canvas collapses it | `AppShell.tsx` ~469, ~529; `canvas/useCanvasSidebar.ts` |
| Chat header | `header.chat-header`, absolute over the main area; session header items (extension slot, desktop only), the panel toggle; hidden when a V1 extension page owns it | `shell/ChatHeader.tsx`, `vscodeExtensions/SessionHeaderItems.tsx` |
| Composer | Inside the chat page, not a shell part | `pages/ChatPage.tsx` ~1927 |
| Right rail (classic) | `aside[data-slot=workspace-panel]`, `.workspace-tab-strip` of `rail-tab`s; width (about 36vw, 420 to 600) and open state per session in `omnigent:session-workspace-state`; new sessions follow `omnigent:default-workspace-panel` | `shell/WorkspacePanel.tsx`, `hooks/useResizableInlinePanel.ts`, `lib/sessionWorkspaceState.ts` |
| Right rail (v2) | Behind the `workspace_sidebar_v2` server flag and not on touch clients: browser-like tabs of "places" (files, changes, pulls, terminal, agents, tasks, search, web...); reuses the extension views for Agents, Tasks, Search and the PR list | `shell/useTabsSidebar.ts`, `shell/workspaceTabs/`, `docs/workspace-sidebar-v2.md` |
| Other panels | Terminals push panel, execution logs, phone drawers per tab | `shell/AppShellWorkspacePanels.tsx`, `shell/MobilePanelDrawer.tsx` |
| Pages | Every route renders into the main area's `Outlet`; sidebar and header stay. The grid replaces the main area with its own `main-area` section; canvas draws its own split | `App.tsx` 243-352, `grid/GridWorkspace.tsx`, `canvas/CanvasWorkspace.tsx` |
| Floating sheet | The `sheet` variant (`data-omni-sheet="floating"`) at md and up; tokens `ui-sheet-gap`, `ui-sheet-gap-top` (its description already anticipates a top bar), `ui-sheet-radius` | `theme/variants.css` 401-418, `theme/tokens/variantSurfaces.ts` |
| Contributable | One view container, `omnigent.rightPanel` (others warn and are ignored); no `viewsContainers`; no `when` on views (`view.<id>.available` is host-set); menus only `view/title`; session header items; built-in tabs replaced by views through `builtInTab` | `vscodeExtensions/contributions.ts` 15, 371; `shell/railViews.ts`, `shell/railTabs.ts` |
| Layout commands | `toggle-left-sidebar`, `toggle-right-sidebar`; shortcuts `sidebar.left` (Ctrl/Cmd+B native, Cmd+Alt+[ browser), `sidebar.right` | `shell/appCommands.ts` 95-110, `lib/shortcuts/registry.ts` 131-144 |
| Narrow | md = 73.8125rem (1181px in JS); sidebar becomes a drawer (side by side from 600px at aspect 3/4); the right rail is drawers opened from the header's phone menu; the Electron app keeps the desktop layout | `hooks/useIsMobileViewport.ts`, `hooks/useIsSideBySideSidebarViewport.ts`, `ChatHeader.tsx` 243 |
| Embed | Same routes and AppShell. `OmnigentAppProps`: `sidebarConfig` (polling and paging only), `basename`, `routing`, `isDarkMode`, `product.theme`. No layout props | `embed.tsx` 115-147, `appConfig.ts` |
| Settings JSON | `omnigent:ui-settings`; keys `workbench.colorCustomizations`, `omnigent.themeOptions`, `omnigent.style.*`. The document and parser are generic, the schema and apply are theme-specific (`additionalProperties: false`). `omnigent.files.*` (`workspace.getConfiguration`) is a separate map in other storage | `theme/settingsDocument.ts`, `theme/settingsSchema.ts`, `vscodeExtensions/workspaceService.ts` 95-103 |
| Product config | `theme` only, three sources: embed prop, `web/product.json`, server `product: theme:` on `GET /v1/info` | `theme/productTheme.ts`, `omnigent/server/server_config.py`, `omnigent/server/app.py` |

## Findings: VS Code and Theia

VS Code ([custom layout](https://code.visualstudio.com/docs/configure/custom-layout),
[contribution points](https://code.visualstudio.com/api/references/contribution-points),
[UX guidelines](https://code.visualstudio.com/api/ux-guidelines/overview)):

| Concept | VS Code | Use here |
|---|---|---|
| Parts | Title Bar, Activity Bar, Primary Side Bar, Editor, Panel, Secondary Side Bar (internally `auxiliarybar`), Status Bar | Same names |
| `contributes.viewsContainers` | Keys `activitybar` and `panel`; entries `id`, `title`, `icon`. The secondary side bar has no key: views get there by moving | Same, plus a `secondarySidebar` key (decision 2) |
| `contributes.views` | Keyed by container id (`explorer`, `scm`, custom); entries `id`, `name`, `when`, `icon`, `contextualTitle`, `visibility` (`visible`/`collapsed`/`hidden`), `initialSize`, `type` | Add `when`, `visibility`, `contextualTitle`, `initialSize` |
| `contributes.viewsWelcome` | `view`, `contents` (markdown with command links), `when` | Same; replaces ad hoc empty states over time |
| Activity bar | One icon per container, badges from views, drag to reorder, right-click to hide; Accounts and Manage at the bottom. Clicking the active one hides the side bar | Same behaviour (it is also DevHub's) |
| Layout settings | `workbench.activityBar.location` (`default`, `top`, `bottom`, `hidden`), `workbench.sideBar.location` (`left`, `right`), `workbench.panel.defaultLocation`, `workbench.secondarySideBar.defaultVisibility`, `workbench.statusBar.visible`, `window.commandCenter`, `workbench.layoutControl.enabled` | Same keys in the settings JSON |
| Layout state | Sizes, visibility, active container, moved and hidden views live in storage, not settings; "Reset View Locations" | Same split (decision 4) |
| Moving views | Drag and drop between containers and parts; "Move View" command; moving creates a container in the target | Same, in a later milestone |
| Title bar | Menu, command center (search and command entry), layout controls, account | Regions with contributable items |
| Commands | `workbench.action.toggleSidebarVisibility`, `togglePanel`, `toggleAuxiliaryBar`, `toggleActivityBarVisibility`, `workbench.view.<container>`, `<view>.focus` | Same ids as aliases of today's commands |

Theia (`packages/core/src/browser/shell/application-shell.ts`,
[widgets](https://theia-ide.org/docs/widgets/)): `ApplicationShell` areas `top` (menu bar),
`left`, `main`, `right`, `bottom`, plus the status bar and secondary windows. Left and right are
`SidePanelHandler`s (a tab bar, which is the activity bar, over a dock panel).
`AbstractViewContribution` gives a widget `defaultWidgetOptions: { area, rank }` and a toggle
command; `ShellLayoutRestorer` persists the layout through `StorageService`;
`FrontendApplicationContribution.initializeLayout` builds the first layout. What to take: parts
are named areas a trusted contribution can target with a React widget and a rank; layout state
is one serializable document restored at start. This plan's part ids and view registry are
those areas and that document.

## Goals

1. The app shell becomes a workbench of named parts, each with a stable hook, a visibility, a
   size and (where it makes sense) a location.
2. Every sidebar and right-panel surface is a view in a view container, contributed through
   `contributes.viewsContainers` and `contributes.views`, built-ins included.
3. An activity bar switches the primary side bar's containers.
4. A title bar with regions and contributable items.
5. Layout settings live in the settings JSON, on a general configuration registry; layout state
   lives in one layout state store.
6. A product sets layout defaults, locks keys and hides parts, containers and views, through the
   same three sources as the product theme, embed included.
7. Today's look is the default: every refactor milestone is 0 px on the harness.
8. The part ids and view registry are the seam the trusted React tier, menus everywhere and
   product config later fill.

## Non-goals

- Replacing another product's UI, or any App Builder work.
- The trusted React tier itself (React slots from products). This plan reserves its seams only.
- Menus beyond the ones a part needs (`viewContainer/title`, the title bar's items). Item context
  menus and the "..." overflow are the menus stage.
- Editor groups, split chats, tabs in the main area (the grid stays as it is).
- Moving terminals into a bottom Panel; the part id is reserved.
- Reworking the v2 tabs sidebar's places; it keeps rendering inside the secondary side bar.
- New Settings UI rows.

## Proposed model

### Parts

| Part id | VS Code | Contents | Hook | Default |
|---|---|---|---|---|
| `workbench.parts.titlebar` | Title Bar | Regions `left`, `center`, `right` | `[data-part="titlebar"]` | Hidden (decision 7) |
| `workbench.parts.activitybar` | Activity Bar | One item per primary side bar container, global items at the bottom | `[data-part="activitybar"]` | Hidden (decision 3) |
| `workbench.parts.sidebar` | Primary Side Bar | The active container's views | `[data-part="sidebar"]`, keeps `.conversations-sidebar` | Visible, left |
| `workbench.parts.main` | Editor | The chat header, the route's page, the composer; the grid and canvas | `[data-part="main"]`, keeps `[data-slot=main-area]` | Visible |
| `workbench.parts.auxiliarybar` | Secondary Side Bar | `omnigent.rightPanel` and other containers; the v2 tabs sidebar when its flag is on | `[data-part="auxiliarybar"]`, keeps `[data-slot=workspace-panel]` | Per session, as today |
| `workbench.parts.panel` | Panel | Reserved (terminals later) | | Not rendered |
| `workbench.parts.statusbar` | Status Bar | Reserved (decision 8) | | Not rendered |

A `layoutService` (web, plain data) owns them: `isVisible(part)`, `setPartHidden(hidden, part)`,
`getSize(part)`, `setSize`, `getLocation(part)`, `onDidChangePartVisibility`,
`onDidChangeLayout`. AppShell reads it instead of its own state. The extension API exposes the
read side and the commands, as VS Code does (no direct `setSize` for extensions).

### View containers and locations

| Container | Location | Built-in extension | Views |
|---|---|---|---|
| `omnigent.conversations` | activitybar | `omnigent.conversations` | `omnigent.conversations.navigation` (the primary nav), `omnigent.conversations.list` (sessions, projects) |
| `omnigent.inbox` | activitybar | `omnigent.inbox` | `omnigent.inbox.list` |
| `omnigent.automations` | activitybar | `omnigent.automations` | `omnigent.automations.list` |
| `omnigent.canvas` | activitybar | `omnigent.canvas` | `omnigent.canvas.list` |
| `omnigent.rightPanel` (kept) | secondarySidebar | the existing tab extensions | Files, Changes, Pull Requests, Agents, Tasks, Content search, extension views |

- `contributes.viewsContainers`: `{ "activitybar": [ { id, title, icon } ], "secondarySidebar": [...], "panel": [...] }`.
  Container ids start with the extension id, as view ids do. Icons from the Lucide allowlist.
- `contributes.views[<container>][]` gains `when`, `visibility`, `contextualTitle`,
  `initialSize`. A container's views stack (sidebar, VS Code style, collapsible with headers when
  more than one) or tab (secondary side bar, as the rail's strip today).
- `builtInView` (built-ins only, as `builtInTab`): the view's body is a host React component from
  an allowlisted registry (the conversation list, the inbox list). This is the trusted tier's
  first seam: the trusted stage opens the same registry to products.
- `contributes.viewsWelcome`: plain-data empty states with command links, for every view.
- A container with no visible view is not shown in the activity bar (VS Code's rule).
- Context keys: `activeViewlet`, `sideBarVisible`, `auxiliaryBarVisible`, `activityBarVisible`,
  `view.<id>.visible` (on screen) next to today's `view.<id>.available`.

### Activity bar

- Settings: `workbench.activityBar.location`: `default` (vertical rail beside the side bar),
  `top` (icons in the side bar's header row), `hidden`. `bottom` too if cheap (VS Code has it).
- Behaviour: click selects the container and shows the side bar; clicking the active item hides
  the side bar; badges from a view's `badge` (already in the TreeView API) roll up to the
  container; drag to reorder and "Hide" from a right-click (layout state); keyboard focus with
  arrows.
- Global items at the bottom: Accounts (the profile and server picker, today's sidebar footer)
  and Manage (settings). When the bar is visible they leave the side bar's footer, as DevHub
  wants; when hidden the footer stays.
- Commands: `workbench.view.<container>`, `workbench.action.toggleActivityBarVisibility`,
  `workbench.action.focusActivityBar`.

### Side bars

| Setting | Values | Default |
|---|---|---|
| `workbench.sideBar.location` | `left`, `right` (the secondary side bar takes the other side) | `left` |
| `workbench.secondarySideBar.defaultVisibility` | `hidden`, `visible`, `visibleInWorkspace` (here: a session) | today's `omnigent:default-workspace-panel` value, migrated |
| `omnigent.secondarySideBar.autoHideBelow` | px window width, or `0` | `0` (DevHub: 1180) |

- Widths: themes and products set them as tokens (decision 5): `ui-sidebar-width` (default
  320px), `ui-sidebar-min-width` (220px), `ui-sidebar-max-width` (50vw), the same three for the
  auxiliary bar, `ui-activitybar-width`, `ui-titlebar-height`. A drag stores a width in layout
  state; double-click or "Reset Layout" returns to the token. DevHub's `clamp(220px, 20vw, 280px)`
  is a token value.
- The side bar's open state becomes persisted layout state (today it isn't), per window.
- The secondary side bar keeps per-session open state and width (today's behaviour), plus a
  close button and maximize ("wide") in its container title (`viewContainer/title` menu).
- View moving: "Move View..." and drag and drop of a view between containers and the two side
  bars, "Reset View Locations"; moved and hidden views are layout state.

### Title bar

- Regions `left`, `center`, `right`. Built-in items (each a contribution of a built-in
  extension): brand (the theme's brand logo and app name), command center (opens Cmd+K, VS Code's
  `window.commandCenter`), layout controls (toggle side bars), account.
- Plain-data items: `contributes.menus["titleBar/left" | "titleBar/center" | "titleBar/right"]`
  (command buttons with `icon`, `when`, `group`, order) and `window.createTitleBarItem` modelled
  on `createStatusBarItem` (text, tooltip, command, color) (decision 6).
- Product items that need React (a workspace switcher, an app grid) are trusted-tier slots on the
  same region ids; until that stage a product picks built-in kinds only.
- Settings: `window.titleBar.visible` (Omnigent key; VS Code's custom title bar is always there),
  `window.commandCenter`, `workbench.layoutControl.enabled`. When visible, `ui-sheet-gap-top`
  takes its top-bar value.
- On phones the title bar's items fold into the chat header's phone menu; the bar is hidden.

### Status bar (decision 8)

Reserved part id, `window.createStatusBarItem` reserved as an alias target of
`createSessionHeaderItem`. No design asks for one.

### Settings and layout state

| Kind | Store | Examples |
|---|---|---|
| Settings (user intent, in the settings JSON) | `omnigent:ui-settings` | `workbench.activityBar.location`, `workbench.sideBar.location`, `workbench.secondarySideBar.defaultVisibility`, `window.titleBar.visible`, `window.commandCenter`, `omnigent.secondarySideBar.autoHideBelow` |
| Layout state (what the user dragged and toggled) | one versioned `omnigent:layout-state` document (Theia's restorer, VS Code's storage) | side bar open, widths, active container, activity bar order and hidden items, moved and hidden views, collapsed view sections |
| Per-session state (unchanged) | `omnigent:session-workspace-state` | the secondary side bar's open state and width per session |

- L1 turns the settings document into a general **configuration registry**
  (`contributes.configuration`, `contributes.configurationDefaults`, `workspace.getConfiguration`
  over the same document). The theme keys register on it; layout keys register on it;
  `omnigent.files.*` moves into the document (migrated from `omnigent:files-panel-preferences`).
  The schema becomes the union of registered properties, so the M10b editor's completions,
  hover and "Set by product" work for every key.
- Existing localStorage keys (`panel-size-preferences`, `sidebar-view`, collapsed sections) are
  migrated once into layout state, as M10b migrated its keys.
- "View: Reset Layout" clears layout state; settings stay.

### Product control

Mirrors `ProductThemeConfig`, same three sources (embed prop over `web/product.json` over the
server's `product:` block on `GET /v1/info`), merged field by field:

```ts
interface ProductConfig {
  theme?: ProductThemeConfig;
  settings?: {
    defaults?: Record<string, unknown>; // any registered key: first run and reset
    locked?: Record<string, unknown>;   // applied last, refused on write, "Set by product"
  };
  layout?: {
    hiddenParts?: string[];       // e.g. "workbench.parts.titlebar"
    hiddenContainers?: string[];  // ids or `*` patterns
    hiddenViews?: string[];
    containerOrder?: string[];    // activity bar default order
    lockViewLocations?: boolean;  // no moving or hiding views
  };
}
```

`settings` is generic (decision 9): the layout stage is its first user, product config later adds
nothing but keys. Hiding is removal (like `allowed` for themes): a hidden view's commands and
`<view>.focus` don't run and its context key is false.

### Embed

- The embed shows the same workbench. A host page usually has its own chrome, so the title bar
  default stays hidden and the product's `layout.hiddenParts` can drop more.
- Part sizes clamp to the embed's scope root, not the window: the layout service measures the
  root (ResizeObserver), and the md breakpoint logic reads the root's width for parts. This is a
  behaviour change for embeds narrower than the window; tested separately.
- Layout state is keyed by the embed's `basename` so two embeds on one origin don't share it.

### Narrow and mobile

| Width | Activity bar | Side bar | Secondary side bar | Title bar |
|---|---|---|---|---|
| md and up | per setting | in flow | in flow, per session | per setting |
| side-by-side band (600px, aspect 3/4) | `top` inside the side bar | in flow | drawer | hidden, items in the phone menu |
| phone | `top` inside the drawer | drawer, as today | drawers from the phone menu, which lists the container's views | hidden |

The Electron app keeps the desktop layout, as today. Touch clients keep the classic rail drawers.

## Built-ins: migration

| Today | Becomes | Milestone |
|---|---|---|
| `Sidebar.tsx` nav rows | `omnigent.conversations.navigation`: a host-drawn list of entries from a `sidebar/navigation` menu (New session, Automations, Workflows, Inbox, Canvas, V1 extension pages, Usage), each with `when`, hideable through layout state and `layout.hiddenViews`-style ids (decision 10) | L5 |
| `ConversationList` | `omnigent.conversations.list` (`builtInView`) with its header actions as `view/title` items | L3 |
| Sidebar header row | The container's title bar: title (or brand when the title bar is hidden), `viewContainer/title` items (search, back, forward, collapse) | L3 |
| Server picker footer | The activity bar's Accounts and Manage items when the bar shows; the footer otherwise | L4 |
| Inbox, Automations, Canvas pages | Stay routes; new compact list views (`builtInView`) in their own containers | L4 |
| Right rail tabs | Views of `omnigent.rightPanel` in the secondary side bar: no change in their extensions; `builtInTab` stays; the strip draws from the container | L3 |
| Rail gating in code (`showGithubTab`...) | View `when` clauses on host context keys | L3 |
| v2 tabs sidebar | Drawn inside the secondary side bar part when the flag is on; its places untouched | L2 |
| `toggle-left-sidebar`, `toggle-right-sidebar` | Commands `workbench.action.toggleSidebarVisibility` and `workbench.action.toggleAuxiliaryBar` (old ids kept as aliases); shortcuts unchanged | L2 |

## DevHub's layout items

All in `my-extensions/dev` (`thekauer.dev`), no fork code beyond the mechanisms:

| Design item | Expressed as |
|---|---|
| Icon rail, 48px, Projects and Automations (Inbox, Canvas with `navInRail`) | `configurationDefaults`: `workbench.activityBar.location: "default"`; theme token `ui-activitybar-width: 48px`; activity bar item tokens (size, active bar width and colour) |
| Active item: accent icon, `sel` background, 2px accent bar | New activity bar colour tokens (`activitybar-foreground`, `-active-foreground`, `-active-background`, `-active-border`, `-badge-*`) with VS Code aliases (`activityBar.*`) |
| Clicking the active item collapses the sidebar | Built-in behaviour |
| Avatar with popover, Settings at the bottom; footer gone | Accounts and Manage global items |
| Top bar 48px: logo, workspace switcher, app grid, avatar | `window.titleBar.visible: true`; brand and account built-in items; the switcher and grid wait for trusted-tier slots (a product's, not an extension's) |
| Sidebar `clamp(220px, 20vw, 280px)` | Theme token `ui-sidebar-width` |
| "New session" gone from the nav | The nav entry `omnigent.newSession` hidden (decision 10) |
| Inbox, Canvas, Automations sidebar views | The built-in containers |
| Right panel 280-400px, wide mode `min(720px, 50vw)` | `ui-auxiliarybar-width`, `-max-width` tokens; maximize in `viewContainer/title` |
| Auto-hidden under 1180px | `omnigent.secondarySideBar.autoHideBelow: 1180` in `configurationDefaults` |
| Close (x) and Expand in the tab bar | Built-in container title actions |
| Files tab gone | Hidden view in layout state seeded by `configurationDefaults` (decision 11) |
| Title bar under the tab bar with meta and refresh | Exists (`view-title`, `TreeView.description`, `view/title`); restyle only |
| Segmented Chat / Terminal toggle in the header | Not this stage (menus everywhere: `chat/title`) |

## Milestones

Each is one or more commits on a worktree of `extensible-ui`, landed as in the theming plan.
"0 px" means `verify.sh --screens --token-dump --embed --compare verify/baselines` with the
theming plan's tolerances.

| # | Milestone | Verified by |
|---|---|---|
| L0 | Harness: a layout dump (each part's box, visibility and hook, per screen) next to the token dump; new screens: sidebar collapsed, rail open and closed, narrow band, phone drawer, grid, canvas, embed narrower than the window; baselines of today | Two runs: 0 px, identical layout dumps |
| L1 | Configuration registry: `contributes.configuration`, `configurationDefaults`, the theme keys and `omnigent.files.*` on it, `getConfiguration` over the settings document, migration | Vitest: registry, schema union, defaults layering, migration, locks; settings JSON harness checks; 0 px |
| L2 | Workbench parts and `layoutService`; `data-part` hooks; layout state store with migration of the old keys; the toggle commands under VS Code ids; side bar open state persisted | Vitest: service, migration, commands; RTL on AppShell; 0 px and identical layout dumps (hooks additions only) |
| L3 | View containers: `viewsContainers`, the view registry generalized from `railViews`, `when`/`visibility`/`viewsWelcome`, `builtInView`; `omnigent.conversations` and `omnigent.rightPanel` as containers; rail gating as `when` | Vitest: parsing, ordering, `when`, welcome; the built-in tab tests unchanged; 0 px |
| L4 | Activity bar part (`default`, `top`, `hidden`), badges, order and hide, global items; Inbox, Automations, Canvas containers and views | Vitest and RTL; new screens per location; defaults 0 px; `--only-layout` checks (click, collapse, badge, keyboard) |
| L5 | Side bars: `sideBar.location`, width tokens, the navigation view and its menu, hide entries, `autoHideBelow`, close and maximize | Unit; screens left and right, narrow band; defaults 0 px |
| L6 | Moving views: "Move View...", drag and drop, hide and reset; `lockViewLocations` | Unit for state; `--only-layout` drag checks |
| L7 | Title bar: part, regions, built-in items, `titleBar/*` menus, `createTitleBarItem`, the sheet's top gap | Unit; screens with the bar on; defaults 0 px |
| L8 | Product layout: `product.settings` and `product.layout` from the three sources, server block and `/v1/info` (`openapi.json`), embed sizing to the scope root, state keyed by basename | Vitest, `embed.test.tsx`, pytest for the server block; harness embed checks |
| L9 | Narrow and mobile pass per the table above | Narrow and phone screens; RTL on drawers |
| L10 | Extension API read side: `window.onDidChangeLayout`-style events, context keys, the vendored typings and docs (`vscode_style_extensions.md` mapping rows, `theme_hooks.md` part hooks) | API tests; typings check |
| L11 | DevHub layout in `my-extensions/dev`: `configurationDefaults`, tokens, side-by-sides with the design; also the tokens M11 left unmatched: Vercel's muted idle sidebar rows, the accent Send button, the accent avatar, mono timestamps | `--only-layout` DevHub checks; new `devhub-*-layout` baselines; side-by-sides |

Order: L0 > L1 > L2 > L3 > L4. L5 and L7 need L3. L6 needs L5. L8 needs L1 and L2. L9 needs L4,
L5 and L7. L10 can follow each part. L11 needs L4, L5, L7 and L8.

## Risks

| Risk | Mitigation |
|---|---|
| AppShell is 3900 lines with many tests; the parts refactor touches all of it | L2 moves state, not markup, first; 0 px and the layout dump on each commit |
| Two right-rail implementations (classic and v2) | Both render inside one part; containers drive the classic one only until v2 adopts views |
| Per-session rail state against per-window container state | Keep per-session open and width; container and view state per window |
| Activity bar and title bar shift every pixel when on | Defaults keep both off; new baselines only for screens that turn them on |
| Embeds narrower than the window change behaviour | Its own L8 screens; a product can keep window-based breakpoints if needed |
| Extensions hiding or moving built-in views | Only the user (layout state) and products hide; third-party extensions may only add; `configurationDefaults` for layout keys limited to user-overridable defaults |
| A settings registry over three owners (theme, layout, files) | One schema union; the theme service keeps applying its keys |
| Keybinding clashes (Cmd+B and browser shortcuts) | Keep today's chords; new commands without defaults |
| localStorage migrations losing state | Migrate once, keep the old keys until the new document is written (the M10b rule) |
| Scope creep into menus and the trusted tier | Only the menus a part needs; React slots stay reserved ids |

## Decisions for the user

**Decided 2026-11-27:** the user accepted all 14 recommendations: 1 (a), 2 (a), 3 (a), 4 (a),
5 (a), 6 (a), 7 (a), 8 (a), 9 (a), 10 (a), 11 (a), 12 (a), 13 (a), 14 (a). The user's answers to
the theming plan's M11 questions, recorded here because they set L11's scope:

- Vercel keeps its inline code border (`code-inline-border`).
- Orange stays the default for Share and Stop on Console and Paper.
- The product mark as the logo and favicon is right.
- The DevHub tokens M11 left unmatched (Vercel's muted idle sidebar rows, the accent Send button,
  the accent avatar, mono timestamps) go into L11.

The options as reviewed:


1. **Part names.** (a) VS Code's: Title Bar, Activity Bar, Primary/Secondary Side Bar, Panel,
   Status Bar, ids `workbench.parts.*`; (b) Omnigent names (left sidebar, right panel).
   Recommend (a), with today's hooks kept.
2. **Contributing to the right panel.** VS Code has no `viewsContainers` key for the secondary
   side bar. (a) Add `secondarySidebar` (a deviation, documented); (b) only `activitybar` and
   `panel`, with `omnigent.rightPanel` the one built-in secondary container and other containers
   moved there by the user or a product. Recommend (a).
3. **Activity bar default.** (a) `hidden`, today's look, one container in the side bar;
   (b) `default` (VS Code's), a new rail for everyone. Recommend (a); products and extensions set
   (b) through `configurationDefaults` or `product.settings.defaults`.
4. **Where layout lives.** (a) Intent in the settings JSON, drags and toggles in a layout state
   store (VS Code's split); (b) everything, widths and open states included, in the settings
   JSON. Recommend (a): (b) rewrites the user's JSON on every drag.
5. **Sidebar widths.** (a) Theme tokens for default, min and max, product-lockable, drags in
   layout state; (b) settings keys; (c) both. Recommend (a): the width belongs to the design
   (DevHub sets it), and `lockedTokens` already locks it.
6. **Title bar items from extensions.** (a) `titleBar/*` menus (commands) plus
   `window.createTitleBarItem` (text items); (b) menus only; (c) none until the trusted tier.
   Recommend (a).
7. **Title bar default.** (a) Hidden everywhere; (b) visible standalone, hidden in the embed.
   Recommend (a), 0 px.
8. **Status bar.** (a) Reserve the id only; (b) build the part and `createStatusBarItem` now.
   Recommend (a): no design needs it.
9. **Product config shape.** (a) Generic `product.settings.{defaults, locked}` over the
   configuration registry plus `product.layout.hidden*`; (b) a layout-only
   `ProductLayoutConfig` like `ProductThemeConfig`. Recommend (a).
10. **Hiding the "New session" row.** (a) The nav becomes a view drawn from a
    `sidebar/navigation` menu, entries hideable by the user and by products; (b) a setting
    listing hidden nav entries; (c) a theme variant. Recommend (a).
11. **How an extension sets layout (DevHub).** (a) `contributes.configurationDefaults` for
    settings and tokens in its themes, always on while it is installed; (b) a theme `layout`
    section applied only while the theme is active; (c) both. Recommend (a), VS Code's way:
    layout does not change with the colour theme.
12. **New sidebar containers.** (a) Built-in Inbox, Automations and Canvas containers with
    compact host views, as DevHub shows; (b) only `omnigent.conversations`, others later.
    Recommend (a).
13. **The v2 tabs sidebar.** (a) Leave it inside the secondary side bar, untouched; (b) make its
    places views of containers in this stage. Recommend (a).
14. **Embed breakpoints.** (a) Parts size and collapse against the embed's root; (b) against the
    window, as today. Recommend (a).
