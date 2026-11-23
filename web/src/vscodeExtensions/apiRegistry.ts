// Per-extension API instances, looked up by the `omnigent` module the dev plugin
// generates for each extension (see vite.omnigentExtensions.ts).
import type { OmnigentApi } from "./api";

const apis = new Map<string, OmnigentApi>();

export function registerExtensionApi(extensionId: string, api: OmnigentApi): () => void {
  apis.set(extensionId, api);
  return () => {
    if (apis.get(extensionId) === api) apis.delete(extensionId);
  };
}

export function getExtensionApi(extensionId: string): OmnigentApi {
  const api = apis.get(extensionId);
  if (api === undefined) {
    throw new Error(`[omnigent-extensions] no API registered for extension ${extensionId}`);
  }
  return api;
}
