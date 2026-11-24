// The Agents tab: the session tree of the workspace on screen. The root ("main")
// session links back to itself, then its sub-agents and theirs, down to
// MAX_TREE_DEPTH levels, each with its status, role or harness icon, preview,
// routed model and cost; a sub-agent opens beside the chat or in its place. As a
// list or a graph ("List view" / "Graph view"). The tab's badge counts the agents
// and how many work.
import type * as Omnigent from "omnigent";
import {
  type AgentNode,
  agentsBadge,
  childItem,
  listMessage,
  MAX_TREE_DEPTH,
  rootItem,
} from "./agentsModel";
import { omnigent } from "./omnigent";

export const VIEW_ID = "omnigent.agents.view";
export const SHOW_LIST_COMMAND = "omnigent.agents.showList";
export const SHOW_GRAPH_COMMAND = "omnigent.agents.showGraph";
/** The context key the List / Graph toggles read. */
export const PRESENTATION_CONTEXT_KEY = "omnigent.agents.presentation";

export function activate(context: Omnigent.ExtensionContext): void {
  const changed = new omnigent.EventEmitter<void>();
  const states = omnigent.TreeItemCollapsibleState;
  const childrenOf = (id: string, depth: number): AgentNode[] =>
    depth > MAX_TREE_DEPTH
      ? []
      : omnigent.sessions
          .getChildSessions(id)
          .sessions.map((session) => ({ kind: "child", session, depth }));
  // A node at the depth cap neither fetches nor shows sub-agents.
  const hasChildren = (id: string, depth: number) =>
    depth < MAX_TREE_DEPTH && omnigent.sessions.getChildSessions(id).sessions.length > 0;

  const provider: Omnigent.TreeDataProvider<AgentNode> = {
    onDidChangeTreeData: changed.event,
    getChildren: (element) => {
      if (!element) {
        const root = omnigent.sessions.activeSessionTreeRoot;
        return root === undefined || view.message !== undefined ? [] : [{ kind: "root", id: root }];
      }
      return element.kind === "root"
        ? childrenOf(element.id, 1)
        : childrenOf(element.session.id, element.depth + 1);
    },
    getTreeItem: (element) =>
      element.kind === "root"
        ? rootItem(
            element.id,
            omnigent.sessions.getSession(element.id),
            hasChildren(element.id, 0),
            states,
          )
        : childItem(element.session, hasChildren(element.session.id, element.depth), states),
  };
  const view = omnigent.window.createTreeView(VIEW_ID, { treeDataProvider: provider });

  const rebuild = () => {
    const root = omnigent.sessions.activeSessionTreeRoot;
    const list = root === undefined ? undefined : omnigent.sessions.getChildSessions(root);
    view.badge = agentsBadge(list?.sessions ?? []);
    view.message = list ? listMessage(list) : undefined;
    changed.fire();
  };
  const present = (presentation: "tree" | "graph") => {
    view.presentation = presentation;
    void omnigent.commands.executeCommand("setContext", PRESENTATION_CONTEXT_KEY, presentation);
  };

  context.subscriptions.push(
    view,
    changed,
    omnigent.commands.registerCommand(SHOW_LIST_COMMAND, () => present("tree")),
    omnigent.commands.registerCommand(SHOW_GRAPH_COMMAND, () => present("graph")),
    omnigent.sessions.onDidChangeActiveSessionTree(rebuild),
    omnigent.sessions.onDidChangeChildSessions(rebuild),
  );
  present("tree");
  rebuild();
}
