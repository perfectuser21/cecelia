/**
 * diff-gate reason_code 三类分流回归测试 —— sprint 08170944-kernel-4eb00a75
 *
 * 根因：evaluateDiffGate 步骤 3a 把一切非 fresh 折叠成 mapper_stale/retryable:true，
 * 丢掉 mapper 的 freshness.reason_code 与 unclaimed_files，导致确定性结论被无限重试。
 *
 * 本测试锁定三类分流：
 *   (a) 真新鲜度问题（fact_snapshot_stale 等）→ 仍 impact_unknown/mapper_stale/retryable:true（回归保护）
 *   (b) 确定性结论（impact_anchor_missing / capability_assertion_coverage_missing 等）
 *       → blocked/reason=原reason_code/retryable:false + detail(unclaimed_files, capability_ids)
 *   (c) 未知 reason_code → impact_unknown/mapper_contract_invalid/retryable:false（fail-closed）
 *
 * mapper（radius.js / /map/radius）在范围外，用与 resolveImpactRadius 同形的最小注入替身
 *（见 contract-draft.md「未覆盖真实链路清单」）；被测的 diff-gate 分类逻辑本体真实执行。
 * 冻结测试位于 sprints/<sprint_dir>/tests/；permanent 回归测试由 Generator 复制到
 * packages/brain/src/impact-contract/__tests__/。
 */
import { describe, test, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

function mapper(freshness, extra = {}) {
  return async () => ({
    freshness,
    affected_nodes: extra.affected_nodes ?? [],
    required_assertions: extra.required_assertions ?? [],
    unclaimed_files: extra.unclaimed_files ?? [],
    fact_revisions: extra.fact_revisions ?? {},
    manifest_digest: extra.manifest_digest,
    projection_digest: extra.projection_digest,
  });
}

describe('diff-gate reason_code 三类分流（08170944-kernel-4eb00a75）', () => {
  test('impact_anchor_missing → blocked/retryable=false/detail.unclaimed_files', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 't1',
      mapClient: mapper(
        { status: 'unknown', reason_code: 'impact_anchor_missing' },
        { unclaimed_files: ['DoD.md'] },
      ),
      changedFiles: ['DoD.md'],
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  test('capability_assertion_coverage_missing → blocked/retryable=false/detail.capability_ids', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 't2',
      mapClient: mapper(
        { status: 'unknown', reason_code: 'capability_assertion_coverage_missing' },
        { affected_nodes: [{ capability_id: 'G1', owner: 'G1' }] },
      ),
      changedFiles: ['apps/dashboard/x.tsx'],
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('capability_assertion_coverage_missing');
    expect(result.retryable).toBe(false);
    expect(Array.isArray(result.detail?.capability_ids)).toBe(true);
    expect(result.detail.capability_ids).toContain('G1');
  });

  test('fact_snapshot_stale → impact_unknown/mapper_stale/retryable=true（回归保护）', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 't3',
      mapClient: mapper({ status: 'stale', reason_code: 'fact_snapshot_stale' }),
      changedFiles: ['packages/brain/src/x.js'],
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  test('未知 reason_code → impact_unknown/mapper_contract_invalid/retryable=false（fail-closed）', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 't4',
      mapClient: mapper({ status: 'unknown', reason_code: 'brand_new_future_code' }),
      changedFiles: ['packages/brain/src/x.js'],
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_contract_invalid');
    expect(result.retryable).toBe(false);
  });
});
