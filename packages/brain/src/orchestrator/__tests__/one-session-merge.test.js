import { describe, expect, it, vi } from 'vitest';
import { executeOneSessionMerge } from '../one-session-merge.js';

const IDENTITY = Object.freeze({
  contract_id: '22222222-3333-4444-8555-666666666666',
  manifest_sha256: 'b'.repeat(64),
  source_revision: 'c'.repeat(40),
});

function observed(overrides = {}) {
  const verdict = { verdict: 'PASS', pr_head_sha: 'a'.repeat(40), contract_identity: IDENTITY };
  return {
    run: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', phase: 'review', cost_usd: 0 },
    task: { id: '11111111-2222-4333-8444-555555555555', status: 'in_progress', payload: {} },
    prdExists: true,
    contract: { approved: true, identity: IDENTITY },
    pr: {
      url: 'https://github.com/example/repo/pull/1',
      state: 'OPEN',
      merged: false,
      ci: 'pass',
      head_sha: 'a'.repeat(40),
      mergeStateStatus: 'CLEAN',
    },
    candidate: null,
    inflight: { attempts: [], containers: [], host_pids: [] },
    lastAgentExit: { code: null, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: { verdict: 'APPROVED' },
    generatorSpawned: true,
    evaluateVerdict: verdict,
    judgeVerdict: verdict,
    evaluateResult: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: [],
    counters: {
      hops: 0,
      fixRound: 0,
      pollCount: 0,
      noPushStreak: 0,
      noVerdictStreak: 0,
      ganCostUsd: 0,
    },
    ...overrides,
  };
}

function deps(value = observed()) {
  const order = [];
  return {
    order,
    collect: vi.fn(async () => value),
    impactGate: {
      beforeMerge: vi.fn(async () => ({ gate: 'pass', contract_hash: 'd'.repeat(64) })),
    },
    appendHop: vi.fn(async (_pool, entry) => { order.push(`append:${entry.action}`); }),
    nextHop: vi.fn(async () => 9),
    dispatch: vi.fn(async (action) => {
      order.push(`dispatch:${action}`);
      return { status: 'DONE', detail: 'merge requested' };
    }),
  };
}

describe('executeOneSessionMerge', () => {
  it('仅在 exact SHA + exact frozen contract 双 PASS 后 intent-before-dispatch merge', async () => {
    const d = deps();
    const result = await executeOneSessionMerge({
      pool: {},
      taskId: '11111111-2222-4333-8444-555555555555',
      runId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      ...d,
    });
    expect(result).toMatchObject({ status: 'DONE' });
    expect(d.order).toEqual(['append:merge_pr', 'dispatch:merge_pr', 'append:result:dispatch']);
    expect(d.impactGate.beforeMerge).toHaveBeenCalledOnce();
  });

  it('旧合同 Judge PASS 不得进入 dispatch', async () => {
    const stale = observed({
      judgeVerdict: {
        verdict: 'PASS',
        pr_head_sha: 'a'.repeat(40),
        contract_identity: { ...IDENTITY, manifest_sha256: 'e'.repeat(64) },
      },
    });
    const d = deps(stale);
    await expect(executeOneSessionMerge({
      pool: {},
      taskId: stale.task.id,
      runId: stale.run.id,
      ...d,
    })).rejects.toThrow('one_session_merge_gate_denied');
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('Impact merge fence 非 pass 时不得写 intent 或 merge', async () => {
    const d = deps();
    d.impactGate.beforeMerge.mockResolvedValue({ gate: 'blocked', reason: 'gap_dependencies' });
    await expect(executeOneSessionMerge({
      pool: {},
      taskId: '11111111-2222-4333-8444-555555555555',
      runId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      ...d,
    })).rejects.toThrow('one_session_impact_gate_denied:gap_dependencies');
    expect(d.appendHop).not.toHaveBeenCalled();
    expect(d.dispatch).not.toHaveBeenCalled();
  });
});
