/**
 * 冻结合同测试（TDD Red）— Sprint 08170545-kernel-ecf0ed01
 * Diff Impact Gate 按 mapper freshness.reason_code 三分类 + 透传 detail。
 *
 * 覆盖 Golden Path Step 1-2：mapper 在快照新鲜的前提下写入确定性 reason_code，
 * diff-gate.js 必须区分「真新鲜度问题（可重试）」与「确定性结论（不可重试）」，
 * 并把 unclaimed_files / capability_ids 放进 result.detail。
 *
 * 禁 mock 被改的边：本测试注入 mapClient（diff-gate 的既有测试 seam，是 diff-gate 的
 * *输入* 而非被改的那条边）；被改的 diff-gate↔radius 输出 shape 由 fixture 录制件
 * （B-05）用真实 radius 响应形态覆盖。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HEAD = 'a'.repeat(40);

// mapper 返回「快照新鲜、但确定性结论写进 freshness.status='unknown'」的形态（radius.js:381-397）
function unknownMapper(reasonCode, extra = {}) {
  return async () => ({
    freshness: { status: 'unknown', reason_code: reasonCode, mapper_revision: 'bc4e8644' },
    fact_revisions: { cecelia: 'bc4e8644' },
    affected_nodes: [{ capability_id: 'G1' }],
    required_assertions: [],
    unclaimed_files: [],
    ...extra,
  });
}

describe('Diff Impact Gate reason_code 三分类', () => {
  it('B-01: impact_anchor_missing → blocked/retryable=false/detail.unclaimed_files', async () => {
    const result = await evaluateDiffGate({
      mapClient: unknownMapper('impact_anchor_missing', { unclaimed_files: ['DoD.md'] }),
      headRevision: HEAD,
      changedFiles: ['DoD.md'],
      repo: 'cecelia',
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  it('B-02: capability_assertion_coverage_missing → blocked/retryable=false/detail.capability_ids', async () => {
    const result = await evaluateDiffGate({
      mapClient: unknownMapper('capability_assertion_coverage_missing'),
      headRevision: HEAD,
      changedFiles: ['apps/dashboard/x.tsx'],
      repo: 'cecelia',
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('capability_assertion_coverage_missing');
    expect(result.retryable).toBe(false);
    expect(Array.isArray(result.detail?.capability_ids)).toBe(true);
    expect(result.detail.capability_ids.length).toBeGreaterThan(0);
  });

  it('B-03 回归保护: fact_snapshot_stale（真新鲜度问题）→ impact_unknown/mapper_stale/retryable=true', async () => {
    const result = await evaluateDiffGate({
      mapClient: async () => ({
        freshness: { status: 'stale', reason_code: 'fact_snapshot_stale' },
        fact_revisions: { cecelia: 'bc4e8644' },
        affected_nodes: [],
        required_assertions: [],
      }),
      headRevision: HEAD,
      changedFiles: ['packages/brain/src/x.js'],
      repo: 'cecelia',
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  it('B-04 fail-closed: 未知 reason_code → impact_unknown/mapper_contract_invalid/retryable=false', async () => {
    const result = await evaluateDiffGate({
      mapClient: unknownMapper('some_brand_new_reason_code'),
      headRevision: HEAD,
      changedFiles: ['packages/brain/src/x.js'],
      repo: 'cecelia',
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_contract_invalid');
    expect(result.retryable).toBe(false);
  });

  it('B-05 录制件: run d1360a48 真实 radius 形态（含 DoD.md）→ blocked/impact_anchor_missing', async () => {
    const recording = JSON.parse(
      readFileSync(join(HERE, 'fixtures', 'd1360a48-radius-recording.json'), 'utf8'),
    );
    const result = await evaluateDiffGate({
      mapClient: async () => recording,
      headRevision: HEAD,
      changedFiles: recording.changed_files,
      repo: 'cecelia',
    });
    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toEqual(['DoD.md']);
  });
});
