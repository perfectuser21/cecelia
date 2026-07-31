import { describe, expect, it } from 'vitest';
import {
  getVerifiedRemotePlannerPrdArtifact,
  hasVerifiedRemotePlannerPrdReceipt,
} from './planner-artifact-receipt.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const SPRINT_DIR = 'sprints/07310943-kernel-real-business';
const BRANCH = 'cp-harness-prd-aaaaaaaa-a2';
const REPO = 'perfectuser21/zenithjoy-workspace';

function receiptInput(overrides = {}) {
  const artifact = {
    type: 'git_artifact',
    kind: 'planner_prd',
    verification_status: 'verified',
    repo: REPO,
    branch: BRANCH,
    head_sha: 'a'.repeat(40),
    path: `${SPRINT_DIR}/sprint-prd.md`,
    ...overrides.artifact,
  };
  const serverVerification = {
    method: 'git_branch_head',
    artifact: {
      repo: artifact.repo,
      branch: artifact.branch,
      path: artifact.path,
      head_sha: artifact.head_sha,
    },
    ...overrides.serverVerification,
  };
  const attempt = {
    id: ATTEMPT_ID,
    run_id: RUN_ID,
    role: 'planner',
    status: 'completed',
    lease_generation: 2,
    execution_transport: 'fleet-worker',
    machine_attestation_status: 'verified',
    actual_machine_id: 'us-mac-m4',
    task_bundle: {
      inputs: {
        planner_branch: BRANCH,
        workspace_spec: { repo: REPO },
      },
    },
    result: {
      server_verification: {
        planner_git_artifact: serverVerification,
      },
    },
    ...overrides.attempt,
  };
  const detail = {
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    role: 'planner',
    status: 'completed',
    lease_generation: 2,
    artifacts: [artifact],
    server_verification: {
      planner_git_artifact: serverVerification,
    },
    ...overrides.detail,
  };
  return {
    runId: RUN_ID,
    task: { payload: { sprint_dir: SPRINT_DIR } },
    attemptRows: [attempt],
    logRows: [{
      action: 'verdict:attempt_callback',
      detail,
      ...overrides.log,
    }],
  };
}

describe('planner artifact receipt', () => {
  it('accepts only the exact attested terminal Attempt and Git artifact', () => {
    const artifact = getVerifiedRemotePlannerPrdArtifact(receiptInput());

    expect(artifact).toEqual({
      type: 'git_artifact',
      kind: 'planner_prd',
      verification_status: 'verified',
      repo: REPO,
      branch: BRANCH,
      head_sha: 'a'.repeat(40),
      path: `${SPRINT_DIR}/sprint-prd.md`,
    });
    expect(Object.isFrozen(artifact)).toBe(true);
  });

  it('accepts an attested planner receipt completed with concerns', () => {
    expect(hasVerifiedRemotePlannerPrdReceipt(receiptInput({
      attempt: { status: 'completed_with_concerns' },
      detail: { status: 'completed_with_concerns' },
    }))).toBe(true);
  });

  it.each([
    ['pre-cutover callback without server proof', {
      attempt: { result: {} },
      detail: { server_verification: undefined },
    }],
    ['unattested machine', { attempt: { machine_attestation_status: 'missing' } }],
    ['foreign branch', { artifact: { branch: 'cp-harness-prd-foreign-a2' } }],
    ['foreign sprint path', { artifact: { path: 'sprints/foreign/sprint-prd.md' } }],
    ['stale lease', { detail: { lease_generation: 1 } }],
    ['unverified artifact', { artifact: { verification_status: 'claimed' } }],
    ['mismatched terminal status', { attempt: { status: 'completed_with_concerns' } }],
  ])('rejects %s', (_label, overrides) => {
    expect(hasVerifiedRemotePlannerPrdReceipt(receiptInput(overrides))).toBe(false);
  });
});
