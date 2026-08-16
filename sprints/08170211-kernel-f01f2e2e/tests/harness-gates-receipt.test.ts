/**
 * 合同冻结测试 — harness-gates.beforeEvaluate 的 gateReceipt 透传 reason/retryable/detail（PRD r8 · 验收点 2）
 *
 * 被改的边：harness-gates.js gateReceipt() 未透传 detail。本测试用真实 createHarnessImpactGates
 * + 真实 beforeEvaluate（真实 gateReceipt 逻辑执行），仅把 diffGate 结果作为注入数据
 * （B-05 E2E 用真实 diff-gate + 真实 harness-gates + 真 DB 覆盖端到端，见 contract-draft ## E2E 验收）。
 *
 * 现状（RED 依据）：gateReceipt 返回体不含 detail → receipt.detail === undefined。
 */
import { describe, it, expect } from 'vitest';
import { createHarnessImpactGates } from '../../../packages/brain/src/impact-contract/harness-gates.js';

const HEAD_SHA = 'b'.repeat(40);
const BASE_SHA = 'a'.repeat(40);

function makeGates(diffGateResult: unknown) {
  return createHarnessImpactGates({
    db: {},
    getActiveContract: async () => ({
      id: 'contract-1',
      repo: 'cecelia',
      base_revision: BASE_SHA,
      contract_hash: 'hash-1',
      change_kind: 'code_change',
      contract_body: {},
    }),
    getGap: async () => null,
    readChangedFiles: async () => ['DoD.md'],
    diffGate: async () => diffGateResult,
  });
}

describe('harness-gates beforeEvaluate gateReceipt 透传', () => {
  it('blocked:impact_anchor_missing → receipt 含 reason / retryable:false / detail.unclaimed_files', async () => {
    const gates = makeGates({
      gate: 'blocked',
      reason: 'impact_anchor_missing',
      retryable: false,
      detail: { unclaimed_files: ['DoD.md'], capability_ids: [] },
    });
    const receipt = await gates.beforeEvaluate({
      task: { id: 'task-1', payload: {} },
      pr: { head_sha: HEAD_SHA },
      run: {},
    });
    expect(receipt.stage).toBe('diff');
    expect(receipt.gate).toBe('blocked');
    expect(receipt.reason).toBe('impact_anchor_missing');
    expect(receipt.retryable).toBe(false);
    expect(receipt.detail).toBeTruthy();
    expect(receipt.detail.unclaimed_files).toEqual(['DoD.md']);
  });

  it('blocked:capability_assertion_coverage_missing → receipt.detail.capability_ids 透传', async () => {
    const gates = makeGates({
      gate: 'blocked',
      reason: 'capability_assertion_coverage_missing',
      retryable: false,
      detail: { unclaimed_files: [], capability_ids: ['G1'] },
    });
    const receipt = await gates.beforeEvaluate({
      task: { id: 'task-2', payload: {} },
      pr: { head_sha: HEAD_SHA },
      run: {},
    });
    expect(receipt.reason).toBe('capability_assertion_coverage_missing');
    expect(receipt.retryable).toBe(false);
    expect(receipt.detail.capability_ids).toEqual(['G1']);
  });
});
