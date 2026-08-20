/**
 * 回归测试（TDD Red）— Diff Impact Gate 确定性 Map 结论 fail-closed 出口（r19/r28）
 *
 * 复现 runs f62c7e87 / d1360a48 的 `deny:impact:mapper_stale` 无限重试空转：
 * mapper 返回确定性/终态 freshness.reason_code（重试不会变 fresh）时，diff-gate 旧行为
 * 把所有非 fresh 折叠成裸 `mapper_stale, retryable:true` → run 永远重排、需人介入。
 *
 * 断言修复后：透传真实 reason_code + 终态 retryable=false；真瞬态 fact_snapshot_stale 仍 retryable=true。
 * 无 Postgres 依赖：终态裁决在 diff-gate 步骤 3a 返回，早于任何 db.query（db=undefined + 注入 mapClient）。
 *
 * freshness.reason_code 取值与 packages/brain/src/map/radius.js 权威枚举字面一致（[status枚举全grep] 铁律）。
 */
import { describe, test, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const makeMapper = (freshness) => async () => ({
  freshness,
  fact_revisions: {},
  affected_nodes: [],
  required_assertions: [],
});
const run = (freshness, taskId) => evaluateDiffGate({
  db: undefined,
  taskId,
  mapClient: makeMapper(freshness),
  headRevision: 'deadbeef',
  changedFiles: ['packages/brain/src/x.js'],
});

describe('[BEHAVIOR] Diff Gate 终态 Map 结论 fail-closed（r19/r28 空转根因）', () => {
  test('B-01 终态 unknown/capability_not_in_active_projection 透传 reason_code 且 retryable=false', async () => {
    const r = await run({ status: 'unknown', reason_code: 'capability_not_in_active_projection' }, 't01');
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason_code).toBe('capability_not_in_active_projection');
    expect(r.reason).toBe('capability_not_in_active_projection');
    expect(r.retryable).toBe(false);
  });

  test('B-02 真瞬态 stale/fact_snapshot_stale 透传 reason_code 且 retryable=true（既有行为不回退）', async () => {
    const r = await run({ status: 'stale', reason_code: 'fact_snapshot_stale' }, 't02');
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason_code).toBe('fact_snapshot_stale');
    expect(r.retryable).toBe(true);
  });

  test('B-03 reason_code 缺失但 non-fresh 时 fail-closed 兜底 retryable=false（禁未知即重试）', async () => {
    const r = await run({ status: 'unknown' }, 't03');
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason_code ?? null).toBe(null);
    expect(r.retryable).toBe(false);
  });

  test('B-04 终态 stale/manifest_projection_mismatch 也 fail-closed retryable=false（覆盖 stale 类终态）', async () => {
    const r = await run({ status: 'stale', reason_code: 'manifest_projection_mismatch' }, 't04');
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason_code).toBe('manifest_projection_mismatch');
    expect(r.retryable).toBe(false);
    // 空转根因关闭：确定性结论绝不再输出成裸 mapper_stale 常量
    expect(r.reason).not.toBe('mapper_stale');
  });
});
