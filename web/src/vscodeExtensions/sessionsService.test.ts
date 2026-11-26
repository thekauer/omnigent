// @vitest-environment node
import type * as omnigent from "omnigent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conversationRegistry } from "@/store/conversationRegistry";
import { handleSessionEvent, useChatStore } from "@/store/chatStore";
import { SessionsService, chatStoreSessionSource } from "./sessionsService";

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const MODEL_USAGE: omnigent.ModelUsage = {
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
  totalCostUsd: 1.5,
};

/**
 * Make `id` the conversation on screen the way a route bind does: the root store
 * switches, then mirrors the conversation's own entry state.
 */
function showConversation(id: string | null, entryState: Record<string, unknown> = {}) {
  useChatStore.setState({ conversationId: id });
  if (id === null) return;
  conversationRegistry.peek(id)!.setState({ tokensUsed: -1, ...entryState });
}

describe("SessionsService over the chat store", () => {
  let service: SessionsService;
  let sessionEvents: (omnigent.Session | undefined)[];
  let usageEvents: omnigent.SessionUsage[];

  beforeEach(() => {
    showConversation(null);
    useChatStore.setState({
      sessionCostUsd: null,
      sessionUsageByModel: null,
      sessionCostHidden: false,
    });
    service = new SessionsService(chatStoreSessionSource());
    sessionEvents = [];
    usageEvents = [];
    service.onDidChangeActiveSession((session) => sessionEvents.push(session));
    service.onDidChangeUsage((usage) => usageEvents.push(usage));
  });

  afterEach(() => {
    service.dispose();
    conversationRegistry.clear();
  });

  it("tracks the active session and fires on change, including to none", async () => {
    expect(service.activeSession).toBeUndefined();
    showConversation("conv_a");
    await flush();
    expect(service.activeSession).toEqual({ id: "conv_a" });
    expect(sessionEvents).toEqual([{ id: "conv_a" }]);

    showConversation(null);
    await flush();
    expect(service.activeSession).toBeUndefined();
    expect(service.activeSessionUsage).toBeUndefined();
    expect(sessionEvents).toEqual([{ id: "conv_a" }, undefined]);
  });

  it("fires usage from the SSE session_usage handler", async () => {
    showConversation("conv_a");
    await flush();
    usageEvents.length = 0;

    handleSessionEvent({
      type: "session_usage",
      conversationId: "conv_a",
      totalCostUsd: 2.5,
      usageByModel: { "model-a": MODEL_USAGE },
    });
    await flush();

    expect(useChatStore.getState().sessionCostUsd).toBe(2.5);
    expect(usageEvents).toEqual([
      {
        sessionId: "conv_a",
        totalCostUsd: 2.5,
        costHidden: false,
        usageByModel: { "model-a": MODEL_USAGE },
      },
    ]);
    expect(service.activeSessionUsage).toEqual(usageEvents[0]);
    // Plain data: frozen copies, never the store's own objects.
    expect(Object.isFrozen(usageEvents[0])).toBe(true);
    expect(usageEvents[0]!.usageByModel).not.toBe(useChatStore.getState().sessionUsageByModel);
  });

  it("reports hidden cost from the SSE handler", async () => {
    showConversation("conv_a");
    handleSessionEvent({ type: "session_usage", conversationId: "conv_a", totalCostUsd: 3 });
    await flush();
    handleSessionEvent({ type: "session_usage", conversationId: "conv_a", costHidden: true });
    await flush();
    expect(useChatStore.getState().sessionCostHidden).toBe(true);
    expect(usageEvents.at(-1)).toMatchObject({
      sessionId: "conv_a",
      totalCostUsd: null,
      costHidden: true,
    });
  });

  it("coalesces a burst of store writes into one usage event", async () => {
    showConversation("conv_a");
    await flush();
    usageEvents.length = 0;
    useChatStore.setState({ sessionCostUsd: 1 });
    useChatStore.setState({ sessionCostUsd: 2 });
    useChatStore.setState({ tokensUsed: 5 });
    await flush();
    expect(usageEvents.map((usage) => usage.totalCostUsd)).toEqual([2]);
  });

  it("fires usage for the new session on a switch, null when unpriced", async () => {
    showConversation("conv_a");
    useChatStore.setState({ sessionCostUsd: 4 });
    await flush();
    sessionEvents.length = 0;
    usageEvents.length = 0;

    // conv_b's own entry has no cost yet (unpriced or still loading).
    showConversation("conv_b");
    await flush();

    expect(sessionEvents).toEqual([{ id: "conv_b" }]);
    expect(usageEvents).toEqual([
      { sessionId: "conv_b", totalCostUsd: null, costHidden: false, usageByModel: null },
    ]);
  });

  it("ignores store writes that do not touch the session or usage", async () => {
    showConversation("conv_a");
    await flush();
    usageEvents.length = 0;
    sessionEvents.length = 0;
    useChatStore.setState({ tokensUsed: 42 });
    await flush();
    expect(usageEvents).toEqual([]);
    expect(sessionEvents).toEqual([]);
  });
});
