// F1「工厂 · 开发闭环」步骤 2「合同即法律」—— 边：Diff Impact Gate ↔ Mapper freshness.reason_code
//
// r41（sprint 08220132-kernel-d133c55c）：evaluateDiffGate 第 3a 步把 Mapper
// freshness.status !== 'fresh' 的所有情形折叠成裸 mapper_stale/retryable:true，确定性
// reason_code（重试不会变）被当瞬时态无限重试，run 空转到不了 merge fence。本文件按决策
// 109dd8eb 写在边上：真 import 被改的 diff-gate.js 与 harness-gates.js，只注入 Mapper 外部
// 边界（mapClient）构造确定 freshness 投影，被测的 3a 分类逻辑与 gateReceipt 全程真实执行，
// 绝不 vi.mock 被改模块——守卫必须用真零件跑。
import { describe, it, expect } from 'vitest';

import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { gateReceipt } from '../../../packages/brain/src/impact-contract/harness-gates.js';

// 注入 Mapper 外部边界替身；被测的 3a 分类逻辑全程真实执行（db:null 路径，无需 Postgres）。
function callGate(reason_code, freshnessMissing = false) {
  return evaluateDiffGate({
    db: null,
    taskId: 'gp-f1-step2',
    headRevision: 'head',
    changedFiles: [],
    mapClient: async () =>
      freshnessMissing
        ? { affected_nodes: [] }
        : { freshness: { status: 'stale', reason_code } },
  });
}

describe('F1 step2 · 合同即法律 — Diff Impact Gate 3a 按 reason_code 确定性 fail-closed', () => {
  it('确定性 reason_code 走 fail-closed（capability_not_in_active_projection → retryable=false 且 reason 为具体码）', async () => {
    const r = await callGate('capability_not_in_active_projection');
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('capability_not_in_active_projection');
    expect(r.retryable).toBe(false);
  });

  it('瞬时白名单保留重试（fact_snapshot_stale / projection_revision_missing → retryable=true 带具体码）', async () => {
    const a = await callGate('fact_snapshot_stale');
    expect(a.reason).toBe('fact_snapshot_stale');
    expect(a.retryable).toBe(true);
    const b = await callGate('projection_revision_missing');
    expect(b.reason).toBe('projection_revision_missing');
    expect(b.retryable).toBe(true);
  });

  it('freshness 缺失（null）视为瞬时态保留重试（gate impact_unknown 且 retryable=true）', async () => {
    const r = await callGate(null, true);
    expect(r.gate).toBe('impact_unknown');
    expect(r.retryable).toBe(true);
  });

  it('未知/未来 reason_code 默认 fail-closed（不在白名单 → retryable=false，reason 透传具体码）', async () => {
    const r = await callGate('some_future_unknown_code');
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('some_future_unknown_code');
    expect(r.retryable).toBe(false);
  });

  it('gateReceipt 透传具体 reason_code（deny 收据非裸 mapper_stale）', () => {
    const receipt = gateReceipt('diff', {
      gate: 'impact_unknown',
      reason: 'capability_not_in_active_projection',
      retryable: false,
    });
    expect(receipt.reason).toBe('capability_not_in_active_projection');
    expect(receipt.reason).not.toBe('mapper_stale');
  });
});
