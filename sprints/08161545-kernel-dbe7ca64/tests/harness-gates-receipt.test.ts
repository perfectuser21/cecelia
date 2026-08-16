/**
 * 冻结合同测试 — harness-gates beforeEvaluate gateReceipt 透传 reason/retryable/detail
 *
 * 被改的边（禁 mock）：harness-gates.js gateReceipt 的字段透传（当前丢弃 result.detail）。
 * 注入的替身仅为不改的外层：getActiveContract（DB 读，未改）、diffGate 的返回值
 * （diff-gate 分类逻辑由 diff-gate-classify.test.ts 真实覆盖，本用例只验 gateReceipt 转发），
 * pr 用 verified git_candidate 走冻结 changed_files，故 readChangedFiles 不应被调用。
 */
import { describe, it, expect, vi } from 'vitest';
import { createHarnessImpactGates } from '../../../packages/brain/src/impact-contract/harness-gates.js';

const HEAD_SHA = 'b'.repeat(40);
const BASE_SHA = 'a'.repeat(40);
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('harness-gates beforeEvaluate gateReceipt 透传', () => {
  it('blocked 确定性结论的 gateReceipt 含 reason retryable detail 且 unclaimed_files 可见', async () => {
    const active = {
      id: 'contract-1',
      repo: 'perfectuser21/cecelia',
      base_revision: BASE_SHA,
      contract_hash: 'c'.repeat(64),
    };
    const diffGate = vi.fn().mockResolvedValue({
      gate: 'blocked',
      reason: 'impact_anchor_missing',
      retryable: false,
      detail: { unclaimed_files: ['DoD.md'], capability_ids: [] },
    });
    const readChangedFiles = vi.fn().mockRejectedValue(new Error('should not read git'));
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(active),
      diffGate,
      readChangedFiles,
    });

    const receipt = await gates.beforeEvaluate({
      task: { id: TASK_ID, payload: {} },
      pr: {
        head_sha: HEAD_SHA,
        type: 'git_candidate',
        verification_status: 'verified',
        changed_files: ['DoD.md'],
      },
    });

    expect(readChangedFiles).not.toHaveBeenCalled();
    expect(receipt.gate).toBe('blocked');
    expect(receipt.reason).toBe('impact_anchor_missing');
    expect(receipt.retryable).toBe(false);
    expect(receipt.detail).toEqual({ unclaimed_files: ['DoD.md'], capability_ids: [] });
    expect(receipt.unclaimed_files).toEqual(['DoD.md']);
  });
});
