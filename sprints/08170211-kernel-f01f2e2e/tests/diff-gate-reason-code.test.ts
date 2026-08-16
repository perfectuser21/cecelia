/**
 * 合同冻结测试 — Diff Impact Gate 按 reason_code 三分类（PRD r8 · 验收点 1 + 4）
 *
 * 被改的边：evaluateDiffGate 步骤 3a 的 freshness 分类逻辑（diff-gate.js）。
 * 本测试用真实 evaluateDiffGate，仅注入 mapper 响应（radius.js 不在本单改动范围，
 * 属"更外层无关依赖"，注入其响应符合"禁 mock 被改的边"——被改的分类逻辑真实执行）。
 * 不使用 db（db 省略 → contract=null → 直接进步骤 2/3，无需 Postgres）。
 *
 * 现状（RED 依据）：diff-gate.js:201-207 对所有 freshness.status !== 'fresh' 一律返回
 *   { gate:'impact_unknown', reason:'mapper_stale', retryable:true }，丢掉 reason_code。
 * 新行为：确定性结论 → blocked/retryable:false + detail；真新鲜度 → 仍 mapper_stale/retryable:true；
 *   未知 reason_code → fail-closed mapper_contract_invalid/retryable:false。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function mapperReturning(result: unknown) {
  return async () => result;
}

describe('diff-gate reason_code 三分类', () => {
  it('(b) impact_anchor_missing → blocked / retryable:false / detail.unclaimed_files 透传', async () => {
    const result = await evaluateDiffGate({
      taskId: 'task-anchor',
      repo: 'cecelia',
      headRevision: 'a'.repeat(40),
      changedFiles: ['DoD.md'],
      mapClient: mapperReturning({
        freshness: { status: 'unknown', reason_code: 'impact_anchor_missing' },
        fact_revisions: { cecelia: 'b'.repeat(40) },
        affected_nodes: [],
        required_assertions: [],
        unclaimed_files: ['DoD.md'],
      }),
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  it('(b) capability_assertion_coverage_missing → blocked / retryable:false / detail.capability_ids 非空', async () => {
    const result = await evaluateDiffGate({
      taskId: 'task-coverage',
      repo: 'cecelia',
      headRevision: 'a'.repeat(40),
      changedFiles: ['apps/dashboard/x.tsx'],
      mapClient: mapperReturning({
        freshness: { status: 'unknown', reason_code: 'capability_assertion_coverage_missing' },
        fact_revisions: { cecelia: 'b'.repeat(40) },
        affected_nodes: [{ capability_id: 'G1' }],
        required_assertions: [],
        unclaimed_files: [],
      }),
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('capability_assertion_coverage_missing');
    expect(result.retryable).toBe(false);
    expect(Array.isArray(result.detail?.capability_ids)).toBe(true);
    expect(result.detail?.capability_ids).toContain('G1');
  });

  it('(a) 真新鲜度问题 fact_snapshot_stale → 仍 impact_unknown / mapper_stale / retryable:true（回归保护）', async () => {
    const result = await evaluateDiffGate({
      taskId: 'task-stale',
      repo: 'cecelia',
      headRevision: 'a'.repeat(40),
      changedFiles: ['packages/brain/src/x.js'],
      mapClient: mapperReturning({
        freshness: { status: 'stale', reason_code: 'fact_snapshot_stale' },
        fact_revisions: { cecelia: 'b'.repeat(40) },
        affected_nodes: [],
        required_assertions: [],
        unclaimed_files: [],
      }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  it('(a) manifest_projection_mismatch → 仍 mapper_stale / retryable:true（回归保护）', async () => {
    const result = await evaluateDiffGate({
      taskId: 'task-manifest',
      repo: 'cecelia',
      headRevision: 'a'.repeat(40),
      changedFiles: ['packages/brain/src/x.js'],
      mapClient: mapperReturning({
        freshness: { status: 'unknown', reason_code: 'manifest_projection_mismatch' },
        fact_revisions: { cecelia: 'b'.repeat(40) },
        affected_nodes: [],
        required_assertions: [],
        unclaimed_files: [],
      }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  it('(c) 未知 reason_code → fail-closed mapper_contract_invalid / retryable:false', async () => {
    const result = await evaluateDiffGate({
      taskId: 'task-unknown',
      repo: 'cecelia',
      headRevision: 'a'.repeat(40),
      changedFiles: ['packages/brain/src/x.js'],
      mapClient: mapperReturning({
        freshness: { status: 'unknown', reason_code: 'some_new_reason_never_seen' },
        fact_revisions: { cecelia: 'b'.repeat(40) },
        affected_nodes: [],
        required_assertions: [],
        unclaimed_files: [],
      }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_contract_invalid');
    expect(result.retryable).toBe(false);
  });

  it('回归夹具 run d1360a48（含仓库根 DoD.md）→ 新代码 blocked:impact_anchor_missing', async () => {
    const fixture = JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'run-d1360a48-radius.json'), 'utf8'),
    );
    const result = await evaluateDiffGate({
      taskId: '0ca4b234',
      repo: 'cecelia',
      headRevision: 'a'.repeat(40),
      changedFiles: fixture.changed_files,
      mapClient: mapperReturning(fixture),
    });
    // 旧代码在此夹具上返回 { gate:'impact_unknown', reason:'mapper_stale', retryable:true }
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toEqual(['DoD.md']);
  });
});
