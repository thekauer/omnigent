// Composer-footer "MCPs" chip for choosing which of the host's MCP connections a
// new session or automation should use (`OmnigentHostConfig.mcpConnections`).
// Each row is a toggle; switching on one that needs a per-user OAuth grant runs
// the host's sign-in first and selects it only once the grant is saved, so the
// session's tools resolve. All toggles default off.
//
// Controlled: the selection lives in the screen that sends it; this component
// renders the live status and drives the sign-in. It lists every connection the
// host returns, opens a popover whose list scrolls inside, and renders nothing
// unless the host wired the capability and the list is non-empty.
//
// Connections the server's admin configuration adds to every session render on
// and locked. Any on connection the user hasn't signed in to (admin-provided, or
// a restored selection whose grant lapsed) gets a Sign in action.
//
// When the host can `browse`, a footer opens a searchable, paged list of the
// other MCP services the user can add, in the same popover. Switching one on adds
// it to this list and, like a switch here, signs in first if needed. Services
// switched off there drop out of the list when the popover closes.

import { ArrowLeftIcon, ChevronDownIcon, PlugIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  useAuthorizeMcpConnection,
  useBrowseMcpServices,
  useFetchMcpServiceStatus,
  useMcpConnections,
} from "@/hooks/useMcpConnections";
import { getOmnigentMcpConnections, type McpConnectionStatus } from "@/lib/host";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";

export interface McpConnectionPickerProps {
  /** Selected MCP service names (e.g. `tools.github`); controlled by the screen that sends them. */
  selected: ReadonlySet<string>;
  /** Toggle one connection's membership in the selection. */
  onToggle: (name: string, next: boolean) => void;
}

export function McpConnectionPicker({ selected, onToggle }: McpConnectionPickerProps) {
  // What was on when the popover opened plus what's checked in browse since; kept
  // listed until it closes even if switched off, so a row doesn't vanish under
  // the cursor.
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());
  const [browsing, setBrowsing] = useState(false);
  const {
    data: connections,
    listedNames,
    statusesPending,
  } = useMcpConnections([...selected, ...added]);
  const authorize = useAuthorizeMcpConnection();
  const fetchStatus = useFetchMcpServiceStatus();
  // Browse row whose sign-in status is being read before switching it on.
  const [checking, setChecking] = useState<string | null>(null);
  const canBrowse = getOmnigentMcpConnections()?.browse != null;
  // A picked service with no status is one the user can't use (the browse listing
  // can include services they may not call). Say so and deselect it, rather than
  // starting a session with a server whose tools would all fail.
  const unavailable = useMemo(
    () =>
      connections && !statusesPending
        ? [...added].filter((name) => !connections.some((connection) => connection.name === name))
        : [],
    [connections, statusesPending, added],
  );
  useEffect(() => {
    for (const name of unavailable) {
      if (selected.has(name)) onToggle(name, false);
    }
  }, [unavailable, selected, onToggle]);

  if (!connections || connections.length === 0) {
    return null;
  }

  const handleToggle = (name: string, authorized: boolean, next: boolean) => {
    if (!next) {
      onToggle(name, false);
      return;
    }
    if (authorized) {
      onToggle(name, true);
      return;
    }
    // Needs sign-in: pop the OAuth flow and only select once the grant is saved.
    // On cancel/failure the toggle stays off and the row surfaces the error.
    authorize
      .mutateAsync(name)
      .then(() => onToggle(name, true))
      .catch(() => undefined);
  };

  const signIn = (name: string) => {
    authorize.mutateAsync(name).catch(() => undefined);
  };

  const isOn = (connection: McpConnectionStatus) =>
    connection.providedByAdmin === true || selected.has(connection.name);
  const selectedConnections = connections.filter(isOn);
  const selectedCount = selectedConnections.length;
  // On connections whose per-user grant isn't active. The toggle-on path
  // authorizes first, but an admin-provided server is on without the user
  // choosing it, and a selection restored from a previous session (see
  // mcpPreferences) can carry a connection whose grant has since lapsed. Flag
  // them in the chip so the user signs in before the session starts, rather
  // than hitting a dead tool mid-turn.
  const needsSignInCount = selectedConnections.filter(
    (connection) => !connection.authorized,
  ).length;

  const toggleFromBrowse = (name: string, next: boolean) => {
    setAdded((previous) => new Set(previous).add(name));
    if (!next) {
      onToggle(name, false);
      return;
    }
    // Browse results carry no sign-in status, so read it, then switch on exactly
    // as a row in the list does. A service with no status is reported as
    // unavailable.
    setChecking(name);
    fetchStatus(name)
      .then((status) => {
        if (status) handleToggle(name, status.authorized, true);
      })
      .catch(() => undefined)
      .finally(() => setChecking(null));
  };

  const rows = sortedConnections(connections);

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setAdded(new Set(selected));
      return;
    }
    setBrowsing(false);
    setAdded(new Set());
  };

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative inline-flex h-6 min-w-10 max-w-[calc(50%-0.25rem)] cursor-pointer items-center gap-1 rounded-md border border-transparent bg-transparent px-0.5 text-xs leading-4 font-normal text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:min-w-11 md:px-1"
          data-testid="new-chat-landing-mcps-chip"
        >
          <PlugIcon className="size-4 shrink-0" />
          <span
            data-workspace-collapse-label=""
            className="min-w-0 truncate text-left group-data-[workspace-labels=collapsed]/composer-workspace:hidden"
          >
            {selectedCount > 0 ? `MCPs · ${selectedCount}` : "MCPs"}
          </span>
          {needsSignInCount > 0 && (
            <span
              className="truncate text-(--ui-warning-text)"
              data-testid="new-chat-landing-mcps-needs-signin"
            >
              · {needsSignInCount} needs sign-in
            </span>
          )}
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-[var(--radix-popover-content-available-height)] w-80 flex-col p-0"
      >
        {browsing ? (
          <McpServiceBrowser
            connections={connections}
            isOn={(name) => {
              const connection = connections.find((candidate) => candidate.name === name);
              return connection ? isOn(connection) : selected.has(name);
            }}
            unavailable={unavailable}
            checking={checking}
            authorizing={(name) => authorize.isPending && authorize.variables === name}
            failed={(name) => authorize.isError && authorize.variables === name}
            onToggle={toggleFromBrowse}
            onBack={() => setBrowsing(false)}
          />
        ) : (
          <>
            <div className="flex shrink-0 flex-col gap-0.5 border-b border-border px-3 py-2.5">
              <span className="text-sm font-medium text-foreground">Tools for this session</span>
              <span className="text-xs text-muted-foreground">
                Turn on the MCP servers this session should use. You&apos;ll be asked to sign in to
                ones that need it.
              </span>
              {connections.some((connection) => connection.providedByAdmin) && (
                <span className="text-xs text-muted-foreground">
                  Servers your admin added are always on.
                </span>
              )}
              {unavailable.map((name) => (
                <span
                  key={name}
                  className="text-xs text-(--ui-danger-text)"
                  data-testid={`new-chat-landing-mcp-unavailable-${name}`}
                >
                  You don&apos;t have permission to use {name}.
                </span>
              ))}
            </div>
            <ul className="overflow-y-auto py-1">
              {rows.map((connection) => {
                const authorizing = authorize.isPending && authorize.variables === connection.name;
                const failed = authorize.isError && authorize.variables === connection.name;
                const adminProvided = connection.providedByAdmin === true;
                return (
                  <li
                    key={connection.name}
                    className="flex items-center justify-between gap-3 px-3 py-1.5"
                    data-testid={`new-chat-landing-mcp-${connection.name}`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {connection.iconUrl ? (
                        <img src={connection.iconUrl} alt="" className="size-4 shrink-0" />
                      ) : (
                        <PlugIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm text-foreground" title={connection.name}>
                          {connection.displayName}
                          {!listedNames.has(connection.name) && qualifier(connection.name) && (
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              · {qualifier(connection.name)}
                            </span>
                          )}
                        </span>
                        {authorizing ? (
                          <span className="truncate text-xs text-muted-foreground">
                            Authorizing…
                          </span>
                        ) : failed ? (
                          <span className="truncate text-xs text-(--ui-danger-text)">
                            Sign-in failed. Try again.
                          </span>
                        ) : adminProvided ? (
                          <span
                            className={
                              connection.authorized
                                ? "truncate text-xs text-muted-foreground"
                                : "truncate text-xs text-(--ui-warning-text)"
                            }
                          >
                            Added by your admin
                          </span>
                        ) : connection.authorized ? (
                          <span className="truncate text-xs text-muted-foreground">Connected</span>
                        ) : selected.has(connection.name) ? (
                          // Restored selection whose grant lapsed: toggle is on but
                          // the connection isn't authorized. Name the gap so the
                          // user knows which one to re-authorize.
                          <span className="truncate text-xs text-(--ui-warning-text)">
                            Needs sign-in
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {isOn(connection) && !connection.authorized && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={authorizing}
                          onClick={() => signIn(connection.name)}
                          data-testid={`new-chat-landing-mcp-signin-${connection.name}`}
                        >
                          Sign in
                        </Button>
                      )}
                      <Switch
                        checked={isOn(connection)}
                        disabled={authorizing || adminProvided}
                        onCheckedChange={(next) =>
                          handleToggle(connection.name, connection.authorized, next)
                        }
                        data-testid={`new-chat-landing-mcp-toggle-${connection.name}`}
                        aria-label={connection.displayName}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            {canBrowse && (
              <button
                type="button"
                className="flex shrink-0 cursor-pointer items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setBrowsing(true)}
                data-testid="new-chat-landing-mcps-browse"
              >
                <SearchIcon className="size-4 shrink-0" />
                Browse MCP servers…
              </button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// The qualifier of a dotted service name (`team.tools` of `team.tools.linear`),
// shown for one added from browse to tell same-named services apart.
function qualifier(name: string): string | undefined {
  return name.split(".").slice(0, -1).join(".") || undefined;
}

// Alphabetical by name only, so switching a row on or off never moves it; ties
// (same name in different schemas) by full name.
function sortedConnections(connections: McpConnectionStatus[]): McpConnectionStatus[] {
  return [...connections].sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }) ||
      a.name.localeCompare(b.name),
  );
}

// Results to show before fetching more pages while a search matches few rows.
const BROWSE_MIN_MATCHES = 20;

function McpServiceBrowser({
  connections,
  isOn,
  unavailable,
  checking,
  authorizing,
  failed,
  onToggle,
  onBack,
}: {
  connections: McpConnectionStatus[];
  isOn: (name: string) => boolean;
  unavailable: readonly string[];
  checking: string | null;
  authorizing: (name: string) => boolean;
  failed: (name: string) => boolean;
  onToggle: (name: string, next: boolean) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const { data, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useBrowseMcpServices(true);
  const needle = query.trim().toLowerCase();
  const matches = (data?.pages ?? [])
    .flatMap((page) => page.services)
    .filter((service) => !needle || service.name.toLowerCase().includes(needle));

  // The list API has no server-side search, so a search keeps walking pages until
  // it has a screenful of matches or the list ends. It stops at a failed page;
  // Load more retries.
  useEffect(() => {
    if (
      needle &&
      matches.length < BROWSE_MIN_MATCHES &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isError
    ) {
      void fetchNextPage();
    }
  }, [needle, matches.length, hasNextPage, isFetchingNextPage, isError, fetchNextPage]);

  // Connected / needs-sign-in status lives in the list; browse only shows a
  // sign-in in progress or failed, and explains a locked or refused switch.
  const note = (name: string, adminProvided: boolean) => {
    if (authorizing(name)) {
      return <span className="truncate text-xs text-muted-foreground">Authorizing…</span>;
    }
    if (failed(name)) {
      return (
        <span className="truncate text-xs text-(--ui-danger-text)">Sign-in failed. Try again.</span>
      );
    }
    if (unavailable.includes(name)) {
      return (
        <span className="truncate text-xs text-(--ui-danger-text)">
          You don&apos;t have permission to use this
        </span>
      );
    }
    return adminProvided ? (
      <span className="truncate text-xs text-muted-foreground">Added by your admin</span>
    ) : null;
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-2">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Back"
          onClick={onBack}
          data-testid="new-chat-landing-mcps-browse-back"
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name"
          className="h-7"
          data-testid="new-chat-landing-mcps-browse-search"
        />
      </div>
      <ul className="overflow-y-auto py-1" data-testid="new-chat-landing-mcps-browse-list">
        {matches.map((service) => {
          const adminProvided =
            connections.find((candidate) => candidate.name === service.name)?.providedByAdmin ===
            true;
          return (
            <li key={service.name} className="flex items-center justify-between gap-3 px-3 py-1.5">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-foreground">{service.displayName}</span>
                <span className="truncate text-xs text-muted-foreground">{service.name}</span>
                {note(service.name, adminProvided)}
              </span>
              <Switch
                checked={isOn(service.name)}
                disabled={adminProvided || checking === service.name || authorizing(service.name)}
                onCheckedChange={(next) => onToggle(service.name, next)}
                data-testid={`new-chat-landing-mcps-browse-${service.name}`}
                aria-label={service.name}
              />
            </li>
          );
        })}
        {(isPending || isFetchingNextPage) && (
          <li className="px-3 py-1.5 text-xs text-muted-foreground">Loading…</li>
        )}
        {isError && (
          <li className="px-3 py-1.5 text-xs text-(--ui-danger-text)">
            Couldn&apos;t load MCP servers.
          </li>
        )}
        {!isPending && !isFetchingNextPage && !isError && matches.length === 0 && !hasNextPage && (
          <li className="px-3 py-1.5 text-xs text-muted-foreground">No MCP servers found.</li>
        )}
      </ul>
      {hasNextPage && !isFetchingNextPage && (
        <button
          type="button"
          className="shrink-0 cursor-pointer border-t border-border px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => void fetchNextPage()}
          data-testid="new-chat-landing-mcps-browse-more"
        >
          Load more
        </button>
      )}
    </>
  );
}
