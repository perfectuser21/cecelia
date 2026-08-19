/**
 * gate-reason-passthrough.test.ts — TDD RED（proposer 起草）
 *
 * 断言 diff-gate / structure-gate 非 fresh 分支按 freshness.status 分流透传 reason_code，
 * 确定性 unknown / freshness 缺失 fail-closed（retryable:false），不再折叠成 mapper_stale。
 *
 * 当前实现（base 54f970d6）把所有非 fresh 折叠为 mapper_stale/retryable:true → 本文件应全红。
 * generator 修复后转绿；永久回归归入 packages/brain/src/impact-contract/__tests__/{diff,structure}-gate.test.js。
 *
 * 禁 mock 被改的边：直调真实 gate 函数，只注入上游 Mapper（mapClient）作为可信输入。
 */
import { describe, test, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { evaluateStructureGate } from '../../../packages/brain/src/impact-contract/structure-gate.js';

const mkMapClient = (freshness: any) => async ({ repo, baseRevision }: any) => ({
  manifest_digest: 'md',
  projection_digest: 'pd',
  fact_revisions: { [repo || 'cecelia']: baseRevision || 'base-sha' },
  freshness,
  affected_nodes: [],
  required_assertions: [],
});

const diff = (freshness: any) => evaluateDiffGate({
  db: null,
  taskId: 'probe-task',
  repo: 'cecelia',
  headRevision: 'head',
  changedFiles: ['packages/brain/src/tick.js'],
  mapClient: mkMapClient(freshness),
});

const structure = (freshness: any) => evaluateStructureGate({
  task: { id: 'probe-task', change_kind: 'code' },
  contract: {
    task_id: 'probe-task',
    change_kind: 'code',
    repo: 'cecelia',
    base_revision: 'base-sha',
    contract_body: { affected_capabilities: [], required_assertions: [] },
  },
  mapClient: mkMapClient(freshness),
} as any);

describe('Diff/Structure Impact Gate 非 fresh 分流 [BEHAVIOR]', () => {
  test('瞬态 stale 透传 reason_code 且 retryable', async () => {
    const r: any = await diff({ status: 'stale', reason_code: 'fact_snapshot_stale' });
    expect(r.retryable).toBe(true);
    expect(r.reason).toBe('fact_snapshot_stale');
    expect(r.reason_code).toBe('fact_snapshot_stale');
  });

  test('确定性 unknown fail-closed retryable false', async () => {
    const r: any = await diff({ status: 'unknown', reason_code: 'impact_anchor_missing' });
    expect(r.retryable).toBe(false);
    expect(r.reason).toBe('impact_anchor_missing');
    expect(r.reason).not.toBe('mapper_stale');
  });

  test('freshness 缺失 fail-closed 不折叠 mapper_stale', async () => {
    const r: any = await diff(null);
    expect(r.retryable).toBe(false);
    expect(r.reason).not.toBe('mapper_stale');
    expect(String(r.reason).length).toBeGreaterThan(0);
  });

  test('reason_code 缺失但 status=unknown 给确定性兜底 retryable false', async () => {
    const r: any = await diff({ status: 'unknown' });
    expect(r.retryable).toBe(false);
    expect(r.reason).not.toBe('mapper_stale');
  });

  test('structure-gate 确定性 unknown 与 diff 一致', async () => {
    const r: any = await structure({ status: 'unknown', reason_code: 'impact_anchor_missing' });
    expect(r.retryable).toBe(false);
    expect(r.reason).toBe('impact_anchor_missing');
  });

  test('structure-gate 瞬态 stale 透传 retryable true', async () => {
    const r: any = await structure({ status: 'stale', reason_code: 'fact_snapshot_stale' });
    expect(r.retryable).toBe(true);
    expect(r.reason).toBe('fact_snapshot_stale');
  });
});
