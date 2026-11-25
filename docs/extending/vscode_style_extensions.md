# VS Code-style web extensions (prototype)

Status: prototype. The host and its API ship in every build, where they run the
built-in extensions (the Changes tab is one); dev-path extensions load on the dev
server only. It lives next to the existing extension system
(`web/src/extensions/`, `omnigent/extensions/`, `sdks/web-extension`), which it does
not change.

## Status and queue

This section is the durable state to resume from. Update it at each checkpoint.

**Done:** the prototype host, session header items, the `thekauer.dev` session cost
feature, hardening of the host lifecycle and the dev plugin, the trust model
below, and queue item 1 (reconnect for the user's own cloud dev machines): Node
entries, commands, progress notifications and the host reconnect provider seam,
with the server wake moved onto it; and queue item 3 (Changes 2): extension views
in the classic rail, host-rendered tree views, view/title actions with `when`
clauses and context keys, built-in workspace commands, changed-files events and
a per-chat-session `workspaceState`; and queue item 4 (tab migration, M1 to
M5): built-in extensions load in every build, and the Changes, Content
search, Agents, Tasks, Files and Pull Requests tabs are the built-in
`omnigent.changes`, `omnigent.content-search`, `omnigent.agents`,
`omnigent.tasks`, `omnigent.files` and `omnigent.pull-requests` extensions
(Changes 2 retired into the first). Queue item 2's recognition part is done
too: the git host provider seam, with GitHub built in and the private host
in `thekauer.dev`. What stays in core is listed under "Left in core" below.

**Queue, in order.** Deployment-specific details (machine and host names, exact
commands, the private Git host's URL shape) are kept in the personal extensions
repository's README (`my-extensions/README.md`, "Status and queue"), because this
repository's reference policy keeps them out of here.

1. **Done: reconnect for the user's own cloud dev machines.**
   - The existing "Reconnect host" item (same label and visibility) asks the
     host reconnect providers first; the dev machine provider in `thekauer.dev`
     claims user-connected hosts named like one of the user's machines, resumes
     a stopped machine through its provider's CLI and starts the Omnigent host
     on it over SSH, non-interactively and without opening a browser.
   - The machine list comes from the provider's CLI through a Node command,
     fetched when the host menu opens (providers are asked then, to warm caches)
     and cached stale-while-revalidate (fresh for 60 seconds).
   - The server wake path is the built-in provider, registered first.
   - No `when` clause was needed: the item keeps its own visibility condition,
     and a provider decides on the click. `when` stays on the "Later" list.
   - Real test: passed against a fresh machine that was stopped, resumed by
     Reconnect, and ran the start command (exit code and output in the personal
     extensions README). The machine was stopped again and kept.
   - **Done, follow-up: inline progress.** After user feedback, Reconnect host
     shows its steps inline at the host (a small spinner and the latest step in
     place of the Reconnect item and the inline "Offline · Reconnect"), not as
     a toast, waits for the host to come online with quick liveness checks, and
     shows a failure inline ("Reconnect failed", with the detail in a tooltip).
     This adds the host progress location (scope item 11). Real test against
     the same machine: the host read online about a second after the start
     command (times in the personal extensions README).
   - **Done, review fixes.** The composer's host menu is no longer modal, so
     Escape after a failed reconnect leaves the inline retry reachable at once
     (a modal menu kept the page `aria-hidden` until its exit animation
     ended). Each badge has one always-mounted live region for the steps and
     the failure; a badge without a retry (a grid cell) only spins its dot. A
     reconnect in flight stays shown at its host when its session is left and
     opened again, a failure clears once the host is online, and the offline
     composer placeholder reads "Reconnecting..." while one runs.
   - **Out of scope, noted:** the two desktop-app-only paths of
     `useSessionReconnect` (the remote dev machine connect and this machine's
     `controlHost` start) still show loading and success toasts; they are not
     providers and keep the reconnect dialog for their failures.
2. **Private Git host PR links** in the Pull Requests tab (a GitHub
   Enterprise-style host with numbered shards, such as
   `https://N.git.example.com/<org>/<repo>/pull/<number>` with any N).
   - **Done: recognition.** The git host provider seam (scope item 33), with
     GitHub as the built-in and the private host in `thekauer.dev`: its links
     get chips in the chat and read as pull requests in the link input.
   - **Open: linking.** Linking such a pull request still fails in the
     installed host daemon, not the UI (recorded in the personal extensions
     README). If the server cannot fetch from the private host, the dev
     extension's Node part could fetch the PR on the developer's machine with
     its local `gh` credentials; that waits for the user.
3. **Done: Changes 2,** a new right-panel tab in `thekauer.dev`
   (`src/features/changes2.js`), scope items 12 to 17 below.
   - The session's changed files with VS Code's two view/title commands, "View
     as Tree" and "View as List" (shown by `when` on a context key the
     extension sets), next to Refresh; the mode is kept in `workspaceState`, so
     per chat session. Several repositories group under their roots in both
     modes, as in the Changes list.
   - Rows reuse the classic row components (extracted from `FolderTree.tsx` and
     `FlatFileList.tsx` without changing them): list rows are the Changes list's
     rows, tree rows the Files tree's. The browser verify compares their
     geometry, colors, fonts, status letters and diffstats against the classic
     tabs and saves side-by-side screenshots. Known differences: no search
     field or sort, and no file size (a tree item has no size; the tree's
     trailing column shows the diffstat instead).
   - Classic rail only; the v2 sidebar and the existing tabs are unchanged.
   - Built-in tabs and extension views now resolve through one descriptor path
     (`railTabDescriptor`), a step toward item 4.
4. **Tab migration.** Each right-panel tab becomes a built-in extension, and its
   core code is deleted once the extension passes the same tests.
   Terminals, browser, side chat and the file viewer stay in core. This
   satisfies the AGENTS.md "move a built-in onto each seam" rule.
   - **Done, M1: built-ins in production and Changes.** Scope items 18 to 22.
     `omnigent.changes` reproduces the classic tab on the API, plus "View as
     Tree / View as List" per chat session; FlatFileList, the FilesPanel
     changed-files branch and the `flat` scope are gone, and Changes 2 is
     retired from `thekauer.dev`.
   - **Done, M2: Content search and Agents.** Scope items 23 to 26.
     `omnigent.content-search` and `omnigent.agents` reproduce the classic
     tabs on the API (a search input on views, `workspace.findTextInFiles`,
     keybindings and `<view>.focus`, text-match and session rows, the session
     tree in `omnigent.sessions`, a graph presentation); ContentSearchPanel,
     SubagentsPanel, SubagentsGraphView and AgentCostTag are gone, and the
     `subagents` and `content-search` scopes route to the extension views.
   - **Done, M3: Tasks.** Scope items 27 to 29. `omnigent.tasks` reproduces
     the classic tab on the API (the session's tasks as plain data in
     `omnigent.sessions`, the `omnigent.tasks.*` commands, `showInChat`, a
     host-drawn plan view with Markdown goals, a `picker:workflow` link to the
     host's Run a workflow menu); TasksPanel is gone, its shared parts moved
     to `components/workflows/taskParts.tsx` (the workflow pages use them),
     and the `tasks` scope routes to the extension view.
   - **Done, M4: Files.** Scope items 30 to 32. `omnigent.files`
     reproduces the classic tab on the API (lazy folders through
     `workspace.fs.readDirectory`, `workspace.findFiles` with globs as filter
     fields, the location bar, `TreeView.reveal`, selection and keyboard
     navigation in the host's tree, the Open In menu as a host menu entry,
     and `omnigent.revealInFiles` for the shell); FilesPanel and FolderTree
     are gone, their rows moved to `shell/fileTreeRows.tsx` (the host's tree
     view draws them), and `revealFolderInFilesPanel` became the command.
   - **Done, M5: Pull Requests.** Scope items 33 to 36.
     `omnigent.pull-requests` reproduces the classic tab on the API (the
     session's pull requests as plain data with a watch and its focus, the
     `omnigent.pullRequests.*` commands, a host-drawn pull request view whose
     details, diff and review threads the host draws, like VS Code's diff
     editor); PullRequestPanel and `selectPullRequestInPanel` are gone, the
     details stay as `PullRequestPanelDetails` (the pull request page draws
     them too), and the `github` tab routes to the extension view.
   - **Left in core** (not tabs, or not rail tabs): terminals, the in-app
     browser, side chats, the file viewer, and the v2 sidebar's Files page
     (`FilesPageTree`), which needs views in the v2 sidebar (on the "Later"
     list). Each pull request's details stay host-drawn content.

Stop after item 4. The rest of the "Later" list waits for the user.

**Theming** (themes, tokens and variants) is tracked with its own status in
[theming_plan.md](theming_plan.md).

**Constraints:**

- Commit and push at each green checkpoint. No upstream PRs or comments.
- The user's dev certificate expires 2026-11-24 20:49 UTC.
- Never use the em dash.

## Goals

- Let a web UI feature ship as an extension that is written like a VS Code
  extension: a `package.json` manifest, an ES module with `activate(context)` and
  optional `deactivate()`, and `import * as omnigent from "omnigent"`.
- Keep the API to events and plain-data calls, so the host can later move
  extensions into an isolated Worker without changing extension code.
- One broken extension must not break the UI or other extensions.

## What the prototype proves

- Extensions load from local folders through the Vite dev server, with manifest
  validation and clear errors.
- `import * as omnigent from "omnigent"` resolves to a per-extension API instance,
  as VS Code does for `vscode`, with no build step in the extension.
- A native header slot can render extension items without the extension touching
  React, the DOM or the chat store.
- Live data (session cost) reaches an extension through events derived from the
  existing store, including the SSE `session.usage` path and session switches.
- The first real extension, `thekauer.dev` (a personal extension, kept outside
  this repository), shows the active session's cost left of the agent info button.

## Scope implemented

1. **Dev-path loading** (`web/vite.omnigentExtensions.ts`, wired in `vite.config.ts`).
   `OMNIGENT_WEB_EXTENSION_DEV_PATHS` lists extension folders separated by the
   platform path delimiter (`:` on Linux and macOS). For each folder the plugin
   reads `package.json` and validates `name` (lowercase), `publisher`, `version`
   (semver), `engines.omnigent` (a semver range; required, not yet enforced),
   `browser` (an existing `.js`/`.mjs` file whose real path is inside the folder) and
   `activationEvents` (array of strings; unknown events warn). All problems of a
   folder are reported in one message; duplicate ids are rejected. The extension
   id is `publisher.name`.
   - The list reaches the UI as `virtual:omnigent-dev-extensions`; it is empty in
     production builds.
   - `GET /__omnigent/extensions` returns the scan (extensions, errors, warnings)
     as JSON. It is not under the proxied `/v1` paths.
   - Entries are served through Vite's `/@fs/` route. What else is served and
     imported is limited as described in [Security and trust model](#security-and-trust-model).
   - Adding, editing or removing a manifest rescans, updates the allow list and
     the extension list, and reloads the page; no restart is needed. Adding,
     changing or removing a source file rebuilds the allow list.
   - When declared folders are nested, a file belongs to the deepest one.
   - The dev server prints `[omnigent-extensions] loaded <id> <version> from <dir>`
     for each extension, plus warnings and errors.
2. **In-page host** (`web/src/vscodeExtensions/host.ts`, created by
   `extensionHost.ts` from `main.tsx` in every build to run the built-ins, see
   item 18; `devLoader.ts` adds the dev-path extensions). The dev loader is
   imported dynamically under `import.meta.env.DEV`, so production builds
   contain no loader, endpoint, token or Node host code.
   - Each entry is loaded with dynamic `import()`. Its `activate(context)` is
     awaited; `deactivate()` is called on teardown when present.
   - `import * as omnigent from "omnigent"` inside an extension folder resolves to
     a generated module bound to that extension id (`getExtensionApi(id)` in
     `apiRegistry.ts`). The host registers the API before importing the entry.
   - A failed load, a missing `activate`, or `activate` throwing or rejecting is
     logged as `[omnigent-extensions] <id>: ...`; whatever the extension created
     so far is disposed, and the other extensions still activate.
   - Every entry starts loading at boot, also for `onStartupFinished`
     extensions; only `activate` waits for the activation event. The dev server
     speaks HTTP/1.1, so the browser opens about six connections per origin, and
     the app keeps three or four long-lived SSE streams open
     (`conversationRegistry.ts`, `streamSlots.ts`); module requests made after
     those streams open queue behind them and took well over 10 seconds.
   - Loading the entry and its imports gets 20 seconds (`LOAD_TIMEOUT_MS`), so a
     top-level `await` that never settles is covered. `activate` then gets 10
     seconds (`ACTIVATION_TIMEOUT_MS`, as in the V1 view host); waiting for the
     activation event counts against neither. An entry that finishes loading
     after its load timed out, or after the host was disposed, is never
     activated. A hanging one is logged as failed and
     does not block `start()` or the other extensions; if it finishes later, its
     `deactivate()` runs and everything it created is disposed. The id is not
     activated again in this page, and its API instance is inert from the
     timeout on: `createSessionHeaderItem` returns an inert, unregistered item
     and event subscriptions are no-ops, each logged.
   - Every listener an extension registers on a host event is wrapped: a throw or
     rejection is logged with the extension id and does not reach other listeners.
     A returned promise is recognized by shape (a `then` method), not with
     `instanceof Promise`: the app's telemetry (`lib/telemetry.ts`) loads
     zone.js, which replaces the global `Promise`, so its promises would be
     missed. The same holds for `EventEmitter` listeners.
   - `activationEvents`: `*` activates at boot, `onStartupFinished` after the
     window `load` event. Anything else warns; an extension with no supported
     event is not activated.
   - An id activates at most once per page. The browser caches an entry module
     (and the generated `omnigent` module) bound to the API instance of its first
     activation, so a second activation after a deactivate or a timeout could not
     get a working API. Activating it again is skipped with a warning that names
     the reason (its teardown is still pending, or it already ran in this page;
     reload the page). A rescan reloads the page, so editing an extension still
     works without a restart.
   - `dispose()` cancels activations still loading or activating: they resolve
     as skipped at once, and if one finishes later its `deactivate()` runs and
     everything it created is disposed, so it never joins the active set. After
     `dispose()`, `activate` is skipped.
   - Once an extension's API is disposed, host events already being delivered do
     not reach its listeners, and `createSessionHeaderItem` returns an inert item
     without registering anything.
3. **VS Code basics** (`base.ts`). `Disposable` (with `Disposable.from`),
   `EventEmitter<T>` and `Event<T>` with VS Code semantics: an event is a function
   taking `(listener, thisArgs?, disposables?)` and returning a `Disposable`; a
   listener that throws does not stop the others; listeners added while firing
   take effect on the next fire. `ExtensionContext` has `subscriptions` (disposed
   in order on deactivate) and `extension.{id, version}`.
4. **API** (`api.ts`, typed in `omnigent.d.ts`).
   - `omnigent.window.createSessionHeaderItem(id?, alignment?, priority?)` (with
     and without the id, like `createStatusBarItem`) returns an item with `id`,
     `alignment`, `priority`, `text`, `tooltip`, `show()`, `hide()`, `dispose()`.
     `SessionHeaderItemAlignment.Left` / `.Right`. Text is plain, single line,
     capped at 40 characters; tooltip plain, capped at 200 (host side).
   - `omnigent.sessions.activeSession` (`{ id } | undefined`),
     `onDidChangeActiveSession`.
   - `omnigent.sessions.onDidChangeUsage` with
     `{ sessionId, totalCostUsd: number | null, costHidden, usageByModel }` and
     `omnigent.sessions.activeSessionUsage` for late activators. Values are frozen
     copies; store updates are coalesced per microtask.
   - `omnigent.version`, `omnigent.Disposable`, `omnigent.EventEmitter`.
   - Resources an extension forgets to dispose (items, listeners) are disposed
     when it deactivates.
5. **Header slot** (`SessionHeaderItems.tsx`, rendered by `ChatHeader` immediately
   left of `AgentInfoButton`, under the same `!pending && conversationId`
   condition). Desktop only (`hidden md:inline-flex`), muted small text, tooltip
   through the shared tooltip component, `data-testid="session-header-item-<id>"`.
   Items are per window, not per session. With no visible item the slot renders
   nothing.
   - Order: left-aligned items first, then right-aligned items next to the info
     button. Within a group, higher priority sits closer to that group's edge
     (left edge for `Left`, the info button for `Right`), then by id.
6. **Typed API**: `web/src/vscodeExtensions/omnigent.d.ts` (`declare module
"omnigent"`, modeled on `@types/vscode`). The host implementation is checked
   against it. Extensions vendor a copy until typings are published; the verify
   script fails when the copy drifts.
7. **Store seam**: the chat store's conversation state gains `sessionCostHidden`,
   following the latest cost report (set by the session snapshot, the usage read,
   reconnect and SSE `session.usage`). The snapshot and usage-read paths set it
   under the same staleness and revision guard as `sessionCostUsd`, so the flag
   and the cost always come from the same report. Nothing in the UI reads it yet besides the
   sessions API.

8. **Node entries** (`main` in `package.json`, like VS Code's `main` next to
   `browser`; `web/vite.omnigentNodeExtensions.ts`, `web/vite.omnigentNodeHost.mjs`).
   - `main` is optional and validated like `browser` (an ES module whose real
     path is inside the folder).
   - The dev plugin runs every Node entry in one child process (`fork`, IPC),
     like VS Code's extension host process: extension code never runs in, or
     blocks, the dev server. Dev server shutdown stops it. The host runs in its
     own process group, so processes it spawned die with it.
   - A manifest change, or an edit to any file of an extension with a Node
     entry, restarts the host once its running calls finish, or after a 30
     second grace that fails the calls still running (Node has no hot reload).
   - An unexpected exit fails the calls in flight and restarts the host with
     backoff: 1 second, doubling up to 30, reset after 60 seconds of uptime.
     While the host is down, the command endpoint answers 503.
   - `uncaughtException` and `unhandledRejection` are logged against the
     extension; `process.exit` from extension code is refused.
   - A call fails when its timeout passes (15 minutes by default;
     `registerCommand(id, handler, { timeoutMs })` sets it, at most 24 hours)
     or the page disconnects. There is no cancellation token yet, so the
     handler keeps running until it finishes or the host restarts. Results are
     capped at 1 MiB.
   - `import * as omnigent from "omnigent/node"` resolves, through Node module
     hooks in that process, to the extension's Node API: `version`,
     `Disposable`, `commands.registerCommand`, `window.withProgress` and
     `window.createOutputChannel` (lines go to the dev server output as
     `[omnigent-extensions] <id> (node): ...`). Loading gets 20 seconds and
     `activate` 10, as in the page.
   - The page runs a Node command through
     `POST /__omnigent/extensions/<extension id>/commands/<command id>` with
     `{"args": [...]}`. The answer is NDJSON: `{"type":"progress",...}` lines
     from the command's `withProgress` (start, report, end, per scope), then one
     `{"type":"result","value":...}` or `{"type":"error","message":...}`.
     Guards are listed in the trust model below.
   - The virtual module gives the page the endpoint, the per-boot token and
     each extension's Node command ids; it waits for the Node entries to
     activate (40 seconds at most). In builds it exports `null`, and no plugin
     server code runs.
9. **Commands** (`commands.ts`, `nodeCommands.ts`). One registry per window,
   shared by all extensions, as in VS Code. `registerCommand` returns a
   `Disposable`; a duplicate id (page or Node) throws. `executeCommand` runs a
   page command or routes to the Node command of the same id, and rejects for
   an unknown one. Arguments and results are copied as JSON. An extension's
   command ids start with its own id, and `omnigent.` is reserved for
   built-in owners (page and Node alike); the shell's bridge
   (`omnigent.revealInFiles` from the file viewer) runs only built-in
   commands.
10. **Progress and messages** (`progress.ts`, on the app's sonner toasts;
    `web/src/lib/hostProgress.ts` for the host location).
    `window.withProgress({ title }, task)` shows a loading toast with the
    latest reported message; it is dismissed when the task resolves and
    turns into an error toast with the error's message when it rejects (the
    promise rejects too). `showInformationMessage` and `showErrorMessage`
    show plain toasts. Progress a Node command reports joins the calling
    extension's latest open progress, or gets its own toast when none is open.
    - Progress locations, as VS Code's `ProgressOptions.location`:
      notification (no `location`, the toast above); `{ viewId }` (scope item
      21: above a view's rows); and `{ hostId }`, VS Code's
      `ProgressLocation.Window` scoped to one host: a small spinner (the app's
      `Spinner`) and the title, then the latest message, drawn by the host in
      that host's badge: in the host menu in place of "Reconnect host", and
      beside the composer's host trigger in place of "Offline · Reconnect", in
      the same text style. The newest open progress at a host is shown. A
      failure is not shown at either location; Node progress joins a
      host-located progress like a notification's.
    - `HostProgressLocations` also keeps a host's last reconnect failure
      (short text and detail), set and cleared only by Reconnect host.
11. **Host reconnect providers** (`web/src/lib/hostReconnectProviders.ts`,
    shipped in builds; like VS Code's remote authority resolvers).
    - `hosts.registerReconnectProvider({ canReconnect(host), reconnect(host,
progress) })`, where `host` is plain data: `{ hostId, name, status,
sandboxProvider, resumable }`.
    - `useSessionReconnect.reconnect()` asks the providers in registration
      order and runs the first whose `canReconnect` is true; with none, it does
      what it did before (desktop reconnect or the reconnect dialog).
    - The built-in provider (`omnigent.serverWake`, registered by the module
      itself, so always first) claims resumable managed hosts and runs the
      existing server wake; behavior is unchanged, and it decides
      synchronously on the click as before.
    - `canReconnect` may be async. A throw, a rejection or no answer within 5
      seconds counts as `false` and is logged, so a broken provider cannot
      break the ones after it or the default behavior. Clicks while a provider
      answers are ignored; an answer that lands after the session changed is
      dropped. Answers are checked as thenables, since a page may replace the
      global `Promise`.
    - The host menu asks every provider about an offline host when it opens,
      and ignores the answers, so providers can warm caches before the click.
    - Reconnect host runs every provider, built-in or extension, the same
      way, with no toast: its progress is the host location above, starting
      with "Reconnecting...". The provider's `progress` (and a Node command's
      progress while it runs) reports the next steps, such as "Starting
      machine..." and "Starting omni...". The menu stays open on the click, so
      the steps replace the item there.
    - Clicking again while it runs does nothing new: it joins the run (the
      item and the inline button are replaced by the spinner anyway), and a
      joined run's reporters all get the progress so far and the rest.
    - When `reconnect` resolves, the host shows "Waiting for host...",
      re-polls the session's `/health` and invalidates the hosts query every
      2 seconds, and clears the progress as soon as the host reads online, so
      the badge shows the normal online state and Reconnect host disappears.
      After 90 seconds it shows "Host didn't come online" instead, with the
      provider's `{ detail }` (a summary of what ran) in the tooltip.
    - A rejection shows "Reconnect failed" inline, red, with the error (and
      any sign-in hint it carries) in a tooltip and the detail in an
      `aria-describedby` text; Reconnect host stays next to it as the retry,
      which clears the failure. With the menu closed it shows beside the
      composer trigger as "Reconnect failed · Reconnect".
    - The built-in wake reports the same steps ("Reconnecting...", the
      server's launch stage, then "Waiting for host...") and keeps its own
      end conditions (online, the health-poll count, the stage limit, a
      stopped stage); its error toasts became the same inline failures.
    - Inline state belongs to the session on screen: a session or host switch
      and an unmount end the progress and clear the failure, and a late answer
      of the old run shows nothing. An extension provider's run stays shown at
      its host (its steps, from the API's per-host run) until it settles, so
      opening the session again shows it running; what it resolves to is only
      seen by the session that started it. A stored failure clears once the
      host reads online.
    - Only a badge with a retry (the composer's, and the mobile header's)
      shows a failure; a grid cell's badge spins its dot while a reconnect
      runs and shows no step beside it. Each badge has one `aria-live`
      region, mounted from the start, that speaks the step or the failure
      (with its detail); the visible step texts are not live regions. The
      host menu is not modal, as the header's and the agent picker's, so the
      rest of the page stays reachable while it is open or closing.
    - While a reconnect runs, the offline composer placeholder reads
      "Reconnecting..." instead of asking for a reconnect.

12. **Rail view registry** (`web/src/shell/railViews.ts`, `railTabs.ts`,
    `railViewIcons.ts`, `workspacePanelTabs.ts`; shipped in builds).
    - The rail's tab ids are `BUILT_IN_RAIL_TABS` plus `ext:<view id>` for
      extension views; `isRailTab` (one function, used by the per-session store)
      accepts both, so a selected extension tab survives a reload. Unknown or
      malformed ids are still dropped on restore.
    - `railViews` holds each view as plain data: contribution (`id`,
      `extensionId`, `name`, `icon`) plus state (`title`, `description`,
      `badge`, `message`, `loading`, title `actions`, `tree` model). Views sort
      by extension id, then manifest order, and follow the built-in tabs in the
      strip, with the next ⌃N digits, in the narrow-rail picker too.
    - `railTabDescriptor(tab, views)` gives every trigger its descriptor: a
      built-in's from `WORKSPACE_PANEL_TABS` (unchanged), a view's from the
      registry (badge drawn like the Changes count). `resolveWorkspaceActiveView`
      has an `extension` scope; the content slot renders `ExtensionRailView`.
    - Extensions load after the app mounts, so `main.tsx` marks the registry as
      loading while the dev loader runs: a restored `ext:` tab shows a spinner
      until its view registers, and falls back like any unavailable tab once
      loading settled without it. Builds never load extensions, so an `ext:`
      tab from a dev session falls back at once there.
    - Icons are lucide names from an allowlist (`file-diff`, `git-compare`,
      `list-tree`, `list`, `refresh-cw`, `git-branch` and a few more); anything
      else draws a generic icon.
13. **Tree views** (`window.createTreeView(viewId, { treeDataProvider })`;
    `treeView.ts` turns a provider into the plain `RailTreeModel` the rail
    draws, `ExtensionRailView.tsx` and `treeRows.ts` draw it).
    - `getChildren(element?)` and `getTreeItem(element)` may return promises;
      elements stay in the host, the rail sees handles (`id:<TreeItem.id>`, or
      parent plus label) and checked, capped items.
    - `TreeItem` fields: `label`, `description` (`true` uses the resource's
      folder), `tooltip`, `resourceUri` (`{ path }`), `iconPath` (`file`,
      `folder` or an allowlisted icon), `decoration` (`text`, `parts` with a
      `text` and a `tone` of added, removed or muted, and `title`),
      `gitStatus`, `collapsibleState`, `command`, `contextValue`, `id`.
    - Rows: a collapsible `folder` item is the Files tree's folder row (icon,
      chevron on hover, colored name with `/`, status dot, copy button); other
      collapsible items are the Changes list's group header (chevron, icon,
      label, description as the count); a resource leaf with a `description` is
      the Changes list's row (name, folder subtitle, diffstat, A/M/D, copy and
      download on hover); one without is the Files tree's file row (indent
      guides, colored name, A/M/D, decoration in the trailing column).
    - Windowed with the same virtualizer settings as the Files tree (rows of a
      tree without folders are spaced like the Changes list). Expand state is
      kept per view and chat session for the page's lifetime;
      `onDidChangeTreeData` reloads the roots and then each open node level by
      level, swapping them in at once.
    - Clicking a row runs its `command` (JSON arguments); a failure is logged
      against the extension. A provider that throws shows no rows and is logged.
    - `TreeView` has `title`, `description`, `message` (shown above the rows),
      `badge` (`{ value, tooltip }`, on the tab) and `dispose()`, which leaves
      the view in VS Code's "There is no data provider registered" state.
14. **Contributions** (`contributions.ts`, `viewsService.ts`; `contributes` is
    passed through by the dev plugin and checked in the page).
    - `contributes.views["omnigent.rightPanel"]`: `{ id, name, icon }`. Ids
      must start with the extension id. Views register before the extension
      activates and show "Loading" until it settled.
    - `contributes.commands`: `{ command, title, icon, toggled? }`; `toggled`
      is a `when` clause, and a button of such a command has `aria-pressed`.
    - `contributes.menus["view/title"]`: `{ command, when?, group }`. Entries in
      group `navigation` are buttons in the view's title bar, styled like the
      Changes tab's Refresh; other groups are not shown yet. Unknown containers,
      menus and malformed entries are warnings; an invalid `when` never holds.
15. **`when` clauses and context keys** (`when.ts`, `contextKeys.ts`). `key`,
    `!`, `==`/`===`, `!=`/`!==`, `&&`, `||`, parentheses, `true`/`false`,
    quoted or bare values; precedence `!`, then comparisons, `&&`, `||`. Values
    compare by their string form, `true`/`false` as booleans. Context keys are
    window-wide, set by `commands.executeCommand("setContext", key, value)`
    (strings, numbers, booleans, null or short arrays; `undefined` removes); the
    view/title evaluation adds `view` (the view's id).
16. **Built-in commands and workspace data** (`builtinCommands.ts`,
    `workspaceService.ts`, `web/src/shell/workspaceBridge.ts`).
    - `omnigent.openFile(path)` calls the shell's `openFileViewer`;
      `omnigent.refreshChangedFiles()` invalidates the session's
      `["workspace-changed-files", id]` query. The shell (AppShell) registers
      both on the bridge and publishes the active session's changed files from
      its existing query, so SSE `session.changed_files.invalidated` and the
      end-of-turn refetch reach extensions with no new fetches.
    - `workspace.getChangedFiles()` returns a frozen camelCase snapshot
      (`path`, `name`, `repositoryRoot`, `status` added/modified/deleted,
      `bytes`, `modifiedAt`, `linesAdded`, `linesRemoved`), `undefined` while
      loading; `workspace.changedFilesError` says why they could not be
      loaded; `workspace.onDidChangeChangedFiles` fires `{ sessionId, files,
error? }`, coalesced per microtask, also on session switches.
17. **`context.workspaceState`** (`memento.ts`, stored by
    `lib/sessionWorkspaceState.ts`). Synchronous `get(key, default?)` (a copy),
    `keys()`, and `update(key, value)` (JSON; `undefined` deletes), always on
    the chat session on screen at the call. Stored as the session's
    `extensionState` bucket, so it shares the store's LRU of 100 sessions; per
    session at most 20 extensions, 50 keys of up to 128 characters and 8 KiB of
    JSON per extension. `update` rejects without a session or over a cap;
    stored buckets that break a cap are dropped on read.

18. **Built-in extensions** (`web/src/builtinExtensions/`,
    `vscodeExtensions/extensionHost.ts`, `builtinApi.ts`, `manifest.ts`).
    - Each built-in is a folder `<publisher>.<name>/` (publisher `omnigent`)
      with a `package.json` manifest of the same shape as a dev extension's
      and an entry module. `index.ts` imports them statically and checks
      their manifests with the validator the dev plugin uses
      (`manifest.ts`, pure, also run in a unit test); a manifest that fails
      is logged and left out.
    - Built-in code uses the same typed API through a static binding,
      `bindExtensionApi(id)` (getters onto the instance the host registers
      before activation). A unit test keeps the boundary: built-in sources
      import only relative files, `omnigent` types and that binding; no
      React, store or other app code.
    - `startExtensionHost()` in `main.tsx` creates the window's one host and
      its services and starts the built-ins before the first render, in
      every build. Contributions register synchronously, and a statically
      imported entry activates within microtasks, so a built-in view is
      there for the first paint. The dev loader adds dev-path extensions
      to the same host and sets the Node command route
      (`CommandRegistry.setNodeRoute`), still only under
      `import.meta.env.DEV`.
    - The embed (`OmnigentApp` in `embed.tsx`) runs the same host through
      `useWindowExtensionHost()`: it starts the host and the built-ins
      before its first render and holds it while mounted. Every
      `OmnigentApp` on the page shares the one host; after the last one
      unmounts it is disposed (deferred a task, so a StrictMode or route
      remount keeps it), unless the standalone app keeps it for the page.
      Dev-path extensions never load in the embed.
    - Built-ins have no load timeout (the module is in the bundle) and 60
      seconds to activate. When one fails, its views show an error state
      ("<name> could not be loaded") and the failure is logged; a built-in
      tab whose view never registered shows the same error, never a blank
      panel.
19. **Built-in tabs backed by extension views.** A built-in extension's
    view may name `builtInTab` (refused with a warning for other
    extensions). It then stands in for that tab: the tab keeps its id
    (`changes`, so a saved `rightRailTab: "changes"` still works), its place,
    its ⌃N digit and its visibility rule, and takes its label, icon and
    badge from the view. `resolveWorkspaceActiveView` routes such a tab to
    the `extension` scope with the view's id; the extension strip leaves
    the view out.
20. **Workspaces on screen** (`shell/workspaceBridge.ts`,
    `useWorkspaceBridgeSource.ts`). Each workspace surface registers a
    source: AppShell for the session in the route, and each grid cell; the
    most recently activated active source is the one on screen (AppShell
    while not in the grid, the selected cell in it). A source publishes the
    session's changed files, why they cannot load (`availability`:
    agent asleep, sandbox offline or starting; or an error string), whether
    the host serves an asleep agent's files, and its file settings (sort
    order, hidden files), and handles `openFile`, the refresh and settings
    changes. `workspace.activeSessionId` and `workspaceState` follow it, so
    a grid cell's Changes tab shows that cell's files and opens them in that
    cell. A view drawn for a session other than the one whose data the
    provider has waits ("Loading…") instead of showing another session's
    rows. A grid cell also drops a saved `ext:` tab whose view is gone, as
    AppShell does.
21. **API additions for workspace views.**
    - `workspace.availability`, `servedFromHost`, `activeSessionId`; the
      change event carries the first two.
    - `workspace.getConfiguration(section)` / `onDidChangeConfiguration`,
      as in VS Code, for `omnigent.files.sortOrder` and
      `omnigent.files.showHidden` (shared with the Files tab and the file
      viewer's prev/next order); each is also the context key
      `config.<name>`, so `when` and `toggled` can read it.
    - `TreeView.visible` / `onDidChangeVisibility` (VS Code), fired as a
      drawn copy mounts, unmounts, or its rail is hidden. The Changes
      extension refetches a list that failed when it comes on screen (the
      502 on a first fetch), as the classic tab's own query did on mount;
      the host has no second retry of its own.
    - `TreeView.filter` / `onDidChangeFilter` with the view contribution's
      `filter: { placeholder, ariaLabel }`: a host-drawn filter field above
      the rows, its text kept per view and chat session; the extension
      filters its own data.
    - `TreeView.message` takes `[text](command:id)` links (drawn as buttons,
      as a trusted `MarkdownString`), `messageSeverity: "error"`, `notice`
      (host-drawn states: agent asleep, sandbox offline or starting), and
      `tag` (a pill after the title, such as "Asleep").
    - `TreeItem.size` (bytes, drawn like the list's file size).
    - Menus: group `filter` of `view/title` draws next to the filter field;
      `contributes.submenus` with their own menus, drawn as a dropdown whose
      button names the toggled entry (a sort order); menu entries may set
      `tooltip` and `tone: "warning"`. While a title action's command runs,
      its button is disabled and its icon spins.
    - More allowlisted icons (sort, eye-off, moon and others).
22. **The built-in Changes tab** (`builtinExtensions/omnigent.changes/`).
    The flat list with folder subtitles, A/M/D and `+N −M`, repository
    groups, the search field ("Find changed files by name"), the Sort menu
    and hidden-files toggle (on the shared settings), Refresh, copy, download
    and reveal on rows (host row actions of resource rows), the changed-file
    badge, scroll restore (host-side for every view, per view and session),
    the agent-asleep and sandbox states, the "Asleep" tag, and the
    "N files hidden. Click to show" and "No changed files match" lines.
    Plus "View as Tree" / "View as List" (`omnigent.changes.viewMode`
    context key), kept per chat session in `workspaceState`. The mobile
    drawer draws the same view with a close button; grid cells draw it for
    their own session.
    - Hardening from the review of the previous step: all sessions'
      mementos share a 256 KiB cap (oldest dropped first) and a full
      storage quota evicts the oldest mementos and retries; a `__proto__`
      key is stored like any other; the store's parse is cached by its raw
      text; `when` clauses are capped at 1024 characters and 32 levels of
      nesting; tree handles are kept for the current and the previous root
      load only; tree reloads are coalesced per animation frame, no-op view
      updates are skipped, and AppShell subscribes to view ids only.
    - Fixes from the M1 review: on a grid route AppShell's own workspace
      source is inactive (a parent's effects run after its children's, so
      it would otherwise sit in front of the selected cell and leave its
      Changes tab loading); the built-in import boundary test reads every
      import form (static, side-effect, type-only, dynamic, re-exports) with
      the TypeScript scanner and resolves relative paths, which must stay in
      the extension's folder; a menu entry's `tooltip` may name context keys
      as `${key}` (its own `<extension id>.*` keys, `view` and the host's
      `config.*` settings only), so the hidden-files warning names the count again ("3
      files in hidden directories. Click to show."); tree rows put the
      diffstat before the A/M/D letter, as list rows do; the Sort menu is
      hidden while the list failed (`omnigent.changes.loadFailed`); and a
      failed list shows the server's `detail` (such as a `git status`
      timeout) rather than "502 Bad Gateway".
    - Host behavior built-ins rely on, part of the API: a tree item with a
      `resourceUri` and a `description` and no children is drawn as the
      Changes list's row (`ChangedFileRow`: name, folder, diffstat, A/M/D,
      size, with copy, download and reveal on hover); a collapsible item
      with `iconPath: "folder"` as the Files tree's folder row; any other
      resource leaf as the Files tree's file row. A built-in tab is looked up
      by its view's `builtInTab` (WorkspacePanel, FilesPanelDrawer and grid
      cells all resolve `changes` that way), so the view's id can change
      without touching the shell.

23. **API additions for M2** (`omnigent.d.ts`).
    - `contributes.views[...].searchInput`: `{ placeholder, ariaLabel,
submitTitle, options: [{ id, title }], fields: [{ id, label,
placeholder }], fieldsToggle: { title, ariaLabel }, fieldsHint, hint }`.
      The host draws the form in place of the view's title bar (as VS Code's
      Search view keeps its title in the container) and keeps its value per
      view and chat session. `TreeView.searchInput` (like a
      `SourceControl.inputBox`): `value` (`{ query, options, fields }`),
      `onDidChangeValue` (also on a workspace switch), `onDidAccept` (Enter or
      the button, only while `enabled` and without a `validationMessage`),
      `validationMessage` (drawn as an alert) and `enabled`.
    - `workspace.findTextInFiles(query, { include, exclude }, token?)` with
      VS Code's `TextSearchQuery` (`pattern`, `isRegExp`, `isCaseSensitive`,
      `isWordMatch`): the workspace on screen at the call, through the
      existing content-search route (the workspace API first). Resolves to
      `{ matches: [{ path, line, column, preview: { text, matches } }],
limitHit, message }`; a cancelled token aborts the request and rejects
      with an error named "Canceled". `workspace.validateTextSearchQuery`
      says why a query cannot run (`tooLong`, `unopenedGroup`, `verbose`),
      the whole-word checks the classic form made before sending.
      `include` and `exclude` must be strings of at most 4096 characters
      (otherwise a TypeError, never a silent cut), and at most 2000 matches
      come back, with `limitHit` set past that.
      `workspace.onDidChangeActiveSessionId` fires when another workspace
      comes on screen, for views that keep per-session state without
      following every changed-files update.
      `CancellationTokenSource` is exported, as in VS Code.
    - `contributes.keybindings`: `{ command, key, mac?, when? }` with keys like
      `ctrl+shift+f` (letters, digits, F1 to F12), matched on the physical key
      by one capture listener on the window, so they work from editors and
      terminals; a match runs the command and stops the event. A chord must
      hold Ctrl, Cmd or Alt or press an F-key, and one the app already owns
      (its shortcut registries, window and text-editing keys) is refused with
      a warning; built-ins override an app chord only through an allowlist
      (`appKeyChords.ts`: content search's ⌘⇧F). While a text field has
      focus (the `inputFocus` context key), only Ctrl or Cmd chords run, and
      AltGr off macOS is typing, not Ctrl+Alt.
    - Theme contributions (theming plan M6, `docs/extending/theming_plan.md`):
      `contributes.themes` `{ id, label, uiTheme, path, family? }` (`uiTheme`
      light or dark, VS Code's `vs`/`vs-dark`/`hc-*` accepted; the full id is
      `<extension id>/<id>`; a `family` pairs a light and a dark member, and a
      theme without one forces its mode), `contributes.colors`
      `{ id, description, defaults: { light, dark } }` registered as
      `--x-<encoded extension id>-<id>` (an injective encoding without `-`:
      `a`-`z` and `0`-`9` stay, `.` is `__`, any other character `_` and two hex
      digits, so `acme.theme-fixture`'s `glow` is `--x-acme__theme_2dfixture-glow`;
      a VS Code-style id `<extension id>.<camelCaseName>` is taken too, its name in
      kebab case: `thekauer.dev.costBadge` is `--x-thekauer__dev-cost-badge`),
      and `contributes.fonts` `{ family, src, weight?, style? }` (`.woff2` only),
      loaded with the FontFace API as `x-<encoded extension id>-<family>` while a theme of the
      extension is active. Problems are warnings (`theme/themeContributions.ts`).
      A theme file's `colors` (Omnigent token ids, the extension's colours and the
      curated VS Code aliases of `theme/vscodeColorAliases.ts`), `tokenColors`
      (registered as a syntax theme the `syntax-theme-*` tokens name),
      `terminal`, `brand` (`logo`, `wordmark`, `favicon`, `appName`) and
      `omnigent.tokens`/`.options`/`.variants`/`.swatch` (the picker's preview
      colours `bg`, `card`, `accent`, `border`, `text`; else resolved from the
      theme's colours and option choices) are checked by
      `theme/themeFile.ts` and `theme/validate.ts`; `theme/themeService.ts`
      applies them (`list()`, `select()`, `getActive()`, `setOption()`, and the
      built-in `omnigent.selectColorTheme` command). A theme entry may also give
      a `description` and, on a family's member, a `familyLabel`. The theme
      picker (⌘K, Select theme) and Settings > Appearance > Color theme show one
      list, `themeService.entries()`: the built-in themes, then each extension's
      under its `displayName`, a family as one entry, a single-mode theme marked
      "Dark only"/"Light only", a chosen theme whose extension is missing as
      "Unavailable" (the choice kept, the default shown). The picker previews the
      highlighted theme live (`preview()`), and Escape reverts it. Under the
      picker, Settings shows the chosen theme's options and an Advanced editor
      for colour customizations (JSON, global and `[<theme id>]`, checked once
      typing pauses, with inline errors). A `[<id>]` key applies to what is on
      screen: a family's `[<extension id>/<family>]` in both modes, then the
      member's own `[<extension id>/<member id>]` in its mode only (so
      `[acme.x/paper]` holds in light mode); a built-in palette also takes its
      palette id (`[nord]`), below `[omnigent.themes/nord]` and
      `[omnigent.themes/nord-dark]`. An id that names no theme is an error; a
      theme of an extension that isn't installed only a warning (kept, applied
      once it is). A single-mode theme locks and dims the mode control ("Set by
      theme"). The built-in palettes are the `omnigent.themes` built-in
      extension (`builtinExtensions/builtInThemes.ts` generates its themes from
      `lib/themePalette.ts`); their files name `omnigent.palette`, which only a
      built-in's theme may: the service applies that palette's precompiled CSS
      (`data-theme`) instead of a runtime stylesheet, and stores its id
      (`nord`) as before. A product's policy (`setProductPolicy`, filled by M10):
      `allowed` limits the list, `select()`, `preview()` and
      `omnigent.selectColorTheme` (by entry or member id, the chosen theme
      always kept); `hidePicker` hides the picker command and Settings' picker
      row (and the built-in palette editor, which chooses Custom), keeping the
      chosen theme's options and Advanced; `hideCustomizations` hides those two.
      A non-built-in extension under the `omnigent` publisher, or with the id of
      one already loaded, is skipped with a warning.
    - The plugin read API (theming plan M8): `window.activeColorTheme`
      (`{ id, label, kind, variants }`, plain data: the member theme on screen,
      `omnigent.themes/<palette>-<mode>` for a built-in, the default's while the
      chosen theme's extension is missing; `kind` a `ColorThemeKind`, VS Code's
      values, Light or Dark for now), `window.onDidChangeActiveColorTheme`
      (after a committed change is applied: a theme chosen, an option or variant,
      the mode; never for the picker's preview of a theme or a mode),
      `window.getThemeToken(id)` (the computed value on the innermost theme root,
      `""` when unset; registry ids and the caller's own colours only, else
      undefined with a warning) and `ThemeColor` (`new ThemeColor(id)`, the same
      ids), taken by `SessionHeaderItem.color` and drawn as `var(--<token>)`;
      a colour string there must pass the theme validator (registry `var()`s
      only). Unknown colours are dropped with a warning (`theme/colorThemes.ts`). The dev plugin reads the
      theme files at scan time and inlines them into the virtual module
      (`ExtensionDescription.files`; built-ins import them statically), hands an
      edited file to the page without a reload, and serves the fonts and brand
      images it checked (see the trust model).
    - Every contributed view gets VS Code's `<view id>.focus` command. It asks
      the workspace rail of the session on screen (`useWorkspaceRail`,
      registered by WorkspacePanel) to select the view's tab, reveal the rail
      and focus the view's input once it shows. The host sets
      `view.<view id>.available` while that rail can show the view (its tab is
      in the strip, the session is not pending, not on a phone).
    - `window.withProgress({ title, location: { viewId } }, task)`: a spinner
      and the title above the view's rows (marked busy), while the chat
      session it started in is on screen; no toast.
    - Tree items: `label` may be a `TreeItemLabel` with `highlights`; `line`
      (a text match: the line number, then the label in monospace with its
      highlights marked); `accessibilityInformation.label`; `resourceUri`
      with `scheme: "session"` (a session row, a link to the session);
      `iconPath` as `{ agent, harness }` (the agent's harness logo, as the
      composer draws it); `status: { state, label, detail? }` (the agent
      status tile; done and idle rows are dimmed unless on screen); and a
      decoration part's `tooltip`. A collapsible `iconPath: "file"` resource
      row is the results list's file heading.
    - `TreeView.presentation = "graph"`: the host draws the tree as a graph of
      cards (every node loaded), as the Agents graph did. `ViewBadge` gains
      `label` (text instead of the value, such as "2/5") and `tone`
      (`success` or `muted`). Title actions of a `toggled` command are the
      compact pressed-or-not buttons of a segmented control.
    - `omnigent.sessions`: `activeSessionTreeRoot` and
      `onDidChangeActiveSessionTree` (the tree of the workspace on screen, as
      AppShell or the grid cell resolves its root); `getChildSessions(id)`
      returns `{ sessions, loading, error }` with each sub-agent's `label`,
      `title`, `tool`, `agent`, `status`, `busy`, `preview`, `routedModel`
      (`{ id, label }`) and `cost` (`{ usd, estimated }`, the active tree's,
      while the server reports costs); `getSession(id)` the root's `label`,
      `agent`, `kind`, `preview`, `status` and `cost`;
      `onDidChangeChildSessions({ sessionIds })`, coalesced per microtask.
      They read the cache entries the app's hooks use (`QueryObserver`s on the
      workspace's query client, same keys and fetch options), so the SSE
      watch-set keeps them live; at most 100 lists and 100 sessions are
      observed, the least recently asked for released first.
    - Commands: `omnigent.openSession(id)`, `omnigent.openSubagent(id)` (a
      tab beside the chat with the user's setting, else navigation; the
      workspace decides with `openSessionFromView`), and
      `omnigent.openFile(path, { line, column })`.
    - Context-key `${key}` references in menu tooltips (from the M1 review).
24. **The built-in Content search tab** (`builtinExtensions/omnigent.content-search/`).
    The form (query, Filter files with Include and Exclude, Search, Match
    case, Whole word, Regular expression, the notes), its alerts for a query
    that cannot match whole words, "Searching…", the error, "No matches" and
    "N matching lines in M files", the truncation or searcher warning, the
    results grouped by file with the match marked, and a match opening its
    file at its line and column (on a phone, a match from the drawer returns
    to it when the file closes). Each chat session keeps its form, its latest
    results and a search still running when another session comes on screen.
    ⌘⇧F / Ctrl+Shift+F is its `contributes.keybindings` on
    `omnigent.content-search.view.focus`; the tab keeps its id, place, label,
    ⌃N digit and the ⌘⇧F in its tooltip. The input cache no longer has a
    `useQuery` without a `queryFn` (the "No queryFn" console errors are gone).
25. **The built-in Agents tab** (`builtinExtensions/omnigent.agents/`). The
    main row (harness avatar, agent or product name, cost, latest message),
    sub-agents to three levels with the dashed root guide, circle-dot and
    corner connectors, collapse toggles, status tiles, role or harness icons,
    labels, routed model, cost and preview, the row on screen highlighted and
    settled rows dimmed, Loading and "Failed to load agents.", List view /
    Graph view, and the tab's badge (all agents, working/total in the success
    tone). A row is a link (cmd/middle-click opens a tab, session-scoped
    params dropped, global ones kept); a plain click runs
    `omnigent.openSubagent`. Grid cells and the phone drawer draw the same
    view for their own session.
26. **Shell wiring.** `content-search` and `subagents` join `changes` as
    built-in tabs whose page is the extension view (`resolveWorkspaceActiveView`),
    still only where their old rule allowed (content search on, an agent tree);
    WorkspacePanel, the v2 sidebar's Agents and Search pages and the phone
    drawers draw `ExtensionRailView`; the workspace source publishes the tree
    root, whether costs are reported, a session opener and its query client.

27. **API additions for M3** (`omnigent.d.ts`).
    - `omnigent.sessions.activeSessionTasks` (`SessionTasks`: `loading`,
      `error`, `plan` with its name, workflow, workflow name and whether it is
      complete, `tasks`, `paused`, `working`, `stopping`, the composer's
      `actions` and `workflowsLinked`), `onDidChangeActiveSessionTasks`
      (coalesced per microtask) and `watchActiveSessionTasks()`, a
      `Disposable` that keeps the journal loading while held. Each
      `SessionTask` carries its id, name, Markdown goal, `dependsOn`, state,
      newest status, `startedAt`, `native`, `activeForm`, its `history` (each
      status with `restart` marking a new attempt), `chatMarker`, the
      `question` its agent waits on and `blockedBy` (failed upstream tasks).
      Frozen copies, for the workspace on screen (the shell's session or the
      selected grid cell); the surface publishes them from the hooks the
      classic panel used (`shell/useWorkspaceTasksSource.ts`), only while
      watched, keeping the last snapshot while the view is hidden.
    - Commands, each for the workspace on screen and refusing another
      session: `omnigent.tasks.runTaskAction(sessionId, action, taskName)`,
      `.stop(sessionId)`, `.continuePlan(sessionId, planName)`,
      `.saveAsWorkflow(sessionId, planName)`, `.startWorkflow(sessionId, {
description?, workflowId? })` and `.reload(sessionId)`; plus
      `omnigent.showInChat(sessionId, markerId)` (closes the phone's drawer,
      keeps the route's other params) and `omnigent.openWorkflow(id)`.
    - `window.createPlanView(viewId)`: a `PlanView` with `content`,
      `visible`, `onDidChangeVisibility` and `dispose()`. `PlanViewContent`
      is plain data the host checks (`planContent.ts`) and draws
      (`shell/extensionViews/ViewPlan.tsx`): `loading`, `error` with a retry
      command, `empty` with a message whose `[text](picker:workflow)` link
      opens the host's Run a workflow menu (the composer's menu, unchanged),
      or `plan`: heading, workflow chip, "Updated" time, summary, counts,
      paused label, run control (Stop, Stopping…, Continue, the composer's
      `PlanRunButton`), the graph, the plan's ⋯ menu, the tasks with their
      ⋯ action and row command, whether they say what they wait on, and the
      workflow whose runs follow the list. Goals render as Markdown (and
      mermaid) through the host, as a trusted `MarkdownString` would. Times
      tick in the host.
    - The `workflow` icon on the allowlist.
28. **The built-in Tasks tab** (`builtinExtensions/omnigent.tasks/`). The
    loading skeleton, the journal error with Retry, "No tasks yet" with "run
    a workflow" (saved workflows or a new one; a pending check opens nothing
    in the next session), the sticky header with the plan's name, the
    Workflow chip (linked with the Workflows page on), "Updated …", Stop,
    Stopping… and Continue, the graph button and Save as workflow… (disabled
    once saved), the summary with its counts and paused label, the progress
    strip with its cards, ⋯ menus and dependency arcs, the rows with their
    glyphs, details, elapsed and end times, Can't start, the history with
    "After", the whole goal and restarts, a row's click scrolling the chat to
    its marker, a chat marker scrolling to and highlighting its row, the
    question override on Continue, the graph overlay with its ⋯ actions, and
    the workflow runs below a workflow's run. The tab keeps its id, place,
    label, icon and ⌃N digit; it has no badge, as before.
29. **Shell wiring.** `tasks` joins the built-in tabs whose page is the
    extension view (`resolveWorkspaceActiveView`), still only where its old
    rule allowed (workflows with session journals, or the agent's own task
    list); WorkspacePanel, grid cells, the v2 sidebar's Tasks page and the
    phone drawer draw `ExtensionRailView`; AppShell and each grid cell mount a
    `WorkspaceTasksPublisher` on their workspace source.

30. **API additions for M4** (`omnigent.d.ts`).
    - `workspace.rootPath` (the workspace root's absolute path, also on the
      changed-files event), `workspace.fs.readDirectory(path)` and
      `workspace.findFiles({ pattern, include, exclude, location }, token?)`,
      for the workspace on screen at the call. A path is `""` for the root,
      workspace-relative inside it, or absolute on the host outside it;
      entries (`path`, `name`, `type`, `bytes`, `modifiedAt`) come back in
      the same form. Listings go through the query cache the Files views
      shared (`["workspace-all-files", session, location]`, 30 seconds
      fresh), so the server's invalidation reaches them. A listing rejects
      with an error named `FileSystemError` whose `code` is `Unavailable`,
      `RunnerOffline`, `NoPermissions` (with `reachableRoots`) or `Unknown`;
      a relative path with `..` is refused. A cancelled search settles at
      once with "Canceled". `workspace.onDidChangeFiles` fires when the
      session's listings were invalidated (a turn ended, a refresh, the
      server said so), and `omnigent.refreshFiles` marks them stale and
      reloads the changed files.
    - `TreeDataProvider.getChildren` is called as a folder opens, so a lazy
      folder answers from its cache or with a placeholder item and fires
      `onDidChangeTreeData` when its listing lands; an item with neither a
      command nor a `resourceUri` is drawn as a muted placeholder line.
    - `TreeView.reveal(element, { select, focus, expand })` with
      `getParent` (VS Code's): the host opens the ancestors (loading lazy
      ones level by level), scrolls the row to the middle, flashes it and
      selects or focuses it, once; a reveal for a view not drawn waits for
      its session's next draw. `selection` and `onDidChangeSelection`; the
      host tree moves between rows with the arrow keys, Home and End, and
      Right and Left open, close or go to the parent.
    - `TreeView.location` (`{ path, root, error }`, absolute) with a view
      contribution's `location: true`: the host draws its location bar (the
      folder's name, Back one folder, Back to working folder, the folder
      picker where the session may browse its host, the error line) in
      place of the title, the copy-folder-path button before the title
      actions, and `onDidChangeLocation` fires with the picked folder.
    - `filter.fields` on a view contribution (`{ id, label, placeholder }`),
      `TreeView.filterFields` per chat session, and `TreeView.setFilter`
      (the extension clears the search after revealing a result); two host
      menu entries: `omnigent.toggleFilterFields` (the fields toggle, with
      its dot while fields hold text) and the `omnigent.openIn` submenu (the
      Open In menu for the view's location), placed by the manifest.
      `location: true` and these two entries are for built-in extensions;
      a dev extension's are ignored with a warning.
    - A collapsible folder row runs its command on a double click; a
      non-collapsible folder resource is the search results' folder row;
      a file label with a `/` is drawn as a path, truncated at its start; a
      file row shows its `size`. Folder rows animate their children in and
      out (180 ms), as the classic tree did.
    - Fixes from the M2 review: non-error view messages have
      `role="status"`; text-match lines and path labels keep up to 2000
      characters, so a match past column 200 keeps its mark.
31. **The built-in Files tab** (`builtinExtensions/omnigent.files/`). The
    location bar with copy, Refresh (spinning until the folder reloaded) and
    Open In; the search field ("Find files by name"), Sort, the include and
    exclude fields with their toggle, and the hidden-files toggle (on the
    shared settings, its warning tone and count as in Changes); folders
    first, then files in the shared order (equal to core's, tested);
    folders listed lazily as they open, with "Loading…", "Failed to load
    this folder." and the all-hidden line under them; the session's changed
    files laid over the listing (created and deleted files the listing
    lacks, the A/M/D letters, the folders' strongest-status dots and
    colors), also after browsing into a subfolder; sizes and the download
    and copy buttons; the search after a 300 ms pause, folders first, with
    "Searching…", the failure, "No files match", the hidden-matches line
    with its link and the stopped-early notes, a folder result revealing
    the folder in the tree; browsing a double-clicked folder, the parent,
    the working folder or a picked one, per chat session, with a refused
    folder's reason in the bar; files outside the workspace opening by
    their absolute path; the agent-asleep and sandbox states, the "Asleep"
    tag; the open folders kept per view, chat session and browsed folder
    (their ids name the location). `omnigent.revealInFiles(path, {
sessionId, kind })` browses a folder (`kind: "folder"`, the default) or
    shows a file in the tree, its folders opened and the row selected, live
    or on the session's next draw.
32. **Shell wiring.** The `files` scope draws the Files view (kept mounted,
    hidden, behind an open file, as before); the phone drawer and grid
    cells draw it for their session; a chat link to a folder and the file
    viewer's new "Reveal in Files" (its View settings menu) run
    `omnigent.revealInFiles` through the workspace bridge
    (`shell/revealInFiles.ts`, `WorkspaceBridge.executeCommand`), which the
    extension runtime connects to its command registry. The surface
    publishes the root and a listings revision, and serves listings and
    searches. The v2 sidebar's Files page (`FilesPageTree` with its own
    vendored tree, selection and drag model) stays out of scope: it is not
    a rail tab, its tree is a different component, and moving it needs
    views in the v2 sidebar (on the "Later" list).

33. **Git host providers** (`web/src/lib/gitHostProviders.ts`, shipped in
    builds; like a VS Code `DocumentLinkProvider` per host).
    - `git.registerHostProvider({ id, matchUrl(url) })`, where `matchUrl`
      answers plain data, `{ host, owner, repo, number }`, or `undefined`.
      Providers are asked in registration order after the built-in GitHub
      one (`github`, github.com links: https, no port or credentials, the
      pull request's own path); the first match wins. A throw, a malformed
      answer or a promise counts as no match and is logged.
      `git.matchPullRequestUrl(url)` returns the match with `providerId`.
    - The GitHub-shaped path parsing the built-in provider owns serves the
      link input (`pullRequestReference`: a provider's own link reads as its
      pull request, typed link kept), code host links (`codeHosts`, github.com
      through the provider, GitHub Enterprise hosts from evidence as before),
      the chat's pull request chips (`ChatMarkdown`: any provider's link gets
      the `repo#N` chip, redrawn when a provider registers late) and the tab
      sub-page folding (`pullRequestSubpage`). No change for GitHub links.
34. **API additions for M5** (`omnigent.d.ts`).
    - `pullRequests.activeSessionPullRequests` (`SessionPullRequests`: the
      status of the pull request in focus and of the list, the provider's
      label and link placeholder, whether the host tracks links, host
      offline, whether linking needs the host, the sandbox state, not
      synced, whether the viewer may edit, the pull requests in display
      order, the branch's own one, the host's choice, whether the server
      lists them, whether the focused one was read, the host's warnings and
      a review comment asking to open its pull request). Each
      `SessionPullRequest` carries its identity, provider, stored state and
      its live read (`loading`, `error`, `offline` with the hint, `details`
      with checks and their runs, reviewers, labels, merge readiness and the
      comment count, `cached`, `canMerge`). Frozen, coalesced per microtask.
    - `pullRequests.watchActiveSessionPullRequests()` returns a
      `PullRequestsWatch` whose `focus` (`{ sessionId, url, details }`) says
      which pull request to read first and whether its details are on
      screen, which sets the poll as the classic tab did (the details' pace,
      or the list's, each listed one read while the list shows). The host
      adds a passive watch for a drawn but hidden view (reads, no polling,
      the content's `selectedUrl` first) and a list watch for a page that
      lists them.
    - Commands, each for the workspace on screen (while its pull requests
      are watched) and refusing another session:
      `omnigent.pullRequests.link(sessionId, url)` (resolves to the host's
      `selectedUrl`), `.unlink(sessionId, url)` (to the `remaining` urls),
      `.refresh(sessionId)`, `.merge(sessionId, url, { method, expectedHead,
account? })`, `.updateLabels(sessionId, url, { add, remove })`,
      `.updateReviewers(sessionId, url, { add, remove })` and
      `.postComment(sessionId, url, body)`; they run the same mutations as
      the host-drawn controls.
    - `window.createPullRequestView(viewId)`: a `PullRequestView` with
      `content`, `visible`, `onDidChangeVisibility` and `dispose()`.
      `PullRequestViewContent` is plain data the host checks
      (`pullRequestContent.ts`) and draws (`shell/extensionViews/ViewPullRequests.tsx`):
      the bar's `actions` (icon buttons; a phone draws them in its drawer's
      header), `back`, the `bar` (the toolbar with the heading, or the
      heading and a Refresh button), the `linkForm` (its submit gets the
      typed link appended), the `alert` and `note` lines, and a `body`: a
      list of rows (identity, title, status, the host's compact merge
      control, unlink, open on the provider, copy) or one pull request's
      details (url, section and the command a picked section runs, the
      stored copy offline, not synced, the empty state's link, note or open
      link). `page` is the same for a page that opens each pull request on
      its own. Content is kept per session for grid cells.
    - The `plus` and `trash-2` icons on the allowlist.
35. **The built-in Pull Requests tab** (`builtinExtensions/omnigent.pull-requests/`).
    The bar with Refresh (spinning), Link a PR (disabled with "needs the
    host online" while the server keeps the list and the host is away) and
    Unlink PR, the heading shown or only read out, "All pull requests (N)"
    back to the list; the link form with Escape, its pending and failed
    states and the cached list seeded from the answer; the rows with their
    state icon, label, title, status (offline with the hint, Loading,
    Status unavailable, the state pill, checks and Incomplete checks, Draft,
    No checks with the merge hint), the compact merge control and the ⋯
    menu (Unlink PR, Open in the provider, Copy PR link); the unlink alert
    and the host's warnings; the details of the one selected (opening a
    lone one, keeping a just-linked one while the list catches up, falling
    back when it is unlinked), Summary, Comments and Changes per chat
    session; every empty state with the link button, the "To link a PR"
    lines or "Open the PR on GitHub"; the stored copy and "not synced yet"
    offline; a review comment opening its pull request on Changes. The tab
    keeps its id (`github`), place, label, icon, ⌃N digit, visibility
    rule and its "Unable to display pull requests." boundary; it has no
    badge, as before.
36. **Shell wiring.** `github` joins the built-in tabs whose page is the
    extension view (`resolveWorkspaceActiveView`), still only where its old
    rule allowed; WorkspacePanel, grid cells, the phone drawer and the v2
    sidebar's pull request list (`pulls` place, drawing `page` and opening
    each one in its own tab) draw `ExtensionRailView`; the `pull` place
    draws the host's details as before. AppShell and each grid cell mount a
    `WorkspacePullRequestsPublisher` on their workspace source; the
    composer's and grid's pull request links run
    `omnigent.pull-requests.reveal` through the workspace bridge
    (`shell/revealPullRequest.ts`).

### Security and trust model

A dev-path extension is trusted local code, like a folder passed to VS Code's
`--extensionDevelopmentPath`: whoever sets `OMNIGENT_WEB_EXTENSION_DEV_PATHS`
chooses to run it in the page, with the page's access to the backend. Path-level
sandboxing inside Vite's dev server cannot be made complete, so the plugin does
not try. Its guards are cheap and robust, and they stop accidents (a stray
symlink, a dependency import that would drag in `node_modules`) and plain HTTP
requests for files outside an extension's sources:

- The `browser` entry must have a real path inside the folder.
- `server.fs.allow` gets only the extension's own `.js`/`.mjs`/`.json`/`.css`
  files, by real path; `node_modules`, `.git`, symlinked directories and symlinks
  that leave the folder are left out. Vite's default entry, the workspace root of
  the checkout, stays in the list, so this narrowing only matters for extension
  folders outside the checkout: a folder inside it is fully servable over plain
  HTTP.
- A middleware answers 403 to any request for a file in an extension folder whose
  real path is outside it.
- Imports from extension files: a bare package other than `omnigent` and a
  `/@id/` id are refused before they are resolved, so they never reach Vite's
  dependency optimizer. Everything else, including `/@fs/` URLs and any `/@...`
  specifier, is resolved and refused when its real path is outside the folder or
  in its `node_modules` or `.git`. Only an exact list of Vite's own client ids
  (`/@vite/client`, `/@vite/env`, `/@react-refresh`) passes unchecked, and Vite's
  client and env modules are allowed as `/@fs/` targets because Vite injects them
  (into workers, for example). Workers built from the extension's own files, with
  `?worker` or `new Worker(new URL("./w.js", import.meta.url), { type: "module" })`,
  work.
- The dependency optimizer refuses to bundle any file in an extension folder, so
  nothing is served through `/node_modules/.vite/deps`.
- Theme assets are served by exact allow-list from
  `/__omnigent/extension-assets/<extension id>/<content hash>/<path>`: only the
  `.woff2` files `contributes.fonts` names (the `wOF2` signature, at most 2 MiB)
  and the brand images a theme file names (SVG, PNG or WebP by signature, at most
  512 KiB), each by real path inside the folder. An SVG is rebuilt from an
  allow-list of elements and attributes (no script, foreignObject, styles, event
  handlers, external references, `javascript:` or `data:` URLs) and served with
  `nosniff` and `default-src 'none'; style-src 'none'; sandbox`, so even opened as a
  document it loads, styles and runs nothing; the host shows brand images as
  `<img>` only. Theme files themselves are read (at most 64 KiB) and inlined, not
  served. The page takes asset URLs only from this origin, under exactly
  `/__omnigent/extension-assets/` or the bundle's own `BASE_URL` + `assets/` (a
  relative production base is the directory the bundle's chunks are in; never another
  `assets/` path such as a backend route, never protocol-relative, never with `.`/`..`
  segments), also when they come back from the first-paint cache in
  `localStorage`, which settings export leaves out. A theme reads `var()` of registry
  tokens and its own extension's colours only. Brand SVGs lose `style` attributes, CSS
  image functions (`image-set()`, `cross-fade()`, ...) and backslashes (CSS escapes)
  in any attribute, `xml:base` and `requiredExtensions`, every namespace but SVG's
  (default) and XLink's (as `xmlns:xlink`), and any attribute prefix but `xlink:` and
  `xml:`, so `xmlns:foo` with `foo:href` can't name an external reference. A
  `calc()` (with `min()`, `max()` and `clamp()`) is evaluated as an interval, each
  `var()` at its token's range: a literal one must stay in the token's range, one that
  reads tokens within that range widened by its width, never past 10000px; it divides
  only by a number range without zero, and `infinity` is for the pill radius only.
  Colour channels and gradient stops are capped too (at most 32 stops).
- A cross-origin logo from the server's branding (`/v1/info`) loads as an `<img>` with
  `crossorigin="anonymous"` and no referrer: its server must answer with CORS headers
  (`Access-Control-Allow-Origin`), or the default logo shows. Host paths keep loading
  through the host's authenticated fetch.

What the guards do not protect against, by design:

- CSS `@import` is resolved by Vite's CSS pipeline, not through `resolveId`, so an
  extension stylesheet can pull in other files. There is no CSS sandbox.
- `?raw` (and similar queries) of any file inside the folder returns its text,
  including files that are not `.js`/`.mjs`/`.json`/`.css`. Once imported that
  way, Vite also serves the file to plain GET requests.
- Hardlinks to files outside the folder look like the extension's own files.
- Crafted transforms or other ways of steering Vite's plugins.

The real boundary is the isolated host on the "Later" list. Until it exists, do
not load an extension you would not run as local code.

**Node entries** are trusted local code with the developer's full access, like a
VS Code extension's `main`; nothing sandboxes them, and they may import any
Node module. Their command endpoint is what needs guarding, because a command
can run local programs:

- A random token generated at each dev server start, given to the page by the
  virtual module, is required in the `x-omnigent-extension-token` header
  (compared in constant time). Remote sites cannot read it. A page on another
  local port can: Vite's default CORS reflects any `localhost:*` or
  `127.0.0.1:*` Origin, so such a page can load the virtual module.
- `Origin` must be exactly `http://127.0.0.1:<port>` or `http://localhost:<port>`
  of this dev server, and `Host` must be `127.0.0.1:<port>` or
  `localhost:<port>`, which also stops DNS rebinding. This exact check, not the
  token, is what keeps other pages in the browser out.
- Neither protects against local processes: anything that can reach the port
  can read the token and send any headers. On a machine shared with other OS
  users, they are not kept out.
- Only `POST` with `application/json`; the body is capped at 64 KiB and must be
  `{"args": [...]}`.
- Only commands the extension named in the path registered run; anything else
  is a 404.
- Builds contain none of it: the virtual module exports `null`, the plugin's
  server hooks do not run, and the page code that calls the endpoint is in the
  dev-only loader chunk.

### Extension layout (the `dev` extension)

```
dev/
  package.json            publisher thekauer, name dev, engines.omnigent ^0.24.0,
                          activationEvents ["onStartupFinished"], browser ./src/extension.js,
                          main ./src/node/extension.js
  src/extension.js        activate(): activates each feature, pushes its Disposable
  src/features/index.js   list of features
  src/features/sessionCost.js
  src/features/<reconnect>.js  the dev machine reconnect provider
  src/node/extension.js   Node entry: registers the Node commands
  testing/                test helpers: a fake omnigent API, and a fake machine CLI
                          (testing/fake-<cli>/) the tests put first on PATH
  types/omnigent.d.ts     vendored copy of the API typings
  test/*.test.js          node:test unit tests (`node --test` runs them all)
  verify/verify.sh        browser verify loop (see below)
```

Plain ESM with `// @ts-check`; no build step.

## VS Code to Omnigent mapping

| VS Code                                                              | Omnigent prototype                                            | Notes                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| `import * as vscode from "vscode"`                                   | `import * as omnigent from "omnigent"`                        | Per-extension instance, resolved by the dev plugin  |
| `package.json` `publisher.name` id                                   | same                                                          |                                                     |
| `engines.vscode`                                                     | `engines.omnigent`                                            | Validated as a range, not enforced yet              |
| `main` / `browser`                                                   | same                                                          | ES modules; `main` runs in a dev server child       |
| `activationEvents` `*`, `onStartupFinished`                          | same                                                          | Other events warn                                   |
| `activate(context)` / `deactivate()`                                 | same                                                          | Async supported                                     |
| `ExtensionContext.subscriptions`, `.extension.id`                    | same, plus `.extension.version`                               | No storage, URIs or secrets yet                     |
| `Disposable`, `Disposable.from`                                      | same                                                          |                                                     |
| `Event<T>`, `EventEmitter<T>`                                        | same                                                          | Errors reported against the extension               |
| `window.createStatusBarItem(id?, alignment?, priority?)`             | `window.createSessionHeaderItem(id?, alignment?, priority?)`  | Header slot left of the agent info button           |
| `StatusBarAlignment`                                                 | `SessionHeaderItemAlignment`                                  | `Right` sits next to the anchor                     |
| `StatusBarItem.text`, `.tooltip`, `.show()`, `.hide()`, `.dispose()` | same                                                          | Plain text; no `$(icon)`, no `command`, no colors   |
| `window.activeTextEditor`, `onDidChangeActiveTextEditor`             | `sessions.activeSession`, `onDidChangeActiveSession`          |                                                     |
| (none)                                                               | `sessions.onDidChangeUsage`, `sessions.activeSessionUsage`    | Plain-data usage of the active session              |
| `commands.registerCommand`, `commands.executeCommand`                | same                                                          | JSON args and results; page or Node                 |
| `window.withProgress`                                                | same                                                          | Notification by default; `{ title }`                |
| `ProgressLocation.Window`                                            | `withProgress({ location: { hostId } })`                      | Inline at one host's badge and menu                 |
| `window.showInformationMessage`, `showErrorMessage`                  | same                                                          | Toasts; no buttons                                  |
| `window.createOutputChannel(name, { log: true })`                    | `window.createOutputChannel(name)` (Node only)                | Lines go to the dev server output                   |
| `workspace.registerRemoteAuthorityResolver`                          | `hosts.registerReconnectProvider`                             | For "Reconnect host"; plain host data               |
| `import * as vscode from "vscode"` in `main`                         | `import * as omnigent from "omnigent/node"`                   | A smaller API than the page's                       |
| `contributes.views` (view containers)                                | `contributes.views["omnigent.rightPanel"]`                    | Tabs in the classic workspace rail                  |
| `window.createTreeView(id, { treeDataProvider })`                    | same                                                          | Host-drawn rows; no DnD or multi-select             |
| `TreeDataProvider`, `TreeItem`, `TreeItemCollapsibleState`           | same, plain data                                              | Plus `decoration` and `gitStatus` on items          |
| `TreeView.title`, `.description`, `.message`, `.badge`               | same                                                          |                                                     |
| `contributes.commands` (`title`, `icon`, `toggled`)                  | same                                                          | Lucide icon names from an allowlist                 |
| `contributes.menus["view/title"]`, group `navigation`                | same                                                          | Other groups (the "..." menu) not shown yet         |
| `when` clauses, `setContext`                                         | same, a subset                                                | No `=~`, `in`, `<`/`>` or `not in` yet              |
| `ExtensionContext.workspaceState` (`Memento`)                        | same                                                          | Per chat session, not per workspace                 |
| `vscode.open` and SCM resource states                                | `omnigent.openFile`, `workspace.getChangedFiles`              | Plain paths, the session's changed files            |
| Built-in extensions (`extensions/` in the VS Code repo)              | `web/src/builtinExtensions/<publisher.name>/`                 | Bundled, activated at startup in every build        |
| `TreeView.visible`, `onDidChangeVisibility`                          | same                                                          | Visible while a drawn copy is on screen             |
| `workspace.getConfiguration`, `onDidChangeConfiguration`             | same, for `omnigent.files.*`                                  | `config.*` context keys as in VS Code               |
| `contributes.submenus` and submenu menus                             | same, in `view/title`                                         | Drawn as a dropdown naming the toggled entry        |
| `TreeView.message` as a `MarkdownString` with command links          | `[text](command:id)` in a plain string                        | No other markdown                                   |
| `SourceControl.inputBox`                                             | `TreeView.searchInput` with `contributes.views[].searchInput` | Query, toggles and fields; per chat session         |
| `workspace.findTextInFiles`, `TextSearchQuery`                       | same, plus `validateTextSearchQuery`                          | One result list, not a match callback               |
| `CancellationTokenSource`                                            | same                                                          |                                                     |
| `contributes.keybindings`                                            | same, a subset                                                | One chord; letters, digits, F-keys                  |
| `contributes.themes`, `contributes.colors`                           | same, plus `family` and `brand`; colours as `--x-*` variables  | Tokens, not workbench colours; VS Code ids aliased  |
| `window.activeColorTheme`, `onDidChangeActiveColorTheme`, `ColorThemeKind` | same, plus `id`, `label` and `variants`                    | Not fired for the picker's previews                 |
| `ThemeColor`, `StatusBarItem.color`                                  | `ThemeColor`, `SessionHeaderItem.color`                       | Registry tokens and the extension's own colours     |
| (none; webviews read `--vscode-*`)                                   | `window.getThemeToken(id)`                                    | A computed value as a string                        |
| (none; product icon and font themes are separate in VS Code)         | `contributes.fonts`                                           | `.woff2` only, namespaced families                  |
| `<view>.focus` and `view.<id>.visible` context keys                  | `<view>.focus` and `view.<id>.available`                      | Available: the tab is in the strip                  |
| `withProgress({ location: { viewId } })`                             | same                                                          | Per chat session                                    |
| `TreeItemLabel.highlights`, `AccessibilityInformation`               | same                                                          | Plus `TreeItem.line` for text matches               |
| `WebviewView` (closest), `MarkdownString`                            | `window.createPlanView`, Markdown goals drawn by the host     | Plain data, host-drawn; see deviations              |
| (none)                                                               | `sessions.activeSessionTasks`, `watchActiveSessionTasks`      | The tasks of the workspace on screen                |
| `workspace.fs.readDirectory`, `FileSystemError.code`                 | same, plain entries and a named error                         | Paths, not `Uri`s; cached by the host               |
| `workspace.findFiles`                                                | same, with a name pattern, globs and a folder                 | One result list, at most 500                        |
| `workspace.rootPath`, `FileSystemWatcher`                            | `rootPath`, `workspace.onDidChangeFiles`                      | One event for "listings may be stale"               |
| `TreeView.reveal`, `selection`, `onDidChangeSelection`               | same                                                          | Needs `getParent` and item ids                      |
| (none)                                                               | `TreeView.location`, `onDidChangeLocation`                    | The host's location bar                             |
| `languages.registerDocumentLinkProvider` (closest)                   | `git.registerHostProvider`, `git.matchPullRequestUrl`         | Plain `{ host, owner, repo, number }`; GitHub first |
| `vscode.diff` (the diff editor opened by command)                    | `window.createPullRequestView`, host-drawn details and diff   | Plain data; see deviations                          |
| (none)                                                               | `pullRequests.activeSessionPullRequests`, watch with a focus  | The pull requests of the workspace on screen        |

Deviations and why:

- `$(icon)` syntax is not supported: the header has no codicon font, so text is
  rendered verbatim.
- Items with empty text are not rendered, so a shown but empty item adds no DOM.
- Session events are coalesced per microtask; the store writes in bursts during a
  bind, and an out-of-process host would see batched events anyway.
- `SessionHeaderItem.id` is `<extension id>.<id>` (VS Code keeps the bare id).
  Duplicates within an extension get a `#2` suffix and a warning.
- The `omnigent` module exists only for files inside a registered extension
  folder; app code cannot import it.
- The Node API has its own specifier, `omnigent/node`, because it is a different
  and smaller API than the page's; one module would type Node code against
  page-only calls.
- `withProgress` has no cancellation, and its locations are a notification,
  a view (`{ viewId }`) or a host (`{ hostId }`); VS Code's window location is
  one status bar for the whole window, so here it is scoped to a host, the
  only place a host's progress makes sense. The notification shows a rejected
  task's error, which VS Code leaves to the extension.
- Reconnect host shows a provider's progress, its wait for the host and its
  failure inline at the host, not as notifications; VS Code's remote
  resolvers report through a notification.
- A Node command's progress is shown in the page: it joins the calling
  extension's latest open progress (for example a reconnect's), or gets its
  own notification. VS Code has no such bridge.
- Reconnect providers are ordered by registration, built-ins first, not by an
  authority prefix: hosts have no URI scheme to key on.
- View ids must start with the extension id, so views of different extensions
  cannot collide; VS Code only requires them to be unique.
- `resourceUri` is a plain `{ path }` and `iconPath` a name, not `Uri` or
  `ThemeIcon` objects, to keep the API plain data. `decoration` and
  `gitStatus` stand in for `FileDecorationProvider` and SCM resource
  decorations, which would need a separate provider round trip per row.
- `onDidChangeTreeData` always reloads what is shown, even when fired with an
  element; handles keep expand state across the reload.
- `workspaceState` follows the chat session on screen, because the UI has no
  workspace folder; it lives in the browser's storage, not on the server.
- Context keys live in the page only; the Node side cannot set or read them.
- A built-in extension's view can stand in for a built-in tab (`builtInTab`);
  VS Code has no such thing, but it keeps saved tab ids, digits and positions.
- `TreeView.filter`, `notice`, `tag`, `messageSeverity`, `TreeItem.size` and
  the `filter` menu group, menu `tooltip` and `tone` have no VS Code
  equivalent: the classic Changes tab had a search field in its toolbar, a
  sort menu and hidden toggle beside it, a red error line, the asleep hints
  and the Asleep pill, which VS Code's tree view cannot express. VS Code's own
  tree filter is host-side; here the extension filters, so it can say "No
  changed files match".
- A submenu's button shows the toggled entry's title ("Sort: Filename"),
  where VS Code shows only an icon.
- `workspace.activeSessionId` and `workspaceState` follow the workspace on
  screen (a selected grid cell), which can differ from
  `sessions.activeSession`; VS Code has one workspace per window.
- The hidden-files toggle's warning tooltip no longer names the count ("3
  files in hidden directories"); command titles and tooltips are static, as
  in VS Code. The count is in the "N files hidden" line above the rows.
- `searchInput`, `TreeItem.line`, session resources, agent icons and
  statuses, `presentation: "graph"`, the badge's `label` and `tone`, and the
  sessions tree API have no VS Code equivalent: VS Code's Search view and its
  timeline-like views are built into the workbench, not drawn from an API.
  `findTextInFiles` returns one list instead of calling back per match (the
  route answers at once); `view.<id>.available` means the tab can be shown,
  where VS Code's `view.<id>.visible` means it is on screen.
- The built-in extension is `omnigent.content-search` (manifest names are
  lowercase, as in VS Code), not `omnigent.contentSearch`.
- The Agents graph's cards show the routed model next to the cost, as the
  rows do; the classic graph showed only the cost. Its node labels are the
  rows' labels (the classic graph skipped the task part of a `tool:task`
  title). List or graph is kept for the window, where the classic panel
  reset to the list each time it mounted; collapsed rows stay collapsed per
  chat session for the page.
- Content search's "No matches" line uses the results list's small print only
  when there are rows; with none it is drawn at the message size. Its page is
  drawn while its tab is selected (the classic panel stayed mounted, hidden);
  the form's value and the results live in the host and the extension, so
  nothing is lost.
- The "Asleep" tag's tooltip is reworded ("Agent is asleep. Files are shown
  live from the host; send a message to wake it."), because the original
  used a dash this repository's text style avoids.
- The Tasks tab is a plan view, a host-drawn content kind VS Code has no
  equivalent for (its closest, a webview view, would not be plain data). The
  extension decides the words, the controls and the command of every
  action; the host draws them with the parts the workflow pages share
  (glyphs, strip, cards, graph), so the two never drift. The workflow runs
  below a plan stay a host-drawn list (`SessionDescendantRuns`, shared with
  the Workflow page, with its own paging and nesting), named by
  `runsOfWorkflow`, not a tree of the extension's.
- Its availability stays the core `shown` rule (workflows with journals, or
  the agent's own list), not a view `when` clause: AppShell's tab fallback,
  the phone's menu and the grid all read that rule.
- A hidden Tasks view keeps the last tasks it had and stops loading the
  journal; the classic panel stayed mounted with its query paused. On a
  workspace switch the extension's content waits ("Loading tasks") until
  the session on screen's tasks arrive.
- The phone drawer closes before any task's click scrolls the chat or a
  workflow starts (one `onLeave` for the surface), where the classic panel
  had one callback for each.

- The Files tab's location bar, its filter fields and their toggle, and
  the Open In menu are host-drawn (`location: true`, `filter.fields`,
  `omnigent.toggleFilterFields`, `omnigent.openIn`): VS Code's Explorer
  has no breadcrumb picker or name search over a remote host, and these
  controls need host data (the session's host, the viewer's permission,
  the session's reach, the local editors) an extension should not get.
- `findFiles` takes a name pattern and a folder, where VS Code's takes an
  include glob; `onDidChangeFiles` says only that listings may be stale,
  instead of a watcher's per-file events (the server sends no more).
  `readDirectory` returns entries with sizes and times instead of
  `[name, FileType]` pairs, so a tree needs no `stat` per row.
- Rows of the Files tab now name their workspace path (`src/app.ts` while
  browsing `src`, `/etc/hosts` outside the workspace), so their copy and
  download buttons act on the right file; the classic tree named them
  relative to the browsed folder. The file opened is the same.
- Expand state follows the host's per-view rule: a folder of changed
  files that appears later starts open (the classic tree opened only those
  present at the first load). A cleared search returns to the tree at
  once, not after the 300 ms pause.
- The search's "stopped early" note is drawn above the results (view
  messages are), where the classic list put it below.
- Messages that used a dash are reworded, as this repository's text style
  avoids it: "All files are hidden. Click the eye icon to reveal them.",
  "No files match "x". The search stopped early, so results may be
  incomplete." and "Search stopped early, so results may be incomplete."
- New: "Reveal in Files" in the file viewer's View settings menu, and the
  host tree's keyboard navigation and selection (`aria-selected`).

- The Pull Requests tab is a pull request view, a host-drawn content kind
  with no VS Code equivalent. The extension decides the bar, the link
  form, the list or the pull request shown, the words and every command;
  the host draws each pull request's details (its header, checks,
  reviewers, labels, merge dialog, description and comments with their
  composer, the diff with its review threads), as VS Code draws its diff
  editor when an extension opens one by command. The details are shared
  with the pull request page, which stays core, so the two never drift.
- The data API reports facts (statuses, live reads, stored copies) the
  host derives from its queries; a few strings come from the host because
  they need its formatting or provider copy: the offline hint with its
  absolute "Last sync time", the provider's label and link placeholder.
- The pull requests are read only while watched: a drawn view watches
  them (passively while hidden), so with the tab never opened nothing is
  read, as before. The commands act through the surface reading them, so
  they need the pull requests watched. A grid cell not in front draws its
  session's last content and does not poll, as for Tasks; the classic
  panel in such a cell polled on its own.
- The v2 sidebar's pull request list draws the view's `page` layout and
  opens rows itself (as `openSessionFromView` lets the workspace decide),
  instead of a second view.
- A just-linked pull request stays selected for two reads of the data
  while the list catches up; the classic panel got the same from React
  batching its cache writes with the selection.
- A provider's `matchUrl` must answer synchronously (the chat draws links
  as it renders); a promise counts as no match and is logged. The chat
  chip for github.com no longer matches a link with credentials in it.

## Later

- `item.command` on header items.
- Menus other than `view/title` (item context menus, the "..." overflow),
  `keybindings`, `configuration` and a settings UI.
- The rest of the `when` grammar (`=~`, `in`, comparisons), multi-select and
  drag and drop in trees, and views in the v2 workspace sidebar (then the v2
  Files page could move onto the Files extension).
- An isolated host: one Worker per extension inside a sandboxed iframe, with the
  API proxied over `postMessage`. The plain-data API is designed for this. This
  is the real security boundary: the dev plugin's path guards only stop
  accidents, so untrusted extensions must wait for it (see
  [Security and trust model](#security-and-trust-model)).
- Host-enforced permissions per API namespace.
- Loading server-installed extensions in production builds (built-ins load
  there now; dev paths still do not).
- `engines.omnigent` enforcement against the running version.
- More activation events (`onView`, `onCommand`, `onSession...`).
- A cancellation token for Node commands, and crash-loop detection that
  disables an extension after a number of Node host crashes.
- Published typings (`@omnigent/types` or similar) instead of vendored copies.
- Migrating the V1 extension pages and navigation onto this system, and moving a
  built-in header item onto the header item registry to prove the seam.
- A design doc and staged upstream PRs.

## Running the tests

From `web/` (use `corepack pnpm exec` or `node_modules/.bin`):

```bash
# Unit and RTL tests for the host, API, header slot, dev plugin, Node entries,
# commands, progress, reconnect providers and store seam
corepack pnpm exec vitest run src/vscodeExtensions src/shell/ChatHeader.test.tsx \
  src/store/chatStore.test.ts src/lib/hostReconnectProviders.test.ts src/lib/hostProgress.test.ts \
  src/hooks/useSessionReconnect.test.ts src/components/HostBadge.test.tsx \
  src/viteDevProxyToken.test.ts src/shell/railViews.test.ts \
  src/lib/sessionWorkspaceState.test.ts src/shell/WorkspacePanel.test.tsx \
  src/shell/RevealInFileManager.test.tsx src/builtinExtensions \
  src/shell/useWorkspaceBridgeSource.test.tsx src/grid/GridSessionPane.test.tsx \
  src/shell/agentSessionGraph.test.ts src/shell/subagentPanelOpener.test.tsx \
  src/shell/AppShell.subagent-nav.test.tsx src/shell/workspaceTabs/WorkspaceTabsPanel.test.tsx
# Broader regression set
corepack pnpm exec vitest run src/shell src/grid src/components/AgentInfo src/vscodeExtensions \
  src/builtinExtensions src/lib src/index.css.test.ts
# Static checks
corepack pnpm exec prettier --check vite.config.ts vite.omnigentExtensions.ts \
  vite.omnigentNodeExtensions.ts vite.omnigentNodeHost.mjs vite.devProxyToken.ts \
  src/vscodeExtensions src/lib/hostReconnectProviders.ts src/lib/hostProgress.ts \
  src/hooks/useSessionReconnect.ts \
  src/components/HostBadge.tsx src/pages/ChatPage.tsx src/shell/ChatHeader.tsx src/main.tsx \
  src/store/chatStore.ts src/store/conversationState.ts
corepack pnpm exec oxlint --deny-warnings --report-unused-disable-directives .
# A production build carries the host, the API and the built-ins, and no dev
# loader, Node host, endpoint or token code
corepack pnpm exec vite build --outDir /tmp/omnigent-build-check && \
  ! grep -rlE "x-omnigent-extension-token|__omnigent/extensions|omnigent/node|virtual:omnigent-dev-extensions|dev-path extension" /tmp/omnigent-build-check && \
  for s in "There is no data provider registered" "omnigent.refreshChangedFiles" \
    "invalid when clause" "omnigent.changes.view" "omnigent.content-search.view" \
    "omnigent.agents.view" "omnigent.openSubagent" "omnigent.tasks.view" \
    "omnigent.tasks.runTaskAction" "picker:workflow" "omnigent.files.view" \
    "omnigent.revealInFiles" "omnigent.toggleFilterFields" "omnigent.pull-requests.view" \
    "omnigent.pullRequests.link" "omnigent.pull-requests.reveal"; do grep -rlqF "$s" /tmp/omnigent-build-check || exit 1; done
corepack pnpm exec tsc -b   # app and node (vite config) projects
```

What the suites cover:

- `base.test.ts`: `Disposable`, `Disposable.from`, `EventEmitter` (thisArgs,
  disposables array, throwing and rejecting listeners, changes while firing,
  dispose).
- `sessionHeaderItems.test.ts`: item lifecycle, text and tooltip updates, length
  bounds, ordering by alignment and priority, generated and duplicate ids.
- `host.test.ts`: activation and deactivation, subscriptions disposed, API
  registered before import, activation error isolation, separate load and
  `activate` timeouts (a slow load within its budget still activates), no second activation of an id while its timed-out
  activation or its deactivate is pending nor afterwards in the same page,
  `dispose()` cancelling a pending activation and cleaning up its late finish, an
  inert API after a late cleanup (fake timers), no listener call once disposed
  mid-delivery, no header item registered once disposed, activation events,
  listener error isolation, cleanup of undisposed resources, API export names in
  sync with the dev plugin.
- `sessionsService.test.ts`: active session and usage events from the real chat
  store, including the SSE `session_usage` handler, hidden cost, coalescing and
  session switches.
- `devPlugin.test.ts`: manifest validation (missing fields, bad engines, missing
  or escaping entry, a symlinked entry, bad JSON, duplicates, unknown activation
  events) and a real Vite dev server: the narrowed `fs.allow`, refusal of a
  symlinked file and of an import through it, `node_modules` not served, a real
  `node_modules` package re-exporting an outside file not pre-bundled into
  `/.vite/deps`, relative imports into `node_modules` refused, `/@fs/` and
  `/@id/` imports checked, a root-relative `/@x/../...?raw` import refused,
  Vite's client ids allowed, workers built with `?worker` and
  `new Worker(new URL(...))` served with Vite's env module, the optimizer guard, allow-list refresh on change, the JSON
  endpoint, the virtual module, the per-extension `omnigent` module, rescans on
  manifest add, change and unlink, and nested folders.
- `devPluginNode.test.ts`: `main` validation; a real dev server with Node
  entries in the child process: Node command ids and the token in the virtual
  module, a failing entry not affecting others, JSON arguments and results,
  NDJSON progress then result, error propagation, only the named extension's
  commands, refusal of a missing or wrong token, other Origins (site, port,
  scheme), no Origin, other Hosts, other methods, content types, bad JSON and
  bodies over the cap; calls failing when the host process stops, and a
  restart; and a production build with no token, endpoint or Node command ids.
- `commands.test.ts`, `nodeCommands.test.ts`: register, dispose, duplicates
  (page and Node), JSON copies, routing to Node, unknown commands, handler
  errors; the NDJSON client with chunk-split lines, progress, results, errors,
  refused requests and a stream without a result.
- `progress.test.ts`, `api.test.ts`, `hostProgress.test.ts`: `withProgress`
  success and failure, messages, the sonner toasts; the host location (inline
  steps, no notification, a failure ending it, a bad host id); the API's
  commands, Node progress joining the open progress or getting its own,
  reconnect providers (plain frozen host, steps to the host's progress, Node
  steps joining, a rejection passed on without a toast, a second click joining
  with the progress so far, unregistering); the location store (newest open
  progress, failure owners, stable snapshots).
- `hostReconnectProviders.test.ts`, `useSessionReconnect.test.ts`,
  `HostBadge.test.tsx`: provider order, sync and async answers, throwing,
  rejecting, slow and non-Promise thenable answers, warm-up; the built-in wake
  first and unchanged (the existing wake tests pass as they were), fallback to
  the dialog and to the desktop reconnect, ignored repeat clicks, a late
  answer after a session switch, a failing `reconnect`; the menu warming
  providers for an offline host only, the item label unchanged. Inline
  progress: steps in the menu and beside the trigger, the menu kept open,
  step updates, a joined second click, a rejection shown inline with its hint
  in a tooltip and retried, "Waiting for host..." with 2-second polls until
  online (then nothing inline and no Reconnect host), the 90-second "Host
  didn't come online", cleanup on a session switch or unmount, the wake's
  steps inline, and no toast. The inline retry reachable by role right after
  Escape closes the menu (with the menu still mounted for its exit
  animation), one live region announcing steps and the failure, a grid
  cell's badge with no failure and only its dot spinning, a failure cleared
  once the host is online, the API showing a running reconnect at its host
  until it settles, and the "Reconnecting..." placeholder.
- `viteDevProxyToken.test.ts`: the async token cache of the dev proxy.
- `railViews.test.ts`: tab ids (`ext:` accepted, malformed dropped), registry
  order, updates, duplicates, loading state; built-in descriptors unchanged,
  an extension view's label, icon, digit and badge; the `extension` scope.
- `sessionWorkspaceState.test.ts`: an `ext:` tab restored; mementos per
  session and extension, the caps, dropping malformed stored buckets.
- `WorkspacePanel.test.tsx`: extension tabs after the built-ins in registry
  order with the next digits, selection, the page and badge, a restored tab
  waiting for its view, built-in tabs unchanged without views.
- `when.test.ts`: the `when` grammar and precedence, refused clauses, context
  keys, and `contributes` parsing with its warnings.
- `treeViews.test.tsx`: view/title actions by `when` and context keys, toggles
  with `aria-pressed`, a failing action's error; the tree host rendering
  provider rows as the Changes list and as the Files tree, decorations, a click
  running the row's command, expand state per session, reloads on
  `onDidChangeTreeData`, message, title, badge, the no-provider state,
  ownership checks, a failing provider, and item sanitizing.
- `workspaceApi.test.ts`: `workspaceState` per session, caps and rejections,
  passed to `activate`; changed-files snapshots and events, through the API
  and after deactivation; the built-in commands; contributed views registered
  before activation and the tree view through the host.
- `builtinExtensions.test.ts`: one registry entry per folder, valid manifests
  and contributions without warnings, the API boundary of built-in sources, a
  bad manifest left out and logged, views registered synchronously before
  activation settles, a failed built-in's error state and log.
- `omnigent.changes/changesModel.test.ts`: the pure logic: sort orders equal
  to core's (`changedFilesOrder.ts`, used by the file viewer's prev/next),
  repository groups, the folder tree, filtering, hidden files, diffstats,
  tree items and every message of the classic list.
- `omnigent.changes/changesView.test.tsx` and `changesView.virtual.test.tsx`:
  the tab through the real host and rail view: chrome, close button, badge,
  Refresh (spinning while it runs), loading, agent asleep, never started,
  errors, sandbox states, the Asleep tag, the retry when a failed list comes
  on screen, size, status and actions, diffstats, copy, open (deleted
  files too), repository groups, search per session, sort, hidden files,
  list and tree per session, no stale rows from another session, scroll
  restore, and windowing with the real virtualizer.
- `omnigent.content-search/contentSearchView.test.tsx` (the classic
  ContentSearchPanel tests, ported) and `searchModel.test.ts`: submit only,
  the filter fields, options sent as typed, highlights, opening a match at
  its position, per-session forms and results, an in-flight search across
  switches, errors hidden while retrying, runner warnings, invalid answers,
  whole words, the length and boundary refusals, grouping by file; the
  messages and items of the model.
- `omnigent.agents/agentsView.test.tsx`, `agentsGraph.test.tsx` and
  `agentsModel.test.ts` (the classic SubagentsPanel and SubagentsGraphView
  tests, ported): costs, the main row's name, product name, preview and
  kind, loading and failure, rows and links, opening through the workspace,
  modified clicks, labels for every kind of sub-agent, harness and role
  icons, no polling, highlights, every status tile, dimming, search params,
  nesting, connectors, guides, collapsing, the depth cap, routed models, the
  badge, live lists and the workspace on screen; List / Graph view, graph
  cards and clicks; icons, cost formats equal to core's, items and badge.
- `agentSessionGraph.test.ts`: the status and label a child session gets
  through the API, the shared dot palette, the root status, and the graph
  layout (`computeSubtreeWidths`, `layoutTree`, `treeFromRows`).
- `omnigent.tasks/tasksView.test.tsx` (the classic TasksPanel tests, all
  ported) and `tasksModel.test.ts`: the empty state and Run a workflow, the
  agent's own list and the plan, steps and states, ready tasks and arcs, the
  workflow chip, the runs below, cards, Can't start, ⋯ menus on rows, cards
  and the graph, jumping and highlighting, showing in the chat on a route
  or the grid, Save as workflow, Run, Continue, Retry and Stop, the
  question override, Stop, Stopping… and Continue, complete plans, the
  heading, the graph overlay, elapsed and end times, background work,
  waiting for you, prompts, paused labels, workers and side chats,
  restarts, history, Markdown goals; the content, controls and commands
  of the model. `tasksApi.test.ts`: the tasks snapshot (frozen, coalesced,
  following the surface in front), watching, the task commands and their
  refusals, plan views (ownership, checked content, visibility, commands
  with arguments, teardown) and the content checks.
- `omnigent.files/filesView.test.tsx` (the classic FilesPanel and FolderTree
  tests, ported) and `filesModel.test.ts`: the header (folder name, copy,
  Refresh, Close, the Asleep tag), the toolbar order and its toggles, sort,
  the include and exclude fields, Refresh reloading open folders, loading,
  environment failures, empty and all-hidden, runner offline (asleep or
  not started), no files, other failures, sandbox states and a cached
  listing, folder order by name, time, size and type, hidden files, lazy
  folders with Loading, errors and all-hidden lines, a restored deep
  expansion, sizes and download, the shared status column and trailing
  slot, folder affordances, label tokens, the collapse animation,
  indentation, opening files, expand state per session, scroll restore,
  keyboard navigation, the change overlay (created, deleted, folder
  colors, in a browsed subfolder, reload on a files change), search (the
  pause, flat results, Searching, no stale results, no match, stopped
  early, hidden matches, failures, clearing, globs, revealing a folder
  result, per session), and browsing (plain label, unconfined picker,
  collaborators, up and back, absolute files and copy, double-click,
  search in the folder, per session across remounts, `revealInFiles` for
  folders and files, a refused folder); the model's order (equal to
  core's), locations, tree, overlay, statuses, results and items.
  `filesApi.test.ts`: `rootPath`, listings and their path forms, refused
  paths, error codes, `findFiles` and its cancellation, `onDidChangeFiles`,
  `omnigent.refreshFiles`, the bridge's command runner, `reveal` (requests
  per session, listeners, `getParent` and ids required), selection, the
  location and its picks, filter fields per session, `setFilter`, the host
  menu entries, malformed fields, and long labels.
  `RevealInFileManager.test.tsx` checks the Files rows' "Show in Finder"
  with workspace paths.
- `keybindings.test.ts`, `searchViewsApi.test.ts`, `sessionTreeApi.test.ts`,
  `treeItemKinds.test.ts`: chords and the keybinding service; search inputs
  per session, accepting, validation, presentation, badges, view progress,
  `findTextInFiles` (requests, whole words, refusals, cancellation),
  `CancellationTokenSource`, `<view>.focus` and `view.<id>.available`, the
  session commands; the session tree (root, lists, details, loading,
  failures, costs, shared cache observers); the new tree item fields.
- `subagentPanelOpener.test.tsx`: `openSessionFromView`, the decision the
  classic rows made (setting, phone, opener refusal).
- `useWorkspaceBridgeSource.test.tsx`: what a workspace surface publishes
  (loading before the environment, its failure, offline vs never started,
  sandbox states and a cached list, served from host, disabled), and actions
  going to the surface in front.
- `GridSessionPane.test.tsx`: the selected cell's workspace in front, and a
  saved `ext:` tab without its view falling back.
- `omnigent.pull-requests/pullRequestsView.test.tsx` (the classic
  PullRequestPanel tests, all ported, run through the real host with the
  surface's publisher; three settle a mocked mutation or the publisher's
  coalescing explicitly, one asserts the Comments tab instead of the
  removed view cache key) and `pullRequestsModel.test.ts`: the selection
  following the data, a just-linked one, review comments, labels, every
  row status, merging, unlinking and opening, and the content of each
  state. The changes tab, details, labels, merge, reviewers, file section,
  review threads and `useSessionPullRequests` tests stay as they were
  (their components are the host's). `pullRequestsApi.test.ts`: the data
  as frozen copies following the surface in front, watches with focus,
  list and passive ones, the commands and their refusals, the view
  content checks, per-session content, visibility, and extension git host
  providers. `gitHostProviders.test.ts`: the GitHub provider, the order,
  unregistering and refusals; `pullRequestReference.test.ts` and
  `ChatMarkdown.fileLinks.test.tsx` cover a provider's links.
  `AppShell.pullRequestTabVisibility.test.tsx`, `GridSessionPane.test.tsx`
  and `WorkspacePlaceView.test.tsx` check the reveal command, the drawer,
  the boundary and the sidebar page.
- `ChatHeader.test.tsx`: items render immediately left of `agent-info-trigger` in
  order, update live, show the tooltip, stay out without a session or while
  pending, and leave the DOM unchanged when no item is visible.

The `dev` extension's own tests and type check, from its folder:

```bash
node --test 'test/*.test.js'
<web>/node_modules/.bin/tsc -p tsconfig.json
```

## Verify loop (browser)

The `dev` extension ships `verify/verify.sh`, a single command that drives the
system Chrome through Playwright for Python (installed by `uv` from the package
proxy) and prints one `PASS`/`FAIL` line per check plus a summary. It exits
non-zero on any failure and saves screenshots to `/tmp/omni-ext-verify/`.

```bash
OMNI_UI_REPO=<omnigent checkout> ./verify/verify.sh            # mocked + prod
./verify/verify.sh mocked | prod | live                         # one mode
```

- `mocked`: starts the checkout's dev server (port 5181) against an in-process
  mock backend that serves just enough of `/v1` for a session page plus a
  pushable SSE stream. Checks the dev plugin endpoint, `$1.23` on a priced
  session, placement immediately left of the info button, the tooltip, live SSE
  `session.usage` updates (`$4.56`, `<$0.01`), a client-side switch to an
  unpriced session (dash), hidden cost removing the item, a priced update
  restoring it, switching back, no item without a session, no extension errors,
  and that the mock received no unexpected non-GET request.
  - Reconnect host, with a fake machine CLI first on the dev server's `PATH`
    (its argv logged to a file): on a session bound to an offline host named
    like one of the fake machines, the menu has "Reconnect host" and opening
    it fetches the list; clicking it keeps the menu open with a spinner and
    each step in place of the item, and beside the trigger. A first start that
    fails on sign-in shows "Reconnect failed" inline with the hint in its
    tooltip; the inline Reconnect retries, shows "Waiting for host...", and
    the mock reports the host online a few seconds after the fake's SSH step,
    so the badge goes online and Reconnect host is gone. No toast shows, and
    the fake ran resume, then the start command over SSH twice, with the exact
    argv. A host that is not one of the machines opens the existing reconnect
    dialog, and a resumable managed host still sends the server wake
    (`retry_session`, captured by the mock), with its steps inline.
  - The built-in Changes tab, on mocked changed files, directory listings and
    file contents: the tab opens with the flat list and its badge; title bar,
    search field, Sort and hidden toggle; rows read as the classic list did
    (names, subtitles, `+N −M`, A/M/D, order, even rows; with
    `OMNI_VERIFY_CLASSIC_LIST_PNG` set to a screenshot of the classic list,
    `list-side-by-side.png`); search; "View as Tree" shows folders, whose rows
    match the classic Files tree's (indent, icon and label position, height,
    color, font, status; `tree-side-by-side.png`); folders collapse and
    expand; each session keeps its own mode; tab and mode survive a reload;
    an SSE `session.changed_files.invalidated` adds a row; a click opens the
    file viewer; back to the list, and the Files tab works.
    `--only-changes` runs just these.
  - The built-in Content search and Agents tabs, on mocked file contents, a
    session tree (a working researcher, a finished explorer with a
    grandchild waiting on the user) and agent costs: ⌘⇧F selects Content
    search and focuses its field; a search shows the count, the files and
    the marked matches; a match opens its file. Agents shows the badge
    ("Agents 1/3"), the rows at their depths, the status tiles, costs and
    previews, the graph with every agent, and a click opens a sub-agent.
    With `--classic-repo <checkout before the migration>`, the same steps run
    on that checkout's dev server (port + 2) against the same mock, every
    reading must equal the classic tab's, and `--side-by-side-prefix` names
    the side-by-side screenshots (`search-results`, `agents-list`,
    `agents-graph`). The same run opens the Tasks tab on a mocked plan
    (done, stopped, failed and blocked tasks): the tab, header, rows, a
    segment's card with its dependency arcs, a history with its Markdown
    goal, the graph's nodes, and a row's click asking the chat for its
    marker; against the classic checkout every reading must be the same,
    and the side-by-side screenshots are `tasks`, `card`, `history` and
    `graph`. `prod` and `live` open the Tasks tab too. `--only-tabs` runs
    just these.
  - The built-in Files tab, on a mocked workspace (the changed files plus a
    dotfile and a large file on disk, a file search route): the root with
    the deleted file overlaid, two lazy folders opened, the rows' order,
    letters, indentation, heights and colors, Sort by size, the hidden
    toggle, a search, browsing into a folder and back, and opening a file;
    with `--classic-repo` every reading must equal the classic tab's, and
    the side-by-side screenshots are `root`, `tree`, `search` and
    `browse`. The built-in also reveals a changed file opened from the
    Changes tab through the viewer's "Reveal in Files". `prod` and `live`
    open the Files tab and a folder in it (reads only). `--only-files` runs
    just these.
  - The built-in Pull Requests tab, on a mocked session with two stored
    pull requests (an open one with checks, reviewers, labels, a comment,
    a diff and a review thread; a merged one) and an offline session: the
    list and its statuses, linking a third (the POST reaches the mock
    only) and unlinking it (the DELETE likewise), the details with the
    checks, reviewers and labels, the merge dialog with the repository's
    methods (closed, never confirmed), Comments with its composer, Changes
    with the diff and the thread, the offline rows and the stored copy,
    and no badge; with `--classic-repo` every reading must equal the
    classic tab's, and the side-by-side screenshots are `list`,
    `details`, `merge`, `changes` and `offline`. `prod` and `live` open
    the tab, a pull request and its Changes (reads only). `--only-prs`
    runs just these.
- `prod`: starts the dev server (port 5182) against the real backend with CLI
  profile auth, aborts every non-GET request from the page, and checks a real
  session shows a `$` value left of the info button (`prod.png`).
- `live`: the same smoke check against an already running UI (`live.png`), by
  default the omni-ui server on `127.0.0.1:$OMNI_UI_PORT` (30000 when unset;
  `--live-url` overrides it). `prod` and `live` also open the built-in Changes
  tab as list and tree (reads only).
- `--screens`, `--token-dump`, `--embed` and `--compare DIR`: the theming
  harness (see [theming_plan.md](theming_plan.md)), a screen matrix and a dump
  of every CSS custom property on the theme roots, on the mock backend, compared
  against the baselines kept in the dev extension.
- Screenshots go to `$OMNI_EXT_VERIFY_DIR` (default `/tmp/omni-ext-verify/`).
- Every run also checks that the extension's vendored `omnigent.d.ts` matches this
  checkout's copy, and that the ports it used are free afterwards.

The loop for a change: edit, run the targeted vitest files and the extension's
`node --test`, run the static checks, then `verify.sh mocked prod` until every
line passes.
