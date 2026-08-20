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
 *   - 两态 gate 恒为 impact_unknown（fail-closed 护栏，不放行）
 *
 * 说明：本文件是 proposer 的 RED 证据；用例名与 contract-dod.md 的 -t 目标逐字一致，
 *       Generator 须把同名用例落入永久 CI 家 packages/brain/src/impact-contract/__tests__/diff-gate.test.js。
 *
 * 策略：注入 mock mapClient（外层 Mapper 边界，与既有 diff-gate.test.js 的 DI 手法一致），
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
  test('step 3a: freshness.status unknown 透传 reason_code 且 retryable false', async () => {
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

  test('step 3a: freshness.status stale 透传 reason_code 且 retryable true', async () => {
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

  test('step 3a: unknown 缺 reason_code 落确定性占位且 retryable false', async () => {
    const result = await evaluateDiffGate({
      ...baseArgs,
      mapClient: async () => ({
        freshness: { status: 'unknown' },
      }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.retryable).toBe(false);
    // 确定性占位：非 null（不回退成可重试），且是稳定非空字符串
    expect(typeof result.reason_code).toBe('string');
    expect(result.reason_code.length).toBeGreaterThan(0);
  });

  test('step 3a: stale 缺 reason_code 透传 null 且 retryable true', async () => {
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

  test('step 3a: 非 fresh 分支 gate 恒为 impact_unknown', async () => {
    for (const freshness of [
      { status: 'unknown', reason_code: 'impact_anchor_missing' },
      { status: 'stale', reason_code: 'fact_snapshot_stale' },
    ]) {
      const result = await evaluateDiffGate({ ...baseArgs, mapClient: async () => ({ freshness }) });
      // fail-closed 铁律：非 fresh 绝不放行为 pass/extend/drift
      expect(result.gate).toBe('impact_unknown');
      expect(['pass', 'extend', 'drift']).not.toContain(result.gate);
    }
  });
});
