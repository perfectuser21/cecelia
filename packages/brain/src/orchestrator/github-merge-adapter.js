const SHA_PATTERN = /^[a-f0-9]{40}$/;
const PR_URL_PATTERN = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)$/;
const CI_FAILURE = new Set([
  'FAILURE',
  'ERROR',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
]);
const CI_SUCCESS = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);

function parseIdentity(url) {
  const match = String(url ?? '').match(PR_URL_PATTERN);
  if (!match) throw new Error('github_pr_url_invalid');
  return { repository: match[1], number: Number(match[2]) };
}

function checkState(check) {
  return String(check?.state || check?.conclusion || check?.status || '').toUpperCase();
}

function ciStatus(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return 'pending';
  const states = checks.map(checkState);
  if (states.some((state) => CI_FAILURE.has(state))) return 'fail';
  if (states.every((state) => CI_SUCCESS.has(state))) return 'pass';
  return 'pending';
}

function parseJson(value) {
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error('github_pr_observation_invalid');
  }
}

export function createGitHubMergeAdapter({ execFile }) {
  if (typeof execFile !== 'function') throw new Error('github_exec_file_required');

  return Object.freeze({
    async observePullRequest(prUrl) {
      const identity = parseIdentity(prUrl);
      const output = await execFile('gh', [
        'pr',
        'view',
        prUrl,
        '--json',
        'url,number,headRefName,headRefOid,state,mergeStateStatus,statusCheckRollup,mergeCommit',
      ]);
      const observed = parseJson(output);
      if (observed.url !== prUrl || Number(observed.number) !== identity.number) {
        throw new Error('github_pr_identity_mismatch');
      }
      if (!SHA_PATTERN.test(observed.headRefOid ?? '')) {
        throw new Error('github_pr_head_invalid');
      }
      return {
        url: prUrl,
        repository: identity.repository,
        number: identity.number,
        head_ref: observed.headRefName,
        head_sha: observed.headRefOid,
        state: observed.state,
        merge_state_status: observed.mergeStateStatus,
        ci: ciStatus(observed.statusCheckRollup),
        merged: observed.state === 'MERGED',
        merge_commit_sha: observed.mergeCommit?.oid ?? null,
      };
    },

    async mergePullRequest({ pr_url: prUrl, expected_head_sha: expectedHeadSha, method }) {
      parseIdentity(prUrl);
      if (!SHA_PATTERN.test(expectedHeadSha ?? '')) throw new Error('github_pr_head_invalid');
      if (method !== 'squash') throw new Error('github_merge_method_invalid');
      await execFile('gh', [
        'pr',
        'merge',
        prUrl,
        '--squash',
        '--delete-branch',
        '--match-head-commit',
        expectedHeadSha,
      ]);
    },
  });
}

export const __test__ = {
  ciStatus,
  parseIdentity,
};
