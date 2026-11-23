import { describe, expect, it, vi } from "vitest";
import { CommandRegistry, toPlainJson } from "./commands";
import type { NodeCommandRoute } from "./nodeCommands";

function nodeRoute(owners: Record<string, string>): NodeCommandRoute & {
  execute: ReturnType<typeof vi.fn>;
} {
  return {
    ownerOf: (command) => owners[command],
    execute: vi.fn(async (command: string, args: readonly unknown[]) => ({ command, args })),
  };
}

describe("CommandRegistry", () => {
  it("runs a registered command with JSON copies of its arguments and result", async () => {
    const registry = new CommandRegistry();
    const result = { nested: { value: 1 } };
    let received: unknown;
    const handler = vi.fn((...args: unknown[]) => {
      received = structuredClone(args[0]);
      (args[0] as { mutated?: boolean }).mutated = true;
      return result;
    });
    registry.register("pub.a", "pub.a.run", handler);
    const argument = { input: [1, 2] };
    const answer = await registry.execute("pub.a.run", [argument], vi.fn());
    expect(received).toEqual({ input: [1, 2] });
    expect(argument).toEqual({ input: [1, 2] });
    expect(answer).toEqual(result);
    expect(answer).not.toBe(result);
  });

  it("unregisters on dispose, and a disposed registration cannot remove its successor", async () => {
    const registry = new CommandRegistry();
    const first = registry.register("pub.a", "pub.a.run", () => 1);
    first.dispose();
    expect(registry.has("pub.a.run")).toBe(false);
    await expect(registry.execute("pub.a.run", [], vi.fn())).rejects.toThrow(
      "command 'pub.a.run' not found",
    );
    registry.register("pub.a", "pub.a.run", () => 2);
    first.dispose();
    await expect(registry.execute("pub.a.run", [], vi.fn())).resolves.toBe(2);
  });

  it("refuses duplicate ids, including ids a Node entry registered", () => {
    const registry = new CommandRegistry(nodeRoute({ "pub.b.node": "pub.b" }));
    registry.register("pub.a", "pub.a.run", () => 1);
    expect(() => registry.register("pub.b", "pub.a.run", () => 2)).toThrow(
      "command 'pub.a.run' already exists",
    );
    expect(() => registry.register("pub.a", "pub.b.node", () => 2)).toThrow(
      "command 'pub.b.node' already exists",
    );
  });

  it("refuses an empty id or a missing handler", () => {
    const registry = new CommandRegistry();
    expect(() => registry.register("pub.a", "", () => 1)).toThrow(TypeError);
    expect(() =>
      registry.register("pub.a", "pub.a.x", undefined as unknown as () => unknown),
    ).toThrow(TypeError);
  });

  it("routes a Node command to the dev server with plain arguments and its progress", async () => {
    const route = nodeRoute({ "pub.b.node": "pub.b" });
    const registry = new CommandRegistry(route);
    const onProgress = vi.fn();
    await expect(registry.execute("pub.b.node", [{ name: "x" }], onProgress)).resolves.toEqual({
      command: "pub.b.node",
      args: [{ name: "x" }],
    });
    expect(route.execute).toHaveBeenCalledWith("pub.b.node", [{ name: "x" }], onProgress);
  });

  it("prefers a page command and rejects unknown ones", async () => {
    const registry = new CommandRegistry(nodeRoute({}));
    await expect(registry.execute("nope", [], vi.fn())).rejects.toThrow("command 'nope' not found");
  });

  it("rejects arguments that are not JSON", async () => {
    const registry = new CommandRegistry();
    registry.register("pub.a", "pub.a.run", () => 1);
    await expect(registry.execute("pub.a.run", [10n], vi.fn())).rejects.toThrow(
      /command arguments must be plain JSON/,
    );
  });

  it("propagates a handler's error", async () => {
    const registry = new CommandRegistry();
    registry.register("pub.a", "pub.a.fail", () => {
      throw new Error("handler failed");
    });
    await expect(registry.execute("pub.a.fail", [], vi.fn())).rejects.toThrow("handler failed");
  });
});

describe("toPlainJson", () => {
  it("keeps undefined and copies values", () => {
    expect(toPlainJson(undefined, "x")).toBeUndefined();
    expect(toPlainJson({ a: [1, { b: null }] }, "x")).toEqual({ a: [1, { b: null }] });
  });
});
