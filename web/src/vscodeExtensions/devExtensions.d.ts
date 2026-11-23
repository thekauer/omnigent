// The extension list the dev plugin (vite.omnigentExtensions.ts) serves.
declare module "virtual:omnigent-dev-extensions" {
  import type { ExtensionDescription } from "@/vscodeExtensions/host";
  import type { CommandEndpoint } from "@/vscodeExtensions/nodeCommands";

  /** Valid extensions from OMNIGENT_WEB_EXTENSION_DEV_PATHS; empty in builds. */
  export const devExtensions: readonly ExtensionDescription[];
  /** Manifest problems, one message per skipped extension. */
  export const devExtensionErrors: readonly string[];
  /** Where the page runs Node-side commands; `null` in builds. */
  export const devCommandEndpoint: CommandEndpoint | null;
}
