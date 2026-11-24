// Host-side source of `omnigent.workspace`: the workspace on screen (its session,
// changed files, availability and settings) as frozen plain data, from the
// workspace bridge the shell's workspace surfaces publish to.
import type * as omnigent from "omnigent";
import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";
import { isValidSort } from "@/lib/changedSort";
import {
  type ContentSearchResult,
  contentSearchPattern,
  fetchContentSearch,
  fitsContentSearchLimit,
  wholeWordRegexProblem,
} from "@/lib/contentSearch";
import type {
  WorkspaceBridge,
  WorkspaceBridgeState,
  WorkspaceFileSettings,
} from "@/shell/workspaceBridge";
import { EventEmitter } from "./base";

const MAX_GLOBS_LENGTH = 4096;

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
  return Object.freeze({
    matches: Object.freeze(
      result.matches.map((match) =>
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
    limitHit: result.truncated === true,
    message: result.warning || undefined,
  });
}

function canceledError(): Error {
  const error = new Error("Canceled");
  error.name = "Canceled";
  return error;
}

/** The workspace settings by full name, with the bridge field each one is. */
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

function affects(changed: readonly string[], section: string): boolean {
  return changed.some((name) => name === section || name.startsWith(`${section}.`));
}

export class WorkspaceService {
  private readonly filesEmitter = new EventEmitter<omnigent.ChangedFilesChangeEvent>();
  private readonly configurationEmitter = new EventEmitter<omnigent.ConfigurationChangeEvent>();
  private readonly unsubscribe: () => void;
  private readonly bridge: WorkspaceBridge;
  private source: WorkspaceBridgeState;
  private snapshot: readonly omnigent.ChangedFile[] | undefined;
  private flushScheduled = false;
  private disposed = false;

  /** Fires when the workspace on screen, its changed files or their availability change. */
  readonly onDidChangeChangedFiles = this.filesEmitter.event;
  /** Fires when a setting of the workspace on screen changes, also on a switch. */
  readonly onDidChangeConfiguration = this.configurationEmitter.event;

  constructor(bridge: WorkspaceBridge) {
    this.bridge = bridge;
    this.source = bridge.getState();
    this.snapshot = this.copy(this.source);
    this.unsubscribe = bridge.subscribe(() => this.scheduleFlush());
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
    if (token?.isCancellationRequested) throw canceledError();
    const sent = contentSearchPattern({
      query: query.pattern,
      regex: query.isRegExp === true,
      wholeWord: query.isWordMatch === true,
    });
    const globs = (value: unknown) =>
      typeof value === "string" ? value.slice(0, MAX_GLOBS_LENGTH) : "";
    const controller = new AbortController();
    const subscription = token?.onCancellationRequested(() => controller.abort());
    try {
      const result = await fetchContentSearch(
        sessionId,
        sent.pattern,
        {
          caseSensitive: query.isCaseSensitive === true,
          regex: sent.regex,
          include: globs(options?.include),
          exclude: globs(options?.exclude),
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

  /** Every setting's current value by full name, for the `config.*` context keys. */
  settingValues(): Record<string, string | boolean> {
    return Object.fromEntries(
      Object.entries(SETTINGS).map(([name, { field }]) => [name, this.source.settings[field]]),
    );
  }

  getConfiguration(section = ""): omnigent.WorkspaceConfiguration {
    const fullName = (key: string) => (section ? `${section}.${key}` : key);
    function get<T>(key: string, defaultValue?: T): T | undefined;
    function get<T>(this: WorkspaceService, key: string, defaultValue?: T): T | undefined {
      const setting = SETTINGS[fullName(key)];
      return setting ? (this.source.settings[setting.field] as T) : defaultValue;
    }
    return Object.freeze({
      get: get.bind(this) as omnigent.WorkspaceConfiguration["get"],
      has: (key: string) => Object.hasOwn(SETTINGS, fullName(key)),
      update: (key: string, value: unknown): Promise<void> => {
        try {
          const name = fullName(key);
          const setting = Object.hasOwn(SETTINGS, name) ? SETTINGS[name] : undefined;
          if (!setting) throw new Error(`unknown setting ${JSON.stringify(name)}`);
          if (!setting.valid(value)) {
            throw new TypeError(`invalid value for ${name}: ${JSON.stringify(value)}`);
          }
          this.bridge.updateSettings({ [setting.field]: value });
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
        next.servedFromHost !== previous.servedFromHost;
      if (next.changedFiles !== previous.changedFiles) this.snapshot = this.copy(next);
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
      if (!filesChanged) return;
      this.filesEmitter.fire(
        Object.freeze({
          sessionId: next.sessionId ?? undefined,
          files: this.getChangedFiles(),
          ...(this.changedFilesError === undefined ? {} : { error: this.changedFilesError }),
          availability: next.availability,
          servedFromHost: next.servedFromHost,
        }),
      );
    });
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.filesEmitter.dispose();
    this.configurationEmitter.dispose();
  }
}
