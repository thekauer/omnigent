// @vitest-environment node
// The Node extension host survives and recovers from misbehaving extensions:
// uncaught throws, process.exit, hard crashes (auto-restart with backoff),
// hung commands (per-call timeout, cancel on disconnect, forced restart), a
// blocked event loop (heartbeat kill and restart), and
// the command endpoint answers 503 while the host is down and 400 for a bad path.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  COMMAND_TOKEN_HEADER,
  createCommandEndpoint,
  NodeExtensionHost,
  type NodeExtensionDescription,
  type NodeExtensionHostOptions,
} from "../../vite.omnigentNodeExtensions";

const NODE_ENTRY = `
import { spawn } from "node:child_process";
import * as omnigent from "omnigent/node";
export function activate(context) {
  const register = (id, handler, options) =>
    context.subscriptions.push(omnigent.commands.registerCommand(id, handler, options));
  register("acme.crash.echo", (value) => ({ value, pid: process.pid }));
  register("acme.crash.throwLater", () => {
    setTimeout(() => { throw new Error("boom later"); }, 10);
    return "scheduled";
  });
  register("acme.crash.exit", () => {
    process.exit(3);
    return "still here";
  });
  register("acme.crash.exitLater", () => {
    setTimeout(() => process.exit(4), 10);
    return "scheduled";
  });
  register("acme.crash.kill", () => {
    setTimeout(() => process.kill(process.pid, "SIGKILL"), 10);
    return "scheduled";
  });
  register("acme.crash.hang", () => new Promise(() => {}));
  register("acme.crash.slow", () => new Promise(() => {}), { timeoutMs: 200 });
  register("acme.crash.big", (bytes) => "x".repeat(bytes));
  register("acme.crash.partialLines", () => {
    process.stdout.write("hel");
    setTimeout(() => process.stdout.write("lo\\nwor"), 20);
    setTimeout(() => process.stdout.write("ld\\n"), 40);
    return "written";
  });
  register("acme.crash.spin", (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {}
    return "spun";
  });
  register("acme.crash.wait", (ms) => new Promise((resolve) => setTimeout(() => resolve("waited"), ms)));
  register("acme.crash.spawnSleeper", () => {
    const child = spawn("sleep", ["60"], { stdio: "ignore" });
    return child.pid;
  });
}
`;

const OTHER_ENTRY = `
import * as omnigent from "omnigent/node";
export function activate(context) {
  context.subscriptions.push(
    omnigent.commands.registerCommand("acme.other.echo", (value) => ({ value, pid: process.pid })),
  );
}
`;

let workspace: string;
let description: NodeExtensionDescription;
let other: NodeExtensionDescription;

beforeAll(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "omnigent-node-host-robust-"));
  const folder = path.join(workspace, "crash");
  mkdirSync(path.join(folder, "src"), { recursive: true });
  writeFileSync(path.join(folder, "src", "node.js"), NODE_ENTRY);
  writeFileSync(path.join(folder, "package.json"), JSON.stringify({ type: "module" }));
  description = {
    id: "acme.crash",
    version: "1.0.0",
    directory: folder,
    mainPath: path.join(folder, "src", "node.js"),
  };
  const otherFolder = path.join(workspace, "other");
  mkdirSync(otherFolder, { recursive: true });
  writeFileSync(path.join(otherFolder, "node.js"), OTHER_ENTRY);
  writeFileSync(path.join(otherFolder, "package.json"), JSON.stringify({ type: "module" }));
  other = {
    id: "acme.other",
    version: "1.0.0",
    directory: otherFolder,
    mainPath: path.join(otherFolder, "node.js"),
  };
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

interface Logged {
  level: "log" | "warn" | "error";
  line: string;
}

const hosts: NodeExtensionHost[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.stop();
});

function makeHost(options: NodeExtensionHostOptions = {}) {
  const logged: Logged[] = [];
  const host = new NodeExtensionHost({
    restartDelayMs: 50,
    ...options,
    log: {
      log: (line: string) => logged.push({ level: "log", line }),
      warn: (line: string) => logged.push({ level: "warn", line }),
      error: (line: string) => logged.push({ level: "error", line }),
    },
  });
  hosts.push(host);
  return { host, logged };
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    // oxlint-disable-next-line no-await-in-loop
    await sleep(20);
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const echoPid = async (host: NodeExtensionHost) =>
  ((await host.execute("acme.crash", "acme.crash.echo", [1])) as { pid: number }).pid;

describe("NodeExtensionHost crash handling", () => {
  it("logs an uncaught throw from a command's timer against the extension and keeps running", async () => {
    const { host, logged } = makeHost();
    await host.start([description]);
    const pid = await echoPid(host);
    expect(await host.execute("acme.crash", "acme.crash.throwLater", [])).toBe("scheduled");
    await waitFor(() => logged.some(({ line }) => line.includes("boom later")));
    const report = logged.find(({ line }) => line.includes("boom later"))!;
    expect(report.level).toBe("error");
    expect(report.line).toContain("acme.crash (node): uncaught exception");
    expect(host.status).toBe("running");
    expect(host.commandsOf("acme.crash")).toContain("acme.crash.echo");
    expect(await echoPid(host)).toBe(pid);
  });

  it("does not let process.exit from extension code end the host", async () => {
    const { host, logged } = makeHost();
    await host.start([description]);
    const pid = await echoPid(host);
    await expect(host.execute("acme.crash", "acme.crash.exit", [])).rejects.toThrow(
      "process.exit() is not allowed",
    );
    expect(await host.execute("acme.crash", "acme.crash.exitLater", [])).toBe("scheduled");
    await waitFor(() =>
      logged.some(
        ({ line }) => line.includes("acme.crash (node)") && line.includes("called with 4"),
      ),
    );
    expect(host.status).toBe("running");
    expect(await echoPid(host)).toBe(pid);
  });

  it("restarts after a hard crash, with commands back, and backs off on repeated crashes", async () => {
    const { host, logged } = makeHost({ restartDelayMs: 100, stableUptimeMs: 60_000 });
    await host.start([description]);
    const firstPid = await echoPid(host);
    await host.execute("acme.crash", "acme.crash.kill", []);
    await waitFor(() => host.status === "restarting");
    expect(host.commandsOf("acme.crash")).toEqual([]);
    await expect(host.execute("acme.crash", "acme.crash.echo", [])).rejects.toThrow("not running");
    await waitFor(() => host.status === "running");
    const secondPid = await echoPid(host);
    expect(secondPid).not.toBe(firstPid);
    expect(host.commandsOf("acme.crash")).toContain("acme.crash.echo");
    expect(logged.some(({ line }) => line.includes("restarting in 100ms"))).toBe(true);

    // A second crash soon after waits twice as long.
    await host.execute("acme.crash", "acme.crash.kill", []);
    await waitFor(() => logged.some(({ line }) => line.includes("restarting in 200ms")));
    await waitFor(() => host.status === "running");
    expect(await echoPid(host)).not.toBe(secondPid);
  });

  it("resets the backoff after a stable uptime", async () => {
    const { host, logged } = makeHost({ restartDelayMs: 100, stableUptimeMs: 300 });
    await host.start([description]);
    const restarts = () => logged.filter(({ line }) => line.includes("restarting in")).length;
    await host.execute("acme.crash", "acme.crash.kill", []);
    await waitFor(() => restarts() === 1 && host.status === "running");
    await sleep(400);
    await host.execute("acme.crash", "acme.crash.kill", []);
    await waitFor(() => restarts() === 2 && host.status === "running");
    const delays = logged.filter(({ line }) => line.includes("restarting in"));
    expect(delays.map(({ line }) => /restarting in (\d+)ms/.exec(line)![1])).toEqual([
      "100",
      "100",
    ]);
  });

  it("does not restart a host it stopped", async () => {
    const { host } = makeHost();
    await host.start([description]);
    host.stop();
    await sleep(200);
    expect(host.status).toBe("stopped");
  });
});

describe("NodeExtensionHost hung commands", () => {
  it("fails a call after its registered timeout", async () => {
    const { host } = makeHost();
    await host.start([description]);
    await expect(host.execute("acme.crash", "acme.crash.slow", [])).rejects.toThrow(
      "command 'acme.crash.slow' timed out after 200ms",
    );
    expect(host.callsInFlight).toBe(0);
  });

  it("fails a call after the default timeout", async () => {
    const { host } = makeHost({ commandTimeoutMs: 150 });
    await host.start([description]);
    await expect(host.execute("acme.crash", "acme.crash.hang", [])).rejects.toThrow(
      "timed out after 150ms",
    );
  });

  it("fails a call whose signal aborts", async () => {
    const { host } = makeHost();
    await host.start([description]);
    const controller = new AbortController();
    const call = host.execute("acme.crash", "acme.crash.hang", [], () => {}, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(call).rejects.toThrow("cancelled");
    expect(host.callsInFlight).toBe(0);
  });

  it("restarts after the grace period even with a hung call, failing it", async () => {
    const { host, logged } = makeHost({ restartGraceMs: 300 });
    await host.start([description]);
    const pid = await echoPid(host);
    const call = host.execute("acme.crash", "acme.crash.hang", []);
    const failed = call.catch((error: Error) => error);
    host.scheduleRestart([description], 10);
    await sleep(150);
    expect(host.callsInFlight).toBe(1);
    const error = await failed;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("restarted");
    expect(logged.some(({ line }) => line.includes("1 command(s) still running"))).toBe(true);
    await host.ready;
    expect(await echoPid(host)).not.toBe(pid);
  });

  it("logs a requested restart with no command running", async () => {
    const { host, logged } = makeHost();
    await host.start([description]);
    const pid = await echoPid(host);
    host.scheduleRestart([description], 10);
    await waitFor(() =>
      logged.some(({ line }) => line.includes("restarting for an extension change")),
    );
    const entry = logged.find(({ line }) => line.includes("restarting for an extension change"));
    expect(entry?.level).toBe("log");
    await host.ready;
    expect(await echoPid(host)).not.toBe(pid);
  });

  it("restarts as soon as the running calls finish, before the grace period", async () => {
    const { host } = makeHost({ restartGraceMs: 60_000 });
    await host.start([description]);
    const pid = await echoPid(host);
    const call = host.execute("acme.crash", "acme.crash.slow", []).catch(() => undefined);
    host.scheduleRestart([description], 10);
    const started = Date.now();
    await call;
    let newPid: number | undefined;
    await waitFor(() => {
      void echoPid(host).then(
        (value) => (newPid = value),
        () => {},
      );
      return newPid !== undefined && newPid !== pid;
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("NodeExtensionHost heartbeat", () => {
  it.skipIf(process.platform === "win32")(
    "kills and restarts a host whose command busy-loops, failing calls in flight",
    async () => {
      const { host, logged } = makeHost({ heartbeatIntervalMs: 100, heartbeatMaxMisses: 5 });
      await host.start([description, other]);
      const pid = await echoPid(host);
      const sleeper = (await host.execute("acme.crash", "acme.crash.spawnSleeper", [])) as number;
      expect(alive(sleeper)).toBe(true);

      const started = Date.now();
      const spin = host.execute("acme.crash", "acme.crash.spin", [60_000]).catch((e: Error) => e);
      // Another extension's call queued behind the busy loop is failed too, not wedged.
      await sleep(50);
      const queued = host.execute("acme.other", "acme.other.echo", [1]).catch((e: Error) => e);
      const spinError = await spin;
      const elapsed = Date.now() - started;
      expect(spinError).toBeInstanceOf(Error);
      expect((spinError as Error).message).toContain("stopped responding");
      expect((spinError as Error).message).toContain("acme.crash: acme.crash.spin");
      expect(((await queued) as Error).message).toContain("stopped responding");
      // Five 100ms pings, well inside the 60s loop.
      expect(elapsed).toBeLessThan(3000);
      const report = logged.find(({ line }) => line.includes("not responding"));
      expect(report?.level).toBe("error");
      expect(report?.line).toContain("5 heartbeats missed");
      expect(report?.line).toMatch(/while running acme\.crash: acme\.crash\.spin \(for \d+ms\)/);
      expect(report?.line).toContain("with acme.other: acme.other.echo queued");
      expect(logged.some(({ line }) => /restarting in \d+ms/.test(line))).toBe(true);

      await waitFor(() => host.status === "running");
      const otherAnswer = (await host.execute("acme.other", "acme.other.echo", [2])) as {
        value: number;
        pid: number;
      };
      expect(otherAnswer.value).toBe(2);
      expect(otherAnswer.pid).not.toBe(pid);
      // Neither the old host nor what its extensions spawned is left behind.
      await waitFor(() => !alive(pid) && !alive(sleeper));
    },
  );

  it("does not trip on a long async command or a short synchronous one", async () => {
    const { host, logged } = makeHost({ heartbeatIntervalMs: 100, heartbeatMaxMisses: 3 });
    await host.start([description, other]);
    const pid = await echoPid(host);
    expect(await host.execute("acme.crash", "acme.crash.wait", [1500])).toBe("waited");
    expect(await host.execute("acme.crash", "acme.crash.spin", [150])).toBe("spun");
    expect(host.status).toBe("running");
    expect(await echoPid(host)).toBe(pid);
    expect(logged.some(({ line }) => line.includes("not responding"))).toBe(false);
  });

  it("takes its timings from the environment", async () => {
    vi.stubEnv("OMNIGENT_NODE_HOST_HEARTBEAT_INTERVAL_MS", "50");
    vi.stubEnv("OMNIGENT_NODE_HOST_HEARTBEAT_MISSES", "2");
    try {
      const { host, logged } = makeHost();
      await host.start([description]);
      await expect(host.execute("acme.crash", "acme.crash.spin", [60_000])).rejects.toThrow(
        "stopped responding",
      );
      expect(logged.some(({ line }) => line.includes("2 heartbeats missed"))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("NodeExtensionHost limits and output", () => {
  it("refuses a result larger than the cap", async () => {
    const { host } = makeHost({ env: { OMNIGENT_NODE_HOST_MAX_RESULT_BYTES: "1000" } });
    await host.start([description]);
    expect(await host.execute("acme.crash", "acme.crash.big", [10])).toBe("x".repeat(10));
    await expect(host.execute("acme.crash", "acme.crash.big", [2000])).rejects.toThrow(
      "more than the 1000 byte limit",
    );
  });

  it("logs the host's stdout by whole lines", async () => {
    const { host, logged } = makeHost();
    await host.start([description]);
    await host.execute("acme.crash", "acme.crash.partialLines", []);
    await waitFor(() => logged.some(({ line }) => line.endsWith(" world")));
    const lines = logged.filter(({ line }) => line.startsWith("[omnigent-extensions] node host:"));
    expect(lines.map(({ line }) => line.split("node host: ")[1])).toEqual(["hello", "world"]);
  });

  it.skipIf(process.platform === "win32")(
    "kills processes an extension spawned when the host stops",
    async () => {
      const { host } = makeHost();
      await host.start([description]);
      const pid = (await host.execute("acme.crash", "acme.crash.spawnSleeper", [])) as number;
      expect(() => process.kill(pid, 0)).not.toThrow();
      host.stop();
      await waitFor(() => !alive(pid));
    },
  );
});

describe("command endpoint", () => {
  const TOKEN = "t".repeat(43);
  let server: Server;
  let port: number;
  let host: NodeExtensionHost;

  beforeAll(async () => {
    host = new NodeExtensionHost({
      restartDelayMs: 400,
      log: { log: () => {}, warn: () => {}, error: () => {} },
    });
    const endpoint = createCommandEndpoint({ token: TOKEN, host, port: () => port });
    server = createServer((req, res) =>
      endpoint(req, res, () => {
        res.statusCode = 418;
        res.end();
      }),
    );
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    port = address.port;
    await host.start([description]);
  });

  afterAll(async () => {
    host.stop();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  function post(pathname: string, args: unknown[] = [], signal?: AbortSignal) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: pathname,
          method: "POST",
          signal,
          headers: {
            Origin: `http://127.0.0.1:${port}`,
            "Content-Type": "application/json",
            [COMMAND_TOKEN_HEADER]: TOKEN,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
          );
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ args }));
    });
  }
  const commandPath = (command: string) => `/acme.crash/commands/${command}`;

  it("answers 400 for malformed percent-encoding in the path", async () => {
    const answer = await post("/acme.crash/commands/%E0%A4%A");
    expect(answer.status).toBe(400);
    expect(JSON.parse(answer.body)).toEqual({
      error: "the command path is not valid URI encoding",
    });
    expect((await post("/%ZZ/commands/x")).status).toBe(400);
  });

  it("cancels the call when the client disconnects", async () => {
    const controller = new AbortController();
    const answer = post(commandPath("acme.crash.hang"), [], controller.signal).catch(
      (error: Error) => error,
    );
    await waitFor(() => host.callsInFlight === 1);
    controller.abort();
    await answer;
    await waitFor(() => host.callsInFlight === 0);
  });

  it("answers 503 while the host is down, then serves again after the restart", async () => {
    expect((await post(commandPath("acme.crash.echo"), [1])).status).toBe(200);
    await post(commandPath("acme.crash.kill"));
    await waitFor(() => host.status === "restarting");
    const down = await post(commandPath("acme.crash.echo"), [1]);
    expect(down.status).toBe(503);
    expect(JSON.parse(down.body)).toEqual({ error: "Node extension host is not running" });
    await waitFor(() => host.status !== "restarting");
    // While it starts, the endpoint waits for activation instead of failing.
    const up = await post(commandPath("acme.crash.echo"), [1]);
    expect(up.status).toBe(200);
    expect(JSON.parse(up.body.trim().split("\n").at(-1)!)).toMatchObject({
      type: "result",
      value: { value: 1 },
    });
  });
});
