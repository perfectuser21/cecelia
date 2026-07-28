import { describe, expect, it, vi } from 'vitest';

import { createPostgresMergeEffectStore } from '../merge-effect-store.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const HEAD_SHA = 'a'.repeat(40);
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4400';

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
        head_sha: HEAD_SHA,
        diff_hash: `sha256:${'b'.repeat(64)}`,
        contract_version: 7,
        contract_digest: `sha256:${'c'.repeat(64)}`,
        behavior_version: 'dashboard/v3',
        path_class: 'application',
      },
      expires_at: '2099-07-28T08:15:00.000Z',
    },
  };
}

describe('PostgreSQL merge effect store', () => {
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
        .mockResolvedValueOnce({
          rows: [{
            receipt_status: 'confirmed',
            behavior_version: 'dashboard/v3',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ hop: 1, action: 'merge_pr' }] }),
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
        behavior_version: 'dashboard/v3',
      },
      decisionLog: [{ hop: 1, action: 'merge_pr' }],
    });

    expect(client.query.mock.calls[2][0]).toMatch(/FROM initiative_contracts/i);
    expect(client.query.mock.calls[3][0]).toMatch(
      /FROM kernel_behavior_production_receipts/i,
    );
    expect(client.query.mock.calls[4][0]).toMatch(
      /FROM orchestrator_decision_log[\s\S]*ORDER BY hop/i,
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
    const authorization = { id: '44444444-4444-4444-8444-444444444444' };
    const riskAssessment = { id: '66666666-6666-4666-8666-666666666666' };
    const intent = {
      intent_id: '55555555-5555-4555-8555-555555555555',
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
        if (/SELECT id FROM kernel_merge_authorizations/.test(sql)) {
          return { rows: [authorization] };
        }
        if (/SELECT intent\.id AS intent_id/.test(sql)) return { rows: [intent] };
        return { rows: [], rowCount: 1 };
      }),
    };
    const store = createPostgresMergeEffectStore({});

    await expect(store.createAuthorizationIntent(client, {
      proof: proof(),
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
});
