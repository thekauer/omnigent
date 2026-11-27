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
| `composer-send` | The composer's send button otherwise. |
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
VS Code's parts (`workbench.parts.<name>` in the layout service). The titlebar, activitybar,
panel and statusbar parts are reserved: nothing draws them yet.

| Hook | Element |
|---|---|
| `sidebar` | The primary side bar (`aside.conversations-sidebar`), open or closed. |
| `main` | The main area (`[data-slot="main-area"]`): the chat header, the route's page and, on a session, the workspace rail beside it; the grid's own main area on a grid route. |
| `auxiliarybar` | The secondary side bar: the workspace rail (`[data-slot="workspace-panel"]`), classic or tabs. |

## View hooks

Drawn only when an extension contributes them (layout plan L3), so not on the default pages.

| Hook | Element |
|---|---|
| `[data-view="<view id>"]` | A contributed view stacked in the primary side bar (`data-collapsed` while collapsed). |
| `[data-slot="view-container-actions"]` | A container's `viewContainer/title` buttons (`data-view-container` is its id). |
| `[data-slot="view-welcome"]` | A view's welcome content (`contributes.viewsWelcome`). |

## Classes

| Hook | Element |
|---|---|
| `.app-shell` | The application shell. |
| `.conversations-sidebar` | The left sidebar. |
| `.sidebar-header-row` | The sidebar's top row (brand and actions). |
| `.sidebar-row` | A sidebar row: a session, a nav entry or a project header. Its height and line box are the density tokens `ui-row-height` and `ui-row-line`. |
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
