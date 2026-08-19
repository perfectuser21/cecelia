/**
 * Sprint 08191302-kernel-2a813900 — Diff Impact Gate 步骤 3a reason_code 透传 + fail-closed 出口
 *
 * 覆盖父路: 独立小路（无父路） — 修 diff-gate.js 步骤 3a 的 mapper_stale 无限重试根因。
 *
 * 契约 RED 测试（TDD 红）：
 *   - 现状：步骤 3a 把一切 freshness.status !== 'fresh' 折叠成 { reason:'mapper_stale', retryable:true }，
 *     确定性 reason_code 被丢弃 → deny:impact:mapper_stale 无限重试空转（runs f62c7e87 / d1360a48）。
 *   - 期望：Mapper 携带非空确定性 reason_code 时透传该 reason_code 且 retryable=false（fail-closed 终态）；
 *     仅真·瞬时 stale（无 reason_code）时保留 mapper_stale + retryable=true。
 *
 * 禁 mock 被改的边：本 sprint 改的是 diff-gate 步骤 3a 的**纯决策分支**（return 前无 DB 写、无跨模块接力）。
 * mapClient 是外层 HTTP 边界（Universal Mapper /map/radius），全 diff-gate 测试文件均以依赖注入构造其返回，
 * 本文件沿用同一惯例；db 仅提供 active contract（步骤 1），步骤 3a 在 return 前不写 DB。
 */

import { describe, it, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

// active contract 存根（步骤 1 读取）；步骤 3a 对 stale 提前 return，base_revision 相关校验不触及。
function makeDb() {
  return {
    query: vi.fn(async (sql: string) =>
      String(sql).includes('harness_impact_contracts')
        ? {
            rows: [
              {
                id: 'contract-3a',
                repo: 'cecelia',
                base_revision: 'base',
                contract_body: { affected_capabilities: [], required_assertions: [] },
              },
            ],
          }
        : { rows: [] }),
  };
}

describe('diff-gate 步骤 3a：reason_code 透传 + fail-closed 出口', () => {
  it('确定性 reason_code 透传且 retryable=false（fail-closed 终态，不再空转）', async () => {
    const mapClient = vi.fn(async () => ({
      freshness: { status: 'stale', reason_code: 'projection_revision_mismatch' },
      affected_nodes: [],
      required_assertions: [],
    }));

    const result = await evaluateDiffGate({
      db: makeDb(),
      taskId: 'task-det',
      mapClient,
      headRevision: 'head',
      repo: 'cecelia',
    });

    expect(result.gate).toBe('impact_unknown');
    // 根因修复：reason 透传 Mapper 原始 reason_code，不再折叠成 'mapper_stale'
    expect(result.reason).toBe('projection_revision_mismatch');
    // 确定性结论 ⇒ 非重试终态
    expect(result.retryable).toBe(false);
  });

  it('确定性 reason_code 也回填到 reason_code 字段（透传证据）', async () => {
    const mapClient = vi.fn(async () => ({
      freshness: { status: 'unknown', reason_code: 'map_unavailable' },
      affected_nodes: [],
      required_assertions: [],
    }));

    const result = await evaluateDiffGate({
      db: makeDb(),
      taskId: 'task-det2',
      mapClient,
      headRevision: 'head',
      repo: 'cecelia',
    });

    expect(result.reason).toBe('map_unavailable');
    expect(result.reason_code).toBe('map_unavailable');
    expect(result.retryable).toBe(false);
  });

  it('真·瞬时 stale（reason_code=null）保留 mapper_stale + retryable=true（重试语义不回退）', async () => {
    const mapClient = vi.fn(async () => ({
      freshness: { status: 'stale', reason_code: null },
      affected_nodes: [],
      required_assertions: [],
    }));

    const result = await evaluateDiffGate({
      db: makeDb(),
      taskId: 'task-transient',
      mapClient,
      headRevision: 'head',
      repo: 'cecelia',
    });

    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  it('既无 freshness 也无 reason_code：不可判定，fail-closed 保留 mapper_stale + retryable=true（绝不假绿）', async () => {
    const mapClient = vi.fn(async () => ({
      affected_nodes: [],
      required_assertions: [],
    }));

    const result = await evaluateDiffGate({
      db: makeDb(),
      taskId: 'task-indeterminate',
      mapClient,
      headRevision: 'head',
      repo: 'cecelia',
    });

    // 不可判定绝不放行为 pass/extend/drift
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  it('确定性 reason_code 存在但 Mapper 未给 retryable 字段时，Gate 仍判 retryable=false（有 reason_code ⇒ 非重试）', async () => {
    const mapClient = vi.fn(async () => ({
      // 顶层 reason_code（确定性 deny），freshness 非 fresh 且缺 retryable
      reason_code: 'provider_denied',
      freshness: { status: 'stale' },
      affected_nodes: [],
      required_assertions: [],
    }));

    const result = await evaluateDiffGate({
      db: makeDb(),
      taskId: 'task-toplevel',
      mapClient,
      headRevision: 'head',
      repo: 'cecelia',
    });

    expect(result.reason).toBe('provider_denied');
    expect(result.retryable).toBe(false);
  });
});
