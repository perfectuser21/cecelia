/**
 * TDD Red 证据 — Diff Impact Gate step 3a 非 fresh 分支
 *
 * 复现 bug（runs f62c7e87/d1360a48 deny:impact:mapper_stale 空转）：
 *   diff-gate.js step 3a 把所有非 fresh 情形折叠成 { reason:'mapper_stale', retryable:true }，
 *   吞掉 Mapper 的 freshness.reason_code，并把确定性 unknown 也当瞬态无限重试。
 *
 * 期望（本 sprint 修复后 GREEN）：
 *   - status==='unknown'（确定性结论）→ retryable===false（fail-closed 出口），reason_code 透传真实值
 *   - status==='stale'（瞬态）→ retryable===true，reason_code 透传真实值
 *   - unknown 缺 reason_code → retryable===false，reason_code 落确定性占位（不回退成可重试）
 *   - stale 缺 reason_code → retryable===true，reason_code 透传 null
 *
 * 策略：注入 mock mapClient（外层 Mapper 边界，与既有 diff-gate.test.js 一致的 DI 手法），
 *       db 传 null（step 3a 在 DB 之前返回，无需 Postgres），直接断言 evaluateDiffGate 真实分支输出。
 */

import { describe, test, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const baseArgs = {
  db: null,
  taskId: 'task-red-001',
  headRevision: 'head-red',
  changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
  repo: 'cecelia',
};

describe('Diff Impact Gate step 3a — reason_code 透传 + 确定性 fail-closed 出口', () => {
  test('freshness.status unknown 透传 reason_code 且 retryable false（fail-closed）', async () => {
    const result = await evaluateDiffGate({
      ...baseArgs,
      mapClient: async () => ({
        freshness: { status: 'unknown', reason_code: 'capability_not_in_active_projection' },
      }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe('capability_not_in_active_projection');
    expect(result.retryable).toBe(false);
  });

  test('freshness.status stale 透传 reason_code 且 retryable true', async () => {
    const result = await evaluateDiffGate({
      ...baseArgs,
      mapClient: async () => ({
        freshness: { status: 'stale', reason_code: 'fact_snapshot_stale' },
      }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe('fact_snapshot_stale');
    expect(result.retryable).toBe(true);
  });

  test('unknown 缺 reason_code 落确定性占位且 retryable false', async () => {
    const result = await evaluateDiffGate({
      ...baseArgs,
      mapClient: async () => ({
        freshness: { status: 'unknown' },
      }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.retryable).toBe(false);
    // 确定性占位：非 null（不回退成可重试），且是稳定字符串
    expect(typeof result.reason_code).toBe('string');
    expect(result.reason_code.length).toBeGreaterThan(0);
  });

  test('stale 缺 reason_code 透传 null 且 retryable true', async () => {
    const result = await evaluateDiffGate({
      ...baseArgs,
      mapClient: async () => ({
        freshness: { status: 'stale' },
      }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.retryable).toBe(true);
    expect(result.reason_code ?? null).toBe(null);
  });
});
