/**
 * [BEHAVIOR] 冻结合同测试 — Diff Impact Gate 按 reason_code 三分类透传（TDD Red）
 *
 * PRD 验收 bullet 1：evaluateDiffGate 消费 mapper 结论时，必须按 freshness.reason_code
 * 三分类，而不是一律折叠成 mapper_stale/retryable:true：
 *   (a) 真新鲜度问题（fact_snapshot_stale / projection_revision_* / *_projection_mismatch）
 *       → gate='impact_unknown', reason='mapper_stale', retryable=true（回归保护）
 *   (b) 确定性结论（impact_anchor_missing / capability_assertion_coverage_missing /
 *       capability_not_in_active_projection / unsafe_assertion_ref /
 *       assertion_identity_ambiguous）→ gate='blocked', reason=<原 reason_code>,
 *       retryable=false，且 detail.unclaimed_files / detail.capability_ids 落进结果
 *   (c) 其余未知 reason_code → fail-closed gate='impact_unknown',
 *       reason='mapper_contract_invalid', retryable=false
 *
 * 禁 mock 被改的边：本测试真调 evaluateDiffGate（被改边），只注入外层 mapper（map-client
 * 边界，radius.js/map-client 本 sprint 不改，属允许的外层 mock）。不传 db → 走 3a 分类分支，
 * 无需 Postgres。
 *
 * 现行代码（diff-gate.js:201-207 只判 freshness.status !== 'fresh'）下：(b)(c) 全部
 * 返回 impact_unknown/mapper_stale/retryable=true → 断言失败（Red）。
 */
import { describe, it, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const HEAD = 'a'.repeat(40);

/** 构造一个 mapper（queryImpactRadius 同形）结论：非 fresh + 指定 reason_code。 */
function mapperReturning({ status, reason_code, unclaimed_files = [], affected_nodes = [] }) {
  return async () => ({
    freshness: { status, reason_code, checked_at: new Date().toISOString() },
    affected_nodes,
    required_assertions: [],
    unclaimed_files,
    changed_files: ['DoD.md'],
  });
}

async function runGate(mapper) {
  // 不传 db：step1 跳过（contract=null），step2 调 mapper，step3a 按 reason_code 分类。
  return evaluateDiffGate({
    mapClient: mapper,
    headRevision: HEAD,
    changedFiles: ['DoD.md'],
    repo: 'perfectuser21/cecelia',
  });
}

describe('Diff Impact Gate — reason_code 三分类透传（合同冻结）', () => {
  it('确定性 impact_anchor_missing → blocked / reason 同名 / retryable=false / detail.unclaimed_files', async () => {
    const result = await runGate(mapperReturning({
      status: 'unknown',
      reason_code: 'impact_anchor_missing',
      unclaimed_files: ['DoD.md'],
      affected_nodes: [{ capability_id: 'G1' }],
    }));
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  it('确定性 capability_assertion_coverage_missing → blocked / retryable=false / detail.capability_ids 非空', async () => {
    const result = await runGate(mapperReturning({
      status: 'unknown',
      reason_code: 'capability_assertion_coverage_missing',
      affected_nodes: [{ capability_id: 'G1' }],
    }));
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('capability_assertion_coverage_missing');
    expect(result.retryable).toBe(false);
    expect(Array.isArray(result.detail?.capability_ids)).toBe(true);
    expect(result.detail.capability_ids).toContain('G1');
  });

  it('确定性 capability_not_in_active_projection → blocked / retryable=false', async () => {
    const result = await runGate(mapperReturning({
      status: 'unknown',
      reason_code: 'capability_not_in_active_projection',
      affected_nodes: [{ capability_id: 'G1' }],
    }));
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('capability_not_in_active_projection');
    expect(result.retryable).toBe(false);
  });

  it('确定性 unsafe_assertion_ref → blocked / retryable=false', async () => {
    const result = await runGate(mapperReturning({
      status: 'unknown',
      reason_code: 'unsafe_assertion_ref',
      affected_nodes: [{ capability_id: 'G1' }],
    }));
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('unsafe_assertion_ref');
    expect(result.retryable).toBe(false);
  });

  it('确定性 assertion_identity_ambiguous → blocked / retryable=false', async () => {
    const result = await runGate(mapperReturning({
      status: 'unknown',
      reason_code: 'assertion_identity_ambiguous',
      affected_nodes: [{ capability_id: 'G1' }],
    }));
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('assertion_identity_ambiguous');
    expect(result.retryable).toBe(false);
  });

  it('回归保护：真新鲜度问题 fact_snapshot_stale → 仍 impact_unknown / mapper_stale / retryable=true', async () => {
    const result = await runGate(mapperReturning({
      status: 'stale',
      reason_code: 'fact_snapshot_stale',
    }));
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  it('回归保护：真新鲜度问题 projection_revision_mismatch → 仍 impact_unknown / mapper_stale / retryable=true', async () => {
    const result = await runGate(mapperReturning({
      status: 'stale',
      reason_code: 'projection_revision_mismatch',
    }));
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  it('fail-closed：未知 reason_code → impact_unknown / mapper_contract_invalid / retryable=false', async () => {
    const result = await runGate(mapperReturning({
      status: 'unknown',
      reason_code: 'totally_new_reason_code_from_future',
    }));
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_contract_invalid');
    expect(result.retryable).toBe(false);
  });
});
