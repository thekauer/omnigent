// The `omnigent` API of a built-in extension. Built-ins are bundled with the app,
// so there is no generated `omnigent` module per extension as for dev paths:
// this binds the same typed API to an extension id, looked up at each access
// (the host registers the instance before it activates the extension).
import type * as omnigent from "omnigent";
import { OMNIGENT_API_EXPORT_NAMES } from "./api";
import { getExtensionApi } from "./apiRegistry";

export function bindExtensionApi(extensionId: string): typeof omnigent {
  const binding: Record<string, unknown> = {};
  for (const name of OMNIGENT_API_EXPORT_NAMES) {
    Object.defineProperty(binding, name, {
      enumerable: true,
      get: () => getExtensionApi(extensionId)[name],
    });
  }
  return Object.freeze(binding) as typeof omnigent;
}
