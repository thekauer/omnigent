// Child-session summaries and session snapshots for tests of the Agents data.
import type { ChildSessionInfo } from "@/hooks/useChildSessions";
import type { Session } from "@/lib/types";

/** A full child summary with the fields a test does not care about defaulted. */
export function childInfo(overrides: Partial<ChildSessionInfo> & { id: string }): ChildSessionInfo {
  return {
    title: null,
    task_summary: null,
    tool: null,
    session_name: null,
    current_task_status: null,
    busy: false,
    last_message_preview: null,
    pending_elicitations_count: 0,
    ...overrides,
  };
}

export function rootSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "conv_root",
    agentId: "ag_root",
    agentName: null,
    runnerId: null,
    status: "idle",
    createdAt: 0,
    title: null,
    labels: {},
    items: [],
    pendingElicitations: [],
    permissionLevel: 4,
    parentSessionId: null,
    subAgentName: null,
    kind: "default",
    ...overrides,
  } as unknown as Session;
}
