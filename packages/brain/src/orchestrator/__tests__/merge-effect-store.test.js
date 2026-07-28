import { describe, expect, it, vi } from 'vitest';

import { __test__, createPostgresMergeEffectStore } from '../merge-effect-store.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const HEAD_SHA = 'a'.repeat(40);
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4400';
const ASSESSMENT_ID = '33333333-3333-4333-8333-333333333333';

function proof() {
  return {
    run_id: RUN_ID,
    task_id: TASK_ID,
    repository: 'perfectuser21/cecelia',
    pr_number: 4400,
    pr_url: PR_URL,
    head_ref: 'cp-safe',
    head_sha: HEAD_SHA,
    policy_version: 'kernel-merge/v1',
    review_required: false,
    evaluator_hop: 1,
    judge_hop: 2,
    human_review_hop: null,
    merge_intent_hop: 3,
    post_diff_risk: {
      schema_version: 'kernel-post-diff-risk/v1',
      policy_version: 'kernel-post-diff-risk/v1',
      risk_level: 'low',
      human_review_required: false,
      auto_eligible: true,
      reasons: [],
      bindings: {
        task_id: TASK_ID,
        run_id: RUN_ID,
        hop: 3,
        repository: 'perfectuser21/cecelia',
        head_sha: HEAD_SHA,
        base_repository: 'perfectuser21/cecelia',
        base_ref: 'main',
        base_sha: 'b'.repeat(40),
        diff_hash: `sha256:${'b'.repeat(64)}`,
        contract_version: 7,
        contract_digest: `sha256:${'c'.repeat(64)}`,
        behavior_fingerprint: `sha256:${'d'.repeat(64)}`,
        capability_fingerprint: `sha256:${'e'.repeat(64)}`,
        path_surface_digest: `sha256:${'f'.repeat(64)}`,
        path_class: 'application',
      },
      expires_at: '2099-07-28T08:15:00.000Z',
    },
  };
}

describe('PostgreSQL merge effect store', () => {
  it('persists an exact server-owned review assessment using durable merge history', async () => {
    const assessment = {
      assessment_id: ASSESSMENT_ID,
      run_id: RUN_ID,
      task_id: TASK_ID,
      repository: 'perfectuser21/cecelia',
      pr_number: 4400,
      head_sha: HEAD_SHA,
      policy_version: 'kernel-merge/v1',
      changed_paths: ['apps/dashboard/src/App.jsx'],
      risk_tier: 'low',
      risk_reasons: ['low_risk_paths'],
      first_kernel_release: false,
      payload_review_required: false,
      review_required: false,
    };
    const client = {
      query: vi.fn(async (sql) => {
        if (/AS first_kernel_release/.test(sql)) {
          return { rows: [{ first_kernel_release: false }] };
        }
        if (/SELECT id AS assessment_id/.test(sql)) return { rows: [assessment] };
        return { rows: [] };
      }),
    };
    const store = createPostgresMergeEffectStore({});

    await expect(store.assessReviewPolicy(client, {
      runId: RUN_ID,
      taskId: TASK_ID,
      currentPr: {
        repository: 'perfectuser21/cecelia',
        number: 4400,
        head_sha: HEAD_SHA,
        changed_paths: ['apps/dashboard/src/App.jsx'],
      },
      policyVersion: 'kernel-merge/v1',
      payload: { review_required: false },
    })).resolves.toEqual({
      assessment_id: ASSESSMENT_ID,
      policy_version: 'kernel-merge/v1',
      changed_paths: ['apps/dashboard/src/App.jsx'],
      risk_tier: 'low',
      risk_reasons: ['low_risk_paths'],
      first_kernel_release: false,
      payload_review_required: false,
      review_required: false,
    });

    expect(client.query.mock.calls.map(([sql]) => sql).join('\n')).toMatch(
      /pg_advisory_xact_lock[\s\S]*kernel_merge_effect_receipts[\s\S]*INSERT INTO kernel_merge_review_assessments[\s\S]*SELECT id AS assessment_id/,
    );
  });

  it('fails closed when an idempotency collision returns different review authority', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (/AS first_kernel_release/.test(sql)) {
          return { rows: [{ first_kernel_release: false }] };
        }
        if (/SELECT id AS assessment_id/.test(sql)) {
          return {
            rows: [{
              assessment_id: ASSESSMENT_ID,
              run_id: RUN_ID,
              task_id: TASK_ID,
              repository: 'perfectuser21/cecelia',
              pr_number: 4400,
              head_sha: HEAD_SHA,
              policy_version: 'kernel-merge/v1',
              changed_paths: ['packages/brain/migrations/376_bad.sql'],
              risk_tier: 'high',
              risk_reasons: ['high_risk_path:packages/brain/migrations/376_bad.sql'],
              first_kernel_release: false,
              payload_review_required: false,
              review_required: true,
            }],
          };
        }
        return { rows: [] };
      }),
    };
    const store = createPostgresMergeEffectStore({});

    await expect(store.assessReviewPolicy(client, {
      runId: RUN_ID,
      taskId: TASK_ID,
      currentPr: {
        repository: 'perfectuser21/cecelia',
        number: 4400,
        head_sha: HEAD_SHA,
        changed_paths: ['apps/dashboard/src/App.jsx'],
      },
      policyVersion: 'kernel-merge/v1',
      payload: { review_required: false },
    })).rejects.toMatchObject({ code: 'review_assessment_conflict' });
  });

  it('holds and releases one session advisory lock around the whole effect callback', async () => {
    const order = [];
    const client = {
      query: vi.fn(async (sql) => {
        if (/pg_advisory_lock/.test(sql)) order.push('lock');
        if (/pg_advisory_unlock/.test(sql)) order.push('unlock');
        return { rows: [{ unlocked: true }] };
      }),
      release: vi.fn(() => order.push('release')),
    };
    const store = createPostgresMergeEffectStore({
      connect: vi.fn(async () => client),
    });

    await store.withRunLock(RUN_ID, async () => {
      order.push('effect');
    });

    expect(order).toEqual(['lock', 'effect', 'unlock', 'release']);
    expect(client.query.mock.calls[0]).toEqual([
      expect.stringMatching(/pg_advisory_lock/),
      [RUN_ID],
    ]);
  });

  it('releases the advisory lock when the effect callback throws', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    };
    const store = createPostgresMergeEffectStore({
      connect: vi.fn(async () => client),
    });

    await expect(store.withRunLock(RUN_ID, async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    expect(client.query.mock.calls.at(-1)[0]).toMatch(/pg_advisory_unlock/);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('still releases the client when advisory unlock itself fails', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('unlock connection lost')),
      release: vi.fn(),
    };
    const store = createPostgresMergeEffectStore({
      connect: vi.fn(async () => client),
    });

    await expect(store.withRunLock(RUN_ID, async () => 'done')).rejects.toThrow(
      'unlock connection lost',
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('loads run, task, and append-only decision evidence from the database', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: RUN_ID,
            current_task_id: TASK_ID,
            pr_url: PR_URL,
            contract_id: '33333333-3333-4333-8333-333333333333',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: TASK_ID,
            payload: { behavior_version: 'dashboard/v3' },
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: '33333333-3333-4333-8333-333333333333',
            version: 7,
            status: 'approved',
            contract_content: { acceptance: ['green'] },
          }],
        })
        .mockResolvedValueOnce({ rows: [{
          hop: 1,
          action: 'merge_pr',
          gate_verdict: 'allow',
          observed: { post_diff_risk: { bindings: {
            repository: 'perfectuser21/cecelia',
            behavior_fingerprint: `sha256:${'d'.repeat(64)}`,
          } } },
        }] })
        .mockResolvedValueOnce({
          rows: [{
            receipt_status: 'confirmed',
            repository: 'perfectuser21/cecelia',
            behavior_fingerprint: `sha256:${'d'.repeat(64)}`,
          }],
        }),
    };
    const store = createPostgresMergeEffectStore({});

    await expect(store.loadEvidence(client, {
      runId: RUN_ID,
      taskId: TASK_ID,
    })).resolves.toEqual({
      run: {
        id: RUN_ID,
        current_task_id: TASK_ID,
        pr_url: PR_URL,
        contract_id: '33333333-3333-4333-8333-333333333333',
      },
      task: {
        id: TASK_ID,
        payload: { behavior_version: 'dashboard/v3' },
      },
      contract: {
        id: '33333333-3333-4333-8333-333333333333',
        version: 7,
        status: 'approved',
        contract_content: { acceptance: ['green'] },
      },
      productionReceipt: {
        receipt_status: 'confirmed',
        repository: 'perfectuser21/cecelia',
        behavior_fingerprint: `sha256:${'d'.repeat(64)}`,
      },
      decisionLog: [{
        hop: 1,
        action: 'merge_pr',
        gate_verdict: 'allow',
        observed: { post_diff_risk: { bindings: {
          repository: 'perfectuser21/cecelia',
          behavior_fingerprint: `sha256:${'d'.repeat(64)}`,
        } } },
      }],
    });

    expect(client.query.mock.calls[2][0]).toMatch(/FROM initiative_contracts/i);
    expect(client.query.mock.calls[3][0]).toMatch(
      /FROM orchestrator_decision_log[\s\S]*ORDER BY hop/i,
    );
    expect(client.query.mock.calls[4][0]).toMatch(
      /FROM kernel_behavior_production_receipts[\s\S]*repository = \$1[\s\S]*behavior_fingerprint = \$2/i,
    );
  });

  it('commits ownership, observation, authorization, then one intent', async () => {
    const calls = [];
    const ownership = {
      id: '33333333-3333-4333-8333-333333333333',
      run_id: RUN_ID,
      task_id: TASK_ID,
      repository: 'perfectuser21/cecelia',
      pr_number: 4400,
      pr_url: PR_URL,
      head_ref: 'cp-safe',
    };
    const expectedProof = proof();
    const binding = expectedProof.post_diff_risk.bindings;
    const riskAssessment = {
      id: '66666666-6666-4666-8666-666666666666',
      run_id: RUN_ID,
      task_id: TASK_ID,
      assessment_hop: binding.hop,
      repository: binding.repository,
      head_sha: binding.head_sha,
      base_repository: binding.base_repository,
      base_ref: binding.base_ref,
      base_sha: binding.base_sha,
      diff_hash: binding.diff_hash,
      contract_version: binding.contract_version,
      contract_digest: binding.contract_digest,
      behavior_fingerprint: binding.behavior_fingerprint,
      capability_fingerprint: binding.capability_fingerprint,
      path_surface_digest: binding.path_surface_digest,
      path_class: binding.path_class,
      risk_level: expectedProof.post_diff_risk.risk_level,
      human_review_required: expectedProof.post_diff_risk.human_review_required,
      auto_eligible: expectedProof.post_diff_risk.auto_eligible,
      policy_version: expectedProof.post_diff_risk.policy_version,
      proof_expires_at: expectedProof.post_diff_risk.expires_at,
      proof_digest: __test__.proofDigest(expectedProof.post_diff_risk),
      evidence: expectedProof.post_diff_risk,
    };
    const authorization = {
      id: '44444444-4444-4444-8444-444444444444',
      run_id: RUN_ID,
      task_id: TASK_ID,
      repository: 'perfectuser21/cecelia',
      pr_number: 4400,
      pr_url: PR_URL,
      head_ref: 'cp-safe',
      head_sha: HEAD_SHA,
      policy_version: 'kernel-merge/v1',
      risk_assessment_id: riskAssessment.id,
      evidence: expectedProof,
    };
    const intent = {
      intent_id: '55555555-5555-4555-8555-555555555555',
      authorization_id: authorization.id,
      run_id: RUN_ID,
      target: PR_URL,
      requested_head_sha: HEAD_SHA,
      confirmed_receipt: null,
    };
    const client = {
      query: vi.fn(async (sql) => {
        calls.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (/INSERT INTO kernel_pr_ownership/.test(sql)) return { rows: [] };
        if (/SELECT \* FROM kernel_pr_ownership/.test(sql)) return { rows: [ownership] };
        if (/INSERT INTO kernel_merge_authorizations/.test(sql)) return { rows: [] };
        if (/INSERT INTO kernel_post_diff_risk_assessments/.test(sql)) {
          return { rows: [riskAssessment] };
        }
        if (/SELECT \*[\s\S]*FROM kernel_merge_authorizations/.test(sql)) {
          return { rows: [authorization] };
        }
        if (/SELECT intent\.id AS intent_id/.test(sql)) return { rows: [intent] };
        return { rows: [], rowCount: 1 };
      }),
    };
    const store = createPostgresMergeEffectStore({});

    await expect(store.createAuthorizationIntent(client, {
      proof: expectedProof,
      currentPr: {
        url: PR_URL,
        head_sha: HEAD_SHA,
        head_ref: 'cp-safe',
        state: 'OPEN',
        ci: 'pass',
        merged: false,
      },
    })).resolves.toEqual(intent);

    expect(calls.join('\n')).toMatch(
      /INSERT INTO kernel_pr_ownership[\s\S]*INSERT INTO kernel_pr_head_observations[\s\S]*INSERT INTO kernel_post_diff_risk_assessments[\s\S]*INSERT INTO kernel_merge_authorizations[\s\S]*INSERT INTO kernel_merge_effect_intents/,
    );
    expect(calls.at(-1)).toBe('COMMIT');
  });

  it('rolls back when a conflicting assessment reuses the same proof digest', async () => {
    const expectedProof = proof();
    const binding = expectedProof.post_diff_risk.bindings;
    const ownership = {
      id: '33333333-3333-4333-8333-333333333333',
      run_id: RUN_ID,
      task_id: TASK_ID,
      repository: expectedProof.repository,
      pr_number: expectedProof.pr_number,
      pr_url: PR_URL,
      head_ref: expectedProof.head_ref,
    };
    const conflicting = {
      id: '66666666-6666-4666-8666-666666666666',
      run_id: RUN_ID,
      task_id: TASK_ID,
      assessment_hop: binding.hop,
      repository: binding.repository,
      head_sha: binding.head_sha,
      base_repository: binding.base_repository,
      base_ref: binding.base_ref,
      base_sha: binding.base_sha,
      diff_hash: binding.diff_hash,
      contract_version: binding.contract_version,
      contract_digest: binding.contract_digest,
      behavior_fingerprint: binding.behavior_fingerprint,
      capability_fingerprint: binding.capability_fingerprint,
      path_surface_digest: binding.path_surface_digest,
      path_class: 'security_credential',
      risk_level: expectedProof.post_diff_risk.risk_level,
      human_review_required: expectedProof.post_diff_risk.human_review_required,
      auto_eligible: expectedProof.post_diff_risk.auto_eligible,
      policy_version: expectedProof.post_diff_risk.policy_version,
      proof_expires_at: expectedProof.post_diff_risk.expires_at,
      proof_digest: __test__.proofDigest(expectedProof.post_diff_risk),
      evidence: expectedProof.post_diff_risk,
    };
    const client = {
      query: vi.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
        if (/SELECT \* FROM kernel_pr_ownership/.test(sql)) return { rows: [ownership] };
        if (/INSERT INTO kernel_post_diff_risk_assessments/.test(sql)) return { rows: [] };
        if (/SELECT \*[\s\S]*FROM kernel_post_diff_risk_assessments/.test(sql)) {
          return { rows: [conflicting] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const store = createPostgresMergeEffectStore({});

    await expect(store.createAuthorizationIntent(client, {
      proof: expectedProof,
      currentPr: {
        url: PR_URL,
        head_sha: HEAD_SHA,
        head_ref: 'cp-safe',
        state: 'OPEN',
        ci: 'pass',
        merged: false,
      },
    })).rejects.toMatchObject({ code: 'post_diff_risk_conflict' });
    expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  });
});
