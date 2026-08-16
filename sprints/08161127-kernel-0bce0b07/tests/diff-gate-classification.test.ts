// 冻结合同测试 — Diff Impact Gate 三分类（modification A）
// sprint: 08161127-kernel-0bce0b07
//
// 覆盖父路：独立小路（无父路）—— kernel harness 内部闸修复，不挂业务 Golden Path。
//
// 被测边（禁 mock 边清单对应）：evaluateDiffGate ↔ mapper（radius.js 返回的 freshness.reason_code）。
// 这里 mapClient 是 evaluateDiffGate 的 SSOT 注入点（diff-gate.js 参数 mapClient），
// 注入的是「mapper 的返回值录制」而非 mock 掉被改的 diff-gate 逻辑本身——被改的分类逻辑真跑。
// db 省略：三分类在 step 3a（对账之前）判定，与 contract/DB 无关，故无需 Postgres。
import { describe, it, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const HEAD = 'a'.repeat(40);

/** 构造一个只返回指定 freshness / 附加字段的 mapper 录制件。 */
function mapperReturning(extra: Record<string, unknown>) {
  return async () => ({
    changed_files: ['DoD.md'],
    affected_nodes: [],
    required_assertions: [],
    fact_revisions: { cecelia: 'bc4e864400daf7b4cdafec5af09e4b8b4767a13e' },
    ...extra,
  });
}

describe('evaluateDiffGate 三分类 [BEHAVIOR]', () => {
  it('确定性结论 impact_anchor_missing 返回 blocked 且 retryable=false 且 detail.unclaimed_files', async () => {
    const result = await evaluateDiffGate({
      mapClient: mapperReturning({
        freshness: { status: 'unknown', reason_code: 'impact_anchor_missing' },
        unclaimed_files: ['DoD.md'],
      }),
      headRevision: HEAD,
      changedFiles: ['DoD.md'],
      repo: 'cecelia',
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  it('确定性结论 capability_assertion_coverage_missing 返回 blocked 且 retryable=false 且 detail 带缺覆盖 capability_ids', async () => {
    const result = await evaluateDiffGate({
      mapClient: mapperReturning({
        freshness: { status: 'unknown', reason_code: 'capability_assertion_coverage_missing' },
        affected_nodes: [{ capability_id: 'G1' }],
        required_assertions: [],
        unclaimed_files: [],
      }),
      headRevision: HEAD,
      changedFiles: ['apps/dashboard/src/x.tsx'],
      repo: 'cecelia',
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('capability_assertion_coverage_missing');
    expect(result.retryable).toBe(false);
    // 缺覆盖 capability = affected_nodes 中未被 required_assertions.covers_capability_ids 覆盖者
    expect(result.detail?.uncovered_capability_ids).toEqual(['G1']);
  });

  it('确定性结论 unsafe_assertion_ref 返回 blocked 且 retryable=false（无附加清单也 blocked）', async () => {
    const result = await evaluateDiffGate({
      mapClient: mapperReturning({
        freshness: { status: 'unknown', reason_code: 'unsafe_assertion_ref' },
      }),
      headRevision: HEAD,
      changedFiles: ['packages/brain/src/x.js'],
      repo: 'cecelia',
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('unsafe_assertion_ref');
    expect(result.retryable).toBe(false);
  });

  it('回归保护：真新鲜度问题 fact_snapshot_stale 仍 impact_unknown/mapper_stale/retryable=true', async () => {
    const result = await evaluateDiffGate({
      mapClient: mapperReturning({
        freshness: { status: 'stale', reason_code: 'fact_snapshot_stale' },
      }),
      headRevision: HEAD,
      changedFiles: ['packages/brain/src/x.js'],
      repo: 'cecelia',
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  it('回归保护：真新鲜度问题 projection_revision_mismatch 仍 impact_unknown/mapper_stale/retryable=true', async () => {
    const result = await evaluateDiffGate({
      mapClient: mapperReturning({
        freshness: { status: 'stale', reason_code: 'projection_revision_mismatch' },
      }),
      headRevision: HEAD,
      changedFiles: ['packages/brain/src/x.js'],
      repo: 'cecelia',
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  it('fail-closed：未知 reason_code 归 impact_unknown/mapper_contract_invalid/retryable=false', async () => {
    const result = await evaluateDiffGate({
      mapClient: mapperReturning({
        freshness: { status: 'unknown', reason_code: 'some_future_unknown_code' },
      }),
      headRevision: HEAD,
      changedFiles: ['packages/brain/src/x.js'],
      repo: 'cecelia',
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_contract_invalid');
    expect(result.retryable).toBe(false);
  });

  it('fail-closed：freshness 缺失/非 object 归 impact_unknown/mapper_contract_invalid/retryable=false', async () => {
    const result = await evaluateDiffGate({
      mapClient: async () => ({
        changed_files: ['x'],
        affected_nodes: [],
        required_assertions: [],
        // freshness 缺失
      }),
      headRevision: HEAD,
      changedFiles: ['packages/brain/src/x.js'],
      repo: 'cecelia',
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_contract_invalid');
    expect(result.retryable).toBe(false);
  });
});
