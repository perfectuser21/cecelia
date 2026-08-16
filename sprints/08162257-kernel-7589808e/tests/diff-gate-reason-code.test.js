/**
 * 冻结合同测试 — Diff Impact Gate 透传 reason_code + fail-closed 出口
 * sprint: 08162257-kernel-7589808e
 *
 * 根因（radius.js:381-397 在快照新鲜前提下把确定性结论写进 freshness；
 * diff-gate.js:200-208 只看 status!=='fresh' 就返回 mapper_stale/retryable:true，
 * 丢掉 reason_code）→ 确定性结论被折叠成可重试，kernel 空转到 deadline。
 *
 * 本文件测 packages/brain/src/impact-contract/diff-gate.js 的 evaluateDiffGate：
 * 必须区分三类 —— (a) 真新鲜度 → 维持 impact_unknown/mapper_stale/retryable:true；
 * (b) 确定性结论 → gate:'blocked' + reason:<原 reason_code> + retryable:false + detail；
 * (c) 未知 reason_code → fail-closed impact_unknown/mapper_contract_invalid/retryable:false。
 *
 * 单元层通过依赖注入构造 db + mock mapClient（禁 mock 被改的边 diff-gate↔mapper
 * 结论：这里注入的正是 mapper 真实返回 shape，不 mock diff-gate 内部逻辑）。
 */

import { describe, test, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 造一份 active impact contract（让 evaluateDiffGate 走到 mapper 复算 + freshness 判定）。
function contractDb(base_revision = 'bc4e8644') {
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: 'contract-d1360a48',
        repo: 'cecelia',
        change_kind: 'bugfix',
        base_revision,
        contract_body: { affected_capabilities: [{ capability_id: 'impact-contract' }], required_assertions: [] },
      }],
    })),
  };
}

describe('Diff Impact Gate reason_code 透传 [BEHAVIOR]', () => {
  test('impact_anchor_missing 折叠成 blocked/retryable=false 且 detail 带 unclaimed_files', async () => {
    const result = await evaluateDiffGate({
      db: contractDb(),
      taskId: '0ca4b234',
      repo: 'cecelia',
      headRevision: 'deadbeef',
      changedFiles: ['DoD.md'],
      mapClient: async () => ({
        freshness: { status: 'unknown', reason_code: 'impact_anchor_missing' },
        fact_revisions: { cecelia: 'bc4e8644' },
        affected_nodes: ['impact-contract'],
        required_assertions: [],
        unclaimed_files: ['DoD.md'],
      }),
    });

    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  test('capability_assertion_coverage_missing 折叠成 blocked/retryable=false 且 detail 带缺覆盖 capability_ids', async () => {
    const result = await evaluateDiffGate({
      db: contractDb(),
      taskId: '93cbbb32',
      repo: 'cecelia',
      headRevision: 'deadbeef',
      changedFiles: ['apps/dashboard/src/App.tsx'],
      mapClient: async () => ({
        freshness: { status: 'unknown', reason_code: 'capability_assertion_coverage_missing' },
        fact_revisions: { cecelia: 'bc4e8644' },
        affected_nodes: ['G1'],
        required_assertions: [],
        uncovered_capability_ids: ['G1'],
      }),
    });

    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('capability_assertion_coverage_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.capability_ids).toEqual(['G1']);
  });

  test('真新鲜度问题 fact_snapshot_stale 仍维持 impact_unknown/mapper_stale/retryable=true（回归保护）', async () => {
    const result = await evaluateDiffGate({
      db: contractDb(),
      taskId: 'stale-case',
      repo: 'cecelia',
      headRevision: 'deadbeef',
      changedFiles: ['packages/brain/src/tick.js'],
      mapClient: async () => ({
        freshness: { status: 'stale', reason_code: 'fact_snapshot_stale' },
        fact_revisions: { cecelia: 'bc4e8644' },
        affected_nodes: [],
        required_assertions: [],
      }),
    });

    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  test('未知/新增 reason_code 走 fail-closed mapper_contract_invalid/retryable=false（禁默认可重试）', async () => {
    const result = await evaluateDiffGate({
      db: contractDb(),
      taskId: 'unknown-case',
      repo: 'cecelia',
      headRevision: 'deadbeef',
      changedFiles: ['packages/brain/src/tick.js'],
      mapClient: async () => ({
        freshness: { status: 'unknown', reason_code: 'some_future_unmapped_code' },
        fact_revisions: { cecelia: 'bc4e8644' },
        affected_nodes: [],
        required_assertions: [],
      }),
    });

    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_contract_invalid');
    expect(result.retryable).toBe(false);
  });

  test('回归夹具：run d1360a48 真实 changed_files（含 DoD.md）+ 录制 radius → 新代码 blocked:impact_anchor_missing/retryable=false', async () => {
    const recorded = JSON.parse(
      readFileSync(join(__dirname, 'fixtures/radius-d1360a48-impact-anchor-missing.json'), 'utf8'),
    );
    const result = await evaluateDiffGate({
      db: contractDb('bc4e8644'),
      taskId: '0ca4b234',
      repo: 'cecelia',
      headRevision: 'deadbeef',
      changedFiles: recorded.changed_files,
      mapClient: async () => recorded,
    });

    expect(result.gate).toBe('blocked');
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.retryable).toBe(false);
    expect(result.detail?.unclaimed_files).toContain('DoD.md');
  });
});
