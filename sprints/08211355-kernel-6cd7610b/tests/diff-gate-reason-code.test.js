/**
 * 冻结回归测试 — Diff Impact Gate 透传 reason_code + fail-closed 出口（r37）
 *
 * 覆盖 PRD Golden Path 三边界 + 枚举透传不崩：
 *   1. stale + 确定性 reason_code → 透传该 reason_code（非恒定 'mapper_stale'）且 retryable === false（fail-closed 终态）
 *   2. unknown 无 reason_code → 真正短暂不可判定 → retryable === true
 *   3. freshness 缺失 → 终态可观察不假绿（gate=impact_unknown，未被误判为 pass）
 *   4. reason_code 为下游未知的新枚举值 → 原样透传不报错崩溃（对齐 status 枚举全仓库对账铁律）
 *
 * 策略：evaluateDiffGate（真实模块，不 stub）+ 注入 mapClient 构造确定性 freshness 输入
 *       （既有测试同款依赖注入范式）。步骤 3a 在触达 DB 前返回，无需真 Postgres。
 *
 * sprint: 08211355-kernel-6cd7610b
 */

import { describe, test, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const HEAD = 'headsha0001';

// active 合同 stub：getActiveImpactContract 只走 db.query 读 rows[0]
function stubDb() {
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: 'contract-1',
        repo: 'cecelia',
        base_revision: 'base123',
        contract_body: { affected_capabilities: [], required_assertions: [] },
      }],
    })),
  };
}

const baseParams = () => ({
  db: stubDb(),
  taskId: 'task-reason-code',
  headRevision: HEAD,
  repo: 'cecelia',
  changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
});

describe('Diff Impact Gate reason_code 透传 + fail-closed 出口', () => {
  test('stale + 确定性 reason_code 透传该 reason_code 且 fail-closed retryable=false', async () => {
    const result = await evaluateDiffGate({
      ...baseParams(),
      mapClient: async () => ({
        freshness: { status: 'stale', reason_code: 'MAP_DELETED_NODE' },
        affected_nodes: [],
        required_assertions: [],
      }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe('MAP_DELETED_NODE');
    expect(result.retryable).toBe(false);
  });

  test('unknown 无 reason_code 属短暂不可判定 retryable=true', async () => {
    const result = await evaluateDiffGate({
      ...baseParams(),
      mapClient: async () => ({
        freshness: { status: 'unknown', reason_code: null },
        affected_nodes: [],
        required_assertions: [],
      }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe(null);
    expect(result.retryable).toBe(true);
  });

  test('freshness 缺失 → 终态可观察不假绿（gate=impact_unknown，非 pass），reason_code=null', async () => {
    const result = await evaluateDiffGate({
      ...baseParams(),
      mapClient: async () => ({
        affected_nodes: [],
        required_assertions: [],
      }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.verdict).toBeUndefined();
    expect(result.reason_code).toBe(null);
  });

  test('reason_code 为下游未知的新枚举值：透传不崩溃且 fail-closed', async () => {
    const result = await evaluateDiffGate({
      ...baseParams(),
      mapClient: async () => ({
        freshness: { status: 'stale', reason_code: 'BRAND_NEW_ENUM_9999' },
        affected_nodes: [],
        required_assertions: [],
      }),
    });
    expect(result.reason_code).toBe('BRAND_NEW_ENUM_9999');
    expect(result.retryable).toBe(false);
  });
});
