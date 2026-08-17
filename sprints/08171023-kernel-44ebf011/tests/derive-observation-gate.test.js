/**
 * TDD Red — derive.js gan_no_push_streak 门控 + 两个独立 failure_reason。
 * 复现 run 7a8e5319：proposer 真实 push（回调数 > 观测 rn → crossCheckMismatch=true），
 * 旧代码仍以 gan_no_push_streak 假失败；新代码把 mismatch 当观测故障，重新观测，
 * 连续 3 次才以 proposal_observation_mismatch 失败；remote 解析不到则独立 proposal_remote_unresolved。
 *
 * 被测边（禁 mock）：derive.js 纯状态机 —— 真调 derive(observed)，无替身。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { MAX_NO_PUSH_STREAK, MAX_OBSERVATION_MISMATCH_STREAK } from '../../../packages/brain/src/orchestrator/constants.js';

const CURRENT_CONTRACT_IDENTITY = Object.freeze({
  contract_id: '99999999-9999-4999-8999-999999999999',
  manifest_sha256: '9'.repeat(64),
  source_revision: '8'.repeat(64),
});

// 到达 deriveGan 的最小 observed（对齐 derive.test.js baseObserved + gan 助手）：
// 无 routingReceipt → 走 gear=default 路径；prdExists=true；contract.approved=false；pr=null。
function gan(counters, overrides = {}) {
  return {
    run: { phase: 'gan' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: false, identity: CURRENT_CONTRACT_IDENTITY },
    pr: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 0,
    proposeBranchSha: null,
    ganLatestRoundVerdict: null,
    generatorSpawned: false,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: [],
    caseFile: [],
    counters: {
      hops: 1, fixRound: 0, pollCount: 0, noVerdictStreak: 0, ganCostUsd: 0,
      ...counters,
    },
    ...overrides,
  };
}

describe('derive gan_no_push_streak 门控 crossCheckMismatch [BEHAVIOR]', () => {
  it('crossCheckMismatch=false 且 noPushStreak>=MAX → 仍触发 gan_no_push_streak（原语义不回归）', () => {
    const r = derive(gan({ noPushStreak: MAX_NO_PUSH_STREAK, crossCheckMismatch: false }));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('gan_no_push_streak');
  });

  it('crossCheckMismatch=true 且 noPushStreak>=MAX（观测未满 3 次）→ 绝不判 gan_no_push_streak', () => {
    const r = derive(gan({
      noPushStreak: MAX_NO_PUSH_STREAK,
      crossCheckMismatch: true,
      observationMismatchStreak: 0,
    }));
    expect(r.reason).not.toBe('gan_no_push_streak');
    // 观测故障不终局：不得 mark_failed，重新观测
    expect(r.phase).not.toBe('failed');
    expect(r.reason).toBe('proposal_observation_mismatch');
  });

  it('crossCheckMismatch=true 连续 3 次仍 mismatch → 以 proposal_observation_mismatch 终态失败', () => {
    const r = derive(gan({
      noPushStreak: MAX_NO_PUSH_STREAK,
      crossCheckMismatch: true,
      observationMismatchStreak: MAX_OBSERVATION_MISMATCH_STREAK,
    }));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('proposal_observation_mismatch');
    expect(r.reason).not.toBe('gan_no_push_streak');
  });
});

describe('derive proposalRemoteUnresolved → 独立 failure_reason [BEHAVIOR]', () => {
  it('proposalRemoteUnresolved=true → mark_failed 且 reason=proposal_remote_unresolved（不复用 gan_no_push_streak）', () => {
    const r = derive(gan(
      { noPushStreak: 0, crossCheckMismatch: false },
      { proposalRemoteUnresolved: true },
    ));
    expect(r.phase).toBe('failed');
    expect(r.action).toBe('mark_failed');
    expect(r.reason).toBe('proposal_remote_unresolved');
    expect(r.reason).not.toBe('gan_no_push_streak');
  });
});
