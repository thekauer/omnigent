import { describe, expect, it, vi } from "vitest";
import {
  CLI_TIMEOUT,
  DevProxyToken,
  TOKEN_FAILURE_RETRY_MS,
  TOKEN_FALLBACK_TTL_MS,
  TOKEN_REFRESH_MARGIN_MS,
  type RunCli,
} from "../vite.devProxyToken";

const HOUR = 60 * 60 * 1000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function tokenJson(value: string | null, expiresAt?: number): string {
  return JSON.stringify({
    ...(value === null ? {} : { access_token: value }),
    ...(expiresAt === undefined ? {} : { expiry: new Date(expiresAt).toISOString() }),
  });
}

function setup(runCli: RunCli) {
  let now = 1_000_000;
  const token = new DevProxyToken({
    authArgs: ["--host", "https://example.com"],
    runCli,
    now: () => now,
  });
  return {
    token,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

describe("DevProxyToken", () => {
  it("passes the host, a CLI timeout and JSON output to the CLI", async () => {
    const runCli = vi.fn<RunCli>().mockResolvedValue(tokenJson("t1", 1_000_000 + HOUR));
    const { token } = setup(runCli);
    expect(await token.ensure()).toBe("t1");
    expect(runCli).toHaveBeenCalledExactlyOnceWith([
      "auth",
      "token",
      "--host",
      "https://example.com",
      "--output",
      "json",
      "--timeout",
      CLI_TIMEOUT,
    ]);
  });

  it("never waits for the CLI in current(): it serves the cached token while a refresh runs", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const runCli = vi
      .fn<RunCli>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { token, advance, now } = setup(runCli);

    // No token yet: current() starts a refresh and returns at once.
    expect(token.current()).toBeNull();
    expect(token.current()).toBeNull();
    expect(runCli).toHaveBeenCalledOnce();
    first.resolve(tokenJson("t1", now() + HOUR));
    await token.ensure();
    expect(token.current()).toBe("t1");

    // Past the refresh point: the old token is still served, one refresh starts.
    advance(HOUR - TOKEN_REFRESH_MARGIN_MS);
    expect(token.current()).toBe("t1");
    expect(token.current()).toBe("t1");
    expect(runCli).toHaveBeenCalledTimes(2);
    second.resolve(tokenJson("t2", now() + HOUR));
    await token.refresh();
    expect(token.current()).toBe("t2");
  });

  it("shares one CLI call between concurrent ensure() callers", async () => {
    const pending = deferred<string>();
    const runCli = vi.fn<RunCli>().mockReturnValue(pending.promise);
    const { token, now } = setup(runCli);
    const callers = [token.ensure(), token.ensure(), token.ensure()];
    pending.resolve(tokenJson("t1", now() + HOUR));
    expect(await Promise.all(callers)).toEqual(["t1", "t1", "t1"]);
    expect(runCli).toHaveBeenCalledOnce();
  });

  it("counts the failure back-off from when a slow CLI answered", async () => {
    const pending = deferred<string>();
    const runCli = vi.fn<RunCli>().mockReturnValueOnce(pending.promise);
    const { token, advance } = setup(runCli);
    const waiting = token.ensure();
    // The CLI hangs until its own timeout.
    advance(30_000);
    pending.reject(new Error("timed out"));
    expect(await waiting).toBeNull();

    // Within the back-off nothing runs and nothing waits.
    advance(TOKEN_FAILURE_RETRY_MS - 1);
    expect(await token.ensure()).toBeNull();
    expect(runCli).toHaveBeenCalledOnce();

    runCli.mockResolvedValueOnce(tokenJson("t1"));
    advance(1);
    expect(await token.ensure()).toBe("t1");
    expect(runCli).toHaveBeenCalledTimes(2);
  });

  it("re-mints a CLI-cached token already inside the margin, without blocking callers", async () => {
    const start = 1_000_000;
    const runCli = vi
      .fn<RunCli>()
      .mockResolvedValueOnce(tokenJson("stale", start + 60_000))
      .mockResolvedValueOnce(tokenJson("fresh", start + HOUR));
    const { token } = setup(runCli);
    expect(await token.ensure()).toBe("fresh");
    expect(runCli.mock.calls[1]?.[0]).toContain("--force-refresh");
  });

  it("keeps a nearly expired token when the forced re-mint fails", async () => {
    const start = 1_000_000;
    const runCli = vi
      .fn<RunCli>()
      .mockResolvedValueOnce(tokenJson("stale", start + 60_000))
      .mockRejectedValueOnce(new Error("offline"));
    const { token } = setup(runCli);
    expect(await token.ensure()).toBe("stale");
  });

  it("keeps serving a valid token after a failed refresh, and never an expired one", async () => {
    const start = 1_000_000;
    const runCli = vi.fn<RunCli>().mockResolvedValueOnce(tokenJson("t1", start + HOUR));
    const { token, advance } = setup(runCli);
    await token.ensure();
    runCli.mockRejectedValueOnce(new Error("offline"));
    advance(HOUR - TOKEN_REFRESH_MARGIN_MS);
    await token.refresh();
    expect(token.current()).toBe("t1");
    advance(TOKEN_REFRESH_MARGIN_MS);
    runCli.mockReturnValue(new Promise(() => {}));
    expect(token.current()).toBeNull();
  });

  it("uses the fallback lifetime when the CLI reports no expiry", async () => {
    const runCli = vi.fn<RunCli>().mockResolvedValue(tokenJson("t1"));
    const { token, advance } = setup(runCli);
    await token.ensure();
    advance(TOKEN_FALLBACK_TTL_MS - 1);
    token.current();
    expect(runCli).toHaveBeenCalledOnce();
    advance(1);
    token.current();
    expect(runCli).toHaveBeenCalledTimes(2);
  });

  it("forces a refresh after a 401, at most once per back-off", async () => {
    const runCli = vi.fn<RunCli>().mockResolvedValue(tokenJson("t1", 1_000_000 + HOUR));
    const { token, advance } = setup(runCli);
    await token.ensure();
    token.invalidateAfter401();
    token.current();
    expect(runCli).toHaveBeenCalledOnce();

    advance(TOKEN_FAILURE_RETRY_MS);
    token.invalidateAfter401();
    token.current();
    await token.refresh();
    expect(runCli).toHaveBeenCalledTimes(2);
    expect(runCli.mock.calls[1]?.[0]).toContain("--force-refresh");
  });
});
