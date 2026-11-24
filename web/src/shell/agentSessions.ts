// Agent sessions as the extension API hands them out: a session's sub-agents and
// its own details in plain data, named, iconed and classified the way the Agents
// tab shows them (labels, harness glyphs, status, preview, routed model, cost).

import type * as omnigent from "omnigent";
import { shortModelName } from "@/components/CostRoutingControl";
import type { AgentCost, AgentCosts } from "@/hooks/useAgentCosts";
import type { ChildSessionInfo } from "@/hooks/useChildSessions";
import {
  nativeCodingAgentForSubagentWrapper,
  nativeCodingAgentForWrapper,
  WRAPPER_LABEL_KEY,
} from "@/lib/nativeCodingAgents";
import type { Session, SessionItem } from "@/lib/types";
import { childPrimaryLabel } from "./subagentLabel";
import { type AgentStatus, childStatus, sessionStatus } from "./subagentStatus";

// Pi children are scaffold (no wrapper label); the spawn title's agent-type head (``tool``) is the signal.
const PI_AGENT_NAME = "pi";
// Matches the server's child-session preview, so the root reads like its children.
const MAIN_PREVIEW_MAX_CHARS = 150;

/**
 * The harness identity of a coding child session (full native sessions and
 * their native sub-agents), so every coding agent shows its harness glyph.
 */
export function childHarnessAgent(child: ChildSessionInfo): omnigent.AgentIcon | undefined {
  const wrapper = child.labels?.[WRAPPER_LABEL_KEY];
  const nativeAgent =
    nativeCodingAgentForWrapper(wrapper) ?? nativeCodingAgentForSubagentWrapper(wrapper);
  if (nativeAgent) return { agent: nativeAgent.agentName, harness: nativeAgent.harness };
  // Exact match: substring checks would false-match names like "pipeline".
  if (child.tool === PI_AGENT_NAME) return { agent: "pi-native-ui", harness: "pi-native" };
  return undefined;
}

/**
 * One line of a session's latest message from its snapshot items, as the
 * server previews a child session: the text blocks of the newest `message`.
 */
export function mainMessagePreview(items: readonly SessionItem[] | undefined): string | null {
  if (!items) return null;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type !== "message") continue;
    const content = (item as { data?: { content?: unknown } }).data?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .map((block) =>
        block && typeof block === "object" && "text" in block
          ? String((block as { text: unknown }).text)
          : "",
      )
      .join("")
      .trim();
    if (text) {
      return text.length > MAIN_PREVIEW_MAX_CHARS
        ? `${text.slice(0, MAIN_PREVIEW_MAX_CHARS)}…`
        : text;
    }
  }
  return null;
}

export function toAgentStatus(status: AgentStatus): omnigent.AgentStatus {
  return Object.freeze({
    state: status.activity,
    label: status.label,
    ...(status.details === undefined ? {} : { detail: status.details }),
  });
}

function toCost(cost: AgentCost | undefined): omnigent.AgentCost | undefined {
  return cost ? Object.freeze({ usd: cost.costUsd, estimated: cost.estimated }) : undefined;
}

export function toChildSession(
  child: ChildSessionInfo,
  costs: AgentCosts | null | undefined,
): omnigent.ChildSession {
  const routed = child.routed_model;
  const agent = childHarnessAgent(child);
  return Object.freeze({
    id: child.id,
    label: childPrimaryLabel(child),
    title: child.title,
    tool: child.tool,
    agent: agent ? Object.freeze(agent) : undefined,
    status: toAgentStatus(childStatus(child)),
    busy: child.busy,
    preview: child.last_message_preview ?? undefined,
    routedModel: routed ? Object.freeze({ id: routed, label: shortModelName(routed) }) : undefined,
    cost: toCost(costs?.get(child.id)),
  });
}

export function toSessionDetails(
  session: Session,
  costs: AgentCosts | null | undefined,
): omnigent.SessionDetails {
  // Same wrapper-label probe the sidebar uses to tell a native coding agent's session.
  const nativeAgent = nativeCodingAgentForWrapper(session.labels?.[WRAPPER_LABEL_KEY]);
  return Object.freeze({
    id: session.id,
    label: nativeAgent?.displayName ?? session.agentName ?? undefined,
    agent: Object.freeze({
      agent: session.agentName ?? nativeAgent?.agentName ?? "",
      harness: session.harness ?? nativeAgent?.harness ?? null,
    }),
    kind: nativeAgent
      ? `${nativeAgent.key}-native`
      : session.agentName === "nessie"
        ? "nessie"
        : "agent",
    preview: mainMessagePreview(session.items) ?? undefined,
    status: toAgentStatus(sessionStatus(session.status, session.lastTaskError)),
    cost: toCost(costs?.get(session.id)),
  });
}
