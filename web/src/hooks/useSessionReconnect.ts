import { QueryClientContext } from "@tanstack/react-query";
import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { fetchHosts } from "@/hooks/useHosts";
import {
  HostOfflineError,
  hostReconnectProviders,
  isThenable,
  RECONNECT_STEP,
  type ReconnectHost,
  type ReconnectOutcome,
  type SelectedReconnectProvider,
} from "@/lib/hostReconnectProviders";
import {
  hostProgress,
  type HostProgressFailure,
  type HostProgressHandle,
} from "@/lib/hostProgress";
import { onRunnerHealthPolled, refreshRunnerHealth } from "@/hooks/useRunnerHealth";
import { isArcaHost, readArcaHostId, writeArcaHostId } from "@/lib/arcaHost";
import {
  connectArcaHost,
  controlHost,
  getHostIdentity,
  isElectronShell,
  supportsArcaConnect,
} from "@/lib/nativeBridge";
import { type PostEventResponse, retrySession } from "@/lib/sessionsApi";
import { isSandboxLaunchStopped, SANDBOX_STAGE_LABELS } from "@/lib/sandboxStatus";
import type { SandboxStatus } from "@/lib/types";
import { useChatStore } from "@/store/chatStore";

/** How many scheduled health polls may report a woken sandbox's host offline before it gives up. */
export const SANDBOX_WAKE_ONLINE_GRACE_POLLS = 3;

/** How long a wake may follow a launch stage that never finishes before Reconnect host returns. */
export const SANDBOX_WAKE_STAGE_LIMIT_MS = 5 * 60_000;

/** How often liveness is re-checked while a reconnected host is awaited. */
export const RECONNECT_ONLINE_POLL_MS = 2_000;

/** How long a provider's reconnected host may take to come online. */
export const RECONNECT_ONLINE_TIMEOUT_MS = 90_000;

export { RECONNECT_STEP };

/** Inline failure texts of Reconnect host. */
export const RECONNECT_FAILED = "Reconnect failed";
export const HOST_DID_NOT_COME_ONLINE = "Host didn't come online";

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === "string" && error ? error : "Something went wrong.";
}

/** A reconnect run by a provider, shown inline at its host until the host is online. */
interface ProviderRun {
  readonly hostId: string;
  readonly handle: HostProgressHandle;
  promise: Promise<void>;
}

// One sandbox wake request per session, shared by everything that wakes it
// (Reconnect host, opening the session, the Files and Changes tabs, the
// terminal's Resume, a shell tab's Resume session): a caller during the request
// joins it and gets its answer.
const sandboxWakeRequests = new Map<string, Promise<PostEventResponse>>();

/** Send `retry_session` to wake *sessionId*'s sandbox, or join the one in flight. */
export function wakeSandboxSession(sessionId: string): Promise<PostEventResponse> {
  const running = sandboxWakeRequests.get(sessionId);
  if (running) return running;
  const request = retrySession(sessionId).finally(() => {
    if (sandboxWakeRequests.get(sessionId) === request) sandboxWakeRequests.delete(sessionId);
  });
  sandboxWakeRequests.set(sessionId, request);
  return request;
}

/** Stop joining `request`, a wake its caller gave up waiting for, so the next wake asks again. */
export function abandonSandboxWake(sessionId: string, request: Promise<PostEventResponse>): void {
  if (sandboxWakeRequests.get(sessionId) === request) sandboxWakeRequests.delete(sessionId);
}

// Sessions whose shown view is waking their sandbox, for other panels to say so.
const startingSandboxes = new Map<string, number>();
const startingListeners = new Set<() => void>();

function subscribeStartingSandboxes(listener: () => void): () => void {
  startingListeners.add(listener);
  return () => startingListeners.delete(listener);
}

function markSandboxStarting(sessionId: string, delta: 1 | -1): void {
  const count = (startingSandboxes.get(sessionId) ?? 0) + delta;
  if (count > 0) startingSandboxes.set(sessionId, count);
  else startingSandboxes.delete(sessionId);
  for (const listener of startingListeners) listener();
}

/**
 * Whether *sessionId*'s sandbox is starting, as its host dot shows: Reconnect
 * host is waking it, or the server reports its launch in progress (a wake from
 * before a session switch, another tab, or a sent message).
 */
export function useSandboxStarting(sessionId: string | null | undefined): boolean {
  const read = useCallback(
    () => (sessionId ? startingSandboxes.has(sessionId) : false),
    [sessionId],
  );
  const waking = useSyncExternalStore(subscribeStartingSandboxes, read);
  const launching = useChatStore((s) =>
    s.conversationId === sessionId && s.sandboxStatus !== null
      ? !isSandboxLaunchStopped(s.sandboxStatus)
      : false,
  );
  return waking || launching;
}

/** Identifies a reported launch stage by value; snapshots rebuild the object. */
function launchKey(launch: SandboxStatus | null): string {
  return launch ? JSON.stringify([launch.stage, launch.error, launch.details]) : "";
}

/**
 * Reconnect this desktop's host directly; use the dialog for fallback and retry.
 * The host reconnect providers are asked first: the built-in one wakes a
 * resumable sandbox host through the server, with its progress shown by the
 * composer's host status dot rather than a toast.
 */
export function useSessionReconnect({
  sessionId,
  hostId,
  hostName,
  hostResumable = false,
  hostSandboxProvider = null,
  hostRecordName,
  hostOnline,
  isOwner,
}: {
  sessionId: string | null;
  hostId: string | null;
  hostName?: string | null;
  hostResumable?: boolean;
  /** The host record's sandbox provider; `null` for a user-connected host or when unknown. */
  hostSandboxProvider?: string | null;
  /** The host record's name, managed hosts included; what reconnect providers match on. */
  hostRecordName?: string | null;
  /** The session's host liveness; a woken sandbox counts as starting until it is `true`. */
  hostOnline?: boolean | null;
  isOwner: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canReconnectThisMachine, setCanReconnectThisMachine] = useState(false);
  const [canReconnectArca, setCanReconnectArca] = useState(false);
  const [sandboxWake, setSandboxWake] = useState<"waking" | "awaiting_online" | null>(null);
  const inFlight = useRef<{ progressToast?: string | number } | null>(null);
  // The provider reconnect shown at the host; a click while it runs joins it.
  const providerRun = useRef<ProviderRun | null>(null);
  // Set after a provider's reconnect succeeded, until its host reads online or the time runs out.
  const [awaitingOnline, setAwaitingOnline] = useState<{
    run: ProviderRun;
    detail: string | null;
    deadline: number;
  } | null>(null);
  const [failureOwner] = useState(() => ({}));
  const queryClient = useContext(QueryClientContext);
  // Set while an async provider answers whether it can reconnect the host.
  const selectingProvider = useRef<object | null>(null);
  // What reconnect providers are told about the host, read on the click.
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  const providerHostDetails = useRef({ hostName, hostRecordName, hostSandboxProvider, hostOnline });
  useEffect(() => {
    providerHostDetails.current = { hostName, hostRecordName, hostSandboxProvider, hostOnline };
  }, [hostName, hostRecordName, hostSandboxProvider, hostOnline]);
  // The open session's launch stage, compared against its value at the wake's click.
  const launch = useChatStore((s) => (s.conversationId === sessionId ? s.sandboxStatus : null));
  const launchInProgress = launch !== null && !isSandboxLaunchStopped(launch);
  const wakeStart = useRef<{ operation: object; launch: string; stageChanged: boolean } | null>(
    null,
  );
  const isSessionArcaHost = useCallback(
    () =>
      hostId !== null && isArcaHost({ host_id: hostId, name: hostName ?? "" }, readArcaHostId()),
    [hostId, hostName],
  );
  const runsArcaConnect = useCallback(
    () => !!hostId && isOwner && supportsArcaConnect() && isSessionArcaHost(),
    [hostId, isOwner, isSessionArcaHost],
  );

  /** Ends the provider reconnect at its host, showing `failure` there when given. */
  const finishProviderRun = useCallback(
    (failure: HostProgressFailure | null, run: ProviderRun | null = providerRun.current) => {
      if (!run || providerRun.current !== run) return;
      providerRun.current = null;
      run.handle.end();
      if (failure) hostProgress.setFailure(run.hostId, failure, failureOwner);
      setAwaitingOnline(null);
    },
    [failureOwner],
  );

  useEffect(() => {
    setDialogOpen(false);
    setError(null);
    setCanReconnectThisMachine(false);
    setCanReconnectArca(false);
    setReconnecting(false);
    setSandboxWake(null);
    selectingProvider.current = null;
    return () => {
      if (inFlight.current?.progressToast !== undefined) {
        toast.dismiss(inFlight.current.progressToast);
      }
      inFlight.current = null;
      // Inline progress and failures belong to the session on screen.
      finishProviderRun(null);
      if (hostId) hostProgress.clearFailure(hostId, failureOwner);
    };
  }, [sessionId, hostId, isOwner, finishProviderRun, failureOwner]);

  const reconnectArca = useCallback(async () => {
    if (inFlight.current) return;
    if (!runsArcaConnect()) {
      setCanReconnectArca(false);
      setDialogOpen(true);
      return;
    }

    const operation: { progressToast?: string | number } = {};
    inFlight.current = operation;
    // A failed attempt opens the dialog, which needs the Arca action for its retry.
    setCanReconnectArca(true);
    setReconnecting(true);
    setError(null);
    try {
      operation.progressToast = toast.loading("Reconnecting Arca…");
      const result = await connectArcaHost();
      if (inFlight.current !== operation) return;
      if (!result.ok) {
        if (!result.canceled && !result.shownInConsole) {
          setError(result.error ?? "Couldn't reconnect Arca. Try again.");
        }
        setDialogOpen(true);
        return;
      }
      if (result.identity) writeArcaHostId(result.identity.hostId);
      // The connect starts whichever Arca the user has now, which may not be this
      // session's host, so only the server's view of this host decides success.
      const hosts = await fetchHosts(false).catch(() => null);
      if (inFlight.current !== operation) return;
      if (hosts === null) {
        setError("Couldn't check whether this session's host is back online. Try again.");
        setDialogOpen(true);
        return;
      }
      if (!hosts.some((host) => host.host_id === hostId && host.status === "online")) {
        setError(
          "This session's host is still offline. If Arca came back as a different host, use Switch host to move the session.",
        );
        setDialogOpen(true);
        return;
      }
      setDialogOpen(false);
      toast.success(result.alreadyRunning ? "Arca is already online." : "Arca is back online.");
    } finally {
      if (inFlight.current === operation) {
        if (operation.progressToast !== undefined) toast.dismiss(operation.progressToast);
        inFlight.current = null;
        setReconnecting(false);
      }
    }
  }, [hostId, runsArcaConnect]);

  const starting = sandboxWake !== null;
  useEffect(() => {
    if (!sessionId || !starting) return;
    markSandboxStarting(sessionId, 1);
    return () => markSandboxStarting(sessionId, -1);
  }, [sessionId, starting]);

  // A failure from an earlier reconnect is stale once the host is online.
  useEffect(() => {
    if (hostId && hostOnline === true) hostProgress.clearFailure(hostId);
  }, [hostId, hostOnline]);

  // Liveness polls lag the wake, so stay "starting" until the host reads online.
  useEffect(() => {
    if (sandboxWake === "awaiting_online" && hostOnline === true) {
      setSandboxWake(null);
      finishProviderRun(null);
    }
  }, [sandboxWake, hostOnline, finishProviderRun]);

  // A provider's reconnect succeeded: the host is up once liveness says so.
  useEffect(() => {
    if (!awaitingOnline) return;
    if (hostOnline === true) {
      finishProviderRun(null, awaitingOnline.run);
      return;
    }
    const timer = setTimeout(
      () =>
        finishProviderRun(
          {
            message: HOST_DID_NOT_COME_ONLINE,
            detail: [
              `Not online after ${Math.round(RECONNECT_ONLINE_TIMEOUT_MS / 1000)} seconds.`,
              awaitingOnline.detail,
            ]
              .filter(Boolean)
              .join(" "),
          },
          awaitingOnline.run,
        ),
      Math.max(0, awaitingOnline.deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [awaitingOnline, hostOnline, finishProviderRun]);

  // Re-check liveness quickly while a reconnected or woken host is awaited.
  const pollsForOnline = awaitingOnline !== null || sandboxWake === "awaiting_online";
  useEffect(() => {
    if (!pollsForOnline) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > RECONNECT_ONLINE_TIMEOUT_MS) {
        clearInterval(timer);
        return;
      }
      refreshRunnerHealth();
      void queryClient?.invalidateQueries({ queryKey: ["hosts"] });
    }, RECONNECT_ONLINE_POLL_MS);
    return () => clearInterval(timer);
  }, [pollsForOnline, queryClient]);

  // A wake's steps, inline at the host: the server's launch stage while it reports one.
  const wakeStep = (() => {
    if (sandboxWake === null) return null;
    if (launchInProgress && launch) {
      return `${SANDBOX_STAGE_LABELS[launch.stage] ?? "Launching sandbox"}...`;
    }
    return sandboxWake === "waking" ? RECONNECT_STEP.starting : RECONNECT_STEP.waiting;
  })();
  useEffect(() => {
    if (wakeStep) providerRun.current?.handle.report(wakeStep);
  }, [wakeStep]);

  // Count the interval's polls, not time, since `/health` backs off on failures; a
  // refresh or dialog's extra polls could use up the count in seconds. The count
  // waits for the launch to stop reporting progress, and starts from zero then.
  useEffect(() => {
    if (sandboxWake !== "awaiting_online" || launchInProgress || !sessionId) return;
    let offlinePolls = 0;
    return onRunnerHealthPolled((liveness, scheduled) => {
      const session = liveness.get(sessionId);
      if (!scheduled || !session || session.host_online === true) return;
      offlinePolls += 1;
      if (offlinePolls !== SANDBOX_WAKE_ONLINE_GRACE_POLLS) return;
      setSandboxWake(null);
      finishProviderRun({
        message: HOST_DID_NOT_COME_ONLINE,
        detail: "The sandbox didn't come online. Try Reconnect host again.",
      });
    });
  }, [sandboxWake, launchInProgress, sessionId, finishProviderRun]);

  // The count above waits on the launch, so a stage that never finishes would spin
  // with Reconnect host hidden. Let the wake go quietly: the server's stage keeps the
  // dot spinning, and Reconnect host returns as it does after a reload.
  // Keyed on whether a wake is running, so the server answering mid-stage keeps the deadline.
  const wakeRunning = sandboxWake !== null;
  useEffect(() => {
    if (!wakeRunning || !launchInProgress) return;
    const timer = setTimeout(() => {
      const start = wakeStart.current;
      if (start && inFlight.current === start.operation) inFlight.current = null;
      wakeStart.current = null;
      setSandboxWake(null);
      finishProviderRun(null);
      // A request whose answer never comes mustn't capture the next Reconnect host.
      if (sessionId) sandboxWakeRequests.delete(sessionId);
    }, SANDBOX_WAKE_STAGE_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [wakeRunning, launchInProgress, sessionId, finishProviderRun]);

  // A failed or waiting stage left over from before the click mustn't end the
  // wake; one reported since then does, even if it repeats the old one.
  useEffect(() => {
    const start = wakeStart.current;
    if (sandboxWake === null || !start) return;
    if (launchKey(launch) !== start.launch) start.stageChanged = true;
    if (!start.stageChanged || !isSandboxLaunchStopped(launch)) return;
    if (inFlight.current === start.operation) inFlight.current = null;
    wakeStart.current = null;
    setSandboxWake(null);
    // The chat's launch banner says what stopped it.
    finishProviderRun(null);
  }, [sandboxWake, launch, finishProviderRun]);

  // The server resumes the sandbox and starts the agent, as it does for a
  // message, so this works in the browser and for anyone who can send one.
  // Resolves once the server answered; the wake's own tracking then follows the host.
  const wakeSandbox = useCallback(async (): Promise<ReconnectOutcome> => {
    if (inFlight.current || !sessionId) return {};
    const operation = {};
    inFlight.current = operation;
    const store = useChatStore.getState();
    const clickLaunch = store.conversationId === sessionId ? store.sandboxStatus : null;
    wakeStart.current = { operation, launch: launchKey(clickLaunch), stageChanged: false };
    setSandboxWake("waking");
    try {
      await wakeSandboxSession(sessionId);
      if (inFlight.current !== operation) return { tracked: true };
      setSandboxWake("awaiting_online");
      refreshRunnerHealth();
      return { tracked: true };
    } catch (err) {
      if (inFlight.current !== operation) return { tracked: true };
      setSandboxWake(null);
      throw new Error(`Couldn't wake the sandbox: ${errorText(err)}`, { cause: err });
    } finally {
      if (inFlight.current === operation) inFlight.current = null;
    }
  }, [sessionId]);

  /** Runs `selected`'s reconnect with its steps, failure and wait for the host shown inline. */
  const runProvider = useCallback(
    (
      selected: SelectedReconnectProvider,
      host: ReconnectHost,
      wake: () => Promise<ReconnectOutcome>,
    ): Promise<void> => {
      hostProgress.clearFailure(host.hostId);
      const run: ProviderRun = {
        hostId: host.hostId,
        handle: hostProgress.begin(host.hostId, RECONNECT_STEP.starting),
        promise: Promise.resolve(),
      };
      providerRun.current = run;
      run.promise = (async () => {
        let outcome: void | ReconnectOutcome;
        try {
          outcome = await selected.provider.reconnect(host, {
            sessionId: sessionIdRef.current,
            wakeSandbox: wake,
            progress: Object.freeze({
              report: (value: { message?: string }) => {
                if (providerRun.current === run && typeof value?.message === "string") {
                  run.handle.report(value.message);
                }
              },
            }),
          });
        } catch (err) {
          if (providerRun.current !== run) return;
          console.info(`[host-reconnect] ${selected.id}: ${host.name}: ${errorText(err)}`);
          finishProviderRun(
            {
              message:
                err instanceof HostOfflineError ? HOST_DID_NOT_COME_ONLINE : RECONNECT_FAILED,
              detail: errorText(err),
            },
            run,
          );
          return;
        }
        if (providerRun.current !== run) return;
        // The built-in wake follows the host itself, through the launch stages.
        if (outcome && outcome.tracked) return;
        run.handle.report(RECONNECT_STEP.waiting);
        refreshRunnerHealth();
        setAwaitingOnline({
          run,
          detail: typeof outcome?.detail === "string" && outcome.detail ? outcome.detail : null,
          deadline: Date.now() + RECONNECT_ONLINE_TIMEOUT_MS,
        });
      })();
      return run.promise;
    },
    [finishProviderRun],
  );

  const runProviderRef = useRef(runProvider);
  useEffect(() => {
    runProviderRef.current = runProvider;
  }, [runProvider]);

  const reconnect = useCallback(async () => {
    // A provider's reconnect is shown at the host; clicking again joins it.
    if (providerRun.current) return providerRun.current.promise;
    if (inFlight.current || selectingProvider.current) return;
    if (hostId) {
      const details = providerHostDetails.current;
      const host: ReconnectHost = {
        hostId,
        name: details.hostRecordName || details.hostName || hostId,
        status:
          details.hostOnline === true
            ? "online"
            : details.hostOnline === false
              ? "offline"
              : "unknown",
        sandboxProvider: details.hostSandboxProvider,
        resumable: hostResumable,
      };
      let selected = hostReconnectProviders.select(host);
      if (isThenable<SelectedReconnectProvider | undefined>(selected)) {
        const selecting = {};
        selectingProvider.current = selecting;
        selected = await selected;
        // The session or host changed while a provider answered.
        if (selectingProvider.current !== selecting) return;
        selectingProvider.current = null;
      }
      if (selected) return runProviderRef.current(selected, host, wakeSandbox);
    }
    if (!hostId || !isOwner || !isElectronShell()) {
      setDialogOpen(true);
      return;
    }
    // Arca is a remote machine, so it can never match the desktop host
    // identity below. Starting it here still needs the user's confirmation
    // in the desktop app.
    if (isSessionArcaHost()) {
      await reconnectArca();
      return;
    }

    const operation: { progressToast?: string | number } = {};
    inFlight.current = operation;
    setReconnecting(true);
    setError(null);
    try {
      // Recheck identity on each click, including retries after re-enrollment.
      const identity = await getHostIdentity();
      if (inFlight.current !== operation) return;
      if (!identity?.cliInstalled || identity.hostId !== hostId) {
        setCanReconnectThisMachine(false);
        setCanReconnectArca(false);
        setDialogOpen(true);
        return;
      }
      setCanReconnectThisMachine(true);
      operation.progressToast = toast.loading("Reconnecting this machine…");
      const result = await controlHost("start");
      if (inFlight.current !== operation) return;
      if (!result.ok) {
        setError(
          result.error ??
            (result.authError
              ? "Sign-in didn't complete. A browser should have opened. Finish signing in, then try again."
              : "Couldn't reconnect this machine. Try again or run the command below from a terminal."),
        );
        setDialogOpen(true);
        return;
      }
      setDialogOpen(false);
      toast.success("This machine is back online.");
    } finally {
      if (inFlight.current === operation) {
        if (operation.progressToast !== undefined) toast.dismiss(operation.progressToast);
        inFlight.current = null;
        setReconnecting(false);
      }
    }
  }, [hostId, hostResumable, isOwner, isSessionArcaHost, reconnectArca, wakeSandbox]);

  return {
    reconnect,
    /** Whether `reconnect` runs the desktop's Arca connect for this session's host. */
    reconnectsArca: runsArcaConnect(),
    /** A sandbox wake is running or its host has not yet been seen online. */
    sandboxStarting: sandboxWake !== null,
    dialogOpen,
    setDialogOpen,
    localReconnect: canReconnectThisMachine
      ? { reconnecting, error, onReconnect: () => void reconnect() }
      : undefined,
    arcaReconnect: canReconnectArca
      ? { reconnecting, error, onReconnect: () => void reconnectArca() }
      : undefined,
  };
}
