/**
 * Sprint 08210531-kernel-4582c6dd — Diff Impact Gate 透传 reason_code + fail-closed 出口
 *
 * 覆盖父路：独立小路（无父路）—— Diff Impact Gate step 3a 确定性折叠修复。
 *
 * 策略（禁 mock 被改的边）：
 *   - 被改的边 = evaluateDiffGate step 3a 对 mapperResult.freshness.reason_code 的分类决策 → 真实执行，不 mock。
 *   - mapClient（Mapper HTTP 边界，PRD 明确不在范围内）= 既有注入点，喂入固定 freshness 结论（等价于固定 HTTP 响应）。
 *   - db（Postgres 边界，本 attempt postgres:false）= stub 返回 active contract，仅让 step 1 通过进入 step 3a。
 */
import { describe, test, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

function stubDbWithContract() {
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: 'contract-x',
        repo: 'cecelia',
        base_revision: 'base123',
        contract_body: { affected_capabilities: [], required_assertions: [] },
      }],
    })),
  };
}

// 确定性 freshness reason_code 集合（来源：map/radius.js 结构性 mismatch，Map 已作定态判定）
const DETERMINISTIC_REASON_CODES = [
  'projection_revision_missing',
  'projection_revision_mismatch',
  'manifest_projection_mismatch',
  'graph_projection_revision_mismatch',
  'capability_not_in_active_projection',
  'impact_anchor_missing',
  'unsafe_assertion_ref',
  'assertion_identity_ambiguous',
  'capability_assertion_coverage_missing',
];

describe('Diff Impact Gate — 确定性 freshness reason_code fail-closed 透传', () => {
  test.each(DETERMINISTIC_REASON_CODES)(
    '确定性 reason_code=%s (stale) → retryable:false 且透传真实 reason_code（不折叠 mapper_stale）',
    async (code) => {
      const result = await evaluateDiffGate({
        db: stubDbWithContract(),
        taskId: 'task-det',
        repo: 'cecelia',
        headRevision: 'head',
        mapClient: vi.fn().mockResolvedValue({
          freshness: { status: 'stale', reason_code: code },
        }),
      });
      expect(result.gate).toBe('impact_unknown'); // fail-closed，绝不 pass/extend
      expect(result.retryable).toBe(false);        // 有界终态：不可重试
      expect(result.reason_code).toBe(code);       // reason_code 透传
      expect(result.reason).toBe(code);            // receipt.reason 携带真实 code，非泛化 mapper_stale
    },
  );

  test('确定性 reason_code (status=unknown, impact_anchor_missing) → retryable:false 透传', async () => {
    const result = await evaluateDiffGate({
      db: stubDbWithContract(),
      taskId: 'task-unknown',
      repo: 'cecelia',
      headRevision: 'head',
      mapClient: vi.fn().mockResolvedValue({
        freshness: { status: 'unknown', reason_code: 'impact_anchor_missing' },
      }),
    });
    expect(result).toMatchObject({
      gate: 'impact_unknown',
      reason: 'impact_anchor_missing',
      reason_code: 'impact_anchor_missing',
      retryable: false,
    });
  });

  test('非确定性 reason_code (fact_snapshot_stale) → 保持 mapper_stale/retryable:true（不误杀可恢复）', async () => {
    const result = await evaluateDiffGate({
      db: stubDbWithContract(),
      taskId: 'task-transient',
      repo: 'cecelia',
      headRevision: 'head',
      mapClient: vi.fn().mockResolvedValue({
        freshness: { status: 'stale', reason_code: 'fact_snapshot_stale' },
      }),
    });
    expect(result).toMatchObject({
      gate: 'impact_unknown',
      reason: 'mapper_stale',
      retryable: true,
    });
  });

  test('reason_code 缺失 (stale 无 reason_code) → 保持 mapper_stale/retryable:true（边界：不回退可重试语义）', async () => {
    const result = await evaluateDiffGate({
      db: stubDbWithContract(),
      taskId: 'task-missing',
      repo: 'cecelia',
      headRevision: 'head',
      mapClient: vi.fn().mockResolvedValue({
        freshness: { status: 'stale' },
      }),
    });
    expect(result).toMatchObject({
      gate: 'impact_unknown',
      reason: 'mapper_stale',
      retryable: true,
    });
  });
});
