// The Tasks tab: the tasks of the workspace on screen, its plan's steps or the
// agent's own task list, drawn by the host as a plan view: the summary and
// progress strip, one row per task with its history and ⋯ action, the plan's
// Stop or Continue, Save as workflow and its graph. The tasks load while the
// view shows, as the classic tab's journal did.
import type * as Omnigent from "omnigent";
import { omnigent } from "./omnigent";
import { planContent } from "./tasksModel";

export const VIEW_ID = "omnigent.tasks.view";

export function activate(context: Omnigent.ExtensionContext): void {
  const view = omnigent.window.createPlanView(VIEW_ID);
  const render = () => {
    view.content = planContent(omnigent.sessions.activeSessionTasks);
  };
  // Held while the view is on screen, so the session's journal loads only then.
  let watch: Omnigent.Disposable | undefined;
  const follow = (visible: boolean) => {
    if (visible && !watch) watch = omnigent.sessions.watchActiveSessionTasks();
    if (!visible && watch) {
      watch.dispose();
      watch = undefined;
    }
  };
  context.subscriptions.push(
    view,
    omnigent.sessions.onDidChangeActiveSessionTasks(render),
    view.onDidChangeVisibility(({ visible }) => follow(visible)),
    { dispose: () => follow(false) },
  );
  follow(view.visible);
  render();
}
