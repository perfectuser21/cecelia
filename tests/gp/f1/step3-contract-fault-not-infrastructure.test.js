// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 需求3 分类护栏：
// 结构化 BLOCKED + CONTRACT_* 家族 → 合同故障重开（arbitrate:contract_fault），
// 而非 infrastructure 黑名单重试；对照 provider_exit（infrastructure）不进合同故障重开路径。
//
// 本 sprint（r81）的 Step 1/2 保真透传让结构化终态（含 CONTRACT_* 错误码）
// 保真到达 kernel，这条护栏钉死「保真到达后按 error.code 正确分流」的既有能力，
// 防止未来把结构化合同故障重新误分类为 infrastructure。
//
// 真 import derive（被改边分类逻辑），deps 只用纯 decisionLog 构造，禁 mock derive/constants。
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { ACTION } from '../../../packages/brain/src/orchestrator/constants.js';

function ganObserved(overrides = {}) {
  return {
    run: { phase: 'gan' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: false },
    pr: null,
    candidate: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: null,
    generatorSpawned: false,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 66, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

describe('F1 step3 — 需求3 CONTRACT_* 分类护栏（合同故障重开而非 infrastructure）', () => {
  it('CONTRACT_TEST_UNSATISFIABLE blocked（error.code=CONTRACT_TEST_UNSATISFIABLE）→ 合同故障重开 arbitrate:contract_fault', () => {
    const r = derive(ganObserved({
      decisionLog: [
        { hop: 60, action: 'spawn:generator', detail: { reason: 'phase_changed' } },
        {
          hop: 64,
          action: 'verdict:attempt_callback',
          detail: {
            role: 'generator',
            status: 'blocked',
            error_code: 'CONTRACT_TEST_UNSATISFIABLE',
            attempt_id: '55555555-5555-4555-8555-000000000064',
          },
        },
      ],
    }));
    expect(r.action).toBe(ACTION.ARBITRATE_CONTRACT_FAULT);
    expect(r.reason).toBe('contract_fault_appeal');
  });

  it('provider_exit（infrastructure）→ 不进合同故障重开路径', () => {
    const r = derive(ganObserved({
      decisionLog: [
        { hop: 60, action: 'spawn:generator', detail: { reason: 'phase_changed' } },
        {
          hop: 64,
          action: 'verdict:attempt_callback',
          detail: {
            role: 'generator',
            status: 'failed',
            failure_class: 'infrastructure_blocked',
            error_code: 'provider_exit',
            attempt_id: '55555555-5555-4555-8555-000000000065',
          },
        },
      ],
    }));
    expect(r.action).not.toBe(ACTION.ARBITRATE_CONTRACT_FAULT);
    expect(r.action).not.toBe(ACTION.REOPEN_GAN_CONTRACT);
    expect(r.reason).toBe('callback_infrastructure_blocked');
  });
});
