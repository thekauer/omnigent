// The built-in colour themes, as the extension host registers them at startup, for the
// test files that render the theme picker or Settings > Appearance (they list them
// through the theme service). Import it first thing in such a file:
// `import "@/test/withBuiltInThemes";`. Loading them in every file's setup cost about a
// minute of the suite.
import { registerBuiltInThemes } from "@/builtinExtensions/builtInThemes";
import { themeService } from "@/theme/themeService";

registerBuiltInThemes(themeService);
