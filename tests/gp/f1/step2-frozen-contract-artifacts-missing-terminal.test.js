// F1「工厂 · 开发闭环」步骤 2「合同即法律」—— 边：approved 合同但冻结产物未落地时，
// derive 必须在派 generator 前直接终局，绝不越过节点准入进装配热循环。
//
// 2026-09-24 run 60c1f156 案卷：合同已 approved 但冻结产物表零行（materialize 未落地）。
// derive 仍照常派 generator → 装配层（dispatcher buildAttemptCommon）抛
// FROZEN_CONTRACT_ARTIFACTS_MISSING:approved_contract → pre-attempt BLOCKED；该 BLOCKED
// 不置 generatorSpawned，下一跳仍落同分支重派 → 越过节点准入后 19 跳热循环烧到 deadline。
// 修：观测到 approved + contract.artifacts 空数组即 MARK_FAILED（合同不齐 = 不成法，不进装配）。
//
// 真 import 被改模块 derive.js（守卫在边上），不 mock 它。
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { ACTION } from '../../../packages/brain/src/orchestrator/constants.js';

const CONTRACT_IDENTITY = Object.freeze({
  contract_id: '99999999-9999-4999-8999-999999999999',
  manifest_sha256: '9'.repeat(64),
  source_revision: '8'.repeat(64),
});

// 派 generator 前的最小观测：既无远端 PR 也无本地候选，未派过 generator。
function freshGenerate(contract) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract,
    pr: null,
    candidate: null,
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
    counters: { hops: 5, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
  };
}

describe('F1 step2 · approved 合同冻结产物未落地时 derive 直接终局（run 60c1f156 热循环根治）', () => {
  it('approved 且 contract.artifacts 为空数组 → MARK_FAILED，绝不 spawn:generator 进装配', () => {
    const decision = derive(freshGenerate({
      approved: true, identity: CONTRACT_IDENTITY, artifacts: [],
    }));
    expect(decision.phase).toBe('failed');
    expect(decision.action).toBe(ACTION.MARK_FAILED);
    expect(decision.reason).toBe('frozen_contract_artifacts_missing');
  });

  it('approved 且 contract.artifacts 非空（健康合同）→ 仍正常 spawn:generator', () => {
    const decision = derive(freshGenerate({
      approved: true, identity: CONTRACT_IDENTITY, artifacts: [{ path: 'sprints/x/tests/a.test.mjs' }],
    }));
    expect(decision.action).toBe('spawn:generator');
    expect(decision.reason).toBe('contract_approved');
  });

  it('contract.artifacts 缺省（非数组）→ 守卫让路，零回归 spawn:generator', () => {
    const decision = derive(freshGenerate({ approved: true, identity: CONTRACT_IDENTITY }));
    expect(decision.action).toBe('spawn:generator');
    expect(decision.reason).toBe('contract_approved');
  });
});
