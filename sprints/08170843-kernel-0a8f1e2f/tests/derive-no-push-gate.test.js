/**
 * 合同冻结测试 — derive gan_no_push_streak 误判闸。
 *
 * 被改的边：derive 状态机（观测故障 vs GAN 逻辑失败的归因）。纯函数，直接构造 observed。
 *
 * 规则（PRD 系统处理 B）：
 *  - counters.crossCheckMismatch===true → 视为观测故障：不得触发 gan_no_push_streak（重新观测，noPushStreak 不算数）。
 *  - counters.crossCheckMismatch===true 且 counters.proposalObservationMismatchStreak>=3 → mark_failed，reason='proposal_observation_mismatch'。
 *  - observed.proposalRemoteUnresolved===true → mark_failed，reason='proposal_remote_unresolved'。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { MAX_NO_PUSH_STREAK } from '../../../packages/brain/src/orchestrator/constants.js';

function ganObserved(overrides = {}) {
  const { counters: counterOverrides, ...rest } = overrides;
  return {
    run: { phase: 'gan' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: false },
    pr: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: null,
    generatorSpawned: false,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: [],
    counters: {
      hops: 5, fixRound: 0, pollCount: 0,
      noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0,
      crossCheckMismatch: false, proposalObservationMismatchStreak: 0,
      ...(counterOverrides || {}),
    },
    ...rest,
  };
}

describe('derive gan_no_push_streak 误判闸', () => {
  it('crossCheckMismatch=true 且 noPushStreak>=MAX → 不判 gan_no_push_streak（观测故障重新观测）', () => {
    const r = derive(ganObserved({
      counters: { crossCheckMismatch: true, noPushStreak: MAX_NO_PUSH_STREAK },
    }));
    expect(r.reason).not.toBe('gan_no_push_streak');
    expect(r.phase).not.toBe('failed');
  });

  it('crossCheckMismatch=true 且 proposalObservationMismatchStreak>=3 → mark_failed reason=proposal_observation_mismatch', () => {
    const r = derive(ganObserved({
      counters: { crossCheckMismatch: true, noPushStreak: 0, proposalObservationMismatchStreak: 3 },
    }));
    expect(r.action).toBe('mark_failed');
    expect(r.reason).toBe('proposal_observation_mismatch');
  });

  it('proposalRemoteUnresolved=true → mark_failed reason=proposal_remote_unresolved（独立 failure_reason）', () => {
    const r = derive(ganObserved({
      proposalRemoteUnresolved: true,
    }));
    expect(r.action).toBe('mark_failed');
    expect(r.reason).toBe('proposal_remote_unresolved');
  });

  it('crossCheckMismatch=false 且 noPushStreak>=MAX → 仍照旧判 gan_no_push_streak（零回归）', () => {
    const r = derive(ganObserved({
      counters: { crossCheckMismatch: false, noPushStreak: MAX_NO_PUSH_STREAK },
    }));
    expect(r.action).toBe('mark_failed');
    expect(r.reason).toBe('gan_no_push_streak');
  });
});
