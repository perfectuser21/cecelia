/**
 * 冻结合同测试 — derive 消费 crossCheckMismatch + 两个独立 failure_reason（修法 B）。
 *
 * Golden Path Step 3：
 *   - gan_no_push_streak 仅在观测非故障时触发；counters.crossCheckMismatch===true
 *     （proposer 成功回调数 > 观测 rn = 观测故障）时**禁止**判 gan_no_push_streak。
 *   - observed.proposalRemoteUnresolved===true → 独立终态 reason='proposal_remote_unresolved'。
 *
 * 零回归红线：crossCheckMismatch 缺省/false 时 gan_no_push_streak 行为不变
 *   （现网 100+ derive 用例不带该字段，必须保持原判死语义）。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { MAX_NO_PUSH_STREAK } from '../../../packages/brain/src/orchestrator/constants.js';

const CONTRACT_IDENTITY = Object.freeze({
  contract_id: '99999999-9999-4999-8999-999999999999',
  manifest_sha256: '9'.repeat(64),
  source_revision: '8'.repeat(64),
});

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
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: false,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: [],
    counters: {
      hops: 1, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0,
      ...(counterOverrides || {}),
    },
    ...rest,
  };
}

describe('derive gan_no_push_streak 门 crossCheckMismatch [BEHAVIOR]', () => {
  it('crossCheckMismatch=true 且 noPushStreak>=MAX 时 action 不是 gan_no_push_streak', () => {
    const r = derive(ganObserved({
      counters: { noPushStreak: MAX_NO_PUSH_STREAK, crossCheckMismatch: true },
    }));
    expect(r.reason).not.toBe('gan_no_push_streak');
    expect(r.phase).not.toBe('failed');
  });

  it('crossCheckMismatch 缺省时 noPushStreak>=MAX 仍判 gan_no_push_streak（零回归）', () => {
    const r = derive(ganObserved({
      counters: { noPushStreak: MAX_NO_PUSH_STREAK },
    }));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('gan_no_push_streak');
  });
});

describe('derive proposal_remote_unresolved 独立终态 [BEHAVIOR]', () => {
  it('proposalRemoteUnresolved=true 时 reason 为 proposal_remote_unresolved', () => {
    const r = derive(ganObserved({ proposalRemoteUnresolved: true }));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('proposal_remote_unresolved');
    expect(r.reason).not.toBe('gan_no_push_streak');
  });
});
