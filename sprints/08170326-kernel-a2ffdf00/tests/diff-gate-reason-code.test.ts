/**
 * 冻结合同测试 — Diff Impact Gate 三类裁决（透传 reason_code + fail-closed 出口）
 *
 * 覆盖 PRD Golden Path Step 1/2/3/4 + 边界情况：
 *   (a) 确定性结论   → gate:'blocked', reason:<reason_code>, retryable:false, detail 带证据
 *   (b) 真新鲜度问题 → gate:'impact_unknown', reason:'mapper_stale', retryable:true（回归保护）
 *   (c) 未知 reason_code → fail-closed: impact_unknown/mapper_contract_invalid/retryable:false
 *
 * 策略：evaluateDiffGate 不传 db（contract 走 null 分支），注入确定性 mapClient，
 *      不依赖 Postgres / 实时 Map（radius.js 结论本身正确，本 sprint 只改消费方）。
 */
import { describe, it, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

// 构造 radius.js 现有产出形态的 mapper 响应（freshness + affected_nodes + unclaimed_files）
function mapperResult({ status, reason_code, affectedNodes = [], unclaimedFiles = [] }) {
  return async () => ({
    freshness: { status, reason_code, checked_at: '2026-08-16T00:00:00.000Z', mapper_revision: 'bc4e8644' },
    fact_revisions: { cecelia: 'bc4e8644' },
    changed_files: unclaimedFiles,
    affected_nodes: affectedNodes,
    required_assertions: [],
    unclaimed_files: unclaimedFiles,
  });
}

async function run(mapClient, changedFiles = ['x']) {
  return evaluateDiffGate({ mapClient, taskId: 'task-frozen', changedFiles, repo: 'perfectuser21/cecelia' });
}

describe('Diff Impact Gate 三类裁决', () => {
  it('impact_anchor_missing → blocked, reason 同名, retryable false, detail.unclaimed_files 透传', async () => {
    const r = await run(mapperResult({
      status: 'unknown', reason_code: 'impact_anchor_missing', unclaimedFiles: ['DoD.md'],
    }), ['DoD.md']);
    expect(r.gate).toBe('blocked');
    expect(r.reason).toBe('impact_anchor_missing');
    expect(r.retryable).toBe(false);
    expect(r.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  it('capability_assertion_coverage_missing → blocked, retryable false, detail.capability_ids 带缺覆盖能力', async () => {
    const r = await run(mapperResult({
      status: 'unknown', reason_code: 'capability_assertion_coverage_missing',
      affectedNodes: [{ capability_id: 'G1' }],
    }));
    expect(r.gate).toBe('blocked');
    expect(r.reason).toBe('capability_assertion_coverage_missing');
    expect(r.retryable).toBe(false);
    expect(r.detail?.capability_ids).toContain('G1');
  });

  it.each([
    'capability_not_in_active_projection',
    'unsafe_assertion_ref',
    'assertion_identity_ambiguous',
  ])('确定性结论 %s → blocked, retryable false', async (reason_code) => {
    const r = await run(mapperResult({ status: 'unknown', reason_code }));
    expect(r.gate).toBe('blocked');
    expect(r.reason).toBe(reason_code);
    expect(r.retryable).toBe(false);
  });

  it.each([
    'fact_snapshot_stale',
    'projection_revision_missing',
    'projection_revision_mismatch',
    'manifest_projection_mismatch',
    'graph_projection_revision_mismatch',
  ])('真新鲜度问题 %s → impact_unknown/mapper_stale/retryable true（回归保护）', async (reason_code) => {
    const status = reason_code === 'graph_projection_revision_mismatch' ? 'unknown' : 'stale';
    const r = await run(mapperResult({ status, reason_code }));
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('mapper_stale');
    expect(r.retryable).toBe(true);
  });

  it('未知 reason_code → fail-closed: impact_unknown/mapper_contract_invalid/retryable false', async () => {
    const r = await run(mapperResult({ status: 'unknown', reason_code: 'some_brand_new_code' }));
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('mapper_contract_invalid');
    expect(r.retryable).toBe(false);
  });

  it('边界：unclaimed_files 为空但 reason=impact_anchor_missing 仍落 blocked（不因空数组降级）', async () => {
    const r = await run(mapperResult({
      status: 'unknown', reason_code: 'impact_anchor_missing', unclaimedFiles: [],
    }));
    expect(r.gate).toBe('blocked');
    expect(r.reason).toBe('impact_anchor_missing');
    expect(r.retryable).toBe(false);
    expect(Array.isArray(r.detail?.unclaimed_files)).toBe(true);
  });
});
