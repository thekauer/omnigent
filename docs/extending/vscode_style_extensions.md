# VS Code-style web extensions (prototype)

Status: prototype, dev server only. It lives next to the existing extension system
(`web/src/extensions/`, `omnigent/extensions/`, `sdks/web-extension`), which it does
not change.

## Status and queue

This section is the durable state to resume from. Update it at each checkpoint.

**Done:** the prototype host, session header items, the `thekauer.dev` session cost
feature, hardening of the host lifecycle and the dev plugin, the trust model
below, and queue item 1 (reconnect for the user's own cloud dev machines): Node
entries, commands, progress notifications and the host reconnect provider seam,
with the server wake moved onto it.

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
2. **Private Git host PR links** in the Pull Requests tab (a GitHub
   Enterprise-style host with numbered shards, such as
   `https://N.git.example.com/<org>/<repo>/pull/<number>` with any N).
   - A git-host provider seam, with GitHub as the built-in and the private host
     in `thekauer.dev`.
   - If the server cannot fetch from the private host, the dev extension's Node
     part fetches the PR on the developer's machine with its local `gh`
     credentials.
3. **Changes 2:** a new right-panel tab in `thekauer.dev`.
   - Changed files with a view/title toggle between a flat list and a tree styled
     like the classic Files tab, remembered per chat session.
   - Needs views, a host-rendered TreeView/TreeDataProvider, view/title actions,
     commands, setContext/when, workspaceState, and changed-files events.
   - Classic rail only. Existing tabs stay untouched.
4. **Tab migration** once Changes 2 is proven.
   - Move the right-panel tabs onto built-in extensions, which needs production
     loading. Delete each core version once its replacement passes the same tests.
   - Order: Changes, Content search, Agents, Tasks, then Files, then Pull Requests.
   - Terminals, browser, side chat and the file viewer stay in core.
   - This satisfies the AGENTS.md "move a built-in onto each seam" rule, which is
     waived until then.

Stop after item 4. The rest of the "Later" list waits for the user.

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
2. **In-page host** (`web/src/vscodeExtensions/host.ts`, booted from `main.tsx` via
   `devLoader.ts`; no host code loads when no extension is configured). The
   loader is imported dynamically under `import.meta.env.DEV`, so production
   builds contain no loader, host or API code; only the small header-item
   registry and slot ship.
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
     blocks, the dev server. A crash fails the calls in flight; a manifest
     change, or an edit to any file of an extension with a Node entry,
     restarts the process once no command is running (Node has no hot reload).
     Dev server shutdown stops it.
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
   an unknown one. Arguments and results are copied as JSON.
10. **Progress and messages** (`progress.ts`, on the app's sonner toasts).
    `window.withProgress({ title }, task)` shows a loading toast with the
    latest reported message; it is dismissed when the task resolves and
    turns into an error toast with the error's message when it rejects (the
    promise rejects too). `showInformationMessage` and `showErrorMessage`
    show plain toasts. Progress a Node command reports joins the calling
    extension's latest open progress, or gets its own toast when none is open.
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
    - An extension provider's `reconnect` runs inside a "Reconnecting
      <name>" progress toast; a second click for the same host joins the run;
      success refreshes host liveness.

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
  (compared in constant time). Other sites cannot read it: they cannot load the
  dev server's modules cross-origin.
- `Origin` must be exactly `http://127.0.0.1:<port>` or `http://localhost:<port>`
  of this dev server, and `Host` must be `127.0.0.1:<port>` or
  `localhost:<port>`, which also stops DNS rebinding.
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
  test/fake-<cli>/        a fake machine CLI the tests put first on PATH
  types/omnigent.d.ts     vendored copy of the API typings
  test/*.test.js          node:test unit tests against a fake omnigent API
  verify/verify.sh        browser verify loop (see below)
```

Plain ESM with `// @ts-check`; no build step.

## VS Code to Omnigent mapping

| VS Code                                                              | Omnigent prototype                                           | Notes                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| `import * as vscode from "vscode"`                                   | `import * as omnigent from "omnigent"`                       | Per-extension instance, resolved by the dev plugin |
| `package.json` `publisher.name` id                                   | same                                                         |                                                    |
| `engines.vscode`                                                     | `engines.omnigent`                                           | Validated as a range, not enforced yet             |
| `main` / `browser`                                                   | same                                                         | ES modules; `main` runs in a dev server child      |
| `activationEvents` `*`, `onStartupFinished`                          | same                                                         | Other events warn                                  |
| `activate(context)` / `deactivate()`                                 | same                                                         | Async supported                                    |
| `ExtensionContext.subscriptions`, `.extension.id`                    | same, plus `.extension.version`                              | No storage, URIs or secrets yet                    |
| `Disposable`, `Disposable.from`                                      | same                                                         |                                                    |
| `Event<T>`, `EventEmitter<T>`                                        | same                                                         | Errors reported against the extension              |
| `window.createStatusBarItem(id?, alignment?, priority?)`             | `window.createSessionHeaderItem(id?, alignment?, priority?)` | Header slot left of the agent info button          |
| `StatusBarAlignment`                                                 | `SessionHeaderItemAlignment`                                 | `Right` sits next to the anchor                    |
| `StatusBarItem.text`, `.tooltip`, `.show()`, `.hide()`, `.dispose()` | same                                                         | Plain text; no `$(icon)`, no `command`, no colors  |
| `window.activeTextEditor`, `onDidChangeActiveTextEditor`             | `sessions.activeSession`, `onDidChangeActiveSession`         |                                                    |
| (none)                                                               | `sessions.onDidChangeUsage`, `sessions.activeSessionUsage`   | Plain-data usage of the active session             |
| `commands.registerCommand`, `commands.executeCommand`                | same                                                         | JSON args and results; page or Node                |
| `window.withProgress`                                                | same                                                         | Notification only; `{ title }`                     |
| `window.showInformationMessage`, `showErrorMessage`                  | same                                                         | Toasts; no buttons                                 |
| `window.createOutputChannel(name, { log: true })`                    | `window.createOutputChannel(name)` (Node only)               | Lines go to the dev server output                  |
| `workspace.registerRemoteAuthorityResolver`                          | `hosts.registerReconnectProvider`                            | For "Reconnect host"; plain host data              |
| `import * as vscode from "vscode"` in `main`                         | `import * as omnigent from "omnigent/node"`                  | A smaller API than the page's                      |

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
- `withProgress` has no `location` or cancellation: progress always shows as
  a notification. It shows a rejected task's error, which VS Code leaves to the
  extension.
- A Node command's progress is shown in the page: it joins the calling
  extension's latest open progress (for example a reconnect's), or gets its
  own notification. VS Code has no such bridge.
- Reconnect providers are ordered by registration, built-ins first, not by an
  authority prefix: hosts have no URI scheme to key on.

## Later

- `item.command` on header items.
- `contributes.menus`, `keybindings`, `configuration` and a settings UI.
- `when` clauses and context keys.
- An isolated host: one Worker per extension inside a sandboxed iframe, with the
  API proxied over `postMessage`. The plain-data API is designed for this. This
  is the real security boundary: the dev plugin's path guards only stop
  accidents, so untrusted extensions must wait for it (see
  [Security and trust model](#security-and-trust-model)).
- Host-enforced permissions per API namespace.
- Loading server-installed extensions (not only dev paths), including production
  builds.
- `engines.omnigent` enforcement against the running version.
- More activation events (`onView`, `onCommand`, `onSession...`).
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
  src/store/chatStore.test.ts src/lib/hostReconnectProviders.test.ts \
  src/hooks/useSessionReconnect.test.ts src/components/HostBadge.test.tsx \
  src/viteDevProxyToken.test.ts
# Broader regression set
corepack pnpm exec vitest run src/shell src/components/AgentInfo src/vscodeExtensions
# Static checks
corepack pnpm exec prettier --check vite.config.ts vite.omnigentExtensions.ts \
  vite.omnigentNodeExtensions.ts vite.omnigentNodeHost.mjs vite.devProxyToken.ts \
  src/vscodeExtensions src/lib/hostReconnectProviders.ts src/hooks/useSessionReconnect.ts \
  src/components/HostBadge.tsx src/pages/ChatPage.tsx src/shell/ChatHeader.tsx src/main.tsx \
  src/store/chatStore.ts src/store/conversationState.ts
corepack pnpm exec oxlint --deny-warnings --report-unused-disable-directives .
# A production build carries no Node host, endpoint or token code
corepack pnpm exec vite build --outDir /tmp/omnigent-build-check && \
  ! grep -rlE "x-omnigent-extension-token|__omnigent/extensions|omnigent/node" /tmp/omnigent-build-check
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
- `progress.test.ts`, `api.test.ts`: `withProgress` success and failure,
  messages, the sonner toasts; the API's commands, Node progress joining the
  open progress or getting its own, reconnect providers (plain frozen host,
  progress title, failure shown, a second click joining, unregistering).
- `hostReconnectProviders.test.ts`, `useSessionReconnect.test.ts`,
  `HostBadge.test.tsx`: provider order, sync and async answers, throwing,
  rejecting, slow and non-Promise thenable answers, warm-up; the built-in wake
  first and unchanged (the existing wake tests pass as they were), fallback to
  the dialog and to the desktop reconnect, ignored repeat clicks, a late
  answer after a session switch, a failing `reconnect`; the menu warming
  providers for an offline host only, the item label unchanged.
- `viteDevProxyToken.test.ts`: the async token cache of the dev proxy.
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
    it fetches the list; clicking it shows the progress toast with each step
    and the result toast, and the fake ran resume, then the start command over
    SSH, with the exact argv. A host that is not one of the machines opens the
    existing reconnect dialog, and a resumable managed host still sends the
    server wake (`retry_session`, captured by the mock).
- `prod`: starts the dev server (port 5182) against the real backend with CLI
  profile auth, aborts every non-GET request from the page, and checks a real
  session shows a `$` value left of the info button (`prod.png`).
- `live`: the same smoke check against an already running UI (`live.png`), by
  default the omni-ui server on `127.0.0.1:$OMNI_UI_PORT` (30000 when unset;
  `--live-url` overrides it).
- Every run also checks that the extension's vendored `omnigent.d.ts` matches this
  checkout's copy, and that the ports it used are free afterwards.

The loop for a change: edit, run the targeted vitest files and the extension's
`node --test`, run the static checks, then `verify.sh mocked prod` until every
line passes.
