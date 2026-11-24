// The pure part of the Agents view: tree items for the root session and its
// sub-agents (role icons, routed model and cost), and the tab's badge.
import type * as Omnigent from "omnigent";

/** Levels of sub-agents below the root that are fetched and drawn. */
export const MAX_TREE_DEPTH = 3;
export const OPEN_SUBAGENT_COMMAND = "omnigent.openSubagent";

export type AgentNode =
  { kind: "root"; id: string } | { kind: "child"; session: Omnigent.ChildSession; depth: number };

/**
 * A category icon for a sub-agent type, so a mix of agents reads by role at a
 * glance (many same-type "Explore" agents share it; the preview tells them apart).
 */
export function iconForAgentType(tool: string | null): string {
  const type = (tool ?? "").toLowerCase();
  if (type.includes("explore")) return "search";
  if (type.includes("research")) return "book-open";
  if (type.includes("plan") || type.includes("architect")) return "compass";
  if (type.includes("review")) return "scan-search";
  if (type.includes("test")) return "flask-conical";
  if (type.includes("doc") || type.includes("writ")) return "file-text";
  if (["code", "eng", "dev", "front", "back"].some((part) => type.includes(part))) return "code";
  return "bot";
}

/** As the session total shows it: `<$0.01` for a fraction of a cent, else two decimals. */
export function formatCostUsd(usd: number): string {
  return usd > 0 && usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

/** `"$0.42"`, `"~$0.10"` for an estimate, nothing while unknown. */
export function costLabel(cost: Omnigent.AgentCost | undefined): string | undefined {
  if (typeof cost?.usd !== "number") return undefined;
  return `${cost.estimated ? "~" : ""}${formatCostUsd(cost.usd)}`;
}

function costPart(cost: Omnigent.AgentCost | undefined): Omnigent.TreeItemDecorationPart[] {
  const label = costLabel(cost);
  return label === undefined ? [] : [{ text: label }];
}

export function rootItem(
  id: string,
  details: Omnigent.SessionDetails | undefined,
  hasChildren: boolean,
  states: typeof Omnigent.TreeItemCollapsibleState,
): Omnigent.TreeItem {
  const parts = costPart(details?.cost);
  return {
    id: `session:${id}`,
    // "main" while the session loads or when it carries no agent name.
    label: details?.label ?? "main",
    resourceUri: { scheme: "session", path: id },
    iconPath: details?.agent ?? { agent: "" },
    ...(details?.preview ? { description: details.preview } : {}),
    ...(details ? { status: details.status } : {}),
    ...(parts.length > 0 ? { decoration: { parts } } : {}),
    // Names what runs the session (`claude-native`, `nessie`, `agent`), as the row's context value.
    contextValue: details?.kind ?? "agent",
    collapsibleState: hasChildren ? states.Expanded : states.None,
  };
}

export function childItem(
  session: Omnigent.ChildSession,
  hasChildren: boolean,
  states: typeof Omnigent.TreeItemCollapsibleState,
): Omnigent.TreeItem {
  const parts: Omnigent.TreeItemDecorationPart[] = [
    // The model an intelligent router picked for this sub-agent.
    ...(session.routedModel
      ? [
          {
            text: session.routedModel.label,
            tooltip: `Smart routing picked ${session.routedModel.id}`,
          },
        ]
      : []),
    ...costPart(session.cost),
  ];
  return {
    id: `session:${session.id}`,
    label: session.label,
    resourceUri: { scheme: "session", path: session.id },
    iconPath: session.agent ?? iconForAgentType(session.tool),
    ...(session.preview ? { description: session.preview } : {}),
    status: session.status,
    ...(parts.length > 0 ? { decoration: { parts } } : {}),
    command: { command: OPEN_SUBAGENT_COMMAND, title: "Open", arguments: [session.id] },
    collapsibleState: hasChildren ? states.Expanded : states.None,
  };
}

/** The tab's badge: every agent, the main one included, and how many work ("2/5"). */
export function agentsBadge(children: readonly Omnigent.ChildSession[]): Omnigent.ViewBadge {
  const total = children.length + 1;
  const working = children.filter((child) => child.busy).length;
  return working > 0
    ? {
        value: total,
        tooltip: `${working}/${total}`,
        label: `${working}/${total}`,
        tone: "success",
      }
    : { value: total, tooltip: `${total}`, tone: "muted" };
}

/** The line above the rows while the first list loads or when it failed. */
export function listMessage(list: Omnigent.ChildSessionList): string | undefined {
  if (list.sessions.length > 0) return undefined;
  if (list.loading) return "Loading…";
  if (list.error !== undefined) return "Failed to load agents.";
  return undefined;
}
