/**
 * [BEHAVIOR] 冻结合同测试 — derive 按确定性 impact reason 路由出口（TDD Red）
 *
 * PRD 验收 bullet 2（后半）：impact 闸 retryable=false 的确定性结论，不再退避重试，
 * 由 derive 按 reason 路由既有出口：
 *   - reason=impact_anchor_missing（首次）→ spawn:generator-fix，携带 unclaimed_files 清单
 *   - reason=impact_anchor_missing（本 head 已 generator-fix 过一次仍同 reason）→ wait:human_review
 *   - reason=capability_assertion_coverage_missing → 直接 wait:human_review
 *
 * 信号来源：loop.js 在 impact 闸 blocked 时向 orchestrator_decision_log 落一行
 * gate_verdict='deny:impact:<reason>' + detail.impact_gate={reason,retryable,detail}
 * （loop.js:1454 + 1514）。derive 下一跳读 decisionLog 该行按 reason 路由。
 *
 * 现行 derive.js 无 impact 路由分支 → 对该状态返回 spawn:evaluator（无 evaluate verdict）
 * → 断言失败（Red）。禁 mock：derive 是纯函数，真调，无替身。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const HEAD = 'b'.repeat(40);

function impactBlockedLogRow({ hop, reason, unclaimed_files = [], capability_ids = [] }) {
  return {
    hop,
    action: 'spawn:evaluator',
    gate_verdict: `deny:impact:${reason}`,
    derived_phase: 'evaluate',
    observed: { head_sha: HEAD },
    detail: {
      reason: 'no_evaluate_verdict_for_head_sha',
      impact_gate: {
        stage: 'diff',
        gate: 'blocked',
        reason,
        retryable: false,
        detail: { unclaimed_files, capability_ids },
      },
    },
  };
}

function priorGeneratorFixRow(hop) {
  return {
    hop,
    action: 'spawn:generator-fix',
    gate_verdict: 'allow',
    derived_phase: 'generate',
    observed: { head_sha: HEAD, trigger_sha: HEAD },
    detail: { reason: 'impact_anchor_missing', failure_class: 'impact_contract_invalid' },
  };
}

function baseObserved(decisionLog) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, identity: null },
    pr: null,
    candidate: {
      type: 'git_candidate',
      verification_status: 'verified',
      repo: 'perfectuser21/cecelia',
      head_sha: HEAD,
    },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog,
    counters: { hops: 3, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
  };
}

describe('derive — 确定性 impact 结论按 reason 路由（合同冻结）', () => {
  it('impact_anchor_missing 首次 → spawn:generator-fix，detail 带 unclaimed_files', () => {
    const decision = derive(baseObserved([
      impactBlockedLogRow({ hop: 1, reason: 'impact_anchor_missing', unclaimed_files: ['DoD.md'] }),
    ]));
    expect(decision.action).toBe('spawn:generator-fix');
    expect(decision.detail?.unclaimed_files ?? decision.unclaimed_files).toEqual(['DoD.md']);
  });

  it('impact_anchor_missing 本 head 已 generator-fix 过一次仍同 reason → wait:human_review', () => {
    const decision = derive(baseObserved([
      impactBlockedLogRow({ hop: 1, reason: 'impact_anchor_missing', unclaimed_files: ['DoD.md'] }),
      priorGeneratorFixRow(2),
      impactBlockedLogRow({ hop: 3, reason: 'impact_anchor_missing', unclaimed_files: ['DoD.md'] }),
    ]));
    expect(decision.action).toBe('wait:human_review');
  });

  it('capability_assertion_coverage_missing → 直接 wait:human_review', () => {
    const decision = derive(baseObserved([
      impactBlockedLogRow({ hop: 1, reason: 'capability_assertion_coverage_missing', capability_ids: ['G1'] }),
    ]));
    expect(decision.action).toBe('wait:human_review');
  });
});
