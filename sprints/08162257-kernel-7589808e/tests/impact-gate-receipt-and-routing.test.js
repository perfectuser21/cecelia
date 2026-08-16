/**
 * 冻结合同测试 — beforeEvaluate gateReceipt 透传 + 确定性 impact 结论路由
 * sprint: 08162257-kernel-7589808e
 *
 * (1) harness-gates.js gateReceipt 目前只带 reason/retryable，丢掉 detail →
 *     运维无法从 orchestrator_decision_log 判因（unclaimed_files / 缺覆盖能力）。
 *     修法：gateReceipt 透传 result.detail。
 * (2) loop.js 现对 retryable:false 的 impact 结论直接 failRun（impact_gate_deterministic），
 *     不做按 reason 的差异路由。修法：新增 derive 侧纯函数 routeDeterministicImpactGate，
 *     由 loop.js 调用 —— impact_anchor_missing → spawn:generator-fix 一次（携带
 *     unclaimed_files），已重试过 → wait:human_review；
 *     capability_assertion_coverage_missing → 直接 wait:human_review。
 *
 * 禁 mock 被改的边：createHarnessImpactGates 注入的 diffGate 返回真实 blocked shape，
 * gateReceipt（被改的边）不 mock；routeDeterministicImpactGate 是被测纯函数本体。
 */

import { describe, expect, it, vi } from 'vitest';
import { createHarnessImpactGates } from '../../../packages/brain/src/impact-contract/harness-gates.js';
import { routeDeterministicImpactGate } from '../../../packages/brain/src/orchestrator/derive.js';

const TASK_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

describe('beforeEvaluate gateReceipt 透传 detail [BEHAVIOR]', () => {
  it('blocked 确定性结论的 gateReceipt 含 reason/retryable/detail', async () => {
    const active = { id: 'contract-1', repo: 'perfectuser21/cecelia', base_revision: BASE_SHA, contract_hash: 'c'.repeat(64) };
    const diffGate = vi.fn().mockResolvedValue({
      gate: 'blocked',
      reason: 'impact_anchor_missing',
      retryable: false,
      detail: { unclaimed_files: ['DoD.md'] },
    });
    const readChangedFiles = vi.fn().mockResolvedValue(['DoD.md']);
    const gates = createHarnessImpactGates({
      db: {}, getActiveContract: vi.fn().mockResolvedValue(active), diffGate, readChangedFiles,
    });

    const receipt = await gates.beforeEvaluate({ task: { id: TASK_ID, payload: {} }, pr: { head_sha: HEAD_SHA } });

    expect(receipt.gate).toBe('blocked');
    expect(receipt.reason).toBe('impact_anchor_missing');
    expect(receipt.retryable).toBe(false);
    expect(receipt.detail?.unclaimed_files).toEqual(['DoD.md']);
  });
});

describe('routeDeterministicImpactGate 确定性出口路由 [BEHAVIOR]', () => {
  it('impact_anchor_missing 首遇 → spawn:generator-fix 并携带 unclaimed_files（非 wait/退避）', () => {
    const route = routeDeterministicImpactGate({
      reason: 'impact_anchor_missing',
      detail: { unclaimed_files: ['DoD.md'] },
      decisionLog: [],
    });
    expect(route.action).toBe('spawn:generator-fix');
    expect(route.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  it('impact_anchor_missing 已 generator-fix 过一次仍失败 → wait:human_review（不二次重试）', () => {
    const route = routeDeterministicImpactGate({
      reason: 'impact_anchor_missing',
      detail: { unclaimed_files: ['DoD.md'] },
      decisionLog: [
        { action: 'spawn:generator-fix', detail: { fallback_reason: 'impact_anchor_missing' } },
      ],
    });
    expect(route.action).toBe('wait:human_review');
  });

  it('capability_assertion_coverage_missing → 直接 wait:human_review', () => {
    const route = routeDeterministicImpactGate({
      reason: 'capability_assertion_coverage_missing',
      detail: { capability_ids: ['G1'] },
      decisionLog: [],
    });
    expect(route.action).toBe('wait:human_review');
  });
});
