// 冻结合同测试 — loop/derive 对 retryable=false 的 impact 确定性结论按 reason 路由（modification B 第 2 部分）
// sprint: 08161127-kernel-0bce0b07
//
// 覆盖父路：独立小路（无父路）。
//
// 被测边：derive(observed) ↔ decisionLog 中最新的 impact 闸 deny 行（loop.js 落库形态）。
// derive 是纯函数（无 DB），decisionLog 为数组；不 mock derive 本身，构造真实落库形态的 deny 行喂进去。
// deny 行的 detail.impact_gate 形态与 loop.js append 落库逐字对齐（gate_verdict + detail.impact_gate.{reason,retryable,detail}）。
// 旧 derive 无 impact 分支 → 返回 spawn:evaluator（no_evaluate_verdict_for_head_sha）→ RED。
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const HEAD = 'a'.repeat(40);

function observed(decisionLog: unknown[]) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: { head_sha: HEAD, merged: false },
    candidate: { head_sha: HEAD },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false, action: 'spawn:generator' },
    proposeBranchRn: 2,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 6, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    decisionLog,
  };
}

/** loop.js append 落库的 impact 闸 deny 行形态（见 loop.js 1486-1516 / 1442-1451）。 */
function impactDenyRow(hop: number, reason: string, detail: Record<string, unknown> = {}) {
  return {
    hop,
    action: 'spawn:evaluator',
    gate_verdict: `deny:impact:${reason}`,
    detail: {
      reason: 'candidate_ready_for_evaluate',
      impact_gate: {
        stage: 'diff',
        gate: 'blocked',
        reason,
        retryable: false,
        failure_class: 'impact_contract_invalid',
        detail,
      },
    },
  };
}

describe('derive 对 impact 确定性结论按 reason 路由 [BEHAVIOR]', () => {
  it('impact_anchor_missing（retryable=false）→ 下一动作 spawn:generator-fix，携带 unclaimed_files', () => {
    const decision = derive(observed([
      { hop: 4, action: 'spawn:generator', observed: {} },
      impactDenyRow(6, 'impact_anchor_missing', { unclaimed_files: ['DoD.md'] }),
    ]));
    expect(decision.action).toBe('spawn:generator-fix');
  });

  it('capability_assertion_coverage_missing（retryable=false）→ 下一动作 wait:human_review', () => {
    const decision = derive(observed([
      { hop: 4, action: 'spawn:generator', observed: {} },
      impactDenyRow(6, 'capability_assertion_coverage_missing', { uncovered_capability_ids: ['G1'] }),
    ]));
    expect(decision.action).toBe('wait:human_review');
  });
});
