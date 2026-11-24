// A pull request view's page (`window.createPullRequestView`): a session's pull
// requests as the Pull Requests tab draws them, from the plain content an
// extension sets. The extension decides the bar, the link form, the list or the
// pull request shown and the words; the host draws each pull request's details
// (header, checks, reviewers, labels, merge, comments, the diff and its review
// threads) and the merge control on a row, reading the session's queries.

import type * as omnigent from "omnigent";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GitPullRequestIcon,
  RefreshCwIcon,
  ServerOffIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { normalizePullRequestInfo, usePullRequestInfoSnapshot } from "@/hooks/usePullRequests";
import { copyText } from "@/lib/clipboard";
import { useLocalReviewNavigation } from "@/lib/localReviewContext";
import { cn } from "@/lib/utils";
import { useMobilePanelHeaderTarget } from "../MobilePanelDrawer";
import { IconButton } from "../PullRequestFileSection";
import { PullRequestMerge } from "../PullRequestMerge";
import {
  mergeAccounts,
  PanelTitle,
  PullRequestCheckCounts,
  PullRequestPanelDetails,
  PullRequestStatus,
  type PullRequestSubtab,
} from "../PullRequestPanelDetails";
import { railViewIcon } from "../railViewIcons";
import type { RailView } from "../railViews";
import { associationOf } from "../useWorkspacePullRequestsSource";
import { type WorkspaceBridge, workspaceBridge } from "../workspaceBridge";

type Content = Extract<omnigent.PullRequestViewContent, { kind: "pullRequests" }>;

/**
 * `published`, unless it is for another session and `sessionId` has content of its
 * own (a grid cell not in front). Loading is for the session on screen.
 */
export function pullRequestsForSession(
  view: Pick<RailView, "pullRequestsBySession">,
  published: omnigent.PullRequestViewContent,
  sessionId: string | undefined,
): omnigent.PullRequestViewContent | undefined {
  if (published.kind === "loading" || sessionId === undefined) return published;
  if (published.sessionId === sessionId) return published;
  return view.pullRequestsBySession.get(sessionId);
}

function ActionIcon({ action }: { action: omnigent.PullRequestViewAction }) {
  const Icon = railViewIcon(action.icon) ?? RefreshCwIcon;
  return <Icon className={cn("size-3.5", action.busy && "animate-spin")} aria-hidden="true" />;
}

function BarActions({
  actions,
  run,
}: {
  actions: readonly omnigent.PullRequestViewAction[];
  run: (command: omnigent.Command, extra?: unknown[]) => void;
}) {
  return (
    <TooltipProvider delayDuration={0}>
      {actions.map((action) => (
        <IconButton
          key={action.command.command}
          label={action.title}
          disabled={action.disabled}
          onClick={() => run(action.command)}
        >
          <ActionIcon action={action} />
        </IconButton>
      ))}
    </TooltipProvider>
  );
}

function RefreshButton({
  refresh,
  run,
}: {
  refresh: { busy: boolean; command: omnigent.Command };
  run: (command: omnigent.Command) => void;
}) {
  return (
    <Button size="sm" variant="ghost" disabled={refresh.busy} onClick={() => run(refresh.command)}>
      <RefreshCwIcon
        className={cn("size-3.5", refresh.busy && "animate-spin")}
        aria-hidden="true"
      />
      Refresh
    </Button>
  );
}

/** The link form: a URL field, Link and Cancel, and the failed link's reason. */
function LinkControls({
  form,
  run,
}: {
  form: NonNullable<Content["linkForm"]>;
  run: (command: omnigent.Command, extra?: unknown[]) => void;
}) {
  const [url, setUrl] = useState("");
  // A form that closed (linked or cancelled) starts empty when it opens again.
  const wasOpen = useRef(form.open);
  useEffect(() => {
    if (!form.open && wasOpen.current) setUrl("");
    wasOpen.current = form.open;
  }, [form.open]);
  return (
    <>
      {form.open && (
        <form
          className="mt-2 flex gap-2"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              run(form.cancel);
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (form.disabled) return;
            run(form.submit, [url]);
          }}
        >
          <Input
            aria-label="Pull request URL"
            autoFocus
            type="url"
            required
            disabled={form.disabled}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={form.placeholder}
            className="flex-1 focus-visible:ring-0"
          />
          <Button type="submit" disabled={form.pending || form.disabled}>
            Link
          </Button>
          <Button type="button" variant="outline" onClick={() => run(form.cancel)}>
            Cancel
          </Button>
        </form>
      )}
      {form.error !== undefined && (
        <p role="alert" className="mt-1 text-ui text-destructive">
          {form.error}
        </p>
      )}
    </>
  );
}

/** A listed pull request: its state icon and label, its status, merge control and ⋯ menu. */
function PullRequestListRow({
  sessionId,
  row,
  onSelect,
  run,
}: {
  sessionId: string;
  row: omnigent.PullRequestViewRow;
  onSelect: () => void;
  run: (command: omnigent.Command) => void;
}) {
  const pullRequest = row.pullRequest;
  // The merge control reads what the row's own read cached; the surface polls it.
  const info = usePullRequestInfoSnapshot(row.merge ? sessionId : undefined, pullRequest.url);
  const data = info.data ? normalizePullRequestInfo(info.data) : undefined;
  const cachedPr = data?.pr?.url === pullRequest.url ? data.pr : undefined;
  const details = pullRequest.live.details;
  const summary = details
    ? { state: details.state, isDraft: details.isDraft }
    : { state: pullRequest.state, isDraft: pullRequest.isDraft };
  // The classic row's label, its separator an em dash (written as an escape).
  const label = row.title ? `${row.identity} \u2014 ${row.title}` : row.identity;
  const status = row.status;
  const checks = details?.checks;
  const checkStatus = status.kind === "checks" && (
    <>
      {checks && (
        <PullRequestCheckCounts
          checks={{ ...checks, runs: checks.runs.map((checkRun) => ({ ...checkRun })) }}
          compact
        />
      )}
      {status.incomplete && <span title="Some checks could not be loaded">Incomplete checks</span>}
    </>
  );
  return (
    <li className="flex min-w-0 items-center gap-2 rounded-md px-1.5 hover:bg-muted/50">
      <button
        type="button"
        onClick={onSelect}
        title={label}
        aria-label={label}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 text-left text-ui focus-visible:outline-ring"
      >
        <GitPullRequestIcon
          aria-hidden
          className={cn(
            "size-4 shrink-0",
            !summary.state || summary.isDraft
              ? "text-muted-foreground"
              : summary.state === "OPEN"
                ? "text-green-600"
                : summary.state === "MERGED"
                  ? "text-purple-500"
                  : "text-red-500",
          )}
        />
        <span className="truncate">
          <span className="text-muted-foreground">{row.identity}</span>
          {row.title && (
            <>
              {" "}
              · <span className="font-medium">{row.title}</span>
            </>
          )}
        </span>
      </button>
      <div className="flex max-w-[45%] shrink-0 flex-wrap items-center justify-end gap-1 text-xs text-muted-foreground">
        {status.kind === "offline" ? (
          <>
            {pullRequest.state && (
              <PullRequestStatus state={pullRequest.state} isDraft={pullRequest.isDraft} />
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} role="status" className="inline-flex items-center gap-1">
                    <ServerOffIcon aria-hidden className="size-3" />
                    {status.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{status.hint}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </>
        ) : status.kind === "text" ? (
          <span title={status.tooltip}>{status.text}</span>
        ) : status.kind === "state" ? (
          <PullRequestStatus state={status.state} />
        ) : status.kind === "checks" ? (
          <>
            {status.draft && <span>Draft</span>}
            {checkStatus}
            {status.noChecks !== undefined && (
              <span title={status.noChecks || undefined}>No checks</span>
            )}
          </>
        ) : null}
        {row.merge && cachedPr && (
          <PullRequestMerge
            compact
            showTrigger={row.merge.trigger}
            unavailable={row.merge.unavailable}
            conversationId={sessionId}
            prUrl={pullRequest.url}
            pr={cachedPr}
            accounts={mergeAccounts(data)}
          />
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Actions for ${row.identity}`}
            className="shrink-0"
          >
            <EllipsisIcon aria-hidden className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {row.unlink && (
            <>
              <DropdownMenuItem
                disabled={row.unlink.disabled}
                onSelect={() => row.unlink && run(row.unlink.command)}
              >
                <Trash2Icon aria-hidden /> Unlink PR
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {row.openUrl && (
            <DropdownMenuItem asChild>
              <a href={row.openUrl.url} target="_blank" rel="noreferrer">
                <ExternalLinkIcon aria-hidden /> {row.openUrl.label}
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              void copyText(pullRequest.url).then(
                () => toast.success("PR link copied"),
                () => toast.error("Couldn’t copy PR link"),
              );
            }}
          >
            <CopyIcon aria-hidden /> Copy PR link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** One pull request's details, read from the session's cache (the surface polls it). */
function DetailsBody({
  sessionId,
  body,
  visible,
  inMobileDrawer,
  showHeading,
  run,
  emptyStateAction,
}: {
  sessionId: string;
  body: Extract<omnigent.PullRequestViewBody, { kind: "details" }>;
  visible: boolean;
  inMobileDrawer: boolean;
  showHeading: boolean;
  run: (command: omnigent.Command, extra?: unknown[]) => void;
  emptyStateAction: React.ReactNode;
}) {
  const info = usePullRequestInfoSnapshot(sessionId, body.url);
  const detailsInfo =
    body.branchHidden && info.data
      ? { ...info, data: { ...info.data, pr: null, selected_pr_url: undefined } }
      : info;
  return (
    <PullRequestPanelDetails
      key={`${sessionId}:${body.url ?? ""}`}
      conversationId={sessionId}
      info={detailsInfo as typeof info}
      active={visible}
      activeTab={body.section}
      setActiveTab={(section: PullRequestSubtab) => run(body.selectSection, [section])}
      storedPr={body.stored ? associationOf(body.stored) : undefined}
      notSynced={body.notSynced}
      showHeading={showHeading}
      refreshButton={
        !inMobileDrawer && body.refresh ? (
          <RefreshButton refresh={body.refresh} run={run} />
        ) : undefined
      }
      emptyStateAction={emptyStateAction}
    />
  );
}

/** A pull request view's page for `conversationId`'s workspace. */
export function ViewPullRequests({
  view,
  content,
  conversationId,
  visible,
  onOpenPullRequest,
  bridge = workspaceBridge,
}: {
  view: RailView;
  content: omnigent.PullRequestViewContent;
  conversationId: string | undefined;
  visible: boolean;
  /** Shows a chosen pull request on its own (a sidebar's tab); the page then draws `page`. */
  onOpenPullRequest?: (url: string, section?: PullRequestSubtab) => void;
  bridge?: WorkspaceBridge;
}) {
  const mobileHeaderTarget = useMobilePanelHeaderTarget();
  const inMobileDrawer = mobileHeaderTarget !== undefined;
  const host = view.host;
  const run = (command: omnigent.Command, extra: unknown[] = []) =>
    host?.runCommand(command.command, [...(command.arguments ?? []), ...extra]);
  // A drawn but hidden view (a collapsed rail) keeps them read without polling,
  // the selected one first, as the classic tab's mounted panel did.
  const passiveWatch = useRef<ReturnType<WorkspaceBridge["watchPullRequests"]> | null>(null);
  useEffect(() => {
    const watch = bridge.watchPullRequests({ passive: true });
    passiveWatch.current = watch;
    return () => {
      passiveWatch.current = null;
      watch.dispose();
    };
  }, [bridge]);
  const drawn = pullRequestsForSession(view, content, conversationId);
  const focusKey =
    drawn?.kind === "pullRequests"
      ? JSON.stringify([
          drawn.sessionId,
          drawn.selectedUrl ?? null,
          (onOpenPullRequest && drawn.page ? drawn.page : drawn).body.kind === "details",
        ])
      : null;
  useEffect(() => {
    if (focusKey === null) return;
    const [sessionId, url, details] = JSON.parse(focusKey) as [string, string | null, boolean];
    passiveWatch.current?.setFocus({ sessionId, url: url ?? undefined, details });
  }, [focusKey]);
  // A page that lists pull requests keeps each listed one read, as its rows did.
  const listsAll = onOpenPullRequest !== undefined;
  useEffect(() => {
    if (!listsAll || !visible) return undefined;
    const watch = bridge.watchPullRequests({ list: true });
    return watch.dispose;
  }, [bridge, listsAll, visible]);
  // A page that opens pull requests elsewhere takes a review comment's there.
  const reviewTarget = useLocalReviewNavigation(conversationId ?? "");
  const openElsewhere = useRef(onOpenPullRequest);
  openElsewhere.current = onOpenPullRequest;
  useEffect(() => {
    const prUrl = reviewTarget?.anchor_metadata?.pr_url;
    if (prUrl && openElsewhere.current) openElsewhere.current(prUrl, "changes");
  }, [reviewTarget]);
  const shown = pullRequestsForSession(view, content, conversationId);
  if (!shown || shown.kind === "loading" || conversationId === undefined) {
    return (
      <p className="px-2 py-1 text-muted-foreground text-sm" role="status">
        Loading…
      </p>
    );
  }
  const sessionId = shown.sessionId;
  const layout = onOpenPullRequest && shown.page ? shown.page : shown;
  const actions = layout.actions;
  const bar = inMobileDrawer ? undefined : layout.bar;
  const body = layout.body;
  const linkControls = shown.linkForm && <LinkControls form={shown.linkForm} run={run} />;
  const linkBlockShown =
    layout.bar?.kind === "toolbar" &&
    shown.linkForm !== undefined &&
    (shown.linkForm.open || shown.linkForm.error !== undefined) &&
    !(body.kind === "details" && body.emptyState?.kind === "link");
  const emptyState = body.kind === "details" ? body.emptyState : undefined;
  const emptyStateAction =
    emptyState?.kind === "link" ? (
      <div className="mt-2 w-full max-w-sm">
        {!shown.linkForm?.open && (
          <Button onClick={() => run(emptyState.command)}>Link a PR</Button>
        )}
        {linkControls}
      </div>
    ) : emptyState?.kind === "message" ? (
      <div className="mt-2 w-full max-w-sm">
        <p role="status" className="text-ui text-muted-foreground">
          {emptyState.text}
        </p>
      </div>
    ) : emptyState?.kind === "open" ? (
      <div className="mt-2 flex flex-col items-center gap-2 text-ui">
        <span className="text-muted-foreground">or</span>
        <a
          href={emptyState.url}
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline underline-offset-4"
        >
          {emptyState.label}
        </a>
      </div>
    ) : undefined;
  const barActions = <BarActions actions={actions} run={run} />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {mobileHeaderTarget?.actions && createPortal(barActions, mobileHeaderTarget.actions)}
      {mobileHeaderTarget?.title &&
        shown.back &&
        createPortal(
          <div data-mobile-panel-title>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2"
              aria-label={shown.back.title}
              onClick={() => run(shown.back!.command)}
            >
              <ArrowLeftIcon className="size-3.5" /> All pull requests
            </Button>
          </div>,
          mobileHeaderTarget.title,
        )}
      {bar?.kind === "toolbar" ? (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2">
          <PanelTitle showTitle={bar.showTitle} />
          <div className="ml-auto flex min-w-0 flex-1 items-center gap-2">
            {shown.back && layout === shown && (
              <Button variant="ghost" size="sm" onClick={() => run(shown.back!.command)}>
                <ArrowLeftIcon className="size-3.5" /> {shown.back.title}
              </Button>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1">{barActions}</div>
          </div>
        </div>
      ) : bar?.kind === "refresh" ? (
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
          <PanelTitle showTitle />
          <RefreshButton refresh={bar} run={run} />
        </div>
      ) : null}
      {linkBlockShown && (
        <div className="shrink-0 border-b border-border p-2 [&>:first-child]:mt-0">
          {linkControls}
        </div>
      )}
      {shown.alert !== undefined && (
        <p role="alert" className="shrink-0 border-b border-border p-2 text-ui text-destructive">
          {shown.alert}
        </p>
      )}
      {shown.note !== undefined && (
        <p
          role="status"
          className="shrink-0 border-b border-border p-2 text-ui text-muted-foreground"
        >
          {shown.note}
        </p>
      )}
      <div className="min-h-0 flex-1">
        {body.kind === "list" ? (
          <ul aria-label="Pull requests" className="h-full overflow-y-auto">
            {body.rows.map((row) => (
              <PullRequestListRow
                key={row.pullRequest.url}
                sessionId={sessionId}
                row={row}
                run={run}
                onSelect={() => {
                  if (onOpenPullRequest) onOpenPullRequest(row.pullRequest.url);
                  else run(row.command);
                }}
              />
            ))}
          </ul>
        ) : (
          <DetailsBody
            sessionId={sessionId}
            body={body}
            visible={visible}
            inMobileDrawer={inMobileDrawer}
            showHeading={!inMobileDrawer && layout.bar?.kind !== "toolbar"}
            run={run}
            emptyStateAction={emptyStateAction}
          />
        )}
      </div>
    </div>
  );
}
