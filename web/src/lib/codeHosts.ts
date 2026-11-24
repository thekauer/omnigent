// Which code host serves a pull request link. Hosts are only recognized from
// evidence: github.com through the built-in GitHub host provider, a GitHub
// Enterprise host only when the caller already knows it serves GitHub.

import { GITHUB_DOT_COM, githubShapedPullRequest } from "./gitHostProviders";

/** A code host the workspace links pull requests and files to. */
export type CodeHostProviderId = "github";

/**
 * The provider serving `host`: github.com by name, any host in `githubHosts`
 * as GitHub Enterprise, otherwise null.
 */
export function codeHostProvider(
  host: string,
  githubHosts: Iterable<string> = [],
): CodeHostProviderId | null {
  const name = host.toLowerCase();
  if (name === GITHUB_DOT_COM) return "github";
  for (const known of githubHosts) {
    if (known.toLowerCase() === name) return "github";
  }
  return null;
}

/** A pull request link on a recognized code host. */
export interface CodeHostPullRequest {
  provider: CodeHostProviderId;
  host: string;
  /** `owner/repo`. */
  repository: string;
  number: number;
  /** The link without query, fragment, or trailing path. */
  url: string;
}

/**
 * The provider, host, repository, and number in an https pull request link on
 * a recognized code host, or null. Hosts are matched as in `codeHostProvider`.
 */
export function parseCodeHostPullRequestUrl(
  url: string | null | undefined,
  githubHosts: Iterable<string> = [],
): CodeHostPullRequest | null {
  if (!url) return null;
  const location = githubShapedPullRequest(url);
  if (!location) return null;
  const provider = codeHostProvider(location.host, githubHosts);
  if (!provider) return null;
  const repository = `${location.owner}/${location.repo}`;
  return {
    provider,
    host: location.host,
    repository,
    number: location.number,
    url: `https://${location.host}/${repository}/pull/${location.number}`,
  };
}
