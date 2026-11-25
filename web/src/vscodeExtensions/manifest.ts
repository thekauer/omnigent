// The pure checks of an extension's package.json manifest, shared by the dev
// plugin (vite.omnigentExtensions.ts) and the built-in extension registry. No
// file system access: entry files are checked by the caller.

export const KNOWN_ACTIVATION_EVENTS: ReadonlySet<string> = new Set(["*", "onStartupFinished"]);

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const PUBLISHER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const RANGE_COMPARATOR_PATTERN = /^(?:\^|~|>=|<=|>|<|=)?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/;

export function isValidEngineRange(range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === "*") return true;
  const comparators = trimmed.split(/\s+/);
  return comparators.length > 0 && comparators.every((c) => RANGE_COMPARATOR_PATTERN.test(c));
}

/** The manifest fields the host uses, once they passed the checks. */
export interface ValidManifest {
  /** `publisher.name`. */
  readonly id: string;
  /** A non-blank `displayName`, trimmed (at most 80 characters). */
  readonly displayName: string | undefined;
  readonly publisher: string;
  readonly name: string;
  readonly version: string;
  readonly engines: { readonly omnigent: string };
  readonly activationEvents: readonly string[];
  /** As written; the caller resolves and checks the file. */
  readonly browser: string | undefined;
  readonly main: string | undefined;
  readonly contributes: Record<string, unknown> | undefined;
}

export interface ManifestValidation {
  /** Set when there were no problems. */
  readonly manifest: ValidManifest | undefined;
  /** Every problem found; the manifest is unusable when there is one. */
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
}

const ENTRY_EXAMPLES = { browser: "./src/extension.js", main: "./src/node/extension.js" } as const;

function entryOf(
  field: "browser" | "main",
  value: unknown,
  required: boolean,
  problems: string[],
): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(
      required
        ? `"${field}" must name the ${field} entry file, for example "${ENTRY_EXAMPLES[field]}"`
        : `"${field}" must be a file path such as "${ENTRY_EXAMPLES[field]}" when present`,
    );
    return undefined;
  }
  return value;
}

/**
 * Checks a parsed package.json. `where` prefixes the warnings (a folder or an
 * extension id); problems are returned bare so the caller can join them.
 */
export function validateManifest(raw: unknown, where: string): ManifestValidation {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      manifest: undefined,
      problems: ["package.json must contain a JSON object"],
      warnings,
    };
  }
  const manifest = raw as Record<string, unknown>;
  const { name, publisher, version, engines, activationEvents, contributes } = manifest;
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    problems.push('"name" must be a lowercase string without spaces');
  }
  if (typeof publisher !== "string" || !PUBLISHER_PATTERN.test(publisher)) {
    problems.push('"publisher" must be a string of letters, digits and dashes');
  }
  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    problems.push('"version" must be a semver version such as 0.1.0');
  }
  const engineRange =
    typeof engines === "object" && engines !== null
      ? (engines as Record<string, unknown>).omnigent
      : undefined;
  if (engineRange === undefined) {
    problems.push('"engines.omnigent" is required (for example "^0.24.0")');
  } else if (typeof engineRange !== "string" || !isValidEngineRange(engineRange)) {
    problems.push(`"engines.omnigent" must be a semver range, got ${JSON.stringify(engineRange)}`);
  }
  const browser = entryOf("browser", manifest.browser, true, problems);
  const main = entryOf("main", manifest.main, false, problems);

  let events: string[] = [];
  if (activationEvents === undefined) {
    warnings.push(`${where}: no "activationEvents"; the extension will not be activated`);
  } else if (
    !Array.isArray(activationEvents) ||
    !activationEvents.every((event) => typeof event === "string")
  ) {
    problems.push('"activationEvents" must be an array of strings');
  } else {
    events = activationEvents;
    for (const event of events) {
      if (!KNOWN_ACTIVATION_EVENTS.has(event)) {
        warnings.push(`${where}: activation event "${event}" is not supported yet`);
      }
    }
  }

  const contributesObject =
    typeof contributes === "object" && contributes !== null && !Array.isArray(contributes);
  if (contributes !== undefined && !contributesObject) {
    problems.push('"contributes" must be an object');
  }

  if (problems.length > 0) return { manifest: undefined, problems, warnings };
  return {
    manifest: {
      id: `${publisher as string}.${name as string}`,
      displayName:
        typeof manifest.displayName === "string" && manifest.displayName.trim() !== ""
          ? manifest.displayName.trim().slice(0, 80)
          : undefined,
      publisher: publisher as string,
      name: name as string,
      version: version as string,
      engines: { omnigent: engineRange as string },
      activationEvents: events,
      browser,
      main,
      contributes: contributesObject ? (contributes as Record<string, unknown>) : undefined,
    },
    problems,
    warnings,
  };
}
