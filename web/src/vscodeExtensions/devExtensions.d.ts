// The extension list the dev plugin (vite.omnigentExtensions.ts) serves.
declare module "virtual:omnigent-dev-extensions" {
  import type { ExtensionDescription } from "@/vscodeExtensions/host";

  /** Valid extensions from OMNIGENT_WEB_EXTENSION_DEV_PATHS; empty in builds. */
  export const devExtensions: readonly ExtensionDescription[];
  /** Manifest problems, one message per skipped extension. */
  export const devExtensionErrors: readonly string[];
}
