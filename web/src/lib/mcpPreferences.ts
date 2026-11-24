// Browser preferences shared with managed deployments; they store service names, never credentials.
const STORAGE_KEY = "omnigent:last-mcp-services";
// The host's MCP connections (`OmnigentHostConfig.mcpConnections`) are another
// namespace than the server registry's services, so they are kept apart.
const CONNECTIONS_STORAGE_KEY = "omnigent:last-mcp-connections";

export function readLastMcpServices(): string[] {
  return readNames(STORAGE_KEY);
}

export function writeLastMcpServices(names: readonly string[]): void {
  writeNames(STORAGE_KEY, names);
}

/** The host MCP connections the last new session used. */
export function readLastMcpConnections(): string[] {
  return readNames(CONNECTIONS_STORAGE_KEY);
}

export function writeLastMcpConnections(names: readonly string[]): void {
  writeNames(CONNECTIONS_STORAGE_KEY, names);
}

function readNames(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function writeNames(key: string, names: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify([...names]));
  } catch {
    // Storage quota or access errors must not break the composer.
  }
}
