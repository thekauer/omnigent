// This extension's `omnigent` API: the same typed surface a dev extension gets
// from `import * as omnigent from "omnigent"`.
import { bindExtensionApi } from "@/vscodeExtensions/builtinApi";
import manifest from "./package.json";

export const omnigent = bindExtensionApi(`${manifest.publisher}.${manifest.name}`);
