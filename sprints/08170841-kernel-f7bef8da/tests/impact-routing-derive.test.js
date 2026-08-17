/**
 * 合同冻结测试 — 确定性 impact 结论的 derive 路由出口（PRD 修法 B/C）
 *
 * 背景：impact 闸 retryable=false 的确定性 blocked 结论，不再按 infrastructure_blocked
 * 退避/无限重试（也不再直接 failRun 空转），而由 derive 读 decisionLog 里的 impact-blocked
 * 收据，路由到既有确定性出口：
 *   - reason=impact_anchor_missing → 先一次 spawn:generator-fix（候选可修：删/挪无主文件）
 *   - reason=capability_assertion_coverage_missing → 直接 wait:human_review（需人补断言）
 *   - impact_anchor_missing 已 generator-fix 过一次仍 blocked → wait:human_review（不无限修）
 *
 * derive 是纯函数：本测试真调 derive(observed)，不 mock derive（禁 mock 被改的边）。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { ACTION } from '../../../packages/brain/src/orchestrator/constants.js';

const HEAD = 'c'.repeat(40);

function impactBlockedRow(hop, reason, extraDetail = {}) {
  return {
    hop,
    action: ACTION.SPAWN_EVALUATOR,
    gate_verdict: `deny:impact:${reason}`,
    observed: { trigger_sha: HEAD, pr: { head_sha: HEAD } },
    detail: {
      reason: 'contract_approved',
      impact_gate: {
        stage: 'diff',
        gate: 'blocked',
        reason,
        retryable: false,
        detail: { unclaimed_files: reason === 'impact_anchor_missing' ? ['DoD.md'] : [], capability_ids: reason === 'capability_assertion_coverage_missing' ? ['G1'] : [] },
        ...extraDetail,
      },
    },
  };
}

function baseObserved(decisionLog) {
  return {
    run: { phase: 'B_task_loop' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, identity: null },
    pr: null,
    candidate: { head_sha: HEAD },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { action: null, code: 0 },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 0, pollCount: 0, fixRound: 0 },
    decisionLog,
  };
}

describe('确定性 impact 结论 derive 路由 [BEHAVIOR]', () => {
  it('impact_anchor_missing 且未修过 → 下一动作 spawn:generator-fix', () => {
    const decision = derive(baseObserved([impactBlockedRow(3, 'impact_anchor_missing')]));
    expect(decision.action).toBe(ACTION.SPAWN_GENERATOR_FIX);
  });

  it('impact_anchor_missing 路由的 generator-fix 携带 unclaimed_files 清单', () => {
    const decision = derive(baseObserved([impactBlockedRow(3, 'impact_anchor_missing')]));
    expect(decision.action).toBe(ACTION.SPAWN_GENERATOR_FIX);
    // 无主文件清单必须随路由下传，供 generator-fix 删/挪无主文件
    const carried = decision.detail?.unclaimed_files ?? decision.unclaimed_files;
    expect(carried).toEqual(['DoD.md']);
  });

  it('capability_assertion_coverage_missing → 下一动作 wait:human_review', () => {
    const decision = derive(baseObserved([impactBlockedRow(3, 'capability_assertion_coverage_missing')]));
    expect(decision.action).toBe(ACTION.WAIT_HUMAN_REVIEW);
  });

  it('impact_anchor_missing 已 generator-fix 一次仍 blocked → wait:human_review（不无限修）', () => {
    const decisionLog = [
      impactBlockedRow(3, 'impact_anchor_missing'),
      {
        hop: 4,
        action: ACTION.SPAWN_GENERATOR_FIX,
        observed: { trigger_sha: HEAD },
        detail: { reason: 'impact_anchor_missing_generator_fix', impact_gate: { reason: 'impact_anchor_missing' } },
      },
      impactBlockedRow(6, 'impact_anchor_missing'),
    ];
    const decision = derive(baseObserved(decisionLog));
    expect(decision.action).toBe(ACTION.WAIT_HUMAN_REVIEW);
  });
});
