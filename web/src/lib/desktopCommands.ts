// Native menu commands from the desktop shell: File → Close (⌘W), New Terminal
// (⌃`), New Browser Tab (⌘T), and Session → Pin (⌥⌘P) / Archive (⇧⌘A). The
// shell's menu owns those accelerators so they also fire while an embedded
// browser view has focus, which the page's own key listeners never see. The
// shell enables each menu item only while some mounted surface handles it here;
// see web/electron/src/desktopCommands.js for the shell side.

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import { isFocusInDialogOrMenu } from "@/lib/hotkeys";
import {
  type DesktopCommand,
  type DesktopCommandEvent,
  onDesktopCommand,
  setDesktopCommandState,
  supportsDesktopCommands,
} from "@/lib/nativeBridge";
import {
  activeWorkbenchScope,
  subscribeActiveWorkbenchScope,
  type WorkbenchScope,
  useWorkbenchScope,
} from "@/workbench/workbenchScope";

export type { DesktopCommand, DesktopCommandEvent };

/** Return false to pass the command to the next (lower-priority) handler. */
export type DesktopCommandHandler = (event: DesktopCommandEvent) => boolean | void;

interface Registration {
  command: DesktopCommand;
  /** The mount whose surface registered it: the menu's commands are the active mount's. */
  scope: WorkbenchScope;
  priority: number;
  /** Pinned / archived state of the open session, for the menu's labels. */
  active: boolean | undefined;
  handle: DesktopCommandHandler;
}

const registrations = new Set<Registration>();
let unsubscribeBridge: (() => void) | null = null;
let reportQueued = false;
let lastReported: string | null = null;
// The commands some mounted surface handles, for hints that advertise their chords.
let availableCommands: ReadonlySet<DesktopCommand> = new Set();
const availabilityListeners = new Set<() => void>();

// Reload still works behind a dialog or menu, as the native menu's Reload did, and Quit
// still asks, so ⌘Q never goes dead.
const COMMANDS_THROUGH_DIALOGS: ReadonlySet<DesktopCommand> = new Set(["reload", "quit"]);

/** The registrations of the active mount, highest priority first. */
function activeRegistrations(): Registration[] {
  const active = activeWorkbenchScope();
  return [...registrations]
    .filter((registration) => registration.scope === active)
    .sort((a, b) => b.priority - a.priority);
}

function dispatch(event: DesktopCommandEvent): void {
  // A modal dialog or open menu owns the keyboard, like a sheet in a native app.
  if (isFocusInDialogOrMenu() && !COMMANDS_THROUGH_DIALOGS.has(event.command)) return;
  // The active mount's handlers first; another mount's only when the active one registered none.
  const forCommand = (candidate: Registration[]) =>
    candidate.filter((registration) => registration.command === event.command);
  const own = forCommand(activeRegistrations());
  const candidates = own.length > 0 ? own : forCommand(sortedRegistrations());
  for (const registration of candidates) {
    if (registration.handle(event) !== false) return;
  }
}

function sortedRegistrations(): Registration[] {
  return [...registrations].sort((a, b) => b.priority - a.priority);
}

function isActive(command: DesktopCommand): boolean {
  return activeRegistrations().some(
    (registration) => registration.command === command && registration.active === true,
  );
}

function reportState(): void {
  reportQueued = false;
  // The menu reflects the active mount: its commands are the ones offered here.
  const commands = [...new Set(activeRegistrations().map((registration) => registration.command))];
  const state = {
    commands: commands.sort(),
    sessionPinned: isActive("toggle-pin-session"),
    sessionArchived: isActive("archive-session"),
  };
  const serialized = JSON.stringify(state);
  if (serialized === lastReported) return;
  lastReported = serialized;
  setDesktopCommandState(state);
  if (commands.join() !== [...availableCommands].join()) {
    availableCommands = new Set(commands);
    availabilityListeners.forEach((listener) => listener());
  }
}

function subscribeAvailability(listener: () => void): () => void {
  availabilityListeners.add(listener);
  return () => availabilityListeners.delete(listener);
}

/** The native menu commands some mounted surface handles now (empty off the desktop app). */
export function useAvailableDesktopCommands(): ReadonlySet<DesktopCommand> {
  return useSyncExternalStore(
    subscribeAvailability,
    () => availableCommands,
    () => availableCommands,
  );
}

// Coalesce the unregister/register pairs a re-render produces into one report.
function queueReport(): void {
  if (reportQueued) return;
  reportQueued = true;
  queueMicrotask(reportState);
}

function register(registration: Registration): () => void {
  registrations.add(registration);
  unsubscribeBridge ??= onDesktopCommand(dispatch);
  queueReport();
  return () => {
    registrations.delete(registration);
    queueReport();
  };
}

// The menu follows the active mount, so it is reported again when another takes over.
subscribeActiveWorkbenchScope(queueReport);

/**
 * Handle a native menu command while mounted. A null handler unregisters it,
 * which disables the shell's menu item. Handlers run highest `priority` first;
 * `active` reports the open session's pinned/archived state for the menu label.
 */
export function useDesktopCommand(
  command: DesktopCommand,
  handler: DesktopCommandHandler | null,
  { priority = 0, active }: { priority?: number; active?: boolean } = {},
): void {
  const scope = useWorkbenchScope();
  // Held in a ref so a fresh closure each render doesn't re-register. Published once the
  // render commits: a render that suspends must not hand its handler to the menu.
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  const enabled = handler !== null && supportsDesktopCommands();

  useEffect(() => {
    if (!enabled) return;
    return register({
      command,
      scope,
      priority,
      active,
      handle: (event) => (latest.current ? latest.current(event) : false),
    });
  }, [enabled, command, priority, active, scope]);
}

/** Forget registrations, the bridge subscription, and the last report. */
export function resetDesktopCommandsForTests(): void {
  registrations.clear();
  unsubscribeBridge?.();
  unsubscribeBridge = null;
  reportQueued = false;
  lastReported = null;
  availableCommands = new Set();
  availabilityListeners.forEach((listener) => listener());
}
