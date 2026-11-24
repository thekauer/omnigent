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

/** Command ids only built-in owners may register, as VS Code keeps its own namespace. */
export const RESERVED_COMMAND_PREFIX = "omnigent.";

/**
 * Why `owner`, not built in, may not register `id`, if it may not: an
 * extension's commands start with its own id (`<publisher>.<name>.`), and the
 * `omnigent.` namespace is the host's.
 */
export function commandIdProblem(owner: string, id: string): string | undefined {
  if (id.startsWith(RESERVED_COMMAND_PREFIX)) {
    return `command '${id}': the '${RESERVED_COMMAND_PREFIX}' namespace is reserved for built-in commands`;
  }
  if (!id.startsWith(`${owner}.`)) {
    return `command '${id}' must start with the extension id ('${owner}.')`;
  }
  return undefined;
}

export interface CommandRegistrationOptions {
  /** A built-in owner: any id, and the shell's bridge may run it. */
  readonly builtIn?: boolean;
}

export class CommandRegistry {
  private readonly handlers = new Map<
    string,
    { owner: string; handler: CommandHandler; builtIn: boolean }
  >();
  private node: NodeCommandRoute | undefined;

  constructor(node?: NodeCommandRoute) {
    this.node = node;
  }

  /** Routes unknown commands to the Node entries' commands (dev server only). */
  setNodeRoute(node: NodeCommandRoute): void {
    this.node = node;
  }

  /**
   * Registers `id` for `owner`; an id that exists, here or on the Node side,
   * throws, and so does an id outside a non-built-in owner's namespace.
   */
  register(
    owner: string,
    id: string,
    handler: CommandHandler,
    options: CommandRegistrationOptions = {},
  ): Disposable {
    if (typeof id !== "string" || id === "") throw new TypeError("command id must be a string");
    if (typeof handler !== "function") throw new TypeError("command handler must be a function");
    const builtIn = options.builtIn === true;
    const problem = builtIn ? undefined : commandIdProblem(owner, id);
    if (problem !== undefined) throw new Error(problem);
    if (this.handlers.has(id) || this.node?.ownerOf(id) !== undefined) {
      throw new Error(`command '${id}' already exists`);
    }
    const entry = { owner, handler, builtIn };
    this.handlers.set(id, entry);
    return new Disposable(() => {
      if (this.handlers.get(id) === entry) this.handlers.delete(id);
    });
  }

  /** Whether a built-in owner registered `id` in the page. */
  isBuiltIn(id: string): boolean {
    return this.handlers.get(id)?.builtIn === true;
  }

  /** Runs `id` as {@link execute} does, only when a built-in owns it (the shell's bridge). */
  executeBuiltIn(id: string, args: readonly unknown[]): Promise<unknown> {
    if (!this.isBuiltIn(id)) {
      return Promise.reject(new Error(`command '${id}' is not a built-in command`));
    }
    return this.execute(id, args, () => {});
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
