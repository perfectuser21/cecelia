/**
 * TDD Red 回归 — Diff Impact Gate step 3a 非 fresh 出口语义分流
 *
 * 覆盖 Golden Path：Gate 收到 Mapper 复算非 fresh 结果 → 按 freshness.status 分流出口。
 *   - unknown（Map 确定性结论）→ 透传 reason_code + fail-closed 终局出口（retryable:false）
 *   - stale（瞬态过期）→ retryable:true，reason 优先透传 reason_code，无则回退默认标签
 *   - freshness 缺失/结构异常 → fail-closed，不假绿（retryable:false）
 *
 * 策略：step 3a 在 DB 读取之前返回，注入 db:null + mock mapClient 即可确定性触发，无需 Postgres。
 * 永久回归实体同步落 packages/brain/src/impact-contract/__tests__/diff-gate.test.js（PRD 预期受影响文件）。
 */

import { describe, test, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

// freshness.status !== 'fresh' 的注入器；db:null 时 contract=null，step 3a 在对账前返回。
const mapClientWith = (freshness) => async () => ({ freshness });

describe('Diff Impact Gate — step 3a 非 fresh 出口语义分流 [BEHAVIOR]', () => {

  test('unknown 状态透传 reason_code 且 retryable false（确定性终局出口）', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 'task-unknown',
      mapClient: mapClientWith({ status: 'unknown', reason_code: 'capability_not_in_active_projection' }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('capability_not_in_active_projection');
    expect(result.retryable).toBe(false);
  });

  test('unknown 状态无 reason_code 回退 mapper_unknown 且 retryable false', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 'task-unknown-null',
      mapClient: mapClientWith({ status: 'unknown', reason_code: null }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_unknown');
    expect(result.retryable).toBe(false);
  });

  test('stale 状态透传 reason_code 且 retryable true（瞬态可重试）', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 'task-stale',
      mapClient: mapClientWith({ status: 'stale', reason_code: 'projection_snapshot_expired' }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('projection_snapshot_expired');
    expect(result.retryable).toBe(true);
  });

  test('stale 状态无 reason_code 回退 mapper_stale 标签且 retryable true', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 'task-stale-null',
      mapClient: mapClientWith({ status: 'stale', reason_code: null }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  test('freshness 缺失 fail-closed 且 retryable false（不假绿）', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 'task-missing-freshness',
      mapClient: async () => ({ affected_nodes: [] }), // 无 freshness 字段
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.retryable).toBe(false);
  });

  test('既有 fail-closed mapper_unavailable 与 revision_mismatch 不回退', async () => {
    // mapper_unavailable：mapClient 抛错 → 更外层 catch，retryable:true 不受本改动影响
    const unavailable = await evaluateDiffGate({
      db: null,
      taskId: 'task-unavailable',
      mapClient: async () => { throw new Error('ETIMEDOUT'); },
    });
    expect(unavailable.gate).toBe('impact_unknown');
    expect(unavailable.reason).toBe('mapper_unavailable');
    expect(unavailable.retryable).toBe(true);

    // revision_mismatch：fresh + fact_revisions 不对齐 → 既有出口不变
    const mismatch = await evaluateDiffGate({
      db: { query: async () => ({ rows: [{
        id: 'c1', repo: 'cecelia', base_revision: 'base123',
        contract_body: { affected_capabilities: [], required_assertions: [] },
      }] }) },
      taskId: 'task-mismatch',
      repo: 'cecelia',
      headRevision: 'head',
      mapClient: async () => ({
        freshness: { status: 'fresh' },
        fact_revisions: { cecelia: 'stale999' },
        affected_nodes: [], required_assertions: [],
      }),
    });
    expect(mismatch.gate).toBe('impact_unknown');
    expect(mismatch.reason).toBe('revision_mismatch');
    expect(mismatch.retryable).toBe(true);
  });

});
