// The window's command registry, shared by every extension as in VS Code.
// Commands registered in the page run here; the rest go to the Node entries'
// commands through the dev server (nodeCommands.ts).
import { Disposable } from "./base";
import type { NodeCommandRoute, NodeProgressListener } from "./nodeCommands";

export type CommandHandler = (...args: unknown[]) => unknown;

/** A JSON copy of `value`: arguments and results cross the API as plain data. */
export function toPlainJson(value: unknown, what: string): unknown {
  if (value === undefined) return undefined;
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(
      `${what} must be plain JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return json === undefined ? undefined : (JSON.parse(json) as unknown);
}

export class CommandRegistry {
  private readonly handlers = new Map<string, { owner: string; handler: CommandHandler }>();
  private readonly node: NodeCommandRoute | undefined;

  constructor(node?: NodeCommandRoute) {
    this.node = node;
  }

  /** Registers `id` for `owner`; an id that exists, here or on the Node side, throws. */
  register(owner: string, id: string, handler: CommandHandler): Disposable {
    if (typeof id !== "string" || id === "") throw new TypeError("command id must be a string");
    if (typeof handler !== "function") throw new TypeError("command handler must be a function");
    if (this.handlers.has(id) || this.node?.ownerOf(id) !== undefined) {
      throw new Error(`command '${id}' already exists`);
    }
    const entry = { owner, handler };
    this.handlers.set(id, entry);
    return new Disposable(() => {
      if (this.handlers.get(id) === entry) this.handlers.delete(id);
    });
  }

  has(id: string): boolean {
    return this.handlers.has(id) || this.node?.ownerOf(id) !== undefined;
  }

  /** Runs `id` with JSON copies of `args`; resolves with a JSON copy of its result. */
  async execute(
    id: string,
    args: readonly unknown[],
    onNodeProgress: NodeProgressListener,
  ): Promise<unknown> {
    const plainArgs = toPlainJson([...args], "command arguments") as unknown[];
    const entry = this.handlers.get(id);
    if (entry) {
      return toPlainJson(await entry.handler(...plainArgs), `the result of '${id}'`);
    }
    if (this.node?.ownerOf(id) !== undefined) {
      return this.node.execute(id, plainArgs, onNodeProgress);
    }
    throw new Error(`command '${id}' not found`);
  }
}
