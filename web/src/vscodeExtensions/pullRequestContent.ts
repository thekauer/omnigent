// Checks a pull request view's content (`window.createPullRequestView`) into the
// plain, capped, frozen data the host draws. Anything malformed is dropped,
// never thrown; a view with unreadable content shows as loading.
import type * as omnigent from "omnigent";
import { isRailViewIconName } from "@/shell/railViewIcons";
import { planCommandOf } from "./planContent";

const MAX_TEXT = 2_000;
const MAX_ROWS = 200;
const MAX_ACTIONS = 8;
/** A pull request carried in content: its plain data, copied as JSON up to this size. */
const MAX_PULL_REQUEST_JSON = 64 * 1024;

type Record_ = Record<string, unknown>;
type Content = Extract<omnigent.PullRequestViewContent, { kind: "pullRequests" }>;
type DetailsBody = Extract<omnigent.PullRequestViewBody, { kind: "details" }>;

const isRecord = (value: unknown): value is Record_ => typeof value === "object" && value !== null;

function text(value: unknown, max = MAX_TEXT): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

const LOADING: omnigent.PullRequestViewContent = Object.freeze({ kind: "loading" });

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** A pull request as plain data: a JSON copy with a url, number and repository. */
function pullRequestOf(value: unknown): omnigent.SessionPullRequest | undefined {
  if (!isRecord(value) || typeof value.url !== "string" || value.url === "") return undefined;
  let copy: unknown;
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_PULL_REQUEST_JSON) return undefined;
    copy = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isRecord(copy) || typeof copy.number !== "number" || typeof copy.repository !== "string") {
    return undefined;
  }
  if (!isRecord(copy.live)) {
    copy.live = { loading: false, error: undefined, offline: false, canMerge: false };
  }
  return deepFreeze(copy as unknown as omnigent.SessionPullRequest);
}

function actionOf(value: unknown): omnigent.PullRequestViewAction | undefined {
  if (!isRecord(value)) return undefined;
  const command = planCommandOf(value.command);
  const title = text(value.title, 200);
  const icon = text(value.icon, 64);
  if (!command || !title || !icon || !isRailViewIconName(icon)) return undefined;
  return Object.freeze({
    title,
    icon,
    command,
    disabled: value.disabled === true,
    busy: value.busy === true,
  });
}

function rowStatusOf(value: unknown): omnigent.PullRequestViewRow["status"] {
  if (!isRecord(value)) return Object.freeze({ kind: "none" });
  switch (value.kind) {
    case "offline":
      return Object.freeze({
        kind: "offline",
        label: text(value.label, 200) ?? "",
        hint: text(value.hint) ?? "",
      });
    case "checks":
      return Object.freeze({
        kind: "checks",
        incomplete: value.incomplete === true,
        noChecks: text(value.noChecks, 500),
        draft: value.draft === true,
      });
    case "state":
      return Object.freeze({ kind: "state", state: text(value.state, 64) ?? "" });
    case "text":
      return Object.freeze({
        kind: "text",
        text: text(value.text, 500) ?? "",
        tooltip: text(value.tooltip),
      });
    default:
      return Object.freeze({ kind: "none" });
  }
}

function rowOf(value: unknown): omnigent.PullRequestViewRow | undefined {
  if (!isRecord(value)) return undefined;
  const pullRequest = pullRequestOf(value.pullRequest);
  const command = planCommandOf(value.command);
  if (!pullRequest || !command) return undefined;
  const merge = isRecord(value.merge)
    ? Object.freeze({
        trigger: value.merge.trigger === true,
        unavailable: value.merge.unavailable === true,
      })
    : undefined;
  const unlinkCommand = isRecord(value.unlink) ? planCommandOf(value.unlink.command) : undefined;
  const unlink =
    unlinkCommand && isRecord(value.unlink)
      ? Object.freeze({ command: unlinkCommand, disabled: value.unlink.disabled === true })
      : undefined;
  const openUrl =
    isRecord(value.openUrl) &&
    typeof value.openUrl.url === "string" &&
    /^https:\/\//.test(value.openUrl.url)
      ? Object.freeze({
          url: value.openUrl.url.slice(0, MAX_TEXT),
          label: text(value.openUrl.label, 200) ?? "",
        })
      : undefined;
  return Object.freeze({
    pullRequest,
    identity: text(value.identity, 500) ?? "",
    title: text(value.title, 500),
    command,
    status: rowStatusOf(value.status),
    merge,
    unlink,
    openUrl,
  });
}

function sectionOf(value: unknown): "summary" | "comments" | "changes" {
  return value === "comments" || value === "changes" ? value : "summary";
}

function emptyStateOf(value: unknown): DetailsBody["emptyState"] {
  if (!isRecord(value)) return undefined;
  if (value.kind === "link") {
    const command = planCommandOf(value.command);
    return command ? Object.freeze({ kind: "link", command }) : undefined;
  }
  if (value.kind === "message") {
    const message = text(value.text);
    return message ? Object.freeze({ kind: "message", text: message }) : undefined;
  }
  // Rendered as a link, so only https, as with a row's `openUrl`.
  if (value.kind === "open" && typeof value.url === "string" && /^https:\/\//.test(value.url)) {
    return Object.freeze({
      kind: "open",
      url: value.url.slice(0, MAX_TEXT),
      label: text(value.label, 200) ?? "",
    });
  }
  return undefined;
}

function bodyOf(value: unknown): omnigent.PullRequestViewBody {
  if (isRecord(value) && value.kind === "list") {
    const rows = Array.isArray(value.rows)
      ? value.rows.slice(0, MAX_ROWS).flatMap((row) => {
          const checked = rowOf(row);
          return checked ? [checked] : [];
        })
      : [];
    return Object.freeze({ kind: "list", rows: Object.freeze(rows) });
  }
  const record = isRecord(value) ? value : {};
  const refreshCommand = isRecord(record.refresh)
    ? planCommandOf(record.refresh.command)
    : undefined;
  return Object.freeze({
    kind: "details",
    url: text(record.url),
    branchHidden: record.branchHidden === true,
    section: sectionOf(record.section),
    selectSection: planCommandOf(record.selectSection) ?? Object.freeze({ command: "noop" }),
    stored: pullRequestOf(record.stored),
    notSynced: record.notSynced === true,
    refresh:
      refreshCommand && isRecord(record.refresh)
        ? Object.freeze({ busy: record.refresh.busy === true, command: refreshCommand })
        : undefined,
    emptyState: emptyStateOf(record.emptyState),
  });
}

/** Checked content; `onError` hears why content could not be read. */
export function pullRequestContentOf(
  value: unknown,
  onError?: (message: string, error: unknown) => void,
): omnigent.PullRequestViewContent {
  try {
    return readContent(value);
  } catch (error) {
    try {
      onError?.("pull request view content could not be read; showing it as loading", error);
    } catch {
      // A reporter that throws changes nothing.
    }
    return LOADING;
  }
}

function actionsOf(value: unknown): readonly omnigent.PullRequestViewAction[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.slice(0, MAX_ACTIONS).flatMap((action) => {
      const checked = actionOf(action);
      return checked ? [checked] : [];
    }),
  );
}

function barOf(value: unknown): omnigent.PullRequestViewBar | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "toolbar") {
    return Object.freeze({ kind: "toolbar", showTitle: value.showTitle === true });
  }
  if (value.kind === "refresh") {
    const command = planCommandOf(value.command);
    return command
      ? Object.freeze({ kind: "refresh", busy: value.busy === true, command })
      : undefined;
  }
  return undefined;
}

function readContent(value: unknown): omnigent.PullRequestViewContent {
  if (!isRecord(value) || value.kind !== "pullRequests") return LOADING;
  const sessionId = text(value.sessionId, 500);
  if (!sessionId) return LOADING;
  const backCommand = isRecord(value.back) ? planCommandOf(value.back.command) : undefined;
  let linkForm: Content["linkForm"];
  if (isRecord(value.linkForm)) {
    const submit = planCommandOf(value.linkForm.submit);
    const cancel = planCommandOf(value.linkForm.cancel);
    if (submit && cancel) {
      linkForm = Object.freeze({
        open: value.linkForm.open === true,
        placeholder: text(value.linkForm.placeholder, 500) ?? "",
        disabled: value.linkForm.disabled === true,
        pending: value.linkForm.pending === true,
        error: text(value.linkForm.error),
        submit,
        cancel,
      });
    }
  }
  const page = isRecord(value.page)
    ? Object.freeze({
        actions: actionsOf(value.page.actions),
        bar: barOf(value.page.bar),
        body: bodyOf(value.page.body),
      })
    : undefined;
  return Object.freeze({
    kind: "pullRequests",
    sessionId,
    selectedUrl: text(value.selectedUrl),
    actions: actionsOf(value.actions),
    back:
      backCommand && isRecord(value.back)
        ? Object.freeze({ title: text(value.back.title, 200) ?? "", command: backCommand })
        : undefined,
    bar: barOf(value.bar),
    linkForm,
    alert: text(value.alert),
    note: text(value.note, 10_000),
    body: bodyOf(value.body),
    page,
  });
}
