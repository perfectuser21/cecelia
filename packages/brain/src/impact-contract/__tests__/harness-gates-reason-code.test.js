/**
 * harness-gates beforeEvaluate gateReceipt 透传测试 —— sprint 08161030-kernel-f9f943fc
 *
 * 根因：gateReceipt 只透传 stage/gate/reason/retryable/contract_id/contract_hash，
 * 丢掉确定性结论的 detail 与 unclaimed_files，运维无法从 orchestrator_decision_log 判因。
 *
 * 本测试锁定：beforeEvaluate 对确定性 blocked 结果产出的 receipt 必须含
 * reason/retryable/detail，且顶层镜像 unclaimed_files（供决策日志 detail.impact_gate.unclaimed_files 读取）。
 */
import { describe, expect, it, vi } from 'vitest';
import { createHarnessImpactGates } from '../harness-gates.js';

const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

describe('gateReceipt 透传 reason/retryable/detail（08161030-kernel-f9f943fc）', () => {
  it('beforeEvaluate 对确定性 blocked 结果透传 detail 与 unclaimed_files', async () => {
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue({
        id: 'contract-1',
        contract_hash: 'c'.repeat(64),
        base_revision: BASE_SHA,
        repo: 'cecelia',
      }),
      getGap: vi.fn().mockResolvedValue(null),
      diffGate: vi.fn().mockResolvedValue({
        gate: 'blocked',
        reason: 'impact_anchor_missing',
        reason_code: 'impact_anchor_missing',
        retryable: false,
        detail: { unclaimed_files: ['DoD.md'], capability_ids: [] },
      }),
    });

    const receipt = await gates.beforeEvaluate({
      task: { id: TASK_ID, payload: {} },
      pr: {
        head_sha: HEAD_SHA,
        type: 'git_candidate',
        verification_status: 'verified',
        changed_files: ['DoD.md'],
      },
      run: { impact_contract_policy: 'required' },
    });

    expect(receipt).toMatchObject({
      stage: 'diff',
      gate: 'blocked',
      reason: 'impact_anchor_missing',
      retryable: false,
    });
    expect(receipt.detail).toMatchObject({ unclaimed_files: ['DoD.md'] });
    expect(receipt.unclaimed_files).toEqual(['DoD.md']);
  });
});
