// The dev plugin's Node entries: manifest `main`, the child-process host, the
// command endpoint and its guards, and that builds carry none of it.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { omnigentExtensionsDev, readDevExtension } from "../../vite.omnigentExtensions";
import {
  COMMAND_TOKEN_HEADER,
  commandOriginRefusal,
  MAX_COMMAND_BODY_BYTES,
  NodeExtensionHost,
} from "../../vite.omnigentNodeExtensions";

const BROWSER_ENTRY = "export function activate() {}\n";

const NODE_ENTRY = `
import * as omnigent from "omnigent/node";
export function activate(context) {
  const log = omnigent.window.createOutputChannel("test");
  context.subscriptions.push(
    omnigent.commands.registerCommand("acme.node.echo", (...args) => ({ args, version: omnigent.version })),
    omnigent.commands.registerCommand("acme.node.steps", (count) =>
      omnigent.window.withProgress({ title: "Steps" }, async (progress) => {
        for (let step = 1; step <= count; step += 1) progress.report({ message: "step " + step });
        log.info("steps done");
        return count;
      }),
    ),
    omnigent.commands.registerCommand("acme.node.fail", () => {
      throw new Error("the command failed");
    }),
    omnigent.commands.registerCommand("acme.node.refused", () =>
      ["omnigent.openFile", "acme.other.steal", "acmenode.x"].map((id) => {
        try {
          omnigent.commands.registerCommand(id, () => "taken");
          return "registered";
        } catch (error) {
          return error.message;
        }
      }),
    ),
  );
}
`;

let workspace: string;

function makeExtension(
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string>,
) {
  const folder = path.join(workspace, name);
  for (const [file, content] of Object.entries({
    "package.json": JSON.stringify({
      name,
      publisher: "acme",
      version: "1.0.0",
      engines: { omnigent: "^0.24.0" },
      browser: "./src/extension.js",
      activationEvents: ["onStartupFinished"],
      ...manifest,
    }),
    "src/extension.js": BROWSER_ENTRY,
    ...files,
  })) {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), content);
  }
  return folder;
}

interface Answer {
  status: number;
  body: string;
  contentType: string | undefined;
}

/** A raw HTTP request, so a test controls Origin and Host exactly. */
function send(
  port: number,
  pathname: string,
  {
    method = "POST",
    headers = {},
    body = "",
  }: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: pathname, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
          contentType: res.headers["content-type"],
        }),
      );
    });
    req.on("error", reject);
    req.end(body);
  });
}

let server: ViteDevServer;
let port: number;
let token: string;
let virtualModule: string;

beforeAll(async () => {
  workspace = mkdtempSync(path.join(tmpdir(), "omnigent-node-ext-test-"));
  const folders = [
    makeExtension("node", { main: "./src/node.js" }, { "src/node.js": NODE_ENTRY }),
    makeExtension(
      "other",
      { main: "./src/node.js" },
      {
        "src/node.js":
          'import * as omnigent from "omnigent/node";\nexport function activate(context) { context.subscriptions.push(omnigent.commands.registerCommand("acme.other.run", () => "other")); }\n',
      },
    ),
    makeExtension(
      "broken",
      { main: "./src/node.js" },
      { "src/node.js": 'export function activate() { throw new Error("broken on purpose"); }\n' },
    ),
    makeExtension("browseronly", {}, {}),
  ];
  const root = path.join(workspace, "app");
  mkdirSync(root, { recursive: true });
  const registryModule = path.join(root, "registry.js");
  writeFileSync(registryModule, "export const getExtensionApi = (id) => ({ id });\n");
  writeFileSync(path.join(root, "index.html"), "<!doctype html>");
  server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1" },
    plugins: [
      omnigentExtensionsDev({
        paths: folders,
        apiRegistryModule: registryModule,
        quiet: true,
        nodeHost: { log: { log: () => {}, warn: () => {}, error: () => {} } },
      }),
    ],
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  port = address.port;
  const loaded = await server.transformRequest("virtual:omnigent-dev-extensions");
  virtualModule = loaded?.code ?? "";
  const endpoint = /devCommandEndpoint = (\{.*\});/.exec(virtualModule);
  token = (JSON.parse(endpoint![1]!) as { token: string }).token;
}, 60_000);

afterAll(async () => {
  await server?.close();
  rmSync(workspace, { recursive: true, force: true });
});

const commandPath = (extension: string, command: string) =>
  `/__omnigent/extensions/${extension}/commands/${command}`;

function post(
  extension: string,
  command: string,
  args: unknown[],
  headers: Record<string, string> = {},
) {
  return send(port, commandPath(extension, command), {
    headers: {
      Origin: `http://127.0.0.1:${port}`,
      "Content-Type": "application/json",
      [COMMAND_TOKEN_HEADER]: token,
      ...headers,
    },
    body: JSON.stringify({ args }),
  });
}

const lines = (answer: Answer) =>
  answer.body
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe("manifest main", () => {
  it("is optional and resolves to a real path inside the folder", () => {
    const result = readDevExtension(path.join(workspace, "node"));
    expect("extension" in result && result.extension.mainPath).toBe(
      path.join(workspace, "node", "src", "node.js"),
    );
    const browserOnly = readDevExtension(path.join(workspace, "browseronly"));
    expect("extension" in browserOnly && browserOnly.extension.mainPath).toBeUndefined();
  });

  it.each([
    [{ main: "./missing.js" }, '"main" entry ./missing.js does not exist'],
    [{ main: "../outside.js" }, '"main" must stay inside the extension folder'],
    [{ main: "./src/extension.ts" }, "must be an ES module"],
    [{ main: 42 }, '"main" must be a file path'],
  ])("rejects %j", (manifest, problem) => {
    const folder = makeExtension(`bad-main-${Math.random().toString(36).slice(2)}`, manifest, {
      "src/extension.ts": "",
    });
    const result = readDevExtension(folder);
    expect("error" in result && result.error).toContain(problem);
  });
});

describe("Node extension host", () => {
  it("lists each extension's Node commands and a per-boot token in the virtual module", () => {
    const endpoint = JSON.parse(/devCommandEndpoint = (\{.*\});/.exec(virtualModule)![1]!);
    expect(endpoint).toMatchObject({
      url: "/__omnigent/extensions",
      tokenHeader: COMMAND_TOKEN_HEADER,
      nodeCommands: {
        "acme.node": ["acme.node.echo", "acme.node.fail", "acme.node.refused", "acme.node.steps"],
        "acme.other": ["acme.other.run"],
      },
    });
    expect(endpoint.nodeCommands["acme.broken"]).toBeUndefined();
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it("refuses Node command ids outside the extension's own namespace", async () => {
    const answer = await post("acme.node", "acme.node.refused", []);
    expect(lines(answer)).toEqual([
      {
        type: "result",
        value: [
          "command 'omnigent.openFile': the 'omnigent.' namespace is reserved for built-in commands",
          "command 'acme.other.steal' must start with the extension id ('acme.node.')",
          "command 'acmenode.x' must start with the extension id ('acme.node.')",
        ],
      },
    ]);
  });

  it("runs a command with JSON arguments and streams its result as NDJSON", async () => {
    const answer = await post("acme.node", "acme.node.echo", [{ name: "x" }, 2]);
    expect(answer.status).toBe(200);
    expect(answer.contentType).toBe("application/x-ndjson");
    expect(lines(answer)).toEqual([
      { type: "result", value: { args: [{ name: "x" }, 2], version: "0.1.0" } },
    ]);
  });

  it("streams withProgress events before the result", async () => {
    const answer = await post("acme.node", "acme.node.steps", [2]);
    expect(lines(answer).map(({ type, kind, message }) => [type, kind, message])).toEqual([
      ["progress", "start", undefined],
      ["progress", "report", "step 1"],
      ["progress", "report", "step 2"],
      ["progress", "end", undefined],
      ["result", undefined, undefined],
    ]);
    expect(lines(answer).at(-1)).toEqual({ type: "result", value: 2 });
  });

  it("reports a command's error as the last line", async () => {
    const answer = await post("acme.node", "acme.node.fail", []);
    expect(answer.status).toBe(200);
    expect(lines(answer)).toEqual([{ type: "error", message: "the command failed" }]);
  });

  it("runs only commands the named extension registered", async () => {
    expect((await post("acme.node", "acme.other.run", [])).status).toBe(404);
    expect((await post("acme.nobody", "acme.node.echo", [])).status).toBe(404);
    expect((await post("acme.node", "acme.node.missing", [])).status).toBe(404);
    expect((await post("acme.other", "acme.other.run", [])).status).toBe(200);
  });

  it.each([
    ["no token", { [COMMAND_TOKEN_HEADER]: "" }],
    ["a wrong token", { [COMMAND_TOKEN_HEADER]: "x".repeat(43) }],
    ["another site's Origin", { Origin: "http://evil.example" }],
    ["another port's Origin", { Origin: "http://127.0.0.1:1" }],
    ["an https Origin", { Origin: "https://127.0.0.1:PORT" }],
    ["another Host", { Host: "evil.example" }],
  ])("refuses a request with %s", async (_label, headers) => {
    const fixed = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name, value.replace("PORT", String(port))]),
    );
    const answer = await post("acme.node", "acme.node.echo", [], fixed);
    expect(answer.status).toBe(403);
  });

  it("accepts localhost as Origin and Host", async () => {
    const answer = await post("acme.node", "acme.node.echo", [], {
      Origin: `http://localhost:${port}`,
      Host: `localhost:${port}`,
    });
    expect(answer.status).toBe(200);
  });

  // A browser reaching the server through a forwarded port (an SSH tunnel from a
  // laptop) sends that port in Origin and Host, not the one the server listens on.
  it.each([
    ["localhost:50286", "http://localhost:50286"],
    ["127.0.0.1:8443", "http://127.0.0.1:8443"],
    ["[::1]:50286", "http://[::1]:50286"],
  ])("accepts a same-origin request through forwarded address %s", async (host, origin) => {
    const answer = await post("acme.node", "acme.node.echo", [], { Origin: origin, Host: host });
    expect(answer.status).toBe(200);
  });

  it.each([
    ["another local port", "localhost:50286", "http://localhost:8080"],
    ["another loopback name", "localhost:50286", "http://127.0.0.1:50286"],
    ["a rebound name", "evil.example:50286", "http://evil.example:50286"],
    ["an upper-case name", "LOCALHOST:50286", "http://LOCALHOST:50286"],
    ["a trailing dot", "localhost.:50286", "http://localhost.:50286"],
    ["a localhost subdomain trick", "localhost.evil.com:50286", "http://localhost.evil.com:50286"],
  ])("refuses a forwarded request from %s", async (_label, host, origin) => {
    const answer = await post("acme.node", "acme.node.echo", [], { Origin: origin, Host: host });
    expect(answer.status).toBe(403);
  });

  it("refuses a request without an Origin", async () => {
    const answer = await send(port, commandPath("acme.node", "acme.node.echo"), {
      headers: { "Content-Type": "application/json", [COMMAND_TOKEN_HEADER]: token },
      body: '{"args":[]}',
    });
    expect(answer.status).toBe(403);
  });

  it("refuses other methods, other content types, bad JSON and large bodies", async () => {
    const headers = {
      Origin: `http://127.0.0.1:${port}`,
      [COMMAND_TOKEN_HEADER]: token,
      "Content-Type": "application/json",
    };
    const target = commandPath("acme.node", "acme.node.echo");
    expect((await send(port, target, { method: "GET", headers })).status).toBe(405);
    expect(
      (
        await send(port, target, {
          headers: { ...headers, "Content-Type": "text/plain" },
          body: "{}",
        })
      ).status,
    ).toBe(415);
    expect((await send(port, target, { headers, body: "{not json" })).status).toBe(400);
    expect((await send(port, target, { headers, body: '{"args": 1}' })).status).toBe(400);
    const large = JSON.stringify({ args: ["x".repeat(MAX_COMMAND_BODY_BYTES)] });
    expect((await send(port, target, { headers, body: large })).status).toBe(413);
  });
});

describe("NodeExtensionHost", () => {
  it("fails calls in flight when the host process exits, and can start again", async () => {
    const folder = makeExtension(
      "hang",
      { main: "./src/node.js" },
      {
        "src/node.js":
          'import * as omnigent from "omnigent/node";\nexport function activate(context) { context.subscriptions.push(omnigent.commands.registerCommand("acme.hang.wait", () => new Promise(() => {}))); }\n',
      },
    );
    const quiet = { log: () => {}, warn: () => {}, error: () => {} };
    const host = new NodeExtensionHost({ log: quiet });
    const description = {
      id: "acme.hang",
      version: "1.0.0",
      directory: folder,
      mainPath: path.join(folder, "src", "node.js"),
    };
    await host.start([description]);
    expect(host.commandsOf("acme.hang")).toEqual(["acme.hang.wait"]);
    const call = host.execute("acme.hang", "acme.hang.wait", []);
    host.stop();
    await expect(call).rejects.toThrow("the Node extension host was stopped");
    expect(host.running).toBe(false);
    await expect(host.execute("acme.hang", "acme.hang.wait", [])).rejects.toThrow("not running");

    await host.start([description]);
    expect(host.commandsOf("acme.hang")).toEqual(["acme.hang.wait"]);
    host.stop();
  });
});

describe("production build", () => {
  it("emits no command token, endpoint or Node host code", async () => {
    const root = path.join(workspace, "build-app");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      path.join(root, "index.html"),
      '<!doctype html><script type="module" src="./main.js"></script>',
    );
    writeFileSync(
      path.join(root, "main.js"),
      [
        'import { devCommandEndpoint, devExtensions } from "virtual:omnigent-dev-extensions";',
        "console.log(devCommandEndpoint, devExtensions);",
      ].join("\n"),
    );
    const outDir = path.join(root, "dist");
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      build: { outDir, minify: false },
      plugins: [
        omnigentExtensionsDev({
          paths: [path.join(workspace, "node")],
          quiet: true,
          nodeHost: { log: { log: () => {}, warn: () => {}, error: () => {} } },
        }),
      ],
    });
    const output = readdirSync(path.join(outDir, "assets"))
      .map((file) => readFileSync(path.join(outDir, "assets", file), "utf8"))
      .join("\n");
    expect(output).toMatch(/devCommandEndpoint = null|console.log\(null, \[\]\)/);
    for (const forbidden of [COMMAND_TOKEN_HEADER, "__omnigent/extensions", "acme.node.echo"]) {
      expect(output).not.toContain(forbidden);
    }
  }, 60_000);
});

describe("commandOriginRefusal", () => {
  it.each([
    ["localhost:30000", "http://localhost:30000"],
    ["localhost:50286", "http://localhost:50286"],
    ["127.0.0.1:50286", "http://127.0.0.1:50286"],
    ["[::1]:50286", "http://[::1]:50286"],
    ["localhost", "http://localhost"],
    ["127.0.0.1:65535", "http://127.0.0.1:65535"],
  ])("accepts Host %s with its own Origin", (host, origin) => {
    expect(commandOriginRefusal(origin, host)).toBeUndefined();
  });

  it.each([
    ["another port's Origin", "localhost:50286", "http://localhost:8080"],
    ["an Origin without the port", "localhost:50286", "http://localhost"],
    ["another loopback name's Origin", "localhost:50286", "http://127.0.0.1:50286"],
    ["an https Origin", "localhost:50286", "https://localhost:50286"],
    ["an Origin with a path", "localhost:50286", "http://localhost:50286/"],
    ["the opaque null Origin", "localhost:50286", "null"],
    ["no Origin", "localhost:50286", undefined],
  ])("refuses %s", (_label, host, origin) => {
    expect(commandOriginRefusal(origin, host)).toBe("Origin is not this dev server");
  });

  it.each([
    ["no Host", undefined],
    ["a remote name", "evil.example:50286"],
    ["a rebound name without a port", "evil.example"],
    ["an upper-case name", "LOCALHOST:50286"],
    ["an upper-case name with a trailing dot", "LOCALHOST.:50286"],
    ["a trailing dot", "localhost.:50286"],
    ["a localhost subdomain", "localhost.evil.com:50286"],
    ["a name ending in localhost", "evillocalhost:50286"],
    ["another 127/8 address", "127.0.0.2:50286"],
    ["an unbracketed IPv6 address", "::1:50286"],
    ["a port out of range", "localhost:65536"],
    ["a port with a leading zero", "localhost:050286"],
    ["an empty port", "localhost:"],
    ["userinfo", "user@localhost:50286"],
  ])("refuses %s as Host", (_label, host) => {
    expect(commandOriginRefusal(host === undefined ? undefined : `http://${host}`, host)).toBe(
      "Host is not this dev server",
    );
  });
});
