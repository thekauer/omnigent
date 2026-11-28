# Theme hooks

The stable selectors a theme, an extension's stylesheet or a product may target to
style the Omnigent UI. They are public: renaming or removing one is a breaking
change. Anything else in the DOM (utility classes, element nesting, `aria-label`
text, `data-testid`) is internal and may change at any time.

Prefer tokens (`web/src/theme/tokens/`, see [theming_plan.md](theming_plan.md)) over
hooks: a token changes every site that reads it and survives layout changes. Use a
hook only for what no token covers yet.

## `data-slot` hooks

`[data-slot="<name>"]` on the element named below. Hooks on a `Button` replace its
`data-slot="button"`; such buttons keep `data-variant` and `data-size`.

| Hook | Element |
|---|---|
| `sidebar-section-label` | A sidebar section's heading button ("Projects", "Sessions"); project headers are `.sidebar-row`s instead. Also `.ui-label`. |
| `view-title` | The title bar of a right panel view (Agents, Changes, Tasks, Files, Pull Requests, extension views). |
| `view-title-label` | The title text inside `view-title` (absent where the view shows a location bar). Also `.ui-label`. |
| `pr-row` | A row of the Pull Requests view's list. |
| `pr-row-identity` | The `repo#n` part of a `pr-row`. |
| `pr-row-title` | The title part of a `pr-row`. |
| `pr-row-icon` | The pull request icon of a `pr-row`. |
| `share-button` | The session header's Share button (enabled, disabled and pending). |
| `panel-toggle` | The session header's right panel toggle; `data-panel-open` is set while the panel is open. |
| `composer-stop` | The composer's send button while it interrupts the running turn. |
| `composer-send` | The composer's send button otherwise (its colours: `ui-composer-send-background` and `-foreground`, while it can send). |
| `account-avatar` | The account avatar's fallback: the activity bar's Accounts item and the title bar's account item (its colours: `ui-account-avatar-background` and `-foreground`; its corner radius `ui-account-avatar-radius`, by default `ui-radius-pill` as `rounded-full` was (round, square with a 0 radius base), which rounds the avatar's root too). |
| `user-bubble` | A user message's bubble. |
| `working-indicator` | The transcript's "Working..." row (contains `.otto-working`). |
| `fold-label` | The label of the transcript's fold row ("Worked for 5s"). Also `.ui-label`. |
| `composer-context-strip` | The strip above the composer with the workspace, branch and model context (`.composer-context-bar`). |
| `workspace-panel` | The right panel (`aside`). |
| `transcript-scrollbar` | The transcript's own scrollbar track (it reads the scrollbar colour tokens). |
| `transcript-scrollbar-thumb` | Its thumb. |
| `rail-tab` | A fixed tab of the right panel's tab strip (`data-workspace-tab` names it, `data-state="active"` marks the open one). |
| `main-area` | The main column beside the left sidebar: the session header, the page and the right panel, or the session grid on a grid's route (the floating sheet variant's sheet). |

The shadcn primitives' own slots (`button`, `tabs-trigger`, `dropdown-menu-content`,
`tooltip-content`, `kbd`, `avatar`, ...) are stable too.

## `data-part` hooks

`[data-part="<name>"]` on the element that draws a workbench part (layout plan L2), named as
VS Code's parts (`workbench.parts.<name>` in the layout service). The panel and statusbar
parts are reserved: nothing draws them yet.

| Hook | Element |
|---|---|
| `sidebar` | The primary side bar (`aside.conversations-sidebar`), open or closed. |
| `main` | The main area (`[data-slot="main-area"]`): the chat header, the route's page and, on a session, the workspace rail beside it; the grid's own main area on a grid route. |
| `auxiliarybar` | The secondary side bar: the workspace rail (`[data-slot="workspace-panel"]`), classic or tabs. |
| `titlebar` | The title bar, when `window.titleBar.visible` is on (layout plan L7; not on phones, where its items fold into the chat header's menu; in the macOS desktop app it is the window's title strip, the traffic lights in its left region), class `.titlebar`, over the shell's top strip (`.app-shell[data-titlebar]` makes room for it); its regions are `[data-slot="titlebar-left"]`, `-center` and `-right`, its built-in items `[data-titlebar-item="brand" \| "commandCenter" \| "layoutControls"]` (the account is the profile and Settings buttons), an extension's `titleBar/*` entries `[data-titlebar-command="<command>"]`, its text items `[data-titlebar-text-item="<id>"]`. Not on the default pages. |
| `activitybar` | The activity bar, when `workbench.activityBar.location` shows it (layout plan L4): beside the side bar (`data-location="default"`, class `.activitybar`) or a row in its header or bottom (`top`, `bottom`). Not on the default pages. |

## View hooks

Drawn only when an extension contributes them (layout plan L3), so not on the default pages.

| Hook | Element |
|---|---|
| `[data-view="<view id>"]` | A contributed view stacked in the primary side bar (`data-collapsed` while collapsed). |
| `[data-slot="view-container-actions"]` | A container's `viewContainer/title` buttons (`data-view-container` is its id). |
| `[data-slot="view-welcome"]` | A view's welcome content (`contributes.viewsWelcome`). |
| `.activitybar-item` | An activity bar item (`data-view-container` is its container, `data-active` while it shows in the open side bar), with its `[data-slot="activitybar-badge"]`. Its colours are the `ui-activitybar-*` tokens (layout plan L11). |
| `[data-slot="view-container-title"]` | The side bar's header title for a container other than the sessions. |
| `[data-navigation-entry="<command>"]` | Another extension's `sidebar/navigation` row. |
| `.app-shell[data-sidebar-location="right"]` | The shell with `workbench.sideBar.location: right`; the rail then carries `[data-side="left"]`. |
| `.omnigent-app[data-layout-width="mobile" \| "desktop"]` | An embed's root, marked with the layout its own box picks (layout plan L9: below 1181px the mobile layout, whatever the window's width); the `md:` / `max-md:` variants follow it inside the embed. Unmarked until the root has a box, and in the standalone app (the window's width decides). |
| `.app-shell[data-window-corner="sidebar" \| "auxiliarybar" \| "main"]` | The part at the window's top-left corner, where the macOS desktop app's traffic lights float (the side bar open on the left, the right panel on the left with the side bar on the right, else the chat): what clears them. |
| `[data-phone-menu-view="<view id>"]`, `[data-titlebar-folded-item]` | A phone's chat header menu rows: another right panel view (opening `[data-testid="view-panel-drawer"]`), a title bar item folded into it. |
| `[data-view-drop-target]` | A place a dragged view can land on (the side bar, an activity bar item, the activity bar, the right panel's tab strip), while it is over it (layout plan L6). |

## Classes

| Hook | Element |
|---|---|
| `.app-shell` | The application shell. |
| `.conversations-sidebar` | The left sidebar. |
| `.sidebar-header-row` | The sidebar's top row (brand and actions). |
| `.sidebar-row` | A sidebar row: a session, a nav entry or a project header. Its height and line box are the density tokens `ui-row-height` and `ui-row-line`; a session's idle text is `ui-sidebar-row-idle-foreground`. |
| `.chat-header` | The session header. With `.session-header-glass` while a session or titled page shows. |
| `.workspace-tab-strip` | The right panel's tab strip. |
| `.otto-working` | The working indicator's animated logo. |
| `.ui-label` | A label that reads the label tokens: font `ui-font-label` (under the Appearance font setting), `ui-label-transform` and `ui-label-tracking`; size and weight `ui-label-size`/`-weight` (section labels and the fold row), `ui-view-title-size`/`-weight` (view titles), `ui-fold-label-size`. |
| `.ui-scroll` | A scroll container with a themed thin scrollbar: `ui-scrollbar-width`, `-size`, `-thumb`, `-thumb-hover`, `-track`. |
| `.ui-scroll-hidden` | A scroll container whose scrollbar stays hidden (tab strips, the turn rail). |

## Variant attributes

A style variant (`web/src/theme/variants.ts`) not at its default sets
`data-omni-<name>` (kebab case: `data-omni-density`, `data-omni-user-bubble`) to its
value on the theme roots (the document root; in the embed, its scope root and inner
root). At every default none is set. A stylesheet may key on them, as the host's
`theme/variants.css` does.

## Custom properties

Besides the registered tokens, these component-level variables are stable:

- `--sidebar-active`, `--sidebar-active-foreground` and the other `--sidebar-*`
  palette colours: the sidebar's selected row.
- `--composer-shadow`: the composer's shadow on hover and while typing.
- `--segmented-active-bg`, `--segmented-inactive-bg`, `--segmented-trough-bg`: segmented
  controls.
- `--menu-surface-bg`, `--menu-surface-border`, `--menu-surface-backdrop-filter`: menus
  and popovers.

## Not hooks

- `data-testid` values exist for tests and may change.
- `aria-label` text is user-facing copy and is translated or reworded freely.
- Utility class text (`[class*="..."]`) changes with every refactor.
