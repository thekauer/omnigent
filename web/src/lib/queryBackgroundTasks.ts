// Route the app's react-query refetches that no caller starts through the
// host's background-task seam (`OmnigentHostConfig.runBackgroundTask`). These
// are `refetchInterval` ticks, window-focus refetches and reconnect refetches.
// Each tick or browser event becomes one host task, so the host can attribute
// its requests to that cause rather than to whatever armed the timer. Every
// `onQueryUpdate` re-arms a query's interval, so that would otherwise be the
// most recent action that touched the query. Standalone, the tasks run
// directly.

import { focusManager, onlineManager, timeoutManager } from "@tanstack/react-query";

import { withHostBackgroundTask } from "@/lib/host";

/**
 * Installs the providers on react-query's module singletons. Call once at
 * module scope, before any query is created: react-query warns if the timeout
 * provider changes after timers were armed with the previous one.
 */
export function routeQueryBackgroundWorkThroughHost(): void {
  // Global timers are called through wrappers, as react-query's default
  // provider does, so test doubles installed later still apply. react-query
  // uses intervals only for `refetchInterval`.
  timeoutManager.setTimeoutProvider({
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timeoutId) => clearTimeout(timeoutId),
    setInterval: (callback, delay) => setInterval(withHostBackgroundTask("poll", callback), delay),
    clearInterval: (intervalId) => clearInterval(intervalId),
  });
  // Same browser events as react-query's default listeners.
  focusManager.setEventListener((onFocus) => {
    const onVisibilityChange = withHostBackgroundTask("focus_refresh", () => onFocus());
    window.addEventListener("visibilitychange", onVisibilityChange, false);
    return () => window.removeEventListener("visibilitychange", onVisibilityChange);
  });
  onlineManager.setEventListener((setOnline) => {
    const onOnline = withHostBackgroundTask("reconnect_refresh", () => setOnline(true));
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline, false);
    window.addEventListener("offline", onOffline, false);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  });
}
