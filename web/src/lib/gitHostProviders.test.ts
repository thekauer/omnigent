import { describe, expect, it, vi } from "vitest";
import {
  GITHUB_HOST_PROVIDER,
  GitHostProviderRegistry,
  githubPullRequestPath,
  githubShapedPullRequest,
} from "./gitHostProviders";

describe("git host providers", () => {
  it("recognizes github.com pull request links with the built-in provider", () => {
    expect(GITHUB_HOST_PROVIDER.matchUrl("https://github.com/acme/app/pull/12")).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "app",
      number: 12,
    });
    expect(GITHUB_HOST_PROVIDER.matchUrl("https://GitHub.com/acme/app/pull/12/")).toMatchObject({
      host: "github.com",
    });
    // Sub-pages, other hosts, ports, credentials and plain http are not its links.
    for (const url of [
      "https://github.com/acme/app/pull/12/files",
      "https://ghe.example.com/acme/app/pull/12",
      "https://github.com:8443/acme/app/pull/12",
      "https://user@github.com/acme/app/pull/12",
      "http://github.com/acme/app/pull/12",
      "https://github.com/acme/app/issues/12",
      "not a link",
    ]) {
      expect(GITHUB_HOST_PROVIDER.matchUrl(url)).toBeUndefined();
    }
  });

  it("reads GitHub-shaped paths and links on any host", () => {
    expect(githubPullRequestPath("/acme/app/pull/7/commits/abc")).toEqual({
      owner: "acme",
      repo: "app",
      number: 7,
      rest: "/commits/abc",
    });
    expect(githubPullRequestPath("/acme/app/pulls")).toBeNull();
    expect(githubShapedPullRequest("https://ghe.example.com/acme/app/pull/7")).toEqual({
      host: "ghe.example.com",
      owner: "acme",
      repo: "app",
      number: 7,
    });
  });

  it("asks providers in order after the built-in one, and unregisters them", () => {
    const registry = new GitHostProviderRegistry();
    const first = { id: "pub.first", matchUrl: vi.fn(() => undefined) };
    const second = {
      id: "pub.second",
      matchUrl: vi.fn((url: string) =>
        url.startsWith("https://git.example.com/")
          ? { host: "GIT.example.com", owner: "org", repo: "repo", number: 5 }
          : undefined,
      ),
    };
    const listener = vi.fn();
    registry.subscribe(listener);
    const unregisterFirst = registry.register(first);
    registry.register(second);
    expect(registry.getRevision()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
    // github.com stays the built-in's; the others are never asked.
    expect(registry.match("https://github.com/acme/app/pull/1")).toMatchObject({
      providerId: "github",
    });
    expect(first.matchUrl).not.toHaveBeenCalled();
    expect(registry.match("https://git.example.com/org/repo/pull/5")).toEqual({
      providerId: "pub.second",
      host: "git.example.com",
      owner: "org",
      repo: "repo",
      number: 5,
    });
    expect(first.matchUrl).toHaveBeenCalledTimes(1);
    expect(() => registry.register({ id: "pub.second", matchUrl: () => undefined })).toThrow(
      /already registered/,
    );
    unregisterFirst();
    unregisterFirst();
    expect(registry.getRevision()).toBe(3);
  });

  it("skips a provider that throws or answers malformed data, and logs it", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = new GitHostProviderRegistry([]);
    registry.register({
      id: "pub.throws",
      matchUrl: () => {
        throw new Error("boom");
      },
    });
    registry.register({
      id: "pub.malformed",
      matchUrl: () => ({ host: "x", owner: "", repo: "r", number: 1.5 }),
    });
    registry.register({
      id: "pub.good",
      matchUrl: () => ({ host: "x.example.com", owner: "o", repo: "r", number: 3 }),
    });
    expect(registry.match("https://x.example.com/o/r/pull/3")).toMatchObject({
      providerId: "pub.good",
    });
    expect(error).toHaveBeenCalledWith(
      "[omnigent-extensions] git host provider pub.throws threw",
      expect.any(Error),
    );
    expect(error).toHaveBeenCalledWith(
      "[omnigent-extensions] git host provider pub.malformed returned a malformed match",
    );
    error.mockRestore();
  });

  it("drops a match naming another host than the link's own", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = new GitHostProviderRegistry([]);
    registry.register({
      id: "pub.spoof",
      matchUrl: () => ({ host: "trusted.example.com", owner: "o", repo: "r", number: 3 }),
    });
    registry.register({
      id: "pub.honest",
      matchUrl: (url) => ({ host: new URL(url).hostname, owner: "o", repo: "r", number: 3 }),
    });
    expect(registry.match("https://evil.example.com/o/r/pull/3")).toMatchObject({
      providerId: "pub.honest",
      host: "evil.example.com",
    });
    expect(error).toHaveBeenCalledWith(
      "[omnigent-extensions] git host provider pub.spoof named host trusted.example.com for a link on evil.example.com",
    );
    expect(registry.match("not a link")).toBeUndefined();
    error.mockRestore();
  });

  it("lets only a built-in provider claim github.com links", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const claim = (url: string) => ({
      host: new URL(url).hostname,
      owner: "acme",
      repo: "app",
      number: 1,
    });
    const extensions = new GitHostProviderRegistry([]);
    extensions.register({ id: "pub.claims-github", matchUrl: claim });
    for (const url of [
      "https://github.com/acme/app/pull/1",
      "https://www.github.com/acme/app/pull/1",
    ]) {
      expect(extensions.match(url)).toBeUndefined();
    }
    expect(error).toHaveBeenCalledWith(
      "[omnigent-extensions] git host provider pub.claims-github may not claim www.github.com links",
    );
    const builtIn = new GitHostProviderRegistry([{ id: "builtin", matchUrl: claim }]);
    expect(builtIn.match("https://www.github.com/acme/app/pull/1")).toMatchObject({
      providerId: "builtin",
      host: "www.github.com",
    });
    error.mockRestore();
  });
});
