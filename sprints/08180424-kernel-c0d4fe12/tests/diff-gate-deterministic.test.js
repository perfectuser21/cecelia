/**
 * Golden Path 回归 — Diff Impact Gate 透传 Map 确定性 reason_code + fail-closed 出口（r19）
 *
 * Bug（runs f62c7e87 / d1360a48 在 deny:impact:mapper_stale 空转）：
 *   diff-gate.js Step 3a 把 Mapper 的两类非 fresh 结论折叠成同一个
 *   { reason:'mapper_stale', retryable:true }，丢弃了 Map 给出的确定性 reason_code。
 *   → loop.js 判 infrastructure_blocked → backoff + continue → 无限重试空转。
 *
 * 契约（本 sprint 定案）：
 *   - freshness.status==='unknown'（确定性，结构上判不了）→ 透传 reason_code，retryable:false（fail-closed 终止）。
 *   - freshness.status==='stale'（瞬态，事实快照落后）→ 维持 mapper_stale + retryable:true（真自愈路径不变）。
 *   - freshness.status==='unknown' 但 reason_code 缺失（理论不应发生）→ 仍 fail-closed，用兜底常量，绝不假绿。
 *
 * 层级：直接测真实 diff-gate.js 模块（被改的边不 mock）。db 为外层边界的注入替身，
 *       mapClient 是 Mapper 外部边界（unknown/stale freshness 的输入源），二者均非本 sprint 改动的边。
 */

import { describe, test, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

// active contract 存在（Step 1 通过），走到 Step 2/3 的 Mapper 复算
function dbWithActiveContract() {
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: 'contract-det',
        task_id: 'task-det',
        repo: 'cecelia',
        base_revision: 'base',
        contract_body: { affected_capabilities: [], required_assertions: [] },
      }],
    })),
  };
}

describe('Diff Impact Gate — 确定性 unknown 透传 reason_code + fail-closed（r19 Golden Path）', () => {
  test('Mapper freshness.status=unknown（capability_not_in_active_projection）→ 透传 reason_code 且 retryable:false（不再折叠 mapper_stale）', async () => {
    const mapClient = vi.fn(async () => ({
      freshness: { status: 'unknown', reason_code: 'capability_not_in_active_projection' },
      affected_nodes: [],
      required_assertions: [],
      fact_revisions: { cecelia: 'base' },
    }));

    const result = await evaluateDiffGate({
      db: dbWithActiveContract(),
      taskId: 'task-det',
      repo: 'cecelia',
      headRevision: 'head',
      mapClient,
    });

    // 确定性结论必须 fail-closed，且原样透传 Map 的 reason_code
    expect(result.gate).toBe('impact_unknown');
    expect(result.retryable).toBe(false);
    // reason / reason_code 至少一路带上真实 reason_code（gateReceipt 会 reason ?? reason_code）
    expect(result.reason ?? result.reason_code).toBe('capability_not_in_active_projection');
    // 绝不再折叠为瞬态 mapper_stale
    expect(result.reason).not.toBe('mapper_stale');
  });

  test('另一确定性 reason_code（graph_projection_revision_mismatch）同样透传 + fail-closed', async () => {
    const mapClient = vi.fn(async () => ({
      freshness: { status: 'unknown', reason_code: 'graph_projection_revision_mismatch' },
      affected_nodes: [],
      required_assertions: [],
      fact_revisions: { cecelia: 'base' },
    }));

    const result = await evaluateDiffGate({
      db: dbWithActiveContract(),
      taskId: 'task-det',
      repo: 'cecelia',
      headRevision: 'head',
      mapClient,
    });

    expect(result.gate).toBe('impact_unknown');
    expect(result.retryable).toBe(false);
    expect(result.reason ?? result.reason_code).toBe('graph_projection_revision_mismatch');
    expect(result.reason).not.toBe('mapper_stale');
  });

  test('freshness.status=unknown 但 reason_code 缺失 → 仍 fail-closed（retryable:false），用兜底常量，绝不假绿放行', async () => {
    const mapClient = vi.fn(async () => ({
      freshness: { status: 'unknown', reason_code: null },
      affected_nodes: [],
      required_assertions: [],
      fact_revisions: { cecelia: 'base' },
    }));

    const result = await evaluateDiffGate({
      db: dbWithActiveContract(),
      taskId: 'task-det',
      repo: 'cecelia',
      headRevision: 'head',
      mapClient,
    });

    expect(result.gate).toBe('impact_unknown');
    // 缺 reason_code 也绝不放行、绝不可重试空转
    expect(result.retryable).toBe(false);
    // 兜底 reason 必须是非空字符串（不得为 undefined/null）
    expect(typeof (result.reason ?? result.reason_code)).toBe('string');
    expect((result.reason ?? result.reason_code).length).toBeGreaterThan(0);
    expect(result.reason).not.toBe('mapper_stale');
  });
});

describe('Diff Impact Gate — 瞬态 stale 语义不变（反向不变量）', () => {
  test('Mapper freshness.status=stale（fact_snapshot_stale）→ 维持 mapper_stale + retryable:true（真自愈路径不受影响）', async () => {
    const mapClient = vi.fn(async () => ({
      freshness: { status: 'stale', reason_code: 'fact_snapshot_stale' },
      affected_nodes: [],
      required_assertions: [],
      fact_revisions: { cecelia: 'base' },
    }));

    const result = await evaluateDiffGate({
      db: dbWithActiveContract(),
      taskId: 'task-det',
      repo: 'cecelia',
      headRevision: 'head',
      mapClient,
    });

    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  test('Mapper 抛异常（mapper_unavailable）→ 维持 retryable:true（真瞬态，不归入 fail-closed）', async () => {
    const mapClient = vi.fn(async () => { throw new Error('ETIMEDOUT'); });

    const result = await evaluateDiffGate({
      db: dbWithActiveContract(),
      taskId: 'task-det',
      repo: 'cecelia',
      headRevision: 'head',
      mapClient,
    });

    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_unavailable');
    expect(result.retryable).toBe(true);
  });
});
