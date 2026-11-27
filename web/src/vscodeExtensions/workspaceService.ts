// Host-side source of `omnigent.workspace`: the workspace on screen (its session,
// changed files, availability and settings) as frozen plain data, from the
// workspace bridge the shell's workspace surfaces publish to.
import type * as omnigent from "omnigent";
import {
  PathUnreachableError,
  RunnerOfflineError,
  type WorkspaceChangedFile,
  type WorkspaceFile,
} from "@/hooks/useWorkspaceChangedFiles";
import { isValidSort } from "@/lib/changedSort";
import { UnexpectedListingError } from "@/lib/unexpectedListingError";
import {
  type ContentSearchResult,
  contentSearchPattern,
  fetchContentSearch,
  fitsContentSearchLimit,
  wholeWordRegexProblem,
} from "@/lib/contentSearch";
import {
  type WorkspaceBridge,
  type WorkspaceBridgeState,
  type WorkspaceFileSettings,
  WorkspaceUnavailableError,
} from "@/shell/workspaceBridge";
import {
  type ConfigurationService,
  configurationService as windowConfiguration,
} from "@/configuration/configurationService";
import { EventEmitter } from "./base";

const MAX_GLOBS_LENGTH = 4096;
/** At most this many matches reach an extension; more set `limitHit`. */
export const MAX_TEXT_SEARCH_RESULTS = 2000;

/** An include or exclude option as sent: absent as empty, otherwise a string within the limit. */
function globsOption(name: "include" | "exclude", value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new TypeError(`findTextInFiles: "${name}" must be a string of comma-separated globs`);
  }
  if (value.length > MAX_GLOBS_LENGTH) {
    throw new TypeError(`findTextInFiles: "${name}" is longer than ${MAX_GLOBS_LENGTH} characters`);
  }
  return value;
}

/** Why a text search cannot be sent, as the Content search tab checked it. */
export function textSearchQueryProblem(
  query: omnigent.TextSearchQuery,
): omnigent.TextSearchQueryProblem | undefined {
  const pattern = String(query?.pattern ?? "");
  const regex = query?.isRegExp === true;
  const wholeWord = query?.isWordMatch === true;
  // Whole word is sent as a regular expression, which can outgrow the server's query limit.
  if (!fitsContentSearchLimit(contentSearchPattern({ query: pattern, regex, wholeWord }).pattern)) {
    return "tooLong";
  }
  // Such an expression could escape the whole-word wrapper and lose its boundaries.
  const problem = wholeWord && regex ? wholeWordRegexProblem(pattern) : null;
  if (problem === "unopened-group") return "unopenedGroup";
  if (problem === "verbose") return "verbose";
  return undefined;
}

function toSearchComplete(result: ContentSearchResult): omnigent.TextSearchComplete {
  const capped = result.matches.length > MAX_TEXT_SEARCH_RESULTS;
  return Object.freeze({
    matches: Object.freeze(
      result.matches.slice(0, MAX_TEXT_SEARCH_RESULTS).map((match) =>
        Object.freeze({
          path: match.path,
          line: match.line,
          column: match.column,
          preview: Object.freeze({
            text: match.text,
            matches: Object.freeze([
              Object.freeze([match.match_start, match.match_end]) as [number, number],
            ]),
          }),
        }),
      ),
    ),
    limitHit: capped || result.truncated === true,
    message: result.warning || undefined,
  });
}

function canceledError(): Error {
  const error = new Error("Canceled");
  error.name = "Canceled";
  return error;
}

/**
 * The settings the workspace on screen sets itself, by full name, with the bridge field each
 * one is (the Files tab's sort and eye toggle). They are registered by the built-in
 * `omnigent.files` extension; every other setting comes from the configuration service.
 */
const SETTINGS: Readonly<
  Record<string, { field: keyof WorkspaceFileSettings; valid: (value: unknown) => boolean }>
> = Object.freeze({
  "omnigent.files.sortOrder": {
    field: "sortOrder",
    valid: (value) => typeof value === "string" && isValidSort(value),
  },
  "omnigent.files.showHidden": {
    field: "showHidden",
    valid: (value) => typeof value === "boolean",
  },
});

export const WORKSPACE_SETTING_NAMES: readonly string[] = Object.freeze(Object.keys(SETTINGS));

function toChangedFile(file: WorkspaceChangedFile): omnigent.ChangedFile {
  return Object.freeze({
    path: file.path,
    name: file.name,
    repositoryRoot: file.repository_root || undefined,
    status: file.status === "created" ? "added" : file.status,
    bytes: file.bytes,
    modifiedAt: file.modified_at,
    linesAdded: file.lines_added,
    linesRemoved: file.lines_removed,
  });
}

const MAX_LOCATION_LENGTH = 4096;
const MAX_PATTERN_LENGTH = 1000;

/** `part` with its percent-escapes decoded, as a server that decodes again would read it. */
function decodedSegment(part: string): string {
  let current = part;
  for (let round = 0; round < 3 && current.includes("%"); round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return current;
    }
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * A folder path as the API takes it: "" (the root), workspace-relative, or
 * absolute. Empty and "." segments of a relative path are dropped, so
 * `"./web/"` is `"web"`. Neither form may hold a ".." segment, an escaped dot
 * segment or separator (`%2e%2e`, `%2f`, `%5c`) or a backslash, and an absolute
 * path may not hold a "." either: the browser resolves dot segments before
 * sending, so any of them could carry a request outside the filesystem routes.
 */
function locationOf(value: unknown, what: string): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > MAX_LOCATION_LENGTH) {
    throw new TypeError(`${what} needs a folder path`);
  }
  if (value.includes("\\")) throw new TypeError(`${what}: a folder path cannot contain "\\"`);
  const absolute = value.startsWith("/");
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "") continue;
    const decoded = decodedSegment(part);
    if (part === ".." || decoded === "..") {
      throw new TypeError(`${what}: a folder path cannot contain ".."`);
    }
    if (decoded !== part && (decoded === "." || /[/\\]/.test(decoded))) {
      throw new TypeError(`${what}: a folder path cannot contain an escaped "." or separator`);
    }
    if (part === ".") {
      if (absolute) throw new TypeError(`${what}: an absolute folder path cannot contain "."`);
      continue;
    }
    parts.push(part);
  }
  return absolute ? `/${parts.join("/")}` : parts.join("/");
}

/** Joins a folder ("" the root) and a path relative to it. */
function joinLocation(location: string, relative: string): string {
  if (!relative) return location;
  if (!location) return relative;
  return location === "/" ? `/${relative}` : `${location}/${relative}`;
}

function toFileEntry(file: WorkspaceFile, location: string): omnigent.FileEntry {
  return Object.freeze({
    path: joinLocation(location, file.path),
    name: file.name,
    type: file.type === "directory" ? "directory" : "file",
    bytes: file.bytes,
    modifiedAt: file.modified_at,
  });
}

const UNEXPECTED_RESPONSE = "the workspace returned an unexpected response";

/** The listing entries a reader returned, or a clean error when it is not a list of entries. */
function entriesOf(value: unknown): readonly WorkspaceFile[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (file: unknown) =>
        typeof file === "object" &&
        file !== null &&
        typeof (file as WorkspaceFile).path === "string" &&
        typeof (file as WorkspaceFile).name === "string",
    )
  ) {
    throw new UnexpectedListingError();
  }
  return value as readonly WorkspaceFile[];
}

function fileSystemError(error: unknown): omnigent.FileSystemError {
  const code: omnigent.FileSystemErrorCode =
    error instanceof WorkspaceUnavailableError
      ? "Unavailable"
      : error instanceof RunnerOfflineError
        ? "RunnerOffline"
        : error instanceof PathUnreachableError
          ? "NoPermissions"
          : "Unknown";
  // A malformed answer is a clean Unknown, not the text of whatever read it wrong.
  const message =
    error instanceof UnexpectedListingError
      ? UNEXPECTED_RESPONSE
      : error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : UNEXPECTED_RESPONSE;
  const result = new Error(message) as Error & {
    code: omnigent.FileSystemErrorCode;
    reachableRoots: readonly string[];
  };
  result.name = "FileSystemError";
  result.code = code;
  result.reachableRoots = Object.freeze(
    error instanceof PathUnreachableError && Array.isArray(error.reachableRoots)
      ? error.reachableRoots.filter((root): root is string => typeof root === "string")
      : [],
  );
  return result;
}

function affects(changed: readonly string[], section: string): boolean {
  return changed.some((name) => name === section || name.startsWith(`${section}.`));
}

export class WorkspaceService {
  private readonly filesEmitter = new EventEmitter<omnigent.ChangedFilesChangeEvent>();
  private readonly configurationEmitter = new EventEmitter<omnigent.ConfigurationChangeEvent>();
  private readonly sessionEmitter = new EventEmitter<string | undefined>();
  private readonly fileSystemEmitter = new EventEmitter<omnigent.FilesChangeEvent>();
  private readonly unsubscribe: () => void;
  private readonly unsubscribeConfiguration: () => void;
  private readonly bridge: WorkspaceBridge;
  private readonly configuration: ConfigurationService;
  private source: WorkspaceBridgeState;
  private snapshot: readonly omnigent.ChangedFile[] | undefined;
  private flushScheduled = false;
  private disposed = false;

  /** Fires when the workspace on screen, its changed files or their availability change. */
  readonly onDidChangeChangedFiles = this.filesEmitter.event;
  /** Fires when a setting of the workspace on screen changes, also on a switch. */
  readonly onDidChangeConfiguration = this.configurationEmitter.event;
  /** Fires with the new {@link activeSessionId} when another workspace comes on screen. */
  readonly onDidChangeActiveSessionId = this.sessionEmitter.event;
  /** Fires when the files of the workspace on screen may have changed on disk. */
  readonly onDidChangeFiles = this.fileSystemEmitter.event;

  constructor(bridge: WorkspaceBridge, configuration: ConfigurationService = windowConfiguration) {
    this.bridge = bridge;
    this.configuration = configuration;
    this.source = bridge.getState();
    this.snapshot = this.copy(this.source);
    this.unsubscribe = bridge.subscribe(() => this.scheduleFlush());
    // The workspace's own settings change through the bridge; the rest here.
    this.unsubscribeConfiguration = configuration.onDidChangeConfiguration((event) => {
      if (this.disposed) return;
      const changed = event.affectedKeys.filter((key) => !Object.hasOwn(SETTINGS, key));
      if (changed.length === 0) return;
      this.configurationEmitter.fire(
        Object.freeze({
          affectsConfiguration: (section: string) => affects(changed, section),
        }),
      );
    });
  }

  private copy(state: WorkspaceBridgeState): readonly omnigent.ChangedFile[] | undefined {
    return state.changedFiles === undefined
      ? undefined
      : Object.freeze(state.changedFiles.map(toChangedFile));
  }

  /** The session whose workspace is on screen, as last delivered to listeners. */
  get activeSessionId(): string | undefined {
    return this.source.sessionId ?? undefined;
  }

  /** The changed files of the workspace on screen; `undefined` while they load or without one. */
  getChangedFiles(): readonly omnigent.ChangedFile[] | undefined {
    return this.source.sessionId === null ? undefined : this.snapshot;
  }

  /** Why the changed files could not be loaded, if they could not. */
  get changedFilesError(): string | undefined {
    return this.source.sessionId === null ? undefined : this.source.error;
  }

  get availability(): omnigent.WorkspaceAvailability {
    return this.source.availability;
  }

  get servedFromHost(): boolean {
    return this.source.servedFromHost;
  }

  /** The workspace root on screen; undefined while unknown or without files. */
  get rootPath(): string | undefined {
    return this.source.sessionId === null ? undefined : (this.source.rootPath ?? undefined);
  }

  /** `workspace.fs.readDirectory`: a folder of the workspace on screen at the call. */
  async readDirectory(path: unknown): Promise<readonly omnigent.FileEntry[]> {
    const location = locationOf(path, "readDirectory");
    if (this.bridge.getState().sessionId === null) throw fileSystemError("no workspace is open");
    try {
      const files = entriesOf(await this.bridge.readDirectory(location));
      return Object.freeze(files.map((file) => toFileEntry(file, location)));
    } catch (error) {
      throw fileSystemError(error);
    }
  }

  /** `workspace.findFiles`: files of the workspace on screen by name, cancellable. */
  async findFiles(
    query: omnigent.FileSearchQuery,
    token?: omnigent.CancellationToken,
  ): Promise<omnigent.FileSearchComplete> {
    if (this.bridge.getState().sessionId === null) throw new Error("no workspace is open");
    const pattern = typeof query?.pattern === "string" ? query.pattern.trim() : "";
    if (pattern === "" || pattern.length > MAX_PATTERN_LENGTH) {
      throw new TypeError("findFiles needs a pattern");
    }
    const globs = (value: unknown) =>
      typeof value === "string" ? value.slice(0, MAX_GLOBS_LENGTH) : "";
    const location = locationOf(query.location, "findFiles");
    if (token?.isCancellationRequested) throw canceledError();
    const controller = new AbortController();
    // A cancelled search settles at once, whether or not its request heeds the abort.
    let cancel: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(canceledError());
    });
    cancelled.catch(() => {});
    const subscription = token?.onCancellationRequested(() => {
      controller.abort();
      cancel?.();
    });
    try {
      const result = await Promise.race([
        this.bridge.findFiles(
          { pattern, include: globs(query.include), exclude: globs(query.exclude), location },
          controller.signal,
        ),
        cancelled,
      ]);
      if (token?.isCancellationRequested) throw canceledError();
      if (typeof result !== "object" || result === null) throw new UnexpectedListingError();
      const files = entriesOf(result.files);
      return Object.freeze({
        files: Object.freeze(files.map((file) => toFileEntry(file, location))),
        limitHit: result.truncated === true,
      });
    } catch (error) {
      if (controller.signal.aborted || token?.isCancellationRequested) throw canceledError();
      if (error instanceof UnexpectedListingError) {
        throw new Error(UNEXPECTED_RESPONSE, { cause: error });
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      subscription?.dispose();
    }
  }

  /** `workspace.findTextInFiles`: the workspace on screen at the call, cancellable. */
  async findTextInFiles(
    query: omnigent.TextSearchQuery,
    options: omnigent.FindTextInFilesOptions | undefined,
    token: omnigent.CancellationToken | undefined,
  ): Promise<omnigent.TextSearchComplete> {
    const sessionId = this.bridge.getState().sessionId;
    if (sessionId === null) throw new Error("no workspace is open");
    if (typeof query?.pattern !== "string" || query.pattern === "") {
      throw new TypeError("findTextInFiles needs a pattern");
    }
    const problem = textSearchQueryProblem(query);
    if (problem !== undefined) throw new Error(`the query cannot be searched (${problem})`);
    const include = globsOption("include", options?.include);
    const exclude = globsOption("exclude", options?.exclude);
    if (token?.isCancellationRequested) throw canceledError();
    const sent = contentSearchPattern({
      query: query.pattern,
      regex: query.isRegExp === true,
      wholeWord: query.isWordMatch === true,
    });
    const controller = new AbortController();
    const subscription = token?.onCancellationRequested(() => controller.abort());
    try {
      const result = await fetchContentSearch(
        sessionId,
        sent.pattern,
        {
          caseSensitive: query.isCaseSensitive === true,
          regex: sent.regex,
          include,
          exclude,
        },
        controller.signal,
      );
      if (token?.isCancellationRequested) throw canceledError();
      return toSearchComplete(result);
    } catch (error) {
      if (controller.signal.aborted || token?.isCancellationRequested) throw canceledError();
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      subscription?.dispose();
    }
  }

  /**
   * Every setting's current value by full name, for the `config.*` context keys: the
   * workspace's own, and each other setting whose value is a string, number or boolean.
   */
  settingValues(): Record<string, string | number | boolean> {
    const values: Record<string, string | number | boolean> = {};
    for (const key of this.configuration.keys()) {
      if (Object.hasOwn(SETTINGS, key)) continue;
      const value = this.configuration.getValue(key);
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        values[key] = value;
      }
    }
    for (const [name, { field }] of Object.entries(SETTINGS)) {
      values[name] = this.source.settings[field];
    }
    return values;
  }

  /**
   * `workspace.getConfiguration`: the registered settings, as VS Code's. The Files tab's
   * settings read and write the workspace on screen (which keeps the sort in the user's
   * settings); every other one reads the configuration service and writes the settings JSON.
   */
  getConfiguration(section = ""): omnigent.WorkspaceConfiguration {
    const fullName = (key: string) => (section ? `${section}.${key}` : key);
    const configuration = this.configuration;
    function get<T>(key: string, defaultValue?: T): T | undefined;
    function get<T>(this: WorkspaceService, key: string, defaultValue?: T): T | undefined {
      const name = fullName(key);
      const setting = Object.hasOwn(SETTINGS, name) ? SETTINGS[name] : undefined;
      if (setting) return this.source.settings[setting.field] as T;
      const value = configuration.getValue<T>(name);
      return value === undefined ? defaultValue : value;
    }
    const inspect = (key: string): omnigent.ConfigurationInspection | undefined => {
      const name = fullName(key);
      if (!configuration.has(name) && !Object.hasOwn(SETTINGS, name)) return undefined;
      const layers = configuration.inspect(name);
      const setting = Object.hasOwn(SETTINGS, name) ? SETTINGS[name] : undefined;
      return Object.freeze({
        key: name,
        defaultValue: layers.defaultValue,
        ...(layers.userValue === undefined ? {} : { globalValue: layers.userValue }),
        ...(setting ? { workspaceValue: this.source.settings[setting.field] } : {}),
      });
    };
    return Object.freeze({
      get: get.bind(this) as omnigent.WorkspaceConfiguration["get"],
      has: (key: string) =>
        Object.hasOwn(SETTINGS, fullName(key)) || configuration.has(fullName(key)),
      inspect,
      update: (key: string, value: unknown): Promise<void> => {
        try {
          const name = fullName(key);
          const setting = Object.hasOwn(SETTINGS, name) ? SETTINGS[name] : undefined;
          if (setting) {
            if (!setting.valid(value)) {
              throw new TypeError(`invalid value for ${name}: ${JSON.stringify(value)}`);
            }
            this.bridge.updateSettings({ [setting.field]: value });
            return Promise.resolve();
          }
          if (!configuration.has(name)) throw new Error(`unknown setting ${JSON.stringify(name)}`);
          configuration.update(name, value);
          return Promise.resolve();
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
  }

  // Coalesced per microtask, like the sessions events: a switch publishes twice.
  private scheduleFlush(): void {
    if (this.flushScheduled || this.disposed) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      if (this.disposed) return;
      const previous = this.source;
      const next = this.bridge.getState();
      if (next === previous) return;
      this.source = next;
      const filesChanged =
        next.sessionId !== previous.sessionId ||
        next.changedFiles !== previous.changedFiles ||
        next.error !== previous.error ||
        next.availability !== previous.availability ||
        next.servedFromHost !== previous.servedFromHost ||
        next.rootPath !== previous.rootPath;
      if (next.changedFiles !== previous.changedFiles) this.snapshot = this.copy(next);
      const sessionChanged = next.sessionId !== previous.sessionId;
      const changedSettings = Object.entries(SETTINGS)
        .filter(([, { field }]) => next.settings[field] !== previous.settings[field])
        .map(([name]) => name);
      if (changedSettings.length > 0) {
        this.configurationEmitter.fire(
          Object.freeze({
            affectsConfiguration: (section: string) => affects(changedSettings, section),
          }),
        );
      }
      if (sessionChanged) this.sessionEmitter.fire(next.sessionId ?? undefined);
      if (!sessionChanged && (next.filesRevision ?? 0) !== (previous.filesRevision ?? 0)) {
        this.fileSystemEmitter.fire(Object.freeze({ sessionId: next.sessionId ?? undefined }));
      }
      if (!filesChanged) return;
      this.filesEmitter.fire(
        Object.freeze({
          sessionId: next.sessionId ?? undefined,
          files: this.getChangedFiles(),
          ...(this.changedFilesError === undefined ? {} : { error: this.changedFilesError }),
          availability: next.availability,
          servedFromHost: next.servedFromHost,
          rootPath: this.rootPath,
        }),
      );
    });
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.unsubscribeConfiguration();
    this.filesEmitter.dispose();
    this.configurationEmitter.dispose();
    this.sessionEmitter.dispose();
    this.fileSystemEmitter.dispose();
  }
}
