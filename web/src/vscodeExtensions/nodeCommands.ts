// Runs commands registered by extensions' Node entries, through the dev
// server's command endpoint (vite.omnigentNodeExtensions.ts). Dev only.

/** What the dev plugin's virtual module tells the page. Plain data. */
export interface CommandEndpoint {
  /** Base path; commands are at `<url>/<extension id>/commands/<command id>`. */
  readonly url: string;
  /** Per-boot token the endpoint requires. */
  readonly token: string;
  readonly tokenHeader: string;
  /** Node command ids by extension id, as registered when the page loaded. */
  readonly nodeCommands: Readonly<Record<string, readonly string[]>>;
}

/** A Node `withProgress` event; `scope` tells concurrent progress apart. */
export interface NodeProgressEvent {
  readonly scope: number;
  readonly kind: "start" | "report" | "end";
  readonly title?: string;
  readonly message?: string;
  readonly increment?: number;
  readonly error?: string;
}

export type NodeProgressListener = (event: NodeProgressEvent) => void;

export interface NodeCommandRoute {
  /** The extension that registered `command` on the Node side, if any. */
  ownerOf: (command: string) => string | undefined;
  execute: (
    command: string,
    args: readonly unknown[],
    onProgress: NodeProgressListener,
  ) => Promise<unknown>;
}

type StreamLine =
  | ({ type: "progress" } & NodeProgressEvent)
  | { type: "result"; value?: unknown }
  | { type: "error"; message: string };

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON: fall back to the status line.
  }
  return `${response.status} ${response.statusText}`.trim();
}

/**
 * `fetchImpl` reaches the dev server itself (same origin), not the backend, so
 * it is the page's own fetch rather than the host transport.
 */
export function createNodeCommandRoute(
  endpoint: CommandEndpoint,
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>,
): NodeCommandRoute {
  const owners = new Map<string, string>();
  for (const [extensionId, commands] of Object.entries(endpoint.nodeCommands)) {
    for (const command of commands) owners.set(command, extensionId);
  }
  return {
    ownerOf: (command) => owners.get(command),
    async execute(command, args, onProgress) {
      const owner = owners.get(command);
      if (owner === undefined) throw new Error(`command '${command}' not found`);
      const url = `${endpoint.url}/${encodeURIComponent(owner)}/commands/${encodeURIComponent(command)}`;
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", [endpoint.tokenHeader]: endpoint.token },
        body: JSON.stringify({ args }),
      });
      if (!response.ok || response.body === null) {
        throw new Error(`command '${command}' failed: ${await errorMessage(response)}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      for (;;) {
        // Lines arrive in order; each read waits for the next chunk.
        // oxlint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        buffered += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = done ? "" : (lines.pop() ?? "");
        for (const raw of lines) {
          if (raw.trim() === "") continue;
          const line = JSON.parse(raw) as StreamLine;
          if (line.type === "progress") {
            try {
              onProgress({
                scope: line.scope,
                kind: line.kind,
                title: line.title,
                message: line.message,
                increment: line.increment,
                error: line.error,
              });
            } catch (error) {
              console.error("[omnigent-extensions] progress listener threw", error);
            }
          } else if (line.type === "result") {
            void reader.cancel().catch(() => {});
            return line.value;
          } else {
            void reader.cancel().catch(() => {});
            throw new Error(line.message);
          }
        }
        if (done) break;
      }
      throw new Error(`command '${command}' ended without a result`);
    },
  };
}
