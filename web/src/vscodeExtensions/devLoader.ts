// Boots the in-page extension host for the dev-path extensions, if any.
import { devExtensionErrors, devExtensions } from "virtual:omnigent-dev-extensions";
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
  const [{ ExtensionHost }, { sessionHeaderItems }, { SessionsService, chatStoreSessionSource }] =
    await Promise.all([
      import("./host"),
      import("./sessionHeaderItems"),
      import("./sessionsService"),
    ]);
  const extensionHost = new ExtensionHost({
    services: {
      headerItems: sessionHeaderItems,
      sessions: new SessionsService(chatStoreSessionSource()),
    },
  });
  await extensionHost.start(devExtensions);
  return extensionHost;
}
