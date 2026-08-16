/**
 * 冻结合同测试 — harness-gates beforeEvaluate gateReceipt 透传 reason/retryable/detail
 *
 * PRD Golden Path Step 5：确定性 blocked 结果的 gateReceipt 必须带 reason/retryable/detail
 * （detail 含 unclaimed_files / capability_ids），供 loop.js 写入 orchestrator_decision_log 判因。
 *
 * 策略：createHarnessImpactGates 全依赖注入（db:{}, getActiveContract, diffGate），
 *      不依赖 Postgres；pr 用 verified git_candidate 走 verifiedCandidateFiles 分支避开 readChangedFiles。
 */
import { describe, it, expect, vi } from 'vitest';
import { createHarnessImpactGates } from '../../../packages/brain/src/impact-contract/harness-gates.js';

const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HEAD_SHA = 'b'.repeat(40);
const HASH = 'c'.repeat(64);

function activeContract() {
  return { id: 'contract-1', task_id: TASK_ID, repo: 'perfectuser21/cecelia', base_revision: 'a'.repeat(40), contract_hash: HASH };
}

function candidatePr(changedFiles) {
  return { head_sha: HEAD_SHA, type: 'git_candidate', verification_status: 'verified', changed_files: changedFiles };
}

describe('harness-gates beforeEvaluate gateReceipt 透传', () => {
  it('blocked 结果的 gateReceipt 含 reason/retryable/detail（unclaimed_files 透传）', async () => {
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(activeContract()),
      getGap: vi.fn().mockResolvedValue(null),
      diffGate: vi.fn().mockResolvedValue({
        gate: 'blocked', reason: 'impact_anchor_missing', retryable: false,
        detail: { unclaimed_files: ['DoD.md'] }, contract: activeContract(),
      }),
    });

    const receipt = await gates.beforeEvaluate({
      task: { id: TASK_ID, payload: {} },
      pr: candidatePr(['DoD.md']),
      run: { id: 'r1', impact_contract_policy: 'required' },
    });

    expect(receipt.gate).toBe('blocked');
    expect(receipt.reason).toBe('impact_anchor_missing');
    expect(receipt.retryable).toBe(false);
    expect(receipt.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  it('capability_assertion_coverage_missing blocked → gateReceipt.detail 带 capability_ids', async () => {
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(activeContract()),
      getGap: vi.fn().mockResolvedValue(null),
      diffGate: vi.fn().mockResolvedValue({
        gate: 'blocked', reason: 'capability_assertion_coverage_missing', retryable: false,
        detail: { capability_ids: ['G1'] }, contract: activeContract(),
      }),
    });

    const receipt = await gates.beforeEvaluate({
      task: { id: TASK_ID, payload: {} },
      pr: candidatePr(['apps/dashboard/src/x.tsx']),
      run: { id: 'r1', impact_contract_policy: 'required' },
    });

    expect(receipt.reason).toBe('capability_assertion_coverage_missing');
    expect(receipt.retryable).toBe(false);
    expect(receipt.detail?.capability_ids).toContain('G1');
  });

  it('回归保护：mapper_stale（真新鲜度）→ gateReceipt.retryable=true', async () => {
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(activeContract()),
      getGap: vi.fn().mockResolvedValue(null),
      diffGate: vi.fn().mockResolvedValue({ gate: 'impact_unknown', reason: 'mapper_stale', retryable: true }),
    });

    const receipt = await gates.beforeEvaluate({
      task: { id: TASK_ID, payload: {} },
      pr: candidatePr(['packages/brain/src/tick.js']),
      run: { id: 'r1', impact_contract_policy: 'required' },
    });

    expect(receipt.gate).toBe('impact_unknown');
    expect(receipt.reason).toBe('mapper_stale');
    expect(receipt.retryable).toBe(true);
  });
});
