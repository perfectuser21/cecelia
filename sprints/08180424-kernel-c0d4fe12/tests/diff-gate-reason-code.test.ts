/**
 * r19 回归 — Diff Impact Gate 步骤 3a：透传 Mapper reason_code 并对确定性终态 fail-closed。
 *
 * 根因：runs f62c7e87 / d1360a48 在 deny:impact:mapper_stale 无限空转——Gate 把任何
 * freshness.status !== 'fresh' 折叠成 mapper_stale + retryable:true，丢弃确定性 reason_code。
 *
 * 策略：真实执行 evaluateDiffGate（不 stub 决策），仅注入外层 Mapper 边界(mapClient)
 * 与最小 active contract(db.query)。mapClient 是 HTTP 外边界，真实客户端另有 map-client 回归。
 */
import { describe, test, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const DETERMINISTIC = ['no_anchor', 'anchor_missing', 'revision_mismatch', 'manifest_projection_mismatch', 'fail_current_revision'];
const TRANSIENT = ['map_unavailable', 'resolver_error', 'fact_stale', 'fact_snapshot_stale'];

function makeDb() {
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: 'contract-r19', task_id: 'task-r19', repo: 'cecelia',
        base_revision: 'base', contract_body: { affected_capabilities: [], required_assertions: [] },
      }],
    })),
  };
}

function staleMapClient(reasonCode?: string) {
  return vi.fn(async () => {
    const freshness: any = { status: 'stale' };
    if (reasonCode !== undefined) freshness.reason_code = reasonCode;
    return { freshness, affected_nodes: [], required_assertions: [] };
  });
}

async function runStale(reasonCode?: string) {
  return evaluateDiffGate({
    db: makeDb() as any, taskId: 'task-r19', repo: 'cecelia', headRevision: 'head',
    mapClient: staleMapClient(reasonCode),
  });
}

describe('r19 Diff Impact Gate reason_code 透传 [BEHAVIOR]', () => {
  test('确定性结论 no_anchor 透传 reason_code 且 retryable:false（fail-closed 出口）', async () => {
    const r = await runStale('no_anchor');
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason_code).toBe('no_anchor');
    expect(r.retryable).toBe(false);
  });

  test('确定性终态集合每个 code 均 retryable:false 且原样透传', async () => {
    for (const code of DETERMINISTIC) {
      const r = await runStale(code);
      expect(r.reason_code).toBe(code);
      expect(r.retryable).toBe(false);
      expect(r.gate).toBe('impact_unknown');
    }
  });

  test('暂态原因 map_unavailable 仍 retryable:true 且透传（不误判为终态）', async () => {
    for (const code of TRANSIENT) {
      const r = await runStale(code);
      expect(r.reason_code).toBe(code);
      expect(r.retryable).toBe(true);
      expect(r.gate).toBe('impact_unknown');
    }
  });

  test('reason_code 缺失时保留 mapper_stale 语义且 retryable:true', async () => {
    const r = await runStale(undefined);
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('mapper_stale');
    expect(r.retryable).toBe(true);
    expect(r.reason_code).toBeFalsy();
  });

  test('Mapper 抛异常时维持 mapper_unavailable + retryable:true（本改动不波及）', async () => {
    const r = await evaluateDiffGate({
      db: makeDb() as any, taskId: 'task-r19', repo: 'cecelia', headRevision: 'head',
      mapClient: vi.fn(async () => { throw new Error('ETIMEDOUT'); }),
    });
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('mapper_unavailable');
    expect(r.retryable).toBe(true);
  });

  test('fail-closed 不变量：所有不可判定分支 gate 恒为 impact_unknown 绝不放行', async () => {
    for (const code of [...DETERMINISTIC, ...TRANSIENT, undefined]) {
      const r = await runStale(code);
      expect(r.gate).toBe('impact_unknown');
      expect(['pass', 'extend', 'drift']).not.toContain(r.verdict);
    }
  });
});
