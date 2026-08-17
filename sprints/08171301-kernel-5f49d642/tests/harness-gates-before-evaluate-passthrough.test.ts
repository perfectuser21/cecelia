/**
 * [BEHAVIOR] 冻结合同测试 — harness-gates beforeEvaluate gateReceipt 透传（TDD Red）
 *
 * PRD 验收 bullet 2（前半）：确定性 blocked 结果的 gateReceipt 必须含 reason / retryable / detail，
 * 让 loop.js 与运维能从决策日志判因（旧 gateReceipt 丢掉 detail，unclaimed_files/capability_ids
 * 无法进决策日志）。
 *
 * 禁 mock 被改的边：本测试真调 beforeEvaluate（被改边 harness-gates）与真 evaluateDiffGate
 * （被改边 diff-gate）—— 只注入外层 mapper（map-client 边界）与 getActiveContract（DB 读边界，
 * 本 sprint 不改 contract-store）。db 用轻量 stub（repairContext 无 harness_gap_id 直接返回 null，
 * 不触 DB；无 map_recovery_contract_id 跳过 recovery 查询），无需 Postgres。
 */
import { describe, it, expect } from 'vitest';
import { createHarnessImpactGates } from '../../../packages/brain/src/impact-contract/harness-gates.js';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const HEAD = 'a'.repeat(40);

function buildGates() {
  const mapper = async () => ({
    freshness: { status: 'unknown', reason_code: 'impact_anchor_missing', checked_at: new Date().toISOString() },
    affected_nodes: [{ capability_id: 'G1' }],
    required_assertions: [],
    unclaimed_files: ['DoD.md'],
  });
  // db=null：repairContext 无 harness_gap_id 直接返回 null（不触 DB），无 map_recovery_contract_id
  // 跳过 recovery 查询；getActiveContract 走注入替身；diffGate 内部 `if(db)` 短路，直接进 mapper 分类。
  return createHarnessImpactGates({
    db: null,
    getActiveContract: async () => ({
      id: 'c1', repo: 'perfectuser21/cecelia',
      base_revision: HEAD, contract_hash: 'h1',
    }),
    // 真 diff-gate，只把外层 mapper 注入进去。
    diffGate: (args) => evaluateDiffGate({ ...args, mapClient: mapper }),
  });
}

describe('harness-gates beforeEvaluate — gateReceipt 透传 reason/retryable/detail（合同冻结）', () => {
  it('确定性 blocked 的候选 → gateReceipt.reason=impact_anchor_missing, retryable=false, detail.unclaimed_files 非空', async () => {
    const gates = buildGates();
    const receipt = await gates.beforeEvaluate({
      task: { id: 't1', payload: {} },
      pr: {
        head_sha: HEAD,
        type: 'git_candidate',
        verification_status: 'verified',
        changed_files: ['DoD.md'],
      },
      run: { id: 'r1' },
    });
    expect(receipt.reason).toBe('impact_anchor_missing');
    expect(receipt.retryable).toBe(false);
    expect(receipt.detail?.unclaimed_files).toEqual(['DoD.md']);
    // gate 不是 pass/extend → loop 会据此产出 deny:impact:<reason>
    expect(['blocked', 'impact_unknown']).toContain(receipt.gate);
  });
});
