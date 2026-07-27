import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceSpec,
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
