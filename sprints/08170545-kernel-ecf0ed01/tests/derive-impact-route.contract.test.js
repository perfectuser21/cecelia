/**
 * 冻结合同测试（TDD Red）— Sprint 08170545-kernel-ecf0ed01
 * derive 对 retryable:false 的 impact 确定性结论按 reason 路由，不再退避重试。
 *
 * 覆盖 Golden Path Step 3：
 *   - impact_anchor_missing → spawn:generator-fix（候选可修：删/挪无主文件），一次；
 *   - capability_assertion_coverage_missing → wait:human_review（需人补断言）。
 *
 * 合同约定的 wire shape：loop.js 把 impact 确定性 deny 记为 verdict:attempt_callback，
 * detail = { role, status:'blocked', failure_class:'impact_contract_invalid',
 *            reason:<原 reason_code>, unclaimed_files:[...] }；derive 按 detail.reason 分流。
 */

import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

function observed(decisionLog) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: null,
    candidate: { head_sha: 'b'.repeat(40) },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false, action: 'spawn:evaluator' },
    proposeBranchRn: 2,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: {
      hops: 6,
      fixRound: 0,
      pollCount: 0,
      noPushStreak: 0,
      noVerdictStreak: 0,
      ganCostUsd: 0,
    },
    decisionLog,
  };
}

function impactDeny(reason, extra = {}) {
  return [
    { hop: 4, action: 'spawn:evaluator', observed: {} },
    {
      hop: 5,
      action: 'verdict:attempt_callback',
      detail: {
        role: 'evaluator',
        hop: 4,
        status: 'blocked',
        failure_class: 'impact_contract_invalid',
        reason,
        ...extra,
      },
    },
  ];
}

describe('derive impact 确定性出口路由', () => {
  it('impact_anchor_missing → spawn:generator-fix（一次），不再退避/等人审', () => {
    const decision = derive(observed(impactDeny('impact_anchor_missing', {
      unclaimed_files: ['DoD.md'],
    })));
    expect(decision.action).toBe('spawn:generator-fix');
    expect(decision.phase).toBe('generate');
  });

  it('capability_assertion_coverage_missing → wait:human_review', () => {
    const decision = derive(observed(impactDeny('capability_assertion_coverage_missing')));
    expect(decision.action).toBe('wait:human_review');
    expect(decision.phase).toBe('review');
  });

  it('impact_anchor_missing 已 generator-fix 过一次仍 blocked → 兜底 wait:human_review（防 fix↔gate 死循环）', () => {
    const log = [
      { hop: 2, action: 'spawn:evaluator', observed: {} },
      {
        hop: 3,
        action: 'verdict:attempt_callback',
        detail: {
          role: 'evaluator', hop: 2, status: 'blocked',
          failure_class: 'impact_contract_invalid', reason: 'impact_anchor_missing',
          unclaimed_files: ['DoD.md'],
        },
      },
      { hop: 4, action: 'spawn:generator-fix', observed: { failure_class: 'impact_contract_invalid', trigger_reason: 'impact_anchor_missing' } },
      { hop: 5, action: 'spawn:evaluator', observed: {} },
      {
        hop: 6,
        action: 'verdict:attempt_callback',
        detail: {
          role: 'evaluator', hop: 5, status: 'blocked',
          failure_class: 'impact_contract_invalid', reason: 'impact_anchor_missing',
          unclaimed_files: ['DoD.md'],
        },
      },
    ];
    const decision = derive(observed(log));
    expect(decision.action).toBe('wait:human_review');
    expect(decision.phase).toBe('review');
  });
});
