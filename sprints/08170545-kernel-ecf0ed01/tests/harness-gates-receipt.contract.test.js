/**
 * 冻结合同测试（TDD Red）— Sprint 08170545-kernel-ecf0ed01
 * harness-gates.js beforeEvaluate 的 gateReceipt 必须透传 reason/retryable/detail。
 *
 * 覆盖 Golden Path Step 3：确定性 blocked 结论的 unclaimed_files / capability_ids
 * 必须随 gateReceipt 进入决策日志，运维方能从日志判因。
 *
 * 禁 mock 被改的边：注入 diffGate（harness-gates 的既有 seam），断言 harness-gates
 * 对 diff-gate 返回结果的透传；diff-gate 自身的确定性 shape 由 diff-gate-reason-code
 * 合同测试用真实 evaluateDiffGate 覆盖，两测合起来覆盖真实 diff-gate↔harness-gates 边。
 */

import { describe, it, expect, vi } from 'vitest';
import { createHarnessImpactGates } from '../../../packages/brain/src/impact-contract/harness-gates.js';

const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HEAD_SHA = 'b'.repeat(40);

function activeContract() {
  return {
    id: 'contract-1',
    contract_hash: 'c'.repeat(64),
    repo: 'cecelia',
    base_revision: 'a'.repeat(40),
    contract_body: { required_assertions: [] },
  };
}

// verified git_candidate → beforeEvaluate 直接采用 pr.changed_files，无需 readChangedFiles
function candidatePr(changedFiles) {
  return {
    type: 'git_candidate',
    verification_status: 'verified',
    head_sha: HEAD_SHA,
    changed_files: changedFiles,
  };
}

describe('harness-gates beforeEvaluate 透传确定性 impact 结论', () => {
  it('blocked/impact_anchor_missing 结果的 gateReceipt 含 reason/retryable/detail', async () => {
    const diffGate = vi.fn().mockResolvedValue({
      gate: 'blocked',
      reason: 'impact_anchor_missing',
      retryable: false,
      detail: { unclaimed_files: ['DoD.md'] },
    });
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(activeContract()),
      diffGate,
    });

    const receipt = await gates.beforeEvaluate({
      task: { id: TASK_ID, payload: {} },
      pr: candidatePr(['DoD.md']),
      run: { impact_contract_policy: 'required' },
    });

    expect(receipt.gate).toBe('blocked');
    expect(receipt.reason).toBe('impact_anchor_missing');
    expect(receipt.retryable).toBe(false);
    expect(receipt.detail).toBeTruthy();
    expect(receipt.detail.unclaimed_files).toEqual(['DoD.md']);
  });
});
