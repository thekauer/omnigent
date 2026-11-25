import type { ComponentType, ReactNode, Ref } from "react";

import { getBasePath, withBasePath } from "./basePath.ts";
import { updatesRoutingKey } from "./sessionHost.ts";
import { clientRoutingKey, SLICE_KEY_HEADER, SLICE_KEY_PARAM } from "./routingKey.ts";
import { EMBED_INNER_MARKER, EMBED_SCOPE_MARKER } from "../theme/themeCss.ts";

/**
 * Embed host integration seam.
 *
 * Standalone web talks to a same-origin server: API calls use relative
 * `/v1/...` paths and the terminal WebSocket is built from
 * `window.location`. When web is embedded as a component library inside
 * another app (e.g. the Databricks monolith), the host injects a config so
 * those calls are rebased onto the host's API surface and auth.
 *
 * Default (no config set) preserves the standalone behavior, so importing
 * this module is a no-op until `setOmnigentHostConfig` is called by the
 * embed entry (`embed.tsx`).
 */

/**
 * A user the host suggests for a permission grant. `userId` is the value
 * actually granted (e.g. an email); `displayName` is an optional human-readable
 * label shown alongside it.
 */
export interface UserSuggestion {
  userId: string;
  displayName?: string;
}

/**
 * The kind of UI element an analytics event came from. A small, closed set kept
 * intentionally host-agnostic — the host maps each value onto whatever its own
 * telemetry taxonomy uses. Omitted when the element doesn't fit any of these.
 */
export type OmnigentComponentKind =
  "button" | "link" | "input" | "textarea" | "checkbox" | "toggle" | "select" | "tabs";

/**
 * A multi-phase interaction whose *outcome* or *latency* matters — not just that a
 * control was clicked. Host-agnostic; the host maps each onto its own taxonomy.
 *   - `agent_run`      — one user prompt → model run.
 *   - `tool_call`      — a single tool / skill / MCP invocation within a run.
 *   - `approval`       — a human-in-the-loop permission decision.
 *   - `list_sessions`  — loading the session list (user-initiated; not background polls).
 *   - `get_session`    — loading a single session the user opened / switched to.
 *   - `create_session_sandbox` / `create_session_computer` — a brand-new chat from
 *     send to the first AI message, split by where the session runs (managed
 *     sandbox vs the user's computer host); host kind is baked into the kind so
 *     the host can name/segment the two without a queryable sub-dimension.
 */
export type OmnigentInteractionKind =
  | "agent_run"
  | "tool_call"
  | "approval"
  | "list_sessions"
  | "get_session"
  | "create_session_sandbox"
  | "create_session_computer"
  | "create_scheduled_task";

/** Terminal outcome of an interaction, set on the `complete` phase. */
export type OmnigentInteractionStatus = "success" | "failure" | "cancelled" | "timed_out";

/**
 * A product-analytics event forwarded to the host. Each carries a stable,
 * caller-chosen `componentId` / `pageId` so the host can attribute the action.
 *
 * PII: `value` on a value-change is only ever set when the emitting call site
 * explicitly declares the value PII-free (see `useOmnigentAnalytics` in
 * `lib/analytics.ts`). Free-form field text is never forwarded. Likewise
 * `interaction_phase.name` must be a bounded, non-PII label (e.g. a tool name
 * from a fixed set), never user content.
 */
export type OmnigentAnalyticsEvent =
  | { type: "click"; componentId: string; componentKind?: OmnigentComponentKind }
  | {
      type: "value_change";
      componentId: string;
      componentKind?: OmnigentComponentKind;
      value?: string | number | boolean;
    }
  | { type: "page_view"; pageId: string }
  | {
      /**
       * Start or end of a timed interaction whose outcome or latency matters
       * (see `OmnigentInteractionKind`). `interactionId` correlates the `start`
       * and `complete` of one interaction; `status` and `durationMs` are set on
       * `complete`.
       */
      type: "interaction_phase";
      interactionId: string;
      interactionKind: OmnigentInteractionKind;
      phase: "start" | "complete";
      status?: OmnigentInteractionStatus;
      name?: string;
      durationMs?: number;
    };

/**
 * An MCP connection the user can authorize before starting a session: a
 * host-managed MCP service that needs a per-user OAuth grant. The host owns
 * discovery, status and the OAuth flow; the app renders the picker and calls
 * `authorize`.
 */
export interface McpConnectionStatus {
  /** Qualified connection name, e.g. `tools.github`. */
  name: string;
  /** Human-readable label, e.g. `GitHub`. */
  displayName: string;
  /** True when the current user already holds an active credential for it. */
  authorized: boolean;
  /** Optional icon URL or data URI for the provider. */
  iconUrl?: string;
  /**
   * True when the server's admin configuration already adds this service to
   * every session, so it is on whether or not it is selected.
   */
  providedByAdmin?: boolean;
}

/** An MCP service the user can add to a session from the picker's browse view. */
export interface McpServiceSummary {
  /** Qualified service name. */
  name: string;
  /** Human-readable label. */
  displayName: string;
}

/** One page of `mcpConnections.browse`. */
export interface McpServicesPage {
  services: McpServiceSummary[];
  /** Present when more services remain. */
  nextPageToken?: string;
}

/**
 * What started a unit of work the app runs on its own rather than in response
 * to a user action (see {@link OmnigentHostConfig.runBackgroundTask}):
 *   - `session_update`: a frame pushed on the session-updates stream.
 *   - `poll`: a timer-driven refresh (a react-query `refetchInterval` tick or
 *     one of the app's own refresh intervals).
 *   - `focus_refresh`: the window regaining focus or the tab becoming visible.
 *   - `reconnect_refresh`: the browser coming back online.
 */
export type OmnigentBackgroundTaskKind =
  "session_update" | "poll" | "focus_refresh" | "reconnect_refresh";

/**
 * Trusted host renderer for untrusted HTML. Before executing any supplied HTML,
 * enforce sandboxing and an opaque or separate, unprivileged origin that prevents
 * access to the host app. Expose the content iframe before forwarding every load.
 */
export interface HtmlPreviewFrameProps {
  /** Prepared HTML includes an inline comment bridge; the frame's CSP must allow it. */
  htmlContent: string;
  iframeRef: Ref<HTMLIFrameElement>;
  onLoad: () => void;
}

export interface OmnigentHostConfig {
  /**
   * Install before the app mounts and keep the component identity stable for that
   * mount. Omitted by older hosts, which retain the sandboxed srcdoc preview.
   */
  htmlPreviewFrame?: ComponentType<HtmlPreviewFrameProps>;
  /**
   * Stable server/workspace identity for browser storage and goal ownership.
   * Embedded hosts must change this when switching backends.
   */
  serverIdentity?: string;
  /**
   * Maps an web API path (always starting with `/v1`, `/health`, or
   * `/api/...`) to a `Response`. The host implementation is responsible for
   * prefixing the real API base and attaching auth (e.g. the monolith's
   * `workspaceFetch` against `/ajax-api/2.0/omnigent`). When omitted, the
   * native `fetch` is used with the path unchanged.
   */
  fetcher?: (path: string, init?: RequestInit) => Promise<Response>;
  /**
   * Optional user search/autocomplete provider. When supplied by the host, the
   * permissions "add user" field becomes a suggestion combobox; when omitted
   * (standalone, or before the host wires it), that field stays a plain text
   * input and this feature is fully inert. The host owns the actual search
   * logic and returns the suggestions to display.
   */
  searchUsers?: (query: string, options?: { signal?: AbortSignal }) => Promise<UserSuggestion[]>;
  /**
   * Optional product-analytics sink. When supplied by the host, the app's
   * instrumented components forward clicks, field value-changes, and page views
   * here (see `lib/analytics.ts`); when omitted (standalone, or before the host
   * wires it) every emit is a no-op — the app records nothing on its own. The
   * host owns transport, batching, and any PII policy beyond the app's default
   * value redaction.
   */
  analytics?: (event: OmnigentAnalyticsEvent) => void;
  /**
   * Maps an web WS path (e.g.
   * `/v1/sessions/{id}/resources/terminals/{tid}/attach`) to a fully
   * qualified `ws(s)://` URL. When omitted, the URL is built from
   * `window.location`.
   */
  resolveWebSocketUrl?: (path: string) => string;
  /**
   * Maps a web API path (e.g. a workspace file with `?download=true`) to a URL
   * the browser can load directly as `<video src>`, carrying in the URL any
   * auth the host's `fetcher` would add as headers. Set it when the host page's
   * CSP blocks `blob:` media. When omitted, media is fetched through `fetcher`
   * and played from an object URL.
   */
  resolveMediaUrl?: (path: string) => string;
  /**
   * Turns a relative share-link path (basename already included, e.g.
   * `<basename>/c/:id`) into the full absolute share URL — the host prepends
   * its origin and adds any query params it needs. When omitted (standalone),
   * web prepends `window.location.origin` itself.
   */
  transformShareLink?: (relativePath: string) => string;
  /**
   * Path suffix appended to the origin in CLI `--server` instructions shown
   * in the UI (e.g. `"/api/2.0/omnigent"`). When the host proxies the
   * Omnigent API behind a path prefix, CLI users need the full URL
   * (`https://host/api/2.0/omnigent`) — this suffix supplies the
   * non-origin part.
   */
  cliServerUrlSuffix?: string;
  /**
   * Optional replacement for the whole "connect a host" command shown in the
   * UI (e.g. `"acme-cli host --background"`), for a host that hands users a
   * wrapper CLI which already targets this server and signs in on first use.
   * The connect and reconnect instructions show it as given; the session
   * import panel appends `--server <url>`, so a machine registers with this
   * server. It must therefore be a single simple command, with no `&&`, `||`,
   * `|`, `;`, `#` or line break: a value with one is ignored, with a console
   * warning, and the UI shows its default. Surrounding whitespace is trimmed.
   * When omitted, the UI builds `omnigent host --server <url>` from
   * {@link getCliServerUrl}.
   */
  connectHostCommand?: string;
  /**
   * Optional MCP-connection capability. When supplied, the new-session and
   * new-automation screens show a picker of the host's authorizable MCP
   * connections and let the user complete each one's per-user OAuth grant
   * before starting. When omitted, the picker is hidden and the feature is
   * inert; the host owns all listing, status and OAuth-popup logic.
   */
  mcpConnections?: {
    /** Lists the authorizable MCP connections and each one's status. */
    list: (options?: { signal?: AbortSignal }) => Promise<McpConnectionStatus[]>;
    /**
     * Runs the OAuth popup for one connection (by qualified name) and resolves
     * once the per-user grant is saved; rejects if the user cancels or it fails.
     */
    authorize: (name: string) => Promise<void>;
    /**
     * Optional: the status of one service `list` doesn't return (one picked
     * from `browse`), or null if the user can't use it.
     */
    status?: (name: string) => Promise<McpConnectionStatus | null>;
    /**
     * Optional: pages through the other MCP services the user can add. When
     * omitted, the picker offers only what `list` returns.
     */
    browse?: (options?: { pageToken?: string; signal?: AbortSignal }) => Promise<McpServicesPage>;
  };
  /**
   * Runs `task` synchronously as one unit of background work, which the app
   * starts on its own when a session-updates frame arrives, a refresh timer
   * ticks, or the tab regains focus or connectivity. A host that traces
   * requests can attribute everything the task does, notably the requests it
   * sends through `fetcher`, to that cause, rather than to no caller or to a
   * stale one inherited from whatever armed the timer. When omitted, the task
   * runs directly.
   */
  runBackgroundTask?: (kind: OmnigentBackgroundTaskKind, task: () => void) => void;
  /**
   * Optional overrides, in seconds, for the app's fixed-cadence polls, so a host
   * can tune their load without a release. A field left unset, or not a
   * positive number, keeps that poll's built-in default.
   */
  pollIntervals?: {
    /** Execution-logs panel `GET /v1/sessions/{id}/items` refetch cadence. */
    items?: number;
    /**
     * Accepted for compatibility; child-session lists update from the
     * session-updates stream, so no timer reads it.
     */
    childSessions?: number;
    /** Host picker and chat-header badge `GET /v1/hosts` refetch cadence. */
    hosts?: number;
    /** Canvas `GET /v1/sessions` refresh cadence. */
    canvasSessions?: number;
    /** Canvas pull-request lookup refresh cadence. */
    canvasPullRequests?: number;
    /** Canvas failed pull-request lookup retry cadence. */
    canvasPullRequestRetry?: number;
  };
  /**
   * How long, in seconds, a just-created or forked session stays pinned in the
   * sidebar list while the server's session search catches up with it. Absent
   * keeps the 60 second default; `0` disables the pin.
   */
  sidebarCacheTtlSeconds?: number;
  /**
   * Optional URL to the host's appearance settings, linked beside the browser
   * embed's automatic theme option. Omitted standalone and hidden in Electron.
   */
  themeSettingsUrl?: string;
  /**
   * Optional documentation links for embed-only UX hints.
   *
   * Standalone web ignores these values. Embedded hosts can pass one object
   * instead of adding many top-level props as docs surfaces grow.
   */
  docsLinks?: {
    /**
     * Full tooltip content shown for the disabled New Sandbox help icon.
     */
    newSandbox?: ReactNode;
    /**
     * Full tooltip content shown for the Databricks git-credentials help icon
     * in the sandbox repository popover.
     */
    databricksGitCredentials?: ReactNode;
  };
}

let hostConfig: OmnigentHostConfig = {};
let hostConfigGeneration = 0;
let embedRoot: HTMLElement | null = null;
let embedScopeRoot: HTMLElement | null = null;

export function getOmnigentHtmlPreviewFrame(): OmnigentHostConfig["htmlPreviewFrame"] {
  return hostConfig.htmlPreviewFrame;
}

export function getOmnigentServerIdentity(): string | null {
  if (hostConfig.serverIdentity?.trim()) return hostConfig.serverIdentity.trim();
  // Standalone has one same-origin server. Embedded hosts can proxy many
  // backends behind one origin and must provide an explicit stable identity.
  if (hostConfig.fetcher) return null;
  return typeof window === "undefined" ? "server" : window.location.origin;
}

export function setOmnigentHostConfig(config: OmnigentHostConfig): void {
  // Guard: never clobber an already-installed fetcher with an empty config.
  // `OmnigentApp` installs config during render and React may re-invoke it with
  // default/empty props on concurrent or Suspense renders; without this guard
  // such a render would wipe the host transport and API calls would fall back
  // to bare same-origin paths.
  if (!config?.fetcher && hostConfig.fetcher) return;
  hostConfig = config ?? {};
  hostConfigGeneration += 1;
}

export function getOmnigentHostConfig(): OmnigentHostConfig {
  return hostConfig;
}

export function getOmnigentHostGeneration(): number {
  return hostConfigGeneration;
}

/**
 * True when host-scoped traffic must carry the host_id slice key: either the
 * embed host fetcher is installed (managed UI) or the standalone dev bundle
 * was pointed at a Databricks workspace via `npm run dev` (vite.config.ts sets
 * `VITE_DATABRICKS_WORKSPACE=true`). No fetcher is installed in the dev case,
 * so the flag is the signal. False for a bare local / self-hosted server
 * (single replica, no sharding), where emitting the key would just dirty the log.
 */
export function isDatabricksWorkspace(): boolean {
  return hostConfig.fetcher != null || import.meta.env.VITE_DATABRICKS_WORKSPACE === "true";
}

/** Whether the deployment routes host and runner traffic by host ID. */
export function isHostRoutingEnabled(): boolean {
  return isDatabricksWorkspace() || import.meta.env.VITE_OMNIGENT_HOST_ROUTING === "true";
}

/**
 * The host-provided user search function, or `undefined` when none is
 * configured. Consumers use the absence to stay inert (plain text input).
 */
export function getOmnigentUserSearch(): OmnigentHostConfig["searchUsers"] {
  return hostConfig.searchUsers;
}

/**
 * The host-provided analytics sink, or `undefined` when none is configured.
 * Consumers use the absence to stay inert (emit nothing).
 */
export function getOmnigentAnalytics(): OmnigentHostConfig["analytics"] {
  return hostConfig.analytics;
}

/**
 * The host-provided share-link transform, or `undefined` when none is
 * configured. Absence means the relative URL is used unchanged.
 */
export function getOmnigentTransformShareLink(): OmnigentHostConfig["transformShareLink"] {
  return hostConfig.transformShareLink;
}

/**
 * The host-provided MCP-connections capability, or `undefined` when none is
 * configured. Consumers use the absence to hide the connections picker.
 */
export function getOmnigentMcpConnections(): OmnigentHostConfig["mcpConnections"] {
  return hostConfig.mcpConnections;
}

/**
 * The host-provided poll interval overrides, in seconds, or `undefined` when
 * none are configured. Prefer {@link hostPollIntervalMs}, which validates them.
 */
export function getOmnigentPollIntervals(): OmnigentHostConfig["pollIntervals"] {
  return hostConfig.pollIntervals;
}

/**
 * The poll interval for `key` in milliseconds: the host's override when it is
 * a positive number of seconds, else `defaultMs`.
 */
export function hostPollIntervalMs(
  key: keyof NonNullable<OmnigentHostConfig["pollIntervals"]>,
  defaultMs: number,
): number {
  const seconds = getOmnigentPollIntervals()?.[key];
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : defaultMs;
}

/**
 * The host-provided sidebar keep-alive window in seconds, or `undefined` for
 * the default. `0` disables the keep-alive.
 */
export function getOmnigentSidebarCacheTtlSeconds(): OmnigentHostConfig["sidebarCacheTtlSeconds"] {
  return hostConfig.sidebarCacheTtlSeconds;
}

/** The CLI command that connects a machine as a host, without a configured replacement. */
export const DEFAULT_CONNECT_HOST_COMMAND = "omnigent host";

/** Shell syntax that would chain, pipe or comment out a command `--server` is appended to. */
const COMPOUND_COMMAND = /&&|\|\||[|;#\r\n]/;

const warnedConnectHostCommands = new Set<string>();

/**
 * A connect-a-host command as the UI uses it: trimmed, or `undefined` when it
 * is empty or not a single simple command (see
 * {@link OmnigentHostConfig.connectHostCommand}), so the caller falls back to
 * its default. An unusable value warns once.
 */
export function normalizeConnectHostCommand(
  command: string | null | undefined,
): string | undefined {
  if (typeof command !== "string") return undefined;
  const trimmed = command.trim();
  if (trimmed === "") return undefined;
  if (COMPOUND_COMMAND.test(trimmed)) {
    if (!warnedConnectHostCommands.has(trimmed)) {
      warnedConnectHostCommands.add(trimmed);
      console.warn(
        "[omnigent] connectHostCommand must be a single simple command (no &&, ||, |, ;, # or " +
          "line breaks), since --server is appended to it; showing the default instead.",
      );
    }
    return undefined;
  }
  return trimmed;
}

/**
 * The host-provided connect-a-host command, trimmed, or `undefined` when none
 * is configured or it is unusable. Absence means the UI builds
 * `omnigent host --server <url>` itself.
 */
export function getOmnigentConnectHostCommand(): OmnigentHostConfig["connectHostCommand"] {
  return normalizeConnectHostCommand(hostConfig.connectHostCommand);
}

/**
 * Runs `task` through the host's {@link OmnigentHostConfig.runBackgroundTask},
 * or directly when none is configured. The config is read on every call, so
 * dispatchers armed before the host installed its config still reach it.
 */
export function runHostBackgroundTask(kind: OmnigentBackgroundTaskKind, task: () => void): void {
  const runBackgroundTask = hostConfig.runBackgroundTask;
  if (runBackgroundTask) runBackgroundTask(kind, task);
  else task();
}

/**
 * Wraps an event or timer handler so each call runs as a host background task
 * of `kind`. Keep the returned function to pass to `removeEventListener`.
 */
export function withHostBackgroundTask<TArgs extends unknown[]>(
  kind: OmnigentBackgroundTaskKind,
  handler: (...args: TArgs) => void,
): (...args: TArgs) => void {
  return (...args) => runHostBackgroundTask(kind, () => handler(...args));
}

/**
 * The host-provided URL to its own theme/appearance settings, or `undefined`
 * standalone. The settings screen links here when the host owns light/dark.
 */
export function getOmnigentThemeSettingsUrl(): OmnigentHostConfig["themeSettingsUrl"] {
  return hostConfig.themeSettingsUrl;
}

/**
 * The DOM node the embed is mounted into. Used as the portal container for
 * Radix overlays so portaled content (dialogs, popovers, tooltips, menus)
 * lands inside the scoped `.omnigent-app` subtree and inherits its styles.
 * Returns null in standalone mode, where Radix falls back to `document.body`.
 */
export function setEmbedRoot(el: HTMLElement | null): void {
  if (embedRoot === el) return;
  embedRoot?.removeAttribute(EMBED_INNER_MARKER);
  embedRoot = el;
  el?.setAttribute(EMBED_INNER_MARKER, "");
  notifyThemeRoots();
}

export function getEmbedRoot(): HTMLElement | null {
  return embedRoot;
}

/**
 * The embed's scope element (`.omnigent-app`) — the outer wrapper the scoped
 * stylesheet collapses `:root` / `html` / `body` onto. Per-device preference DOM
 * mutations (UI font size, `--custom-*` theme variables, the `data-theme`
 * palette attribute) must land here (or a descendant) rather than on
 * `document.documentElement`: the scoped `.omnigent-app` tokens shadow anything
 * set on the real document root. Null standalone (falls back to the document
 * root), where the scoped stylesheet isn't in play.
 */
export function setEmbedScopeRoot(el: HTMLElement | null): void {
  if (embedScopeRoot === el) return;
  embedScopeRoot?.removeAttribute(EMBED_SCOPE_MARKER);
  embedScopeRoot = el;
  el?.setAttribute(EMBED_SCOPE_MARKER, embedScopeNonce);
  notifyThemeRoots();
}

// The scope root's marker value: markup elsewhere (the host page's, or rendered content)
// can't guess it, so only the real scope root matches the runtime selectors.
const embedScopeNonce = (() => {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
})();

const themeRootListeners = new Set<() => void>();

function notifyThemeRoots(): void {
  for (const listener of themeRootListeners) listener();
}

/**
 * Calls `listener` when {@link getThemeRoots} may return other elements (the embed
 * mounted, remounted or unmounted); returns the unsubscribe.
 */
export function subscribeThemeRoots(listener: () => void): () => void {
  themeRootListeners.add(listener);
  return () => {
    themeRootListeners.delete(listener);
  };
}

export function getEmbedScopeRoot(): HTMLElement | null {
  return embedScopeRoot;
}

/**
 * The element preference CSS custom properties are set on (UI font size/family,
 * `--custom-*` theme variables): the embed scope root when embedded, else the
 * document root.
 */
export function getStyleRoot(): HTMLElement | null {
  if (embedScopeRoot) return embedScopeRoot;
  return typeof document !== "undefined" ? document.documentElement : null;
}

/**
 * The elements theme *attributes* are stamped onto (`data-theme` palette,
 * `data-custom-translucent-sidebar`). Embedded, both the scope root (matched by
 * the light `:root[data-theme]` selectors) and the inner `.dark` root (matched
 * by the dark `.dark[data-theme]` selectors) need them; standalone it's just the
 * document root.
 */
export function getThemeRoots(): HTMLElement[] {
  if (embedScopeRoot) {
    return embedRoot ? [embedScopeRoot, embedRoot] : [embedScopeRoot];
  }
  return typeof document !== "undefined" ? [document.documentElement] : [];
}

/**
 * The selector a stylesheet that targets the theme roots scopes itself to: the embed's
 * scope class and its root's nonce marker while embedded, else null (the
 * document root). The theme service's runtime stylesheet uses it, so an embed's theme
 * never reaches the host page.
 */
export function getThemeScopeSelector(): string | null {
  return embedScopeRoot
    ? `${EMBED_SCOPE_SELECTOR}[${EMBED_SCOPE_MARKER}="${embedScopeNonce}"]`
    : null;
}

/** The embed's scope class as a selector (`vite.embed.config.ts` prefixes every rule with it). */
export const EMBED_SCOPE_SELECTOR = ".omnigent-app";

/** Routing options for a request to the Omnigent server. */
export interface RoutingOptions {
  /** Send no slice key, to reach a host whose tunnels connected without one. */
  unkeyed?: boolean;
  /** The request names no host: key it by the modal host, else this client's key. */
  hostless?: boolean;
}

/** The fallback key for a request that names no host of its own. */
function fallbackRoutingKey(options?: RoutingOptions): string {
  return options?.hostless ? updatesRoutingKey() : clientRoutingKey();
}

/**
 * `init` with the fallback slice key added when host routing is on and the
 * request carries no key yet, so every request names a replica.
 */
export function withRoutingKey(
  init?: RequestInit,
  options?: RoutingOptions,
): RequestInit | undefined {
  if (options?.unkeyed || !isHostRoutingEnabled()) return init;
  const headers = new Headers(init?.headers);
  if (headers.has(SLICE_KEY_HEADER)) return init;
  headers.set(SLICE_KEY_HEADER, fallbackRoutingKey(options));
  return { ...init, headers };
}

/** `path` with the fallback slice key as a query parameter when it carries none. */
export function withRoutingKeyParam(path: string, options?: RoutingOptions): string {
  if (options?.unkeyed || !isHostRoutingEnabled()) return path;
  const [base, query = ""] = path.split("?", 2);
  const params = new URLSearchParams(query);
  if (params.has(SLICE_KEY_PARAM)) return path;
  params.set(SLICE_KEY_PARAM, fallbackRoutingKey(options));
  return `${base}?${params}`;
}

/**
 * Single network choke point. Delegates to the host fetcher when embedded,
 * otherwise calls native `fetch` with the path unchanged (standalone).
 */
export function hostFetch(
  path: string,
  init?: RequestInit,
  options?: RoutingOptions,
): Promise<Response> {
  const routedInit = withRoutingKey(init, options);
  if (hostConfig.fetcher) {
    // The host owns path rebasing (it proxies onto its own API surface), so
    // the path is passed through untouched — `withBasePath` is standalone-only.
    return hostConfig.fetcher(path, routedInit);
  }
  return fetch(withBasePath(path), routedInit);
}

export function resolveWebSocketUrl(path: string, options?: RoutingOptions): string {
  const routedPath = withRoutingKeyParam(path, options);
  if (hostConfig.resolveWebSocketUrl) {
    return hostConfig.resolveWebSocketUrl(routedPath);
  }
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}${withBasePath(routedPath)}`;
}

/** The host's directly loadable media URL for an API path, or null to fetch through `fetcher`. */
export function resolveMediaUrl(path: string): string | null {
  return hostConfig.resolveMediaUrl ? hostConfig.resolveMediaUrl(path) : null;
}

/**
 * Full server URL for CLI `--server` flags shown in in-product docs.
 * Returns `window.location.origin` plus the configured base path plus the
 * optional {@link OmnigentHostConfig.cliServerUrlSuffix}.
 */
export function getCliServerUrl(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return origin + getBasePath() + (hostConfig.cliServerUrlSuffix ?? "");
}
