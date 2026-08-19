/**
 * Diff Impact Gate — reason_code 透传 + 确定性 unknown fail-closed（回归）
 *
 * sprint: 08192211-kernel-4bf639e3
 * 背景：diff-gate.js 步骤 3a 曾把一切 freshness.status !== 'fresh' 折叠成
 *   reason: 'mapper_stale' + retryable: true，导致确定性 unknown 被误判为瞬态陈旧、
 *   kernel 无限重试永远走不到 fail-closed 出口。本回归锁死：
 *   - 瞬态 stale（freshness.status==='stale'）→ retryable:true 且透传具体 reason_code
 *   - 确定性 unknown（freshness.status==='unknown' / 缺字段 / 未知 status）→ retryable:false（fail-closed）
 *     且透传具体 reason_code；reason_code 缺失时占位 'unknown'，绝不回退 'mapper_stale'
 *
 * 禁 mock 被改的边：直接真调 evaluateDiffGate（不 mock 本函数、不 mock diff-compare），
 *   仅注入 mapClient 提供 freshness 输入（Mapper 外层边界，标准测试接缝）。db=null 走无 DB 路径，
 *   非 fresh 分支在步骤 3a 提前返回，不触达任何 DB 写路径（本 sprint 未改 DB 写路径）。
 */

import { describe, test, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

// 构造 mapClient：返回携带给定 freshness 的非 fresh Mapper 响应（affected_nodes/assertions 为空即可，
// 因为非 fresh 分支在步骤 3a 提前返回，不进入对账）
function mapperWithFreshness(freshness) {
  return async () => ({
    freshness,
    affected_nodes: [],
    required_assertions: [],
  });
}

describe('Diff Impact Gate — reason_code 透传 + 确定性 unknown fail-closed', () => {
  test('瞬态 stale：透传具体 reason_code 且 retryable:true（非 mapper_stale） [B-01]', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 'task-stale',
      mapClient: mapperWithFreshness({ status: 'stale', reason_code: 'fact_snapshot_stale' }),
      changedFiles: ['packages/brain/src/tick.js'],
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.retryable).toBe(true);
    expect(result.reason).toBe('fact_snapshot_stale');
    expect(result.reason).not.toBe('mapper_stale');
  });

  test('确定性 unknown：fail-closed retryable:false 且透传具体 reason_code [B-02]', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 'task-unknown',
      mapClient: mapperWithFreshness({ status: 'unknown', reason_code: 'impact_unknown' }),
      changedFiles: ['packages/brain/src/tick.js'],
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.retryable).toBe(false);
    expect(result.reason).toBe('impact_unknown');
    expect(result.reason).not.toBe('mapper_stale');
  });

  test('边界：缺 reason_code / 未知 status → fail-closed 占位 unknown 不回退 mapper_stale [B-03]', async () => {
    // 未知 status（既非明确 stale 也非 fresh），且无 reason_code → fail-closed + 占位 unknown
    const r1 = await evaluateDiffGate({
      db: null,
      taskId: 't-b3a',
      mapClient: mapperWithFreshness({ status: 'unknown' }),
      changedFiles: ['x'],
    });
    expect(r1.gate).toBe('impact_unknown');
    expect(r1.retryable).toBe(false);
    expect(r1.reason).toBe('unknown');
    expect(r1.reason).not.toBe('mapper_stale');

    // freshness 完全缺失 → 默认 fail-closed，不回退 mapper_stale
    const r2 = await evaluateDiffGate({
      db: null,
      taskId: 't-b3b',
      mapClient: async () => ({ affected_nodes: [], required_assertions: [] }),
      changedFiles: ['x'],
    });
    expect(r2.gate).toBe('impact_unknown');
    expect(r2.retryable).toBe(false);
    expect(r2.reason).not.toBe('mapper_stale');
  });

  test('禁 mapper_stale 残留：所有非 fresh 分支 reason 绝不等于 mapper_stale [B-04]', async () => {
    const cases = [
      { status: 'stale', reason_code: 'fact_snapshot_stale' },
      { status: 'unknown', reason_code: 'impact_unknown' },
      { status: 'unknown', reason_code: 'projection_missing' },
      { status: 'stale' }, // 缺 reason_code
    ];
    for (const freshness of cases) {
      const r = await evaluateDiffGate({
        db: null,
        taskId: 't-b4',
        mapClient: mapperWithFreshness(freshness),
        changedFiles: ['x'],
      });
      expect(r.gate).toBe('impact_unknown');
      expect(r.reason).not.toBe('mapper_stale');
      expect(typeof r.retryable).toBe('boolean');
    }
  });
});
