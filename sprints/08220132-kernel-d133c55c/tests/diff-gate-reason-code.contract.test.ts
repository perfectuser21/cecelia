/**
 * 冻结合同测试 — Diff Impact Gate 3a 透传 reason_code 并按确定性 fail-closed
 * sprint: 08220132-kernel-d133c55c
 *
 * 策略：注入 Mapper 外部边界（mapClient）构造确定 freshness 投影，
 *       调真实 evaluateDiffGate（不 mock 被测分类逻辑），走 db:null 路径（无需 Postgres）。
 *       gateReceipt 用动态 import，未导出时为干净断言失败（不拖垮同文件其他用例）。
 *
 * 当前 main 上应全部 RED：3a 折叠成裸 mapper_stale/retryable:true；gateReceipt 未导出。
 */
import { describe, test, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

// 注入 Mapper 外部边界替身；被测的 3a 分类逻辑全程真实执行。
function callGate(reason_code: string | null, freshnessMissing = false) {
  return evaluateDiffGate({
    db: null,
    taskId: 'contract-t',
    headRevision: 'head',
    changedFiles: [],
    mapClient: async () =>
      freshnessMissing
        ? { affected_nodes: [] }
        : { freshness: { status: 'stale', reason_code } },
  } as any);
}

describe('Diff Impact Gate 3a — reason_code 透传与确定性 fail-closed', () => {
  test('确定性 reason_code fail-closed（capability_not_in_active_projection → retryable=false 且 reason 为具体码）', async () => {
    const r: any = await callGate('capability_not_in_active_projection');
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('capability_not_in_active_projection');
    expect(r.retryable).toBe(false);
  });

  test('瞬时 fact_snapshot_stale 保留重试（reason=fact_snapshot_stale 且 retryable=true）', async () => {
    const r: any = await callGate('fact_snapshot_stale');
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('fact_snapshot_stale');
    expect(r.retryable).toBe(true);
  });

  test('瞬时 projection_revision_missing 保留重试（reason=projection_revision_missing 且 retryable=true）', async () => {
    const r: any = await callGate('projection_revision_missing');
    expect(r.reason).toBe('projection_revision_missing');
    expect(r.retryable).toBe(true);
  });

  test('freshness 缺失 null 保留重试（freshness 对象整体缺失 → retryable=true）', async () => {
    const r: any = await callGate(null, true);
    expect(r.gate).toBe('impact_unknown');
    expect(r.retryable).toBe(true);
  });

  test('未知 reason_code 默认 fail-closed（未来新增码不在白名单 → retryable=false）', async () => {
    const r: any = await callGate('some_future_unknown_code');
    expect(r.gate).toBe('impact_unknown');
    expect(r.retryable).toBe(false);
    // 未知码也透传具体 reason（非裸 mapper_stale）
    expect(r.reason).toBe('some_future_unknown_code');
  });

  test('gateReceipt 透传具体 reason_code（deny 收据非裸 mapper_stale）', async () => {
    const mod: any = await import(
      '../../../packages/brain/src/impact-contract/harness-gates.js'
    );
    expect(typeof mod.gateReceipt).toBe('function');
    const receipt = mod.gateReceipt('diff', {
      gate: 'impact_unknown',
      reason: 'capability_not_in_active_projection',
      retryable: false,
    });
    expect(receipt.reason).toBe('capability_not_in_active_projection');
    expect(receipt.reason).not.toBe('mapper_stale');
  });
});
