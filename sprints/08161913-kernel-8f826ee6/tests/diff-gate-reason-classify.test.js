/**
 * 合同冻结测试 — Diff Impact Gate reason_code 三分类（PRD Golden Path Step 3）
 *
 * 禁 mock 边：evaluateDiffGate 分类逻辑真跑（被改的边），只注入 mapClient 顶替
 * 上游 radius（PRD 明确 radius.js 不改、结论正确）——radius 是未改的外层边界，允许替身。
 * db 省略（分类在步骤 3a 返回，不触 DB）。
 *
 * TDD Red：旧代码 diff-gate.js:201-207 只判 freshness.status!=='fresh' → 一律
 * mapper_stale/retryable:true，本文件所有 blocked/fail-closed 断言在旧代码下 FAIL。
 */
import { describe, it, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

// 构造一个「快照新鲜但 radius 给出确定性结论」的 mapper 响应
function mapperWith({ status, reason_code, unclaimed_files = [], affected_nodes = [] }) {
  return async () => ({
    freshness: { status, reason_code },
    unclaimed_files,
    affected_nodes,
    required_assertions: [],
    fact_revisions: {},
  });
}

describe('Diff Impact Gate reason_code 三分类 [BEHAVIOR]', () => {
  it('(b) impact_anchor_missing → gate=blocked reason 同名 retryable=false detail.unclaimed_files 透传', async () => {
    const result = await evaluateDiffGate({
      changedFiles: ['DoD.md'],
      mapClient: mapperWith({
        status: 'unknown',
        reason_code: 'impact_anchor_missing',
        unclaimed_files: ['DoD.md'],
      }),
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  it('(b) impact_anchor_missing 且 unclaimed_files 为空数组 → 仍 blocked/retryable:false，detail.unclaimed_files=[]（边界：不因空数组回退 mapper_stale）', async () => {
    const result = await evaluateDiffGate({
      changedFiles: ['DoD.md'],
      mapClient: mapperWith({
        status: 'unknown',
        reason_code: 'impact_anchor_missing',
        unclaimed_files: [],
      }),
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toEqual([]);
  });

  it('(b) capability_assertion_coverage_missing → gate=blocked reason 同名 retryable=false detail.capability_ids 带缺覆盖能力', async () => {
    const result = await evaluateDiffGate({
      changedFiles: ['apps/dashboard/x.tsx'],
      mapClient: mapperWith({
        status: 'unknown',
        reason_code: 'capability_assertion_coverage_missing',
        affected_nodes: [{ capability_id: 'G1' }],
      }),
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('capability_assertion_coverage_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.capability_ids).toContain('G1');
  });

  it('(b) 其余确定性 reason_code 全部 blocked/retryable:false（capability_not_in_active_projection / unsafe_assertion_ref / assertion_identity_ambiguous）', async () => {
    for (const rc of ['capability_not_in_active_projection', 'unsafe_assertion_ref', 'assertion_identity_ambiguous']) {
      const result = await evaluateDiffGate({
        changedFiles: ['packages/brain/src/x.js'],
        mapClient: mapperWith({ status: 'unknown', reason_code: rc }),
      });
      expect(result.gate).toBe('blocked');
      expect(result.reason).toBe(rc);
      expect(result.retryable).toBe(false);
    }
  });

  it('(a) 真新鲜度问题 fact_snapshot_stale → 仍 impact_unknown/mapper_stale/retryable=true（回归保护）', async () => {
    const result = await evaluateDiffGate({
      changedFiles: ['packages/brain/src/x.js'],
      mapClient: mapperWith({ status: 'stale', reason_code: 'fact_snapshot_stale' }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  it('(a) 其余真新鲜度 reason_code 全部保持 mapper_stale/retryable=true（projection_revision_missing / projection_revision_mismatch / manifest_projection_mismatch / graph_projection_revision_mismatch）', async () => {
    for (const rc of ['projection_revision_missing', 'projection_revision_mismatch', 'manifest_projection_mismatch', 'graph_projection_revision_mismatch']) {
      const result = await evaluateDiffGate({
        changedFiles: ['packages/brain/src/x.js'],
        mapClient: mapperWith({ status: 'stale', reason_code: rc }),
      });
      expect(result.gate).toBe('impact_unknown');
      expect(result.reason).toBe('mapper_stale');
      expect(result.retryable).toBe(true);
    }
  });

  it('(c) 未知/新增 reason_code → fail-closed impact_unknown/mapper_contract_invalid/retryable=false（禁默认放行、禁默认可重试）', async () => {
    const result = await evaluateDiffGate({
      changedFiles: ['packages/brain/src/x.js'],
      mapClient: mapperWith({ status: 'unknown', reason_code: 'some_brand_new_reason_code' }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_contract_invalid');
    expect(result.retryable).toBe(false);
  });
});
