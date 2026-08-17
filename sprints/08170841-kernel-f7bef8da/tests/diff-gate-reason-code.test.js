/**
 * 合同冻结测试 — Diff Impact Gate 按 reason_code 分类（本 sprint 根因修复）
 *
 * 覆盖：evaluateDiffGate 消费 mapperResult.freshness 时，必须按 reason_code 三分：
 *   (a) 真新鲜度 → impact_unknown/mapper_stale/retryable=true（回归保护）
 *   (b) 确定性结论 → blocked/reason=<reason_code>/retryable=false + detail
 *   (c) 未知 reason_code / freshness 缺失 → impact_unknown/mapper_contract_invalid/retryable=false
 *
 * 禁 mock 被改的边：被改的是 diff-gate 对 mapperResult 的【分类】逻辑，直接真调
 * evaluateDiffGate（不 mock diff-gate 自身）。上游 radius/mapper 需 Postgres+投影，
 * 单元层以录制/构造的 mapper 输出注入（radius.js 本单不变），真实 radius→diff-gate→DB
 * 边由 regression 录制件（regression-d1360a48-*.test.js）与 Final E2E 覆盖。
 *
 * db 省略：evaluateDiffGate 在 db falsy 时跳过 active-contract 读取，直接进入 mapper
 * 调用与 freshness 分类（步骤 3a），本组分类结论均在使用 contract 之前返回。
 */
import { describe, it, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

function mapperReturning(freshness, extra = {}) {
  return async () => ({
    fact_revisions: { cecelia: 'base' },
    affected_nodes: [],
    required_assertions: [],
    unclaimed_files: [],
    ...extra,
    freshness,
  });
}

describe('Diff Impact Gate 按 reason_code 分类 [BEHAVIOR]', () => {
  it('impact_anchor_missing 返回 blocked 且 retryable=false 且 detail.unclaimed_files', async () => {
    const result = await evaluateDiffGate({
      repo: 'cecelia',
      headRevision: 'a'.repeat(40),
      changedFiles: ['DoD.md'],
      mapClient: mapperReturning(
        { status: 'unknown', reason_code: 'impact_anchor_missing' },
        { unclaimed_files: ['DoD.md'] },
      ),
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail.unclaimed_files).toEqual(['DoD.md']);
  });

  it('capability_assertion_coverage_missing 返回 blocked 且 retryable=false 且 detail.capability_ids', async () => {
    const result = await evaluateDiffGate({
      repo: 'cecelia',
      headRevision: 'a'.repeat(40),
      changedFiles: ['apps/dashboard/x.tsx'],
      mapClient: mapperReturning(
        { status: 'unknown', reason_code: 'capability_assertion_coverage_missing' },
        { affected_nodes: [{ capability_id: 'G1' }], unclaimed_files: [] },
      ),
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('capability_assertion_coverage_missing');
    expect(result.retryable).toBe(false);
    expect(Array.isArray(result.detail.capability_ids)).toBe(true);
    expect(result.detail.capability_ids).toContain('G1');
  });

  it('capability_not_in_active_projection / unsafe_assertion_ref / assertion_identity_ambiguous 均 blocked retryable=false', async () => {
    for (const code of [
      'capability_not_in_active_projection',
      'unsafe_assertion_ref',
      'assertion_identity_ambiguous',
    ]) {
      const result = await evaluateDiffGate({
        repo: 'cecelia',
        headRevision: 'a'.repeat(40),
        changedFiles: ['packages/brain/src/x.js'],
        mapClient: mapperReturning({ status: 'unknown', reason_code: code }),
      });
      expect(result.gate).toBe('blocked');
      expect(result.reason).toBe(code);
      expect(result.retryable).toBe(false);
    }
  });

  it('fact_snapshot_stale 仍 impact_unknown/mapper_stale/retryable=true（回归保护）', async () => {
    const result = await evaluateDiffGate({
      repo: 'cecelia',
      headRevision: 'a'.repeat(40),
      changedFiles: ['packages/brain/src/x.js'],
      mapClient: mapperReturning({ status: 'stale', reason_code: 'fact_snapshot_stale' }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  it('分类按 reason_code 不按 status：status=unknown 的 graph_projection_revision_mismatch 仍属真新鲜度 retryable=true', async () => {
    // radius.js 里 graph_projection_revision_mismatch 的 status 是 'unknown'（非 stale），
    // 若按 status 分类会误判为确定性 blocked；必须按 reason_code 归入真新鲜度组。
    const result = await evaluateDiffGate({
      repo: 'cecelia',
      headRevision: 'a'.repeat(40),
      changedFiles: ['packages/brain/src/x.js'],
      mapClient: mapperReturning({ status: 'unknown', reason_code: 'graph_projection_revision_mismatch' }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  it('projection_revision_missing / projection_revision_mismatch / manifest_projection_mismatch 均 retryable=true', async () => {
    for (const code of [
      'projection_revision_missing',
      'projection_revision_mismatch',
      'manifest_projection_mismatch',
    ]) {
      const result = await evaluateDiffGate({
        repo: 'cecelia',
        headRevision: 'a'.repeat(40),
        changedFiles: ['packages/brain/src/x.js'],
        mapClient: mapperReturning({ status: 'stale', reason_code: code }),
      });
      expect(result.gate).toBe('impact_unknown');
      expect(result.reason).toBe('mapper_stale');
      expect(result.retryable).toBe(true);
    }
  });

  it('未知 reason_code 走 fail-closed mapper_contract_invalid/retryable=false（不再可重试）', async () => {
    const result = await evaluateDiffGate({
      repo: 'cecelia',
      headRevision: 'a'.repeat(40),
      changedFiles: ['packages/brain/src/x.js'],
      mapClient: mapperReturning({ status: 'unknown', reason_code: 'some_future_unmapped_code' }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_contract_invalid');
    expect(result.retryable).toBe(false);
  });

  it('freshness 缺失/结构异常 走 fail-closed mapper_contract_invalid/retryable=false', async () => {
    const missing = await evaluateDiffGate({
      repo: 'cecelia',
      headRevision: 'a'.repeat(40),
      changedFiles: ['packages/brain/src/x.js'],
      mapClient: async () => ({ affected_nodes: [], required_assertions: [] }),
    });
    expect(missing.gate).toBe('impact_unknown');
    expect(missing.reason).toBe('mapper_contract_invalid');
    expect(missing.retryable).toBe(false);
  });
});
