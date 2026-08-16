// 冻结合同测试 — harness-gates.beforeEvaluate gateReceipt 透传 reason/retryable/detail（modification B 第 1 部分）
// sprint: 08161127-kernel-0bce0b07
//
// 覆盖父路：独立小路（无父路）。
//
// 被测边：harness-gates.beforeEvaluate ↔ diff-gate 结果 → gateReceipt。
// 注入点用工厂的 diffGate/getActiveContract 参数（createHarnessImpactGates 的 SSOT 注入口），
// 注入的是「diff-gate 的返回值」（上游已由 diff-gate-classification.test 独立守护），
// 被测的是 gateReceipt 组装逻辑本身——即 detail 是否被透传。旧 gateReceipt 丢弃 detail → RED。
// 无需 Postgres：getActiveContract 被注入为常量 stub；pr 走 verified git_candidate 路径避免 readChangedFiles/git。
import { describe, it, expect } from 'vitest';
import { createHarnessImpactGates } from '../../../packages/brain/src/impact-contract/harness-gates.js';

const HEAD = 'b'.repeat(40);

function makeGates(diffGateResult: Record<string, unknown>) {
  return createHarnessImpactGates({
    db: {},
    getActiveContract: async () => ({
      id: 'contract-1',
      repo: 'cecelia',
      base_revision: 'c'.repeat(40),
      contract_hash: 'hash-1',
      contract_body: { required_assertions: [] },
    }),
    getGap: async () => null,
    readChangedFiles: async () => ['DoD.md'],
    diffGate: async () => diffGateResult,
  });
}

const activePr = {
  head_sha: HEAD,
  type: 'git_candidate',
  verification_status: 'verified',
  changed_files: ['DoD.md'],
};

describe('beforeEvaluate gateReceipt 透传 [BEHAVIOR]', () => {
  it('blocked:impact_anchor_missing 结果 → 回执含 reason/retryable=false/detail.unclaimed_files', async () => {
    const gates = makeGates({
      gate: 'blocked',
      reason: 'impact_anchor_missing',
      retryable: false,
      detail: { unclaimed_files: ['DoD.md'], uncovered_capability_ids: [] },
    });
    const receipt = await gates.beforeEvaluate({
      task: { id: 'task-1', payload: {} },
      pr: activePr,
      run: {},
    });
    expect(receipt.gate).toBe('blocked');
    expect(receipt.reason).toBe('impact_anchor_missing');
    expect(receipt.retryable).toBe(false);
    expect(receipt.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  it('回归：pass 结果的回执 retryable 默认 false 且不误报 detail', async () => {
    const gates = makeGates({ gate: 'pass', reason_code: null });
    const receipt = await gates.beforeEvaluate({
      task: { id: 'task-1', payload: {} },
      pr: activePr,
      run: {},
    });
    expect(receipt.gate).toBe('pass');
    expect(receipt.retryable).toBe(false);
  });
});
