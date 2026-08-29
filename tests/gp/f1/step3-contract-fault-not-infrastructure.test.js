// F1「工厂 · 开发闭环」步骤 3「造完真验」——「结构化上报保真透传，根除 provider_exit 语义埋没 [r81]」
// 需求 3 回归护栏（补测既有能力，非 RED）：结构化终态一旦保真到达 kernel 分类，
// CONTRACT_* 家族错误码必须走既有合同故障重开 GAN 路径（arbitrate:contract_fault），
// 不进 failed_targets 黑名单、不按 infrastructure 重试。
//
// 与冻结 RED（sprints/08290210-kernel-r81-provider-exit-fidelity/tests/）互补：
// 那两条测「回执不被 provider_exit 覆盖」（埋没点①②），本条测「保真到达后分类正确」。
// 真 import derive（被改边分类逻辑，不 mock）；埋没修复后 CONTRACT_* 才可能到达此分支，
// 故本护栏防止未来回退把结构化合同故障重新误分类为 infrastructure。
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { ACTION } from '../../../packages/brain/src/orchestrator/constants.js';

function ganObserved(decisionLog) {
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
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 66, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    decisionLog,
  };
}

const generatorCallback = (detail) => ({
  hop: 70,
  action: 'verdict:attempt_callback',
  detail: { attempt_id: '44444444-4444-4444-8444-000000000070', ...detail },
});

describe('r81 需求3 — CONTRACT_* 走合同故障重开而非 infrastructure', () => {
  it('generator BLOCKED + error.code=CONTRACT_TEST_UNSATISFIABLE → arbitrate:contract_fault', () => {
    const r = derive(ganObserved([
      generatorCallback({ role: 'generator', status: 'blocked', error_code: 'CONTRACT_TEST_UNSATISFIABLE' }),
    ]));
    expect(r?.action).toBe(ACTION.ARBITRATE_CONTRACT_FAULT);
    expect(r?.reason).toBe('contract_fault_appeal');
  });

  it('对照：generator failed + provider_exit（infrastructure）→ 不进合同故障重开路径', () => {
    const r = derive(ganObserved([
      generatorCallback({ role: 'generator', status: 'failed', failure_class: 'infrastructure_blocked', error_code: 'provider_exit' }),
    ]));
    expect(r?.action).not.toBe(ACTION.ARBITRATE_CONTRACT_FAULT);
    expect(r?.action).not.toBe(ACTION.REOPEN_GAN_CONTRACT);
    expect(r?.reason).toBe('callback_infrastructure_blocked');
  });
});
