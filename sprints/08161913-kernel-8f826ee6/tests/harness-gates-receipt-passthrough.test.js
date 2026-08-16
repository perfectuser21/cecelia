/**
 * 合同冻结测试 — harness-gates.beforeEvaluate 的 gateReceipt 透传 reason/retryable/detail
 * （PRD Golden Path Step 4）
 *
 * 禁 mock 边：gateReceipt 组装逻辑真跑（被改的边）。diffGate 用 createHarnessImpactGates
 * 既有 DI seam 注入（返回 diff-gate 分类结果的录制件），getActiveContract 注入；这两处是
 * 工厂既定注入口，非「mock 掉被改的模块本体」。diff-gate↔harness-gates 的真 DB 边由 Final
 * E2E（真 Postgres）覆盖。
 *
 * TDD Red：旧 gateReceipt（harness-gates.js:26-36）只带 reason/retryable，丢掉 detail →
 * receipt.detail 断言在旧代码下 FAIL。
 */
import { describe, it, expect, vi } from 'vitest';
import { createHarnessImpactGates } from '../../../packages/brain/src/impact-contract/harness-gates.js';

const HEAD_SHA = 'b'.repeat(40);
const BASE_SHA = 'a'.repeat(40);

function makeGates(diffGateResult) {
  return createHarnessImpactGates({
    db: {},
    getActiveContract: vi.fn().mockResolvedValue({
      id: 'contract-1',
      base_revision: BASE_SHA,
      repo: 'cecelia',
      contract_hash: 'c'.repeat(64),
    }),
    diffGate: vi.fn().mockResolvedValue(diffGateResult),
  });
}

describe('harness-gates.beforeEvaluate gateReceipt 透传 [BEHAVIOR]', () => {
  it('blocked:impact_anchor_missing 结果 → receipt 含 reason / retryable=false / detail.unclaimed_files', async () => {
    const gates = makeGates({
      gate: 'blocked',
      reason: 'impact_anchor_missing',
      retryable: false,
      detail: { unclaimed_files: ['DoD.md'], capability_ids: [] },
    });
    const receipt = await gates.beforeEvaluate({
      task: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', payload: {} },
      pr: {
        type: 'git_candidate',
        verification_status: 'verified',
        changed_files: ['DoD.md'],
        head_sha: HEAD_SHA,
      },
      run: {},
    });
    expect(receipt.gate).toBe('blocked');
    expect(receipt.reason).toBe('impact_anchor_missing');
    expect(receipt.retryable).toBe(false);
    expect(receipt.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  it('blocked:capability_assertion_coverage_missing 结果 → receipt.detail.capability_ids 透传', async () => {
    const gates = makeGates({
      gate: 'blocked',
      reason: 'capability_assertion_coverage_missing',
      retryable: false,
      detail: { unclaimed_files: [], capability_ids: ['G1'] },
    });
    const receipt = await gates.beforeEvaluate({
      task: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', payload: {} },
      pr: {
        type: 'git_candidate',
        verification_status: 'verified',
        changed_files: ['apps/dashboard/x.tsx'],
        head_sha: HEAD_SHA,
      },
      run: {},
    });
    expect(receipt.gate).toBe('blocked');
    expect(receipt.reason).toBe('capability_assertion_coverage_missing');
    expect(receipt.retryable).toBe(false);
    expect(receipt.detail?.capability_ids).toEqual(['G1']);
  });
});
