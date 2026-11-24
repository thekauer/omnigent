// The Pull Requests tab: the pull requests of the workspace on screen, as a list
// or the one selected, with Refresh, Link a PR and Unlink, drawn by the host as a
// pull request view. The host draws each pull request's details, its diff and
// review threads, and the merge, label, reviewer and comment controls. The pull
// requests are read and polled while the view shows, as the classic tab's were.
import type * as Omnigent from "omnigent";
import { omnigent } from "./omnigent";
import {
  INITIAL_VIEW_STATE,
  LINK,
  pullRequestsContent,
  REFRESH,
  type Section,
  type SessionViewState,
  UNLINK,
  VIEW_COMMANDS,
  followData,
} from "./pullRequestsModel";

export const VIEW_ID = "omnigent.pull-requests.view";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sectionOf(value: unknown): Section {
  return value === "comments" || value === "changes" ? value : "summary";
}

export function activate(context: Omnigent.ExtensionContext): void {
  const view = omnigent.window.createPullRequestView(VIEW_ID);
  // Each chat session's place in the tab, for the page's lifetime.
  const states = new Map<string, SessionViewState>();
  const stateOf = (sessionId: string) => states.get(sessionId) ?? INITIAL_VIEW_STATE;
  let watch: Omnigent.PullRequestsWatch | undefined;

  // The selection follows each new read of the data, not every redraw.
  let followed: Omnigent.SessionPullRequests | undefined;
  const render = () => {
    const data = omnigent.pullRequests.activeSessionPullRequests;
    if (data && data !== followed) {
      followed = data;
      const next = followData(stateOf(data.sessionId), data);
      if (next !== stateOf(data.sessionId)) states.set(data.sessionId, next);
    }
    view.content = pullRequestsContent(data, data ? stateOf(data.sessionId) : INITIAL_VIEW_STATE);
    if (watch && data) {
      const state = stateOf(data.sessionId);
      watch.focus = {
        sessionId: data.sessionId,
        url: state.selected,
        details: state.showingDetails,
      };
    }
  };
  const update = (sessionId: string, patch: Partial<SessionViewState>) => {
    states.set(sessionId, { ...stateOf(sessionId), ...patch });
    render();
  };
  const sessionArg = (value: unknown): string => {
    if (typeof value !== "string" || value === "") throw new TypeError("needs a session id");
    return value;
  };

  // Held while the view is on screen, so the session's pull requests are read only then.
  const follow = (visible: boolean) => {
    if (visible && !watch) {
      watch = omnigent.pullRequests.watchActiveSessionPullRequests();
      render();
    }
    if (!visible && watch) {
      watch.dispose();
      watch = undefined;
    }
  };

  const register = (id: string, handler: (sessionId: string, ...args: unknown[]) => unknown) =>
    omnigent.commands.registerCommand(id, (sessionId: unknown, ...args: unknown[]) =>
      handler(sessionArg(sessionId), ...args),
    );

  context.subscriptions.push(
    view,
    omnigent.pullRequests.onDidChangeActiveSessionPullRequests(render),
    view.onDidChangeVisibility(({ visible }) => follow(visible)),
    { dispose: () => follow(false) },
    register(VIEW_COMMANDS.select, (sessionId, url) =>
      update(sessionId, {
        selected: typeof url === "string" ? url : undefined,
        showingDetails: true,
        section: "summary",
      }),
    ),
    register(VIEW_COMMANDS.reveal, (sessionId, url, section) =>
      update(sessionId, {
        selected: typeof url === "string" ? url : undefined,
        showingDetails: true,
        section: sectionOf(section),
      }),
    ),
    register(VIEW_COMMANDS.showList, (sessionId) =>
      update(sessionId, { showingDetails: false, section: "summary" }),
    ),
    register(VIEW_COMMANDS.selectSection, (sessionId, section) =>
      update(sessionId, { section: sectionOf(section) }),
    ),
    register(VIEW_COMMANDS.toggleLink, (sessionId) =>
      update(sessionId, { linking: !stateOf(sessionId).linking }),
    ),
    register(VIEW_COMMANDS.openLink, (sessionId) => update(sessionId, { linking: true })),
    register(VIEW_COMMANDS.cancelLink, (sessionId) => update(sessionId, { linking: false })),
    register(VIEW_COMMANDS.submitLink, async (sessionId, url) => {
      const data = omnigent.pullRequests.activeSessionPullRequests;
      if (data?.sessionId === sessionId && data.linkNeedsHost) return;
      update(sessionId, { linkPending: true, linkError: undefined });
      try {
        const result = await omnigent.commands.executeCommand<{ selectedUrl?: string }>(
          LINK,
          sessionId,
          url,
        );
        update(sessionId, {
          linkPending: false,
          linking: false,
          selected: result?.selectedUrl,
          section: "summary",
          linked: result?.selectedUrl ? { url: result.selectedUrl, changes: 0 } : undefined,
        });
      } catch (error) {
        update(sessionId, { linkPending: false, linkError: errorMessage(error) });
      }
    }),
    register(VIEW_COMMANDS.unlink, async (sessionId, url) => {
      update(sessionId, { unlinkPending: true, unlinkError: undefined });
      try {
        const result = await omnigent.commands.executeCommand<{ remaining: string[] }>(
          UNLINK,
          sessionId,
          url,
        );
        const state = stateOf(sessionId);
        update(sessionId, {
          unlinkPending: false,
          ...(url === state.selected ? { selected: result.remaining[0], section: "summary" } : {}),
        });
      } catch (error) {
        update(sessionId, { unlinkPending: false, unlinkError: errorMessage(error) });
      }
    }),
    register(VIEW_COMMANDS.refresh, async (sessionId) => {
      update(sessionId, { refreshing: true });
      try {
        await omnigent.commands.executeCommand(REFRESH, sessionId);
      } finally {
        update(sessionId, { refreshing: false });
      }
    }),
  );
  follow(view.visible);
  render();
}
