/**
 * derive-gan-observation.test.ts —— 合同冻结测试（TDD Red）
 *
 * 覆盖父路: 独立小路（无父路）—— packages/brain 后端 kernel 观测修复。
 *
 * 对应 PRD 修法 B（derive.js）：
 *   B1. gan_no_push_streak 只允许在 counters.crossCheckMismatch===false 时触发。
 *   B2. crossCheckMismatch===true（成功回调数 > 观测 rn）= 观测故障：不失败、重新观测
 *       （action=wait:running, reason=proposal_observation_mismatch），不递增 noPushStreak。
 *   B3. 连续 MAX_OBSERVATION_MISMATCH(3) 次仍 mismatch → mark_failed reason=proposal_observation_mismatch。
 *   B4. observed.proposalRemoteUnresolved===true → mark_failed reason=proposal_remote_unresolved
 *       （独立 failure_reason，绝不再记成 gan_no_push_streak）。
 *
 * derive 是纯函数，无外部依赖 —— 无需 mock 任何边（见合同「禁 mock 边清单」：derive 为纯函数）。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

// 与 packages/brain/src/orchestrator/constants.js MAX_NO_PUSH_STREAK 一致（2）。
const NO_PUSH_STREAK_AT_CAP = 2;

/**
 * 造一个能路由进 deriveGan 的 observed（contract 未 approved，无 executionProfile / receipt）。
 * 字段集合对齐 derive.js REQUIRED_FIELDS；proposalRemoteUnresolved / decisionLog 为可选注入。
 */
function ganObserved(overrides: Record<string, unknown> = {}) {
  const {
    counters: counterOverride = {},
    ...rest
  } = overrides as { counters?: Record<string, unknown> };
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
    counters: {
      hops: 5,
      fixRound: 0,
      pollCount: 0,
      noPushStreak: 0,
      noVerdictStreak: 0,
      ganCostUsd: 0,
      crossCheckMismatch: false,
      ...counterOverride,
    },
    ...rest,
  };
}

describe('derive GAN 观测修复 [BEHAVIOR]', () => {
  it('B1: crossCheckMismatch=false 且 noPushStreak 到顶 → 仍判 gan_no_push_streak（零回归）', () => {
    const r = derive(ganObserved({
      counters: { noPushStreak: NO_PUSH_STREAK_AT_CAP, crossCheckMismatch: false },
    }));
    expect(r.action).toBe('mark_failed');
    expect(r.reason).toBe('gan_no_push_streak');
  });

  it('B1/B2: crossCheckMismatch=true 且 noPushStreak 到顶 → 绝不判 gan_no_push_streak，改为重新观测', () => {
    const r = derive(ganObserved({
      counters: { noPushStreak: NO_PUSH_STREAK_AT_CAP, crossCheckMismatch: true },
    }));
    expect(r.reason).not.toBe('gan_no_push_streak');
    expect(r.action).not.toBe('mark_failed');
    expect(r.action).toBe('wait:running');
    expect(r.reason).toBe('proposal_observation_mismatch');
  });

  it('B3: crossCheckMismatch=true 且已连续 3 次观测故障 → mark_failed reason=proposal_observation_mismatch', () => {
    const priorMismatches = [
      { hop: 6, action: 'verdict:proposal_observation_mismatch', detail: {} },
      { hop: 7, action: 'verdict:proposal_observation_mismatch', detail: {} },
      { hop: 8, action: 'verdict:proposal_observation_mismatch', detail: {} },
    ];
    const r = derive(ganObserved({
      counters: { noPushStreak: NO_PUSH_STREAK_AT_CAP, crossCheckMismatch: true },
      decisionLog: priorMismatches,
    }));
    expect(r.action).toBe('mark_failed');
    expect(r.reason).toBe('proposal_observation_mismatch');
  });

  it('B3: 仅 2 次观测故障（未到 3）→ 继续重新观测，不失败', () => {
    const priorMismatches = [
      { hop: 6, action: 'verdict:proposal_observation_mismatch', detail: {} },
      { hop: 7, action: 'verdict:proposal_observation_mismatch', detail: {} },
    ];
    const r = derive(ganObserved({
      counters: { noPushStreak: NO_PUSH_STREAK_AT_CAP, crossCheckMismatch: true },
      decisionLog: priorMismatches,
    }));
    expect(r.action).not.toBe('mark_failed');
    expect(r.action).toBe('wait:running');
    expect(r.reason).toBe('proposal_observation_mismatch');
  });

  it('B4: proposalRemoteUnresolved=true → mark_failed reason=proposal_remote_unresolved（独立 failure_reason）', () => {
    const r = derive(ganObserved({
      proposalRemoteUnresolved: true,
      counters: { noPushStreak: NO_PUSH_STREAK_AT_CAP, crossCheckMismatch: false },
    }));
    expect(r.action).toBe('mark_failed');
    expect(r.reason).toBe('proposal_remote_unresolved');
    expect(r.reason).not.toBe('gan_no_push_streak');
  });
});
