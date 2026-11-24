// Per-session UI state for the right "Workspace" rail, keyed by conversationId
// so each session restores its own layout: whether the rail is open, its width,
// the selected rail tab, the set of open file tabs, and the set of open shell
// tabs (plus which one is active). A brand-new session (no stored `open`)
// follows the Appearance Workspace panel default; width and tabs start empty.
// Shell tabs restore to whichever terminals still exist — the AppShell prune
// effect drops keys whose PTY has gone away once the terminal list loads.

import { isRailTab, type RightRailTab } from "@/shell/railTabs";
import { parseTerminalSplitState, type TerminalSplitState } from "./terminalSplitLayout";
import type { DefaultWorkspaceTab } from "./workspaceTabPreferences";

const WORKSPACE_PANEL_TABS: readonly DefaultWorkspaceTab[] = [
  "files",
  "changes",
  "github",
  "tasks",
  "subagents",
];

export interface SessionWorkspaceState {
  /** Whether the rail was left open in this session. */
  open?: boolean;
  /** User-chosen rail width (px) for this session. */
  widthPx?: number;
  /** Selected Workspace page, or null when no pinned or opened page is available. */
  rightRailTab?: RightRailTab | null;
  /** Unpinned built-in pages explicitly opened from the Workspace menu. */
  openPanels?: DefaultWorkspaceTab[];
  /** Ordered list of open file tabs. */
  openFiles?: string[];
  /** The active file tab (null = a scope view is active). */
  selectedFilePath?: string | null;
  /** Ordered list of open shell tabs (``terminalTabKey`` values). */
  openTerminals?: string[];
  /** The active shell tab (null = a file/scope view is active). */
  selectedTerminalKey?: string | null;
  openBrowsers?: string[];
  selectedBrowserId?: string | null;
  /** Ordered list of open side-chat tabs (child conversation ids). */
  openSideChats?: string[];
  /** Side chats closed on this device; discovery must not reopen them. */
  closedSideChats?: string[];
  /** Open sub-agent tabs (`subagentTabId` values) in open order, shown after the side chats. */
  openSubagentTabs?: string[];
  /** The active side-chat tab (null = a file/scope/other view is active). */
  selectedSideChatId?: string | null;
  /** Split panes of the main terminal view; absent while unsplit. */
  terminalSplit?: TerminalSplitState;
  /** Each extension's `workspaceState` memento for this session: key to JSON value. */
  extensionState?: Record<string, Record<string, unknown>>;
}

export const SESSION_WORKSPACE_STATE_KEY = "omnigent:session-workspace-state";
// Cap stored sessions so the store can't grow without bound. The
// least-recently-touched entries (front of the array) are pruned first once the
// cap is exceeded.
const MAX_SESSIONS = 100;
// Cap the open-file tabs persisted per session so one session that churns
// through many files can't bloat the store. Tabs are appended in open order, so
// the most-recent (tail) entries are kept.
export const MAX_OPEN_TABS = 20;
// Bounds of the extension mementos kept per session.
export const MAX_EXTENSION_STATE_EXTENSIONS = 20;
export const MAX_EXTENSION_STATE_KEYS = 50;
export const MAX_EXTENSION_STATE_KEY_LENGTH = 128;
/** Bytes of one extension's memento in one session, as JSON. */
export const MAX_EXTENSION_STATE_BYTES = 8 * 1024;
/**
 * Bytes of every session's extension mementos together, as JSON: well under a
 * browser's ~5 MiB storage quota, which the whole store shares one key of.
 */
export const MAX_TOTAL_EXTENSION_STATE_BYTES = 256 * 1024;
const EXTENSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*\.[a-z0-9][a-z0-9._-]*$/;

function isValidWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * One persisted session entry. The store is an ordered array (not a keyed
 * object) so recency ordering survives serialization regardless of the id
 * format: a plain `Record` reorders integer-like keys (e.g. numeric
 * conversation ids) into ascending numeric order, which would break both the
 * "touch = move to end" refresh and the oldest-first pruning.
 */
interface StoredEntry {
  id: string;
  state: SessionWorkspaceState;
}

type Store = StoredEntry[];

/** Why one extension's memento does not fit the caps, or null when it does. */
export function extensionStateProblem(bucket: Record<string, unknown>): string | null {
  const keys = Object.keys(bucket);
  if (keys.length > MAX_EXTENSION_STATE_KEYS) {
    return `at most ${MAX_EXTENSION_STATE_KEYS} keys per chat session`;
  }
  if (keys.some((key) => key === "" || key.length > MAX_EXTENSION_STATE_KEY_LENGTH)) {
    return `keys must be 1 to ${MAX_EXTENSION_STATE_KEY_LENGTH} characters`;
  }
  let json: string;
  try {
    json = JSON.stringify(bucket);
  } catch {
    return "values must be JSON";
  }
  if (new TextEncoder().encode(json).length > MAX_EXTENSION_STATE_BYTES) {
    return `at most ${MAX_EXTENSION_STATE_BYTES} bytes of JSON per chat session`;
  }
  return null;
}

function sanitizeExtensionState(
  value: unknown,
): Record<string, Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const result: Record<string, Record<string, unknown>> = {};
  let count = 0;
  for (const [extensionId, bucket] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_EXTENSION_STATE_EXTENSIONS) break;
    if (!EXTENSION_ID_PATTERN.test(extensionId)) continue;
    if (typeof bucket !== "object" || bucket === null || Array.isArray(bucket)) continue;
    const record = bucket as Record<string, unknown>;
    if (extensionStateProblem(record) !== null) continue;
    result[extensionId] = record;
    count += 1;
  }
  return count > 0 ? result : undefined;
}

/** The non-empty strings in `values`, first occurrence kept. */
function uniqueIds(values: unknown[]): string[] {
  return [
    ...new Set(
      values.filter((value): value is string => typeof value === "string" && value !== ""),
    ),
  ];
}

function sanitize(entry: unknown): SessionWorkspaceState {
  if (typeof entry !== "object" || entry === null) return {};
  const record = entry as Record<string, unknown>;
  const state: SessionWorkspaceState = {};
  if (typeof record.open === "boolean") state.open = record.open;
  if (isValidWidth(record.widthPx)) state.widthPx = record.widthPx;
  if (record.rightRailTab === null || isRailTab(record.rightRailTab)) {
    state.rightRailTab = record.rightRailTab;
  }
  if (Array.isArray(record.openPanels)) {
    state.openPanels = [
      ...new Set(
        record.openPanels.filter((value): value is DefaultWorkspaceTab =>
          WORKSPACE_PANEL_TABS.some((tab) => tab === value),
        ),
      ),
    ];
  }
  if (Array.isArray(record.openFiles) && record.openFiles.every((p) => typeof p === "string")) {
    state.openFiles = record.openFiles as string[];
  }
  if (record.selectedFilePath === null || typeof record.selectedFilePath === "string") {
    state.selectedFilePath = record.selectedFilePath;
  }
  if (
    Array.isArray(record.openTerminals) &&
    record.openTerminals.every((k) => typeof k === "string")
  ) {
    state.openTerminals = record.openTerminals as string[];
  }
  if (record.selectedTerminalKey === null || typeof record.selectedTerminalKey === "string") {
    state.selectedTerminalKey = record.selectedTerminalKey;
  }
  if (Array.isArray(record.openBrowsers)) state.openBrowsers = uniqueIds(record.openBrowsers);
  if (record.selectedBrowserId === null || typeof record.selectedBrowserId === "string") {
    state.selectedBrowserId = record.selectedBrowserId;
  }
  if (Array.isArray(record.openSideChats)) state.openSideChats = uniqueIds(record.openSideChats);
  if (Array.isArray(record.closedSideChats))
    state.closedSideChats = uniqueIds(record.closedSideChats);
  if (Array.isArray(record.openSubagentTabs))
    state.openSubagentTabs = uniqueIds(record.openSubagentTabs);
  if (record.selectedSideChatId === null || typeof record.selectedSideChatId === "string") {
    state.selectedSideChatId = record.selectedSideChatId;
  }
  const terminalSplit = parseTerminalSplitState(record.terminalSplit);
  if (terminalSplit) state.terminalSplit = terminalSplit;
  const extensionState = sanitizeExtensionState(record.extensionState);
  if (extensionState) state.extensionState = extensionState;
  return state;
}

// The last parse, keyed by the raw text: a write here, another tab's write (the
// `storage` event case) or a cleared store all change the text, so the cache
// cannot go stale, while repeated reads (mementos, every render) skip the parse.
let cachedRaw: string | null = null;
let cachedStore: Store = [];

function copyStore(store: Store): Store {
  return store.map(({ id, state }) => ({ id, state: { ...state } }));
}

function readStore(): Store {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SESSION_WORKSPACE_STATE_KEY);
    if (!raw) return [];
    if (raw === cachedRaw) return copyStore(cachedStore);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const store: Store = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      if (typeof record.id !== "string") continue;
      store.push({ id: record.id, state: sanitize(record.state) });
    }
    cachedRaw = raw;
    cachedStore = copyStore(store);
    return store;
  } catch {
    return [];
  }
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
}

/** Drops the extension mementos of the oldest session that has any; false when none has. */
function evictOldestExtensionState(store: Store, keepId?: string): boolean {
  const oldest = store.find((entry) => entry.state.extensionState && entry.id !== keepId);
  if (!oldest) return false;
  oldest.state = { ...oldest.state };
  delete oldest.state.extensionState;
  return true;
}

/** Keeps all sessions' mementos within MAX_TOTAL_EXTENSION_STATE_BYTES, oldest dropped first. */
function capExtensionState(store: Store, keepId?: string): void {
  const total = () =>
    store.reduce(
      (sum, entry) =>
        sum + (entry.state.extensionState ? jsonBytes(entry.state.extensionState) : 0),
      0,
    );
  while (total() > MAX_TOTAL_EXTENSION_STATE_BYTES && evictOldestExtensionState(store, keepId)) {
    // Evicted one; check again.
  }
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

/**
 * Persist the store; false when storage refused the write. When the quota is
 * full, the oldest sessions' extension mementos go first (never `keepId`'s), so
 * one full store cannot break every session's state.
 */
function writeStore(store: Store, keepId?: string): boolean {
  if (typeof window === "undefined") return false;
  for (;;) {
    try {
      const raw = JSON.stringify(store);
      window.localStorage.setItem(SESSION_WORKSPACE_STATE_KEY, raw);
      cachedRaw = raw;
      cachedStore = copyStore(store);
      return true;
    } catch (error) {
      // Storage quota/access errors must not break panel interactions.
      if (!isQuotaError(error) || !evictOldestExtensionState(store, keepId)) return false;
    }
  }
}

/** Read one session's persisted workspace state (absent/invalid fields omitted). */
export function readSessionWorkspaceState(conversationId: string): SessionWorkspaceState {
  const entry = readStore().find((e) => e.id === conversationId);
  return entry ? entry.state : {};
}

/** Like {@link writeSessionWorkspaceState}, but returns false when storage refused the write. */
export function saveSessionWorkspaceState(
  conversationId: string,
  patch: SessionWorkspaceState,
): boolean {
  const store = readStore();
  const existingIdx = store.findIndex((e) => e.id === conversationId);
  const prev = existingIdx >= 0 ? store[existingIdx].state : {};
  const next = { ...prev, ...patch };
  // Keep only the most-recent open-file tabs (tabs are appended in open order).
  if (next.openFiles && next.openFiles.length > MAX_OPEN_TABS) {
    next.openFiles = next.openFiles.slice(-MAX_OPEN_TABS);
  }
  // Same bound for shell tabs (also appended in open order).
  if (next.openTerminals && next.openTerminals.length > MAX_OPEN_TABS) {
    next.openTerminals = next.openTerminals.slice(-MAX_OPEN_TABS);
  }
  // Same bound for browser tabs. Native view creation enforces its own lower
  // runtime cap; this keeps the persisted rail from growing without bound.
  if (next.openBrowsers && next.openBrowsers.length > MAX_OPEN_TABS) {
    next.openBrowsers = next.openBrowsers.slice(-MAX_OPEN_TABS);
  }
  // Same bound for side-chat tabs (also appended in open order).
  if (next.openSideChats && next.openSideChats.length > MAX_OPEN_TABS) {
    next.openSideChats = next.openSideChats.slice(-MAX_OPEN_TABS);
  }
  if (next.openSubagentTabs && next.openSubagentTabs.length > MAX_OPEN_TABS) {
    next.openSubagentTabs = next.openSubagentTabs.slice(-MAX_OPEN_TABS);
  }
  // Drop any existing entry and re-append so the most-recently-touched session
  // moves to the end; pruning then evicts from the front (oldest-touched).
  if (existingIdx >= 0) store.splice(existingIdx, 1);
  store.push({ id: conversationId, state: next });
  if (store.length > MAX_SESSIONS) {
    store.splice(0, store.length - MAX_SESSIONS);
  }
  if (patch.extensionState !== undefined) capExtensionState(store, conversationId);
  return writeStore(store, conversationId);
}

/** Merge a partial update into one session's persisted workspace state. */
export function writeSessionWorkspaceState(
  conversationId: string,
  patch: SessionWorkspaceState,
): void {
  saveSessionWorkspaceState(conversationId, patch);
}

/** One extension's memento in one session (empty when none was stored). */
export function readExtensionState(
  conversationId: string,
  extensionId: string,
): Readonly<Record<string, unknown>> {
  return readSessionWorkspaceState(conversationId).extensionState?.[extensionId] ?? {};
}

/**
 * Replace one extension's memento in one session; an empty one is removed.
 * Throws a RangeError when it does not fit the caps, an Error when storage refused it.
 */
export function writeExtensionState(
  conversationId: string,
  extensionId: string,
  bucket: Record<string, unknown>,
): void {
  if (!EXTENSION_ID_PATTERN.test(extensionId)) {
    throw new RangeError(`invalid extension id ${extensionId}`);
  }
  const problem = extensionStateProblem(bucket);
  if (problem !== null) throw new RangeError(`workspaceState: ${problem}`);
  const others = Object.fromEntries(
    Object.entries(readSessionWorkspaceState(conversationId).extensionState ?? {}).filter(
      ([id]) => id !== extensionId,
    ),
  );
  if (Object.keys(bucket).length > 0) {
    if (Object.keys(others).length >= MAX_EXTENSION_STATE_EXTENSIONS) {
      throw new RangeError(
        `workspaceState: at most ${MAX_EXTENSION_STATE_EXTENSIONS} extensions per chat session`,
      );
    }
    others[extensionId] = bucket;
  }
  const extensionState = Object.keys(others).length > 0 ? others : undefined;
  if (!saveSessionWorkspaceState(conversationId, { extensionState })) {
    throw new Error("workspaceState: the browser refused to store it");
  }
}

/** Let existing chats follow a changed default while keeping their open tabs and layout. */
export function resetSessionWorkspaceTabSelections(): void {
  const store = readStore();
  for (const { state } of store) {
    delete state.rightRailTab;
    delete state.selectedFilePath;
    delete state.selectedTerminalKey;
    delete state.selectedBrowserId;
    delete state.selectedSideChatId;
  }
  writeStore(store);
}

/** Forget newly unpinned pages without disturbing other tabs or their selection. */
export function unpinSessionWorkspaceTabs(tabs: readonly DefaultWorkspaceTab[]): void {
  if (tabs.length === 0) return;
  const store = readStore();
  for (const { state } of store) {
    if (tabs.some((tab) => tab === state.rightRailTab)) delete state.rightRailTab;
    if (state.openPanels) state.openPanels = state.openPanels.filter((tab) => !tabs.includes(tab));
  }
  writeStore(store);
}
