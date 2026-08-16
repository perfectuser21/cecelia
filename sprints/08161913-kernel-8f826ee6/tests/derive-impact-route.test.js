/**
 * 合同冻结测试 — derive 对 retryable:false 的确定性 impact 结论按 reason 路由
 * （PRD Golden Path Step 5-6）
 *
 * 禁 mock 边：orchestrator/derive.derive() 纯函数状态机真调，禁 mock；observed / decisionLog
 * 手工注入（decisionLog 是纯数据，非被 mock 的模块本体，符合既有 derive 测试惯例）。
 *
 * TDD Red：旧 derive 不识别 impact_gate 确定性阻断 → 在「候选就绪待 evaluate」态下
 * 返回 spawn:evaluator（无限重试根因），本文件断言 spawn:generator-fix / wait:human_review
 * 在旧代码下 FAIL。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const CONTRACT_IDENTITY = Object.freeze({
  contract_id: '11111111-2222-4333-8444-555555555555',
  manifest_sha256: 'b'.repeat(64),
  source_revision: 'c'.repeat(40),
});

// 候选已就绪、CI pass、generator 已派——若无 impact 阻断，derive 会返回 spawn:evaluator。
const candidateReady = (decisionLog) => ({
  run: { phase: 'evaluating' },
  task: { status: 'in_progress' },
  prdExists: true,
  contract: { approved: true, id: CONTRACT_IDENTITY.contract_id, identity: CONTRACT_IDENTITY },
  pr: { url: 'https://example/pr/1', state: 'open', ci: 'pass', merged: false, head_sha: 'sha-1' },
  inflight: { containers: [], host_pids: [], attempts: [] },
  lastAgentExit: { code: 0, auth_failed: false, action: null },
  proposeBranchRn: null,
  ganLatestRoundVerdict: null,
  generatorSpawned: true,
  evaluateVerdict: null,
  judgeVerdict: null,
  reviewRequired: false,
  reviewApproved: false,
  counters: { hop: 4, noPushStreak: 0, noVerdictStreak: 0 },
  decisionLog,
  gear: 'default',
});

function impactBlockRow(hop, reason, detail) {
  return {
    hop,
    action: 'spawn:evaluator',
    gate_verdict: `deny:impact:${reason}`,
    detail: {
      impact_gate: {
        stage: 'diff',
        gate: 'blocked',
        reason,
        retryable: false,
        detail,
      },
    },
  };
}

describe('derive 对确定性 impact 结论按 reason 路由 [BEHAVIOR]', () => {
  it('impact_anchor_missing 首次 → spawn:generator-fix，detail 带 unclaimed_files（不再退避重试 spawn:evaluator）', () => {
    const observed = candidateReady([
      impactBlockRow(4, 'impact_anchor_missing', { unclaimed_files: ['DoD.md'], capability_ids: [] }),
    ]);
    const d = derive(observed);
    expect(d.action).toBe('spawn:generator-fix');
    expect(d.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  it('impact_anchor_missing 已 generator-fix 一次仍阻断 → wait:human_review', () => {
    const observed = candidateReady([
      { hop: 3, action: 'spawn:generator-fix', detail: { reason: 'impact_anchor_missing', impact_gate: { reason: 'impact_anchor_missing', retryable: false } } },
      impactBlockRow(5, 'impact_anchor_missing', { unclaimed_files: ['DoD.md'], capability_ids: [] }),
    ]);
    const d = derive(observed);
    expect(d.action).toBe('wait:human_review');
  });

  it('capability_assertion_coverage_missing → 直接 wait:human_review（需人补断言，不派 generator-fix）', () => {
    const observed = candidateReady([
      impactBlockRow(4, 'capability_assertion_coverage_missing', { unclaimed_files: [], capability_ids: ['G1'] }),
    ]);
    const d = derive(observed);
    expect(d.action).toBe('wait:human_review');
  });
});
