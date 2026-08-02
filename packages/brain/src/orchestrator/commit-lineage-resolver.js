import { resolveGitHubToken } from '../harness-credentials.js';

const CANONICAL_SHA = /^[0-9a-f]{40}$/;
const CANONICAL_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CANONICAL_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

// GitHub's compare status is authoritative about lineage: `identical` means the
// two commits are the same, `ahead` means the head descends from the base.
// `behind` and `diverged` both mean the base is no longer in the head's history.
const ANCESTOR_STATUSES = new Set(['ahead', 'identical']);

function isComparableRef(value) {
  const ref = String(value ?? '');
  return (
    CANONICAL_SHA.test(ref)
    || (CANONICAL_REF.test(ref) && !ref.includes('..'))
  );
}

/**
 * Compare two revisions server-side.
 *
 * Returns both facts the frozen-baseline gate needs:
 *   is_ancestor    — `base` is still reachable from `head`
 *   merge_base_sha — where `head` forked from `base`
 *
 * Throws on any transport/authorization problem so callers fail closed and
 * retry instead of projecting an unverified claim.
 */
export async function defaultCommitLineageResolver({
  repo,
  base,
  head,
} = {}, {
  fetchFn = globalThis.fetch,
  resolveToken = resolveGitHubToken,
} = {}) {
  if (
    !CANONICAL_REPO.test(String(repo ?? ''))
    || !isComparableRef(base)
    || !CANONICAL_SHA.test(String(head ?? ''))
  ) {
    throw new Error('commit_lineage_request_invalid');
  }
  const token = await resolveToken();
  const response = await fetchFn(
    `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(base)}...${head}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response?.ok) {
    throw new Error(`github_commit_compare_http_${response?.status ?? 'unknown'}`);
  }
  const body = await response.json();
  const mergeBase = String(body?.merge_base_commit?.sha ?? '').toLowerCase();
  return {
    is_ancestor: ANCESTOR_STATUSES.has(body?.status),
    merge_base_sha: CANONICAL_SHA.test(mergeBase) ? mergeBase : null,
  };
}
