import { applyMobileAppTargetAttribute } from "./lib/mobileAppTargets";
import { appConfig, type SidebarConfig } from "./appConfig";
import { IdentityAwareSidebarDataProvider } from "./hooks/useSidebarData";
// Embed entry point.
//
// Exposes `OmnigentApp` — a plain React component (app-specific providers +
// routes, NO React root, NO router) — for a host (e.g. the Databricks monolith)
// to render the full web experience directly inside its own React tree and
// its own router. web's `<Routes>` match the absolute host pathname (route
// paths are prefixed with `basename`) and its routing hooks (useNavigate/Link)
// rebase absolute targets under `basename`. This is the same-root path.
//
// The embed:
//   - injects the host transport config (API fetcher + WebSocket URL),
//   - tags a root element with `.omnigent-app` so the scoped stylesheet
//     applies and Radix overlays portal back into this subtree,
//   - follows the host color scheme by default, with per-device overrides,
//   - owns its OWN QueryClient (react-query is bundled, not shared).
//
// Only React/ReactDOM, react/jsx-runtime, and react-router(-dom) are left as
// BARE externals in the intermediate build (`vite.embed.config.ts`); the host
// monolith's rspack resolves them to its own copies (React 18, react-router
// 6.4.1), so the island shares the host's single React + react-router instance.
// Everything else (react-query, monaco, shiki, xterm, …) is bundled by Vite;
// rspack then ingests the single intermediate module and emits the final chunks.

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { APP_QUERY_DEFAULTS } from "./lib/queryRetry";
import { routeQueryBackgroundWorkThroughHost } from "./lib/queryBackgroundTasks";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import { useResolvedThemeMode } from "./components/theme/useResolvedThemeMode";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import App from "./App";
import { TooltipProvider } from "./components/ui/tooltip";
import { ImageLightboxProvider } from "./components/ImageLightbox";
import { RunnerHealthProvider } from "./hooks/RunnerHealthProvider";
import { CapabilitiesContext } from "./lib/CapabilitiesContext";
import { createBootServerInfo } from "./lib/bootCapabilities";
import { resolveServerInfo, type ServerInfo } from "./lib/capabilities";
import { EmbeddedProvider } from "./lib/embedded";
import {
  type OmnigentHostConfig,
  setEmbedRoot,
  setEmbedScopeRoot,
  setOmnigentHostConfig,
} from "./lib/host";
import { prefetchSessionHostChain } from "./hooks/useSession";
import { resolveIdentity, setSessionHostResolver } from "./lib/identity";
import { keepsDesktopLayout } from "./lib/desktopAppLayout";
import { isMacElectronShell, isNativeShell } from "./lib/nativeBridge";
import {
  applyStoredUiFontSize,
  applyUiFontFamily,
  readUiFontFamily,
} from "./lib/uiFontPreferences";
import { applyThemePalette, readThemePalette } from "./lib/themePalette";
import { applyCustomTheme, readCustomTheme } from "./lib/customTheme";
import {
  applyBuildProductTheme,
  applyServerProductTheme,
  parseProductTheme,
  type ProductConfig,
  setProductTheme,
} from "./theme/productTheme";
import { themeService } from "./theme/themeService";
import {
  type RoutingApi,
  RoutingProvider,
  basenamedRouting,
  reactRouterRouting,
} from "./lib/routing";
import { initChatStore } from "./store/chatStore";
import { cn } from "./lib/utils";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import "./index.css";
import "./theme/variants.css";
import { QueueFlushProvider } from "./hooks/QueueFlushProvider";
import { ExtensionProvider } from "./extensions/ExtensionProvider";
import { SessionUpdatesProvider } from "./hooks/SessionUpdatesProvider";
import { useWindowExtensionHost } from "./vscodeExtensions/useWindowExtensionHost";

export type { HtmlPreviewFrameProps, OmnigentHostConfig } from "./lib/host";
export type { RoutingApi } from "./lib/routing";

// Re-export the host-config setter so the host can install transport config
// EAGERLY (before first render), independent of React render/prop timing. The
// config is a module-level singleton in `host.ts`, shared across all chunks.
export { setOmnigentHostConfig } from "./lib/host";

// The embed owns its QueryClient (react-query is bundled, not shared with the
// host). One client at module scope, shared across the whole embed — mirrors
// `main.tsx`'s standalone client (chat-tuned: 30s stale, no window-focus
// refetch, which is noisy for chat).
// Before any query is created: react-query's timers and focus/online listeners
// then run each refetch the app starts on its own as a host background task.
routeQueryBackgroundWorkThroughHost();
const queryClient = new QueryClient({
  defaultOptions: {
    queries: APP_QUERY_DEFAULTS,
  },
});

export type { SidebarConfig } from "./appConfig";
export type { ProductConfig, ProductThemeConfig } from "./theme/productTheme";

export interface OmnigentAppProps extends OmnigentHostConfig {
  /** Runtime consumer policy, display pagination, and polling, resolved by the host. */
  sidebarConfig?: Partial<SidebarConfig>;
  /**
   * Router basename, e.g. `/ml/omnigent-embed`. web's routes + navigation
   * use absolute paths (`/`, `/c/:conversationId`), so the app must be nested
   * under the host mount path.
   *
   * No nested `<Router>` is rendered; route matching is relative (descendant
   * routes), and `navigate()`/`<Link to>` are rebased under `basename` via
   * `basenamedRouting`.
   */
  basename?: string;
  /**
   * Optional routing inversion-of-control override. Merged over the default
   * react-router-dom implementation. In the same-root path react-router-dom is
   * already the host's instance (externalized), so this is rarely needed.
   */
  routing?: Partial<RoutingApi>;
  /**
   * Host color scheme used by automatic mode in a browser. Explicit light/dark
   * overrides it; Electron automatic mode follows the OS. Defaults to light.
   */
  isDarkMode?: boolean;
  /**
   * The product's configuration. `theme` sets the default theme (first run and reset),
   * the themes offered (`allowed`, ids or `*` patterns), a locked mode, locked tokens,
   * options and variants (applied over the user's settings), and hides the picker or the
   * customizations. Each field wins over the build's `web/product.json` and the server's
   * `product.theme`. See `theme/productTheme.ts`.
   */
  product?: ProductConfig;
}

/**
 * Shared provider stack + `<App/>` route table. Expects a router context to
 * already be present — the host (universe) supplies it; the embed renders in
 * the host's same React tree (shared react-router). The embed brings its OWN
 * `<QueryClientProvider>` (react-query is bundled, not shared). Self-contained
 * for styling: renders its own `.omnigent-app` scope wrapper and registers it
 * as the Radix portal root, so the host only renders this — no class/portal
 * wiring needed.
 */
/**
 * Runs `main.tsx`'s boot-time `/v1/info` probe inside the embed tree.
 *
 * Standalone resolves the probe BEFORE its first render and renders the whole
 * app under `<CapabilitiesProvider>`. The embed is rendered synchronously by
 * the host, so there's no "await then render" seam — instead we hold the
 * context at the default `"loading"` and flip it once the probe resolves.
 *
 * WITHOUT this provider, `useServerInfo()` returns the context default
 * (`"loading"`) forever, so `App` hits its `if (info === "loading") return
 * null` guard and the embed renders a permanently blank `.omnigent-app` div.
 */
function EmbedCapabilitiesProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<ServerInfo | "loading">("loading");
  useEffect(() => {
    let alive = true;
    const boot = createBootServerInfo(resolveServerInfo());
    void boot.initial.then((resolved) => {
      if (alive) setInfo(resolved);
    });
    void boot.settled.then((resolved) => {
      // The server's product theme, below the embed's and the build's.
      applyServerProductTheme(resolved);
      if (alive) setInfo(resolved);
    });
    return () => {
      alive = false;
    };
  }, []);
  return <CapabilitiesContext.Provider value={info}>{children}</CapabilitiesContext.Provider>;
}

function OmnigentProviders({
  sidebarConfig: sidebarOverrides,
  routing,
  basename,
}: {
  sidebarConfig?: Partial<SidebarConfig>;
  routing: RoutingApi;
  basename?: string;
}) {
  const isDarkMode = useResolvedThemeMode() === "dark";
  // Reuse the host's QueryClient (read from the ambient provider) and run the
  // one-time side effects (wire the chat store to that client + resolve
  // identity). `initChatStore` only stashes the client for later cache
  // invalidation, so doing this in a mount-once initializer is fine.
  const hostQueryClient = useQueryClient();
  useState(() => {
    initChatStore(hostQueryClient);
    // Resolve a session's routing host on demand (a hostless sub-agent child
    // walks up to its host-bound ancestor) before host-scoped requests key.
    setSessionHostResolver((sessionId, options) =>
      prefetchSessionHostChain(hostQueryClient, sessionId, options),
    );
    void resolveIdentity();
    return null;
  });

  // Register the theme wrapper as the Radix portal container so overlays land
  // inside the themed subtree (and clear it on unmount). It's the inner div —
  // not the `.omnigent-app` scope root — so portaled overlays inherit the
  // `.dark` token overrides too.
  const scopeRef = useCallback((el: HTMLDivElement | null) => {
    setEmbedRoot(el);
  }, []);

  // The outer `.omnigent-app` scope root is where the scoped `:root` tokens
  // live, so per-device preferences (UI font, color palette, custom theme) must
  // be applied here — standalone main.tsx applies them to <html> at boot; the
  // embed applies them once the scope root mounts. The inner `scopeRef` runs
  // first (child refs fire before parent refs), so `getEmbedRoot()` is already
  // set for the palette's dark-mode attribute stamping.
  const scopeRootRef = useCallback((el: HTMLDivElement | null) => {
    setEmbedScopeRoot(el);
    if (el) {
      applyMobileAppTargetAttribute();
      applyStoredUiFontSize();
      applyUiFontFamily(readUiFontFamily());
      applyThemePalette(readThemePalette());
      applyCustomTheme(readCustomTheme());
      themeService.applyCached();
    }
  }, []);

  return (
    // Two nested wrappers on purpose:
    //   - `.omnigent-app` (outer) is the scope anchor. The scoped stylesheet
    //     rewrites `:root` → `.omnigent-app` (light tokens) and `.dark` →
    //     `.omnigent-app .dark`, so the dark class must be a DESCENDANT of the
    //     scope root, not the root itself.
    //   - the inner div carries the selected `dark` class (when dark) and is
    //     the Radix portal root, so both the app and its overlays read the dark
    //     token overrides. Light mode = no `dark` class → inherits the scope
    //     root's light tokens. It re-applies `text-foreground` because the scope
    //     root resolves `color` from the light tokens, and overlays without
    //     their own text color would inherit that value.
    <div
      ref={scopeRootRef}
      className="omnigent-app"
      data-electron-mac={isMacElectronShell() ? "true" : undefined}
      data-desktop-app={keepsDesktopLayout() ? "true" : undefined}
      style={{ height: "100%", width: "100%" }}
    >
      <div
        ref={scopeRef}
        tabIndex={isNativeShell() ? undefined : -1}
        className={cn(isDarkMode && "dark", "text-foreground")}
        style={{ height: "100%", width: "100%", colorScheme: isDarkMode ? "dark" : "light" }}
      >
        <TooltipProvider>
          <ImageLightboxProvider>
            <RoutingProvider value={routing}>
              <EmbedCapabilitiesProvider>
                <IdentityAwareSidebarDataProvider
                  config={{ ...appConfig.sidebar, ...sidebarOverrides }}
                >
                  <SessionUpdatesProvider>
                    <RunnerHealthProvider>
                      <QueueFlushProvider>
                        <App basename={basename} />
                      </QueueFlushProvider>
                    </RunnerHealthProvider>
                  </SessionUpdatesProvider>
                </IdentityAwareSidebarDataProvider>
              </EmbedCapabilitiesProvider>
            </RoutingProvider>
          </ImageLightboxProvider>
        </TooltipProvider>
      </div>
    </div>
  );
}

/** Text of a plain-data prop, to compare renders by value; a prop that isn't JSON is invalid. */
function plainDataKey(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "invalid";
  }
}

/**
 * The product theme from the props, with the build's file: recorded on the first render
 * and applied once the scope root has mounted (before the first paint), so nothing lands
 * on the host page's root; kept in step with the props, cleared on unmount.
 */
function useEmbedProductTheme(product: ProductConfig | undefined) {
  const key = plainDataKey(product?.theme);
  const latest = useRef(product);
  latest.current = product;
  useState(() => {
    applyBuildProductTheme({ apply: false });
    setProductTheme("embed", parseProductTheme(product?.theme, "embed"), { apply: false });
    return null;
  });
  // A layout effect runs after the scope root's ref (a descendant's) in the same commit.
  useLayoutEffect(() => {
    setProductTheme("embed", parseProductTheme(latest.current?.theme, "embed"));
    return () => setProductTheme("embed", undefined);
  }, [key]);
}

/**
 * The Omnigent app for the SAME-ROOT path: a plain component the host renders
 * directly inside its OWN React tree + router. Renders NO `<Router>` (that
 * would throw "Router inside a Router").
 *
 * Routing under `basename` is handled on BOTH sides:
 *   - route MATCHING: `App` declares absolute paths (`${basename}/c/:id`) so it
 *     matches the full host pathname directly — no reliance on the host's
 *     route-match context (whose react-router instance may differ from ours).
 *   - NAVIGATION/links: `navigate()`/`<Link to>` absolute targets are rebased
 *     under `basename` via `basenamedRouting` (the routing IoC).
 */
export function OmnigentApp({
  sidebarConfig,
  basename,
  routing,
  isDarkMode,
  product,
  ...hostConfig
}: OmnigentAppProps = {}) {
  // Install transport config ONCE per mount (not on every render). Setting it in
  // the render body re-ran on every (re)render, and concurrent/Suspense renders
  // could re-invoke with empty props — clobbering the good config with `{}`.
  // The host also sets this eagerly at load (see `loadOmnigentApp`); this is a
  // belt-and-suspenders that captures the first non-empty props.
  useState(() => {
    setOmnigentHostConfig(hostConfig);
    return null;
  });
  // The built-in extensions (the Changes, Files, Pull Requests, Tasks, Agents and
  // Content search tabs) run in the window's extension host, as standalone. It is
  // shared by every OmnigentApp on the page. Dev-path extensions stay standalone only.
  useWindowExtensionHost();
  useEmbedProductTheme(product);

  const routingApi = useMemo<RoutingApi>(() => {
    // Host overrides compose UNDER the basename wrapper: merge the host's
    // primitives over the react-router defaults FIRST, then wrap the result in
    // `basenamedRouting` so navigate()/<Link> rebasing still applies to the
    // host's implementations. (Merging AFTER `basenamedRouting` — `{ ...base,
    // ...routing }` — would clobber its rebased navigate/Link with the host's
    // un-rebased ones, so absolute targets would land at the host root instead
    // of under the mount path.)
    const merged: RoutingApi = { ...reactRouterRouting, ...routing };
    return basename ? basenamedRouting(basename, merged) : merged;
  }, [basename, routing]);

  // The embed owns its QueryClient (bundled react-query); `OmnigentProviders`
  // reads it back via `useQueryClient()` under this provider.
  return (
    <QueryClientProvider client={queryClient}>
      <ExtensionProvider>
        <EmbeddedProvider isDarkMode={isDarkMode}>
          <ThemeProvider embedded>
            <OmnigentProviders
              routing={routingApi}
              basename={basename}
              sidebarConfig={sidebarConfig}
            />
          </ThemeProvider>
        </EmbeddedProvider>
      </ExtensionProvider>
    </QueryClientProvider>
  );
}
