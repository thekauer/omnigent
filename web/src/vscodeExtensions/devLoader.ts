// Boots the in-page extension host for the dev-path extensions, if any.
import {
  devCommandEndpoint,
  devExtensionErrors,
  devExtensions,
} from "virtual:omnigent-dev-extensions";
import type { ExtensionHost } from "./host";

let host: Promise<ExtensionHost | null> | undefined;

/** Starts the host once; a no-op (no host code loaded) when no extension is configured. */
export function startDevExtensions(): Promise<ExtensionHost | null> {
  host ??= boot();
  return host;
}

async function boot(): Promise<ExtensionHost | null> {
  for (const error of devExtensionErrors) console.error(`[omnigent-extensions] ${error}`);
  if (devExtensions.length === 0) return null;
  const [
    { ExtensionHost },
    { sessionHeaderItems },
    { SessionsService, chatStoreSessionSource },
    { CommandRegistry },
    { createNodeCommandRoute },
    { toastNotifications },
    { hostReconnectProviders },
    { refreshRunnerHealth },
  ] = await Promise.all([
    import("./host"),
    import("./sessionHeaderItems"),
    import("./sessionsService"),
    import("./commands"),
    import("./nodeCommands"),
    import("./progress"),
    import("@/lib/hostReconnectProviders"),
    import("@/hooks/useRunnerHealth"),
  ]);
  const extensionHost = new ExtensionHost({
    services: {
      headerItems: sessionHeaderItems,
      sessions: new SessionsService(chatStoreSessionSource()),
      commands: new CommandRegistry(
        devCommandEndpoint
          ? createNodeCommandRoute(devCommandEndpoint, (input, init) => window.fetch(input, init))
          : undefined,
      ),
      notifications: toastNotifications,
      hostReconnect: { registry: hostReconnectProviders, onReconnected: refreshRunnerHealth },
    },
  });
  await extensionHost.start(devExtensions);
  return extensionHost;
}
