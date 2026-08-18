/**
 * Sprint 08180424-kernel-c0d4fe12 — Diff Impact Gate reason_code 透传 + 确定性 stale fail-closed
 *
 * 覆盖父路：独立小路（无父 golden_path），对应本 sprint Golden Path 第 3-4 步。
 *
 * TDD Red 证据：当前 diff-gate.js 步骤 3a 把所有非 fresh freshness 折叠成
 *   { reason:'mapper_stale', retryable:true }，丢弃 mapper 的 freshness.reason_code。
 * 本测试断言：stale → retryable:false + reason_code 透传；unknown → retryable:true + reason_code 透传。
 *
 * 禁 mock 被改的边：evaluateDiffGate 为真实调用（未 mock）。freshness 是被测纯决策函数的
 *   输入，由注入的 mapClient 提供（map-client 属本 sprint 范围外的边界，另有 map-client.test.js 回归）。
 *   stale/unknown 分支在步骤 5 的 DB 写入之前返回，故不触及任何 DB 写路径，无需真 Postgres。
 */
import { describe, it, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

// active contract 存根：步骤 1 读取用；stale/unknown 分支在对账/写库前返回，不触发 DB 写。
function makeContractDb() {
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: 'contract-x', repo: 'cecelia', change_kind: 'bugfix', base_revision: 'base',
        contract_body: { affected_capabilities: [], required_assertions: [] },
      }],
    })),
  };
}

describe('Diff Impact Gate — freshness 分流与 reason_code 透传 [BEHAVIOR]', () => {
  it('确定性 stale 结论 返回 retryable false 且透传 reason_code', async () => {
    const result = await evaluateDiffGate({
      db: makeContractDb(), taskId: 'task-stale', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => ({ freshness: { status: 'stale', reason_code: 'MAP_PROJECTION_STALE' } }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe('MAP_PROJECTION_STALE');
    expect(result.retryable).toBe(false);
  });

  it('确定性 stale 但 reason_code 缺失 仍 fail-closed retryable false 透传 null', async () => {
    const result = await evaluateDiffGate({
      db: makeContractDb(), taskId: 'task-stale-null', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => ({ freshness: { status: 'stale' } }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe(null);
    expect(result.retryable).toBe(false);
  });

  it('unknown 瞬时态 保留 retryable true 且透传 reason_code', async () => {
    const result = await evaluateDiffGate({
      db: makeContractDb(), taskId: 'task-unknown', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => ({ freshness: { status: 'unknown', reason_code: 'MAP_INDETERMINATE' } }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe('MAP_INDETERMINATE');
    expect(result.retryable).toBe(true);
  });

  it('freshness 完全缺失 视为瞬时态 保留 retryable true 透传 reason_code null', async () => {
    const result = await evaluateDiffGate({
      db: makeContractDb(), taskId: 'task-nofresh', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => ({}),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.retryable).toBe(true);
    expect(result.reason_code).toBe(null);
  });
});
