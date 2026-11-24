// Git host providers: who recognizes which pull request links, as plain data.
// The built-in GitHub provider is registered first; extensions add theirs
// (`omnigent.git.registerHostProvider`), asked in registration order.

/** A pull request a provider recognizes in a link. */
export interface PullRequestLocation {
  /** Lowercase. */
  host: string;
  owner: string;
  repo: string;
  number: number;
}

export interface GitHostProvider {
  readonly id: string;
  matchUrl: (url: string) => PullRequestLocation | undefined;
}

export interface PullRequestMatch extends PullRequestLocation {
  providerId: string;
}

/** The built-in provider's id, as the info payload names GitHub. */
export const GITHUB_HOST_PROVIDER_ID = "github";

export const GITHUB_DOT_COM = "github.com";
/** A pull request's path on GitHub and GitHub Enterprise, with any sub-page after it. */
const GITHUB_PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(\/.*)?$/;

/** The owner, repository, number and sub-page (`/files`, or "") of a GitHub-shaped pull request path. */
export function githubPullRequestPath(
  pathname: string,
): { owner: string; repo: string; number: number; rest: string } | null {
  const match = GITHUB_PULL_PATH.exec(pathname);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]), rest: match[4] ?? "" };
}

/**
 * A pull request link on a host: https, no port or credentials, and the
 * pull request's own GitHub-shaped path (a trailing slash allowed).
 */
export function githubShapedPullRequest(url: string): PullRequestLocation | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  // A port or credentials would make this a different server than the one recognized.
  if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password) {
    return undefined;
  }
  const path = githubPullRequestPath(parsed.pathname);
  if (!path || (path.rest !== "" && path.rest !== "/")) return undefined;
  return {
    host: parsed.hostname.toLowerCase(),
    owner: path.owner,
    repo: path.repo,
    number: path.number,
  };
}

/** github.com's pull request links; GitHub Enterprise hosts are known only from evidence. */
export const GITHUB_HOST_PROVIDER: GitHostProvider = {
  id: GITHUB_HOST_PROVIDER_ID,
  matchUrl: (url) => {
    const location = githubShapedPullRequest(url);
    return location?.host === GITHUB_DOT_COM ? location : undefined;
  },
};

function isLocation(value: unknown): value is PullRequestLocation {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.host === "string" &&
    candidate.host !== "" &&
    typeof candidate.owner === "string" &&
    candidate.owner !== "" &&
    typeof candidate.repo === "string" &&
    candidate.repo !== "" &&
    typeof candidate.number === "number" &&
    Number.isSafeInteger(candidate.number) &&
    candidate.number > 0
  );
}

export class GitHostProviderRegistry {
  private readonly providers: GitHostProvider[] = [];
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  constructor(builtIns: readonly GitHostProvider[] = [GITHUB_HOST_PROVIDER]) {
    this.providers.push(...builtIns);
  }

  /** Adds a provider after the ones before it; the function removes it. */
  register(provider: GitHostProvider): () => void {
    if (this.providers.some((existing) => existing.id === provider.id)) {
      throw new Error(`a git host provider with id '${provider.id}' is already registered`);
    }
    this.providers.push(provider);
    this.changed();
    return () => {
      const index = this.providers.indexOf(provider);
      if (index < 0) return;
      this.providers.splice(index, 1);
      this.changed();
    };
  }

  /** The first provider's match; a throwing or malformed provider is skipped and logged. */
  match(url: string): PullRequestMatch | undefined {
    for (const provider of this.providers) {
      let location: unknown;
      try {
        location = provider.matchUrl(url);
      } catch (error) {
        console.error(`[omnigent-extensions] git host provider ${provider.id} threw`, error);
        continue;
      }
      if (location === undefined || location === null) continue;
      if (!isLocation(location)) {
        console.error(
          `[omnigent-extensions] git host provider ${provider.id} returned a malformed match`,
        );
        continue;
      }
      return {
        providerId: provider.id,
        host: location.host.toLowerCase(),
        owner: location.owner,
        repo: location.repo,
        number: location.number,
      };
    }
    return undefined;
  }

  /** Bumped on every registration change, for renderers that cache matches. */
  getRevision = (): number => this.revision;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private changed(): void {
    this.revision += 1;
    for (const listener of [...this.listeners]) listener();
  }
}

/** The window's providers. */
export const gitHostProviders = new GitHostProviderRegistry();

/** The pull request `url` links to on a recognized host, from the window's providers. */
export function matchPullRequestUrl(url: string | null | undefined): PullRequestMatch | undefined {
  return url ? gitHostProviders.match(url) : undefined;
}
