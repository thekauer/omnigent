// Dev server only: adds the dev-path extensions (OMNIGENT_WEB_EXTENSION_DEV_PATHS)
// to the window's extension host, which already runs the built-ins.
import {
  devCommandEndpoint,
  devExtensionErrors,
  devExtensions,
} from "virtual:omnigent-dev-extensions";
import { startExtensionHost } from "./extensionHost";
import type { ExtensionHost } from "./host";
import { createNodeCommandRoute } from "./nodeCommands";

let host: Promise<ExtensionHost | null> | undefined;

/** Starts the dev extensions once; a no-op when none is configured. */
export function startDevExtensions(): Promise<ExtensionHost | null> {
  host ??= boot();
  return host;
}

async function boot(): Promise<ExtensionHost | null> {
  for (const error of devExtensionErrors) console.error(`[omnigent-extensions] ${error}`);
  if (devExtensions.length === 0) return null;
  const runtime = startExtensionHost();
  if (devCommandEndpoint) {
    runtime.commands.setNodeRoute(
      createNodeCommandRoute(devCommandEndpoint, (input, init) => window.fetch(input, init)),
    );
  }
  console.info(`[omnigent-extensions] loading ${devExtensions.length} dev-path extension(s)`);
  await runtime.host.start(devExtensions);
  return runtime.host;
}
