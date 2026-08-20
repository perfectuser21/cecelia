/**
 * Sprint 合同 TDD Red — Diff Impact Gate 步骤 3a：reason_code 透传 + 终态 fail-closed 分流
 *
 * 覆盖父路声明：独立小路（无父路）—— 本 sprint 只修 evaluateDiffGate 步骤 3a 的
 *   mapper 非 fresh 折叠点，不隶属某条已注册 Golden Path。
 *
 * 现状（red 证据）：diff-gate.js 步骤 3a 对**任何** freshness.status !== 'fresh'
 *   一律返回 { reason:'mapper_stale', retryable:true }，丢弃 map-client 已算出的
 *   freshness.reason_code，且对确定性终态也标 retryable:true → deny:impact:mapper_stale
 *   无限重试空转（runs f62c7e87 / d1360a48 实证）。
 *
 * 期望（green 目标）：
 *   - status==='unknown'（结构性不可判定，重试无法自愈）→ retryable:false（fail-closed）
 *   - status==='stale'（事实/投影暂时落后，可能自愈）→ retryable:true
 *   - 两种出口均透传具体 reason_code，reason 不再是裸 'mapper_stale'
 *
 * 禁 mock 边：真跑 evaluateDiffGate 本体，只注入 mapper 结果数据与 contract 行数据；
 *   3a 在任何 DB 写入前返回，改动路径不触达 DB 写。
 */

import { describe, test, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

function stubContractDb(baseRevision = 'base') {
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: 'contract-x',
        repo: 'cecelia',
        base_revision: baseRevision,
        contract_body: { affected_capabilities: [], required_assertions: [] },
      }],
    })),
  };
}

function nonFreshMapper(freshness, { baseRevision = 'base' } = {}) {
  return async () => ({
    manifest_digest: 'm',
    projection_digest: 'p',
    fact_revisions: { cecelia: baseRevision },
    affected_nodes: [],
    required_assertions: [],
    freshness,
  });
}

describe('Diff Impact Gate 步骤 3a — reason_code 透传 + 终态 fail-closed', () => {
  test('确定性终态 unknown → retryable:false 且透传 reason_code（不再无限重试）', async () => {
    const r = await evaluateDiffGate({
      db: stubContractDb(),
      taskId: 't',
      repo: 'cecelia',
      headRevision: 'h',
      mapClient: nonFreshMapper({ status: 'unknown', reason_code: 'impact_anchor_missing' }),
    });
    expect(r.gate).toBe('impact_unknown');
    expect(r.retryable).toBe(false);
    expect(r.reason_code).toBe('impact_anchor_missing');
    expect(r.reason).not.toBe('mapper_stale');
    expect(r.reason).toContain('impact_anchor_missing');
  });

  test('瞬态 stale → retryable:true 且透传具体 reason_code（不再裸 mapper_stale）', async () => {
    const r = await evaluateDiffGate({
      db: stubContractDb(),
      taskId: 't',
      repo: 'cecelia',
      headRevision: 'h',
      mapClient: nonFreshMapper({ status: 'stale', reason_code: 'fact_snapshot_stale' }),
    });
    expect(r.gate).toBe('impact_unknown');
    expect(r.retryable).toBe(true);
    expect(r.reason_code).toBe('fact_snapshot_stale');
    expect(r.reason).not.toBe('mapper_stale');
  });

  test('reason_code 缺失兜底 → 不崩溃、终态 fail-closed、reason_code=null', async () => {
    const r = await evaluateDiffGate({
      db: stubContractDb(),
      taskId: 't',
      repo: 'cecelia',
      headRevision: 'h',
      mapClient: nonFreshMapper({ status: 'unknown', reason_code: null }),
    });
    expect(r.gate).toBe('impact_unknown');
    expect(r.retryable).toBe(false);
    expect(r.reason_code).toBe(null);
  });

  test('既有 revision_mismatch 出口语义不回退（仍 impact_unknown + retryable:true）', async () => {
    // 步骤 3b（fresh 但 revision 不对齐）不在本 sprint 改动范围，作回归护栏
    const r = await evaluateDiffGate({
      db: stubContractDb('base123'),
      taskId: 't',
      repo: 'cecelia',
      headRevision: 'h',
      mapClient: async () => ({
        freshness: { status: 'fresh' },
        affected_nodes: [],
        required_assertions: [],
        fact_revisions: { cecelia: 'stale999' },
      }),
    });
    expect(r).toMatchObject({ gate: 'impact_unknown', reason: 'revision_mismatch', retryable: true });
  });
});
