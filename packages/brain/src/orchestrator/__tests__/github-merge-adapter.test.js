import { describe, expect, it, vi } from 'vitest';

import {
  canonicalPullRequestDiffDigest,
  createGitHubMergeAdapter,
  DEFAULT_REQUIRED_CHECK_POLICY_BY_REPOSITORY,
} from '../github-merge-adapter.js';

const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4400';
const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const BLOB_SHA = 'c'.repeat(40);
const REQUIRED_CHECK_POLICY = Object.freeze([{
  context: 'ci-passed',
  app_slug: 'github-actions',
  app_id: 15368,
  branch_app_id: 15368,
  source: 'github-actions',
}]);

function prView(overrides = {}) {
  return {
    url: PR_URL,
    number: 4400,
    headRefName: 'cp-safe',
    headRefOid: HEAD_SHA,
    headRepository: { nameWithOwner: 'perfectuser21/cecelia' },
    baseRefName: 'main',
    baseRefOid: BASE_SHA,
    baseRepository: { nameWithOwner: 'perfectuser21/cecelia' },
    state: 'OPEN',
    isDraft: false,
    mergeStateStatus: 'CLEAN',
    changedFiles: 1,
    mergeCommit: null,
    ...overrides,
  };
}

function pullFiles(overrides = {}) {
  return [{
    filename: 'apps/dashboard/src/App.jsx',
    previous_filename: 'apps/dashboard/src/OldApp.jsx',
    status: 'renamed',
    sha: BLOB_SHA,
    additions: 12,
    deletions: 3,
    patch: '@@ -1 +1 @@\n-old\n+new',
    ...overrides,
  }];
}

function trustedCheck(overrides = {}) {
  return {
    name: 'ci-passed',
    status: 'completed',
    conclusion: 'success',
    app: { id: 15368, slug: 'github-actions' },
    details_url: 'https://github.com/perfectuser21/cecelia/actions/runs/123456/job/789012',
    head_sha: HEAD_SHA,
    check_suite: { id: 42 },
    ...overrides,
  };
}

function makeExec({
  pr = prView(),
  files = pullFiles(),
  checks = [trustedCheck()],
  checkTotal = checks.length,
  statuses = [],
  protection = {
    required_status_checks: {
      strict: true,
      checks: [{ context: 'ci-passed', app_id: 15368 }],
    },
    required_pull_request_reviews: {
      bypass_pull_request_allowances: { apps: [], teams: [], users: [] },
    },
    enforce_admins: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  },
} = {}) {
  return vi.fn((_binary, args) => {
    if (args[0] === 'pr') return JSON.stringify(pr);
    if (String(args[1]).includes('/pulls/')) return JSON.stringify(files);
    if (String(args[1]).includes('/check-runs')) {
      return JSON.stringify({ total_count: checkTotal, check_runs: checks });
    }
    if (/\/commits\/[^/]+\/status$/.test(String(args[1]))) {
      return JSON.stringify({ statuses });
    }
    if (String(args[1]).includes('/protection')) return JSON.stringify(protection);
    throw new Error(`unexpected command: ${args.join(' ')}`);
  });
}

describe('GitHub merge adapter', () => {
  it('rejects truncated check-run evidence', async () => {
    const adapter = createGitHubMergeAdapter({
      execFile: makeExec({ checkTotal: 101 }),
      requiredCheckPolicy: REQUIRED_CHECK_POLICY,
    });
    await expect(adapter.observePullRequest(PR_URL)).rejects.toThrow(
      'github_check_runs_incomplete',
    );
  });

  it('requires every protected production context using real check-run shape', async () => {
    const policy = DEFAULT_REQUIRED_CHECK_POLICY_BY_REPOSITORY['perfectuser21/cecelia'];
    const adapter = createGitHubMergeAdapter({
      execFile: makeExec({
        checks: [
          trustedCheck(),
          trustedCheck({ name: 'Harness V5 Gate Passed' }),
          trustedCheck({ name: 'Smoke Glob Runner Passed' }),
        ],
        protection: {
          required_status_checks: {
            strict: true,
            checks: [
              { context: 'ci-passed', app_id: 15368 },
              { context: 'Harness V5 Gate Passed', app_id: 15368 },
              { context: 'Smoke Glob Runner Passed', app_id: null },
            ],
          },
          required_pull_request_reviews: {
            bypass_pull_request_allowances: { apps: [], teams: [], users: [] },
          },
          enforce_admins: { enabled: true },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        },
      }),
      requiredCheckPolicy: policy,
    });

    const result = await adapter.observePullRequest(PR_URL);
    expect(result.ci).toBe('pass');
    expect(result.required_checks.map(({ context }) => context)).toEqual([
      'ci-passed',
      'Harness V5 Gate Passed',
      'Smoke Glob Runner Passed',
    ]);
  });

  it('accepts GitHub production protection payloads that omit empty bypass allowances', async () => {
    const adapter = createGitHubMergeAdapter({
      execFile: makeExec({
        protection: {
          required_status_checks: {
            strict: true,
            checks: [{ context: 'ci-passed', app_id: 15368 }],
          },
          required_pull_request_reviews: {
            dismiss_stale_reviews: false,
            require_code_owner_reviews: false,
            require_last_push_approval: false,
            required_approving_review_count: 0,
          },
          enforce_admins: { enabled: true },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        },
      }),
      requiredCheckPolicy: REQUIRED_CHECK_POLICY,
    });

    await expect(adapter.observePullRequest(PR_URL)).resolves.toMatchObject({
      ci: 'pass',
      repository_policy: {
        atomic_merge_backstop: true,
        bypass_disabled: true,
      },
    });
  });

  it('fails closed when branch protection is not strict and admin-enforced', async () => {
    const adapter = createGitHubMergeAdapter({
      execFile: makeExec({
        protection: {
          required_status_checks: {
            strict: false,
            checks: [{ context: 'ci-passed', app_id: 15368 }],
          },
          required_pull_request_reviews: {
            bypass_pull_request_allowances: { apps: [], teams: [], users: [] },
          },
          enforce_admins: { enabled: false },
        },
      }),
      requiredCheckPolicy: REQUIRED_CHECK_POLICY,
    });

    await expect(adapter.observePullRequest(PR_URL)).resolves.toMatchObject({
      ci: 'pending',
      repository_policy: { atomic_merge_backstop: false },
    });
  });

  it('normalizes an exact PR/base/diff/required-check authority without a shell', async () => {
    const files = pullFiles();
    const execFile = makeExec({ files });
    const adapter = createGitHubMergeAdapter({
      execFile,
      requiredCheckPolicy: REQUIRED_CHECK_POLICY,
    });

    await expect(adapter.observePullRequest(PR_URL)).resolves.toEqual({
      url: PR_URL,
      repository: 'perfectuser21/cecelia',
      number: 4400,
      head_repository: 'perfectuser21/cecelia',
      head_ref: 'cp-safe',
      head_sha: HEAD_SHA,
      base_repository: 'perfectuser21/cecelia',
      base_ref: 'main',
      base_sha: BASE_SHA,
      state: 'OPEN',
      is_draft: false,
      merge_state_status: 'CLEAN',
      ci: 'pass',
      required_checks: [{
        context: 'ci-passed',
        app_slug: 'github-actions',
        source: 'github-actions',
        run_id: '123456',
        job_id: '789012',
        head_sha: HEAD_SHA,
        conclusion: 'SUCCESS',
      }],
      merged: false,
      merge_commit_sha: null,
      diff_digest: canonicalPullRequestDiffDigest(files),
      files: [{
        path: 'apps/dashboard/src/App.jsx',
        previous_path: 'apps/dashboard/src/OldApp.jsx',
        status: 'renamed',
        blob_sha: BLOB_SHA,
        patch_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        additions: 12,
        deletions: 3,
      }],
      repository_policy: {
        atomic_merge_backstop: true,
        required_checks_strict: true,
        administrators_enforced: true,
        bypass_disabled: true,
        required_contexts: ['ci-passed'],
      },
    });
    expect(execFile).toHaveBeenCalledWith('gh', [
      'pr',
      'view',
      PR_URL,
      '--json',
      expect.stringContaining('baseRefOid'),
    ]);
    expect(execFile).toHaveBeenCalledWith('gh', [
      'api',
      'repos/perfectuser21/cecelia/pulls/4400/files?per_page=100',
    ]);
    expect(execFile).toHaveBeenCalledWith('gh', [
      'api',
      `repos/perfectuser21/cecelia/commits/${HEAD_SHA}/check-runs?per_page=100`,
      '-H',
      'Accept: application/vnd.github+json',
    ]);
  });

  it.each([
    ['missing', [], 'pending'],
    ['failed', [trustedCheck({ conclusion: 'failure' })], 'fail'],
    ['skipped', [trustedCheck({ conclusion: 'skipped' })], 'pending'],
    ['forged same-name app', [trustedCheck({ app: { slug: 'attacker-app' } })], 'pending'],
    ['forged same-name app id', [trustedCheck({
      app: { id: 99999, slug: 'github-actions' },
    })], 'pending'],
    ['wrong run repository', [trustedCheck({
      details_url: 'https://github.com/evil/repo/actions/runs/123456/job/789012',
    })], 'pending'],
    ['wrong run head', [trustedCheck({
      head_sha: 'd'.repeat(40),
    })], 'pending'],
  ])('fails closed when the required check is %s', async (_label, checks, ci) => {
    const adapter = createGitHubMergeAdapter({
      execFile: makeExec({ checks }),
      requiredCheckPolicy: REQUIRED_CHECK_POLICY,
    });
    await expect(adapter.observePullRequest(PR_URL)).resolves.toMatchObject({ ci });
  });

  it('does not let an unrelated success check satisfy the required policy', async () => {
    const adapter = createGitHubMergeAdapter({
      execFile: makeExec({
        checks: [trustedCheck({ name: 'attacker-unrelated' })],
      }),
      requiredCheckPolicy: REQUIRED_CHECK_POLICY,
    });
    await expect(adapter.observePullRequest(PR_URL)).resolves.toMatchObject({
      ci: 'pending',
      required_checks: [],
    });
  });

  it.each(['UNSTABLE', 'BLOCKED', 'BEHIND', 'DIRTY', 'UNKNOWN'])(
    'does not authorize merge state %s',
    async (mergeStateStatus) => {
      const adapter = createGitHubMergeAdapter({
        execFile: makeExec({ pr: prView({ mergeStateStatus }) }),
        requiredCheckPolicy: REQUIRED_CHECK_POLICY,
      });
      await expect(adapter.observePullRequest(PR_URL)).resolves.toMatchObject({
        merge_state_status: mergeStateStatus,
        ci: 'pending',
      });
    },
  );

  it('fails closed when base identity or the complete file page is unavailable', async () => {
    const missingBase = createGitHubMergeAdapter({
      execFile: makeExec({ pr: prView({ baseRefOid: null }) }),
      requiredCheckPolicy: REQUIRED_CHECK_POLICY,
    });
    await expect(missingBase.observePullRequest(PR_URL))
      .rejects.toThrow('github_pr_base_invalid');

    const truncatedFiles = createGitHubMergeAdapter({
      execFile: makeExec({ pr: prView({ changedFiles: 2 }) }),
      requiredCheckPolicy: REQUIRED_CHECK_POLICY,
    });
    await expect(truncatedFiles.observePullRequest(PR_URL))
      .rejects.toThrow('github_pr_files_incomplete');
  });

  it('changes the diff digest for patch bytes, blob identity, or rename source', () => {
    const original = pullFiles();
    expect(canonicalPullRequestDiffDigest(pullFiles({ patch: '@@ -1 +1 @@\n-safe\n+unsafe' })))
      .not.toBe(canonicalPullRequestDiffDigest(original));
    expect(canonicalPullRequestDiffDigest(pullFiles({ sha: 'd'.repeat(40) })))
      .not.toBe(canonicalPullRequestDiffDigest(original));
    expect(canonicalPullRequestDiffDigest(pullFiles({ previous_filename: 'security/guard.js' })))
      .not.toBe(canonicalPullRequestDiffDigest(original));
  });

  it('rejects a mismatched returned URL', async () => {
    const adapter = createGitHubMergeAdapter({
      execFile: makeExec({
        pr: prView({ url: 'https://github.com/perfectuser21/cecelia/pull/4401' }),
      }),
      requiredCheckPolicy: REQUIRED_CHECK_POLICY,
    });
    await expect(adapter.observePullRequest(PR_URL))
      .rejects.toThrow('github_pr_identity_mismatch');
  });

  it('merges with an exact head fence through argv, never a command string', async () => {
    const execFile = vi.fn(() => '');
    const adapter = createGitHubMergeAdapter({
      execFile,
      requiredCheckPolicy: REQUIRED_CHECK_POLICY,
    });

    await adapter.mergePullRequest({
      pr_url: PR_URL,
      expected_head_sha: HEAD_SHA,
      method: 'squash',
    });

    expect(execFile).toHaveBeenCalledWith('gh', [
      'pr',
      'merge',
      PR_URL,
      '--squash',
      '--delete-branch',
      '--match-head-commit',
      HEAD_SHA,
    ]);
  });
});
