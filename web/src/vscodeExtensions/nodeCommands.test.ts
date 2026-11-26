// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createNodeCommandRoute, type CommandEndpoint } from "./nodeCommands";

const endpoint: CommandEndpoint = {
  url: "/__omnigent/extensions",
  token: "test-token",
  tokenHeader: "x-omnigent-extension-token",
  nodeCommands: { "pub.a": ["pub.a.run"] },
};

/** A streamed response whose body arrives in the given chunks. */
function streamed(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "application/x-ndjson" } });
}

describe("createNodeCommandRoute", () => {
  it("knows each command's extension", () => {
    const route = createNodeCommandRoute(endpoint, vi.fn());
    expect(route.ownerOf("pub.a.run")).toBe("pub.a");
    expect(route.ownerOf("pub.a.other")).toBeUndefined();
  });

  it("posts the arguments with the token and streams progress until the result", async () => {
    const fetchImpl = vi.fn(async () =>
      streamed([
        '{"type":"progress","scope":1,"kind":"start","title":"T"}\n{"type":"prog',
        'ress","scope":1,"kind":"report","message":"step"}\n',
        '{"type":"result","value":{"ok":true}}\n',
      ]),
    );
    const route = createNodeCommandRoute(endpoint, fetchImpl);
    const onProgress = vi.fn();
    await expect(route.execute("pub.a.run", [{ name: "x" }], onProgress)).resolves.toEqual({
      ok: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith("/__omnigent/extensions/pub.a/commands/pub.a.run", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-omnigent-extension-token": "test-token" },
      body: '{"args":[{"name":"x"}]}',
    });
    expect(onProgress.mock.calls.map(([event]) => [event.kind, event.message])).toEqual([
      ["start", undefined],
      ["report", "step"],
    ]);
  });

  it("resolves undefined for a result without a value", async () => {
    const route = createNodeCommandRoute(endpoint, async () => streamed(['{"type":"result"}']));
    await expect(route.execute("pub.a.run", [], vi.fn())).resolves.toBeUndefined();
  });

  it("rejects with the command's error", async () => {
    const route = createNodeCommandRoute(endpoint, async () =>
      streamed(['{"type":"error","message":"it broke"}\n']),
    );
    await expect(route.execute("pub.a.run", [], vi.fn())).rejects.toThrow("it broke");
  });

  it("rejects with the endpoint's error for a refused request", async () => {
    const route = createNodeCommandRoute(
      endpoint,
      async () => new Response('{"error":"missing or wrong extension token"}', { status: 403 }),
    );
    await expect(route.execute("pub.a.run", [], vi.fn())).rejects.toThrow(
      "command 'pub.a.run' failed: missing or wrong extension token",
    );
  });

  it("rejects when the stream ends without a result", async () => {
    const route = createNodeCommandRoute(endpoint, async () =>
      streamed(['{"type":"progress","scope":1,"kind":"start"}\n']),
    );
    await expect(route.execute("pub.a.run", [], vi.fn())).rejects.toThrow(
      "command 'pub.a.run' ended without a result",
    );
  });

  it("rejects an unknown command without a request", async () => {
    const fetchImpl = vi.fn();
    const route = createNodeCommandRoute(endpoint, fetchImpl);
    await expect(route.execute("pub.b.run", [], vi.fn())).rejects.toThrow("not found");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
