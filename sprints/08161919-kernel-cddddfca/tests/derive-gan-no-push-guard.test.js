/**
 * 冻结合同测试 — derive gan_no_push_streak 触发门（根因 #2）。
 *
 * 纯函数 derive(observed)，无外部依赖、无 mock（derive 刻意不 import DB）。
 * 断言三点：
 *  1) crossCheckMismatch===true 且 noPushStreak 已达上限 → 不再以 gan_no_push_streak 失败（观测故障不算真无 push）。
 *  2) observed.proposalRemoteUnresolved===true → 独立 failure_reason='proposal_remote_unresolved'。
 *  3) 零回归：crossCheckMismatch===false 且真无 push → 保持 gan_no_push_streak 原语义不变。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import * as constants from '../../../packages/brain/src/orchestrator/constants.js';

const { MAX_NO_PUSH_STREAK } = constants;

const CURRENT_CONTRACT_IDENTITY = Object.freeze({
  contract_id: '99999999-9999-4999-8999-999999999999',
  manifest_sha256: '9'.repeat(64),
  source_revision: '8'.repeat(64),
});

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: false, identity: CURRENT_CONTRACT_IDENTITY },
    pr: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: [],
    counters: {
      hops: 5, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0,
      ganCostUsd: 0, crossCheckMismatch: false,
    },
    ...overrides,
  };
}

describe('derive：gan_no_push_streak 触发门加 crossCheckMismatch 守卫', () => {
  it('crossCheckMismatch=true 且 noPushStreak>=上限 → action 不是 gan_no_push_streak（观测故障不误判）', () => {
    const r = derive(baseObserved({
      counters: {
        hops: 5, fixRound: 0, pollCount: 0, noPushStreak: MAX_NO_PUSH_STREAK,
        noVerdictStreak: 0, ganCostUsd: 0, crossCheckMismatch: true,
      },
    }));
    expect(r.reason).not.toBe('gan_no_push_streak');
    expect(r.phase).not.toBe('failed');
  });

  it('proposalRemoteUnresolved=true → 独立 failure_reason=proposal_remote_unresolved', () => {
    const r = derive(baseObserved({ proposalRemoteUnresolved: true }));
    expect(r.phase).toBe('failed');
    expect(r.action).toBe('mark_failed');
    expect(r.reason).toBe('proposal_remote_unresolved');
  });

  it('零回归：crossCheckMismatch=false 且真无 push（noPushStreak>=上限）→ 仍是 gan_no_push_streak', () => {
    const r = derive(baseObserved({
      counters: {
        hops: 5, fixRound: 0, pollCount: 0, noPushStreak: MAX_NO_PUSH_STREAK,
        noVerdictStreak: 0, ganCostUsd: 0, crossCheckMismatch: false,
      },
    }));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('gan_no_push_streak');
  });
});
