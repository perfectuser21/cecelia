import { describe, expect, it, vi } from 'vitest';

import {
  buildWorkspaceSpec,
  createWorkspaceSpecResolver,
  parseWorkspaceSpec,
} from './workspace-spec.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const BASE_SHA = '0123456789abcdef0123456789abcdef01234567';

function validSpec(overrides = {}) {
  return {
    repo: 'perfectuser21/cecelia',
    base_sha: BASE_SHA,
    branch: 'cp-07272050-fleet-worker-workspace-4b',
    expected_head_sha: null,
    mode: 'read-write',
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    ...overrides,
  };
}

describe('WorkspaceSpec contract', () => {
  it('returns an immutable canonical WorkspaceSpec', () => {
    const parsed = buildWorkspaceSpec(validSpec());

    expect(parsed).toEqual(validSpec());
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it.each([
    ['cwd', '/Users/operator/perfect21/cecelia'],
    ['worktree_path', '/tmp/operator-worktree'],
    ['workspace_path', '../operator-worktree'],
  ])('rejects caller-owned path field %s', (field, value) => {
    expect(() => parseWorkspaceSpec(validSpec({ [field]: value }))).toThrow();
  });

  it.each([
    '0123456789ABCDEF0123456789ABCDEF01234567',
    '0123456789abcdef0123456789abcdef0123456',
    'g123456789abcdef0123456789abcdef01234567',
    'refs/heads/cp-07272050-fleet-worker-workspace-4b',
  ])('rejects non-canonical base_sha %s', (baseSha) => {
    expect(() => parseWorkspaceSpec(validSpec({ base_sha: baseSha })))
      .toThrow(/base_sha/);
  });

  it.each([
    '0123456789ABCDEF0123456789ABCDEF01234567',
    '0123456789abcdef0123456789abcdef0123456',
    'not-a-sha',
  ])('rejects non-canonical expected_head_sha %s', (expectedHeadSha) => {
    expect(() => parseWorkspaceSpec(validSpec({
      expected_head_sha: expectedHeadSha,
    }))).toThrow(/expected_head_sha/);
  });

  it.each([
    'https://github.com/perfectuser21/cecelia.git',
    '/Users/operator/perfect21/cecelia',
    'other/cecelia',
    'perfectuser21/../cecelia',
  ])('rejects non-allowlisted repository identity %s', (repo) => {
    expect(() => parseWorkspaceSpec(validSpec({ repo }))).toThrow(/repo/);
  });

  it.each([
    'main',
    '/tmp/worktree',
    '../cp-escape',
    'refs/heads/cp-shadow',
    'cp-double..dot',
    'cp-trailing.lock',
    'cp-space branch',
  ])('rejects unsafe or non-task branch %s', (branch) => {
    expect(() => parseWorkspaceSpec(validSpec({ branch }))).toThrow(/branch/);
  });

  it('checks the run, Attempt, and mode against the enclosing TaskBundle', () => {
    expect(() => parseWorkspaceSpec(validSpec(), {
      runId: '33333333-3333-4333-8333-333333333333',
    })).toThrow(/workspace_run_id_mismatch/);
    expect(() => parseWorkspaceSpec(validSpec(), {
      attemptId: '44444444-4444-4444-8444-444444444444',
    })).toThrow(/workspace_attempt_id_mismatch/);
    expect(() => parseWorkspaceSpec(validSpec(), {
      mode: 'read-only',
    })).toThrow(/workspace_mode_mismatch/);
  });
});

describe('production WorkspaceSpec resolution', () => {
  it('uses immutable review SHA evidence and never the caller worktree path', async () => {
    const resolveRepoHead = vi.fn();
    const resolveWorkspaceSpec = createWorkspaceSpecResolver({ resolveRepoHead });

    const resolved = await resolveWorkspaceSpec({
      role: 'reviewer',
      readOnly: true,
      attemptId: ATTEMPT_ID,
      ctx: {
        runId: RUN_ID,
        observed: {
          task: {
            payload: {
              base_repo: '/Users/administrator/perfect21/cecelia',
              worktree_path: '/tmp/untrusted-review-worktree',
            },
          },
        },
      },
      bundle: {
        inputs: {
          contract_branch: 'cp-harness-propose-r1-contract',
          contract_sha: BASE_SHA,
        },
      },
    });

    expect(resolved).toEqual({
      repo: 'perfectuser21/cecelia',
      base_sha: BASE_SHA,
      branch: 'cp-harness-propose-r1-contract',
      expected_head_sha: BASE_SHA,
      mode: 'read-only',
      run_id: RUN_ID,
      attempt_id: ATTEMPT_ID,
    });
    expect(JSON.stringify(resolved)).not.toContain('/tmp/untrusted');
    expect(resolveRepoHead).not.toHaveBeenCalled();
  });

  it('resolves a server-owned repository head for a new writer branch', async () => {
    const resolveRepoHead = vi.fn(async () => BASE_SHA);
    const resolveWorkspaceSpec = createWorkspaceSpecResolver({ resolveRepoHead });

    const resolved = await resolveWorkspaceSpec({
      role: 'generator',
      readOnly: false,
      attemptId: ATTEMPT_ID,
      ctx: {
        runId: RUN_ID,
        observed: {
          task: { payload: { base_repo: 'perfectuser21/cecelia' } },
        },
      },
      bundle: { inputs: {} },
    });

    expect(resolved).toMatchObject({
      repo: 'perfectuser21/cecelia',
      base_sha: BASE_SHA,
      branch: 'cp-fleet-generator-22222222',
      expected_head_sha: null,
      mode: 'read-write',
    });
    expect(resolveRepoHead).toHaveBeenCalledWith('perfectuser21/cecelia');
  });

  it('fails closed for a repository outside the Brain-owned map', async () => {
    const resolveWorkspaceSpec = createWorkspaceSpecResolver({
      resolveRepoHead: vi.fn(async () => BASE_SHA),
    });

    await expect(resolveWorkspaceSpec({
      role: 'generator',
      readOnly: false,
      attemptId: ATTEMPT_ID,
      ctx: {
        runId: RUN_ID,
        observed: {
          task: { payload: { base_repo: 'attacker/other-repo' } },
        },
      },
      bundle: { inputs: {} },
    })).rejects.toThrow(/workspace_repo_not_supported/);
  });
});
