/**
 * Sprint 08191134-kernel-42d10d71 — Diff Impact Gate 确定性 reason_code 透传 + fail-closed 出口
 *
 * TDD Red 阶段：断言确定性 Map 结论（revision/digest mismatch）在 base_sha 冻结下
 *   → 原样透传具体 reason_code（非折叠成 mapper_stale）且 retryable=false；
 * 回归守卫：真瞬态 stale/unavailable 保持 retryable=true。
 *
 * 禁 mock 边：真跑 evaluateDiffGate / evaluateStructureGate 决策逻辑，
 *   只注入 mapClient（Mapper 外部边界）与只读 stub db.query（喂 active contract 行，非被改逻辑）。
 */
import { describe, test, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { evaluateStructureGate } from '../../../packages/brain/src/impact-contract/structure-gate.js';

const D64 = (c: string) => c.repeat(64);

function contractDb(overrides: Record<string, unknown> = {}) {
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: 'contract-1',
        task_id: 'task-det',
        repo: 'cecelia',
        change_kind: 'bugfix',
        base_revision: 'base',
        manifest_digest: D64('1'),
        projection_digest: D64('2'),
        contract_body: { affected_capabilities: [], required_assertions: [] },
        ...overrides,
      }],
    })),
  };
}

describe('确定性 Map 结论 → fail-closed（retryable=false，具体 reason_code 不折叠）', () => {
  test('revision_mismatch 确定性 retryable=false（base_sha 冻结下重试不自愈）', async () => {
    const result = await evaluateDiffGate({
      db: contractDb({ base_revision: 'base123', manifest_digest: null, projection_digest: null }),
      taskId: 'task-det',
      repo: 'cecelia',
      headRevision: 'headsha',
      mapClient: async () => ({
        freshness: { status: 'fresh' },
        affected_nodes: [],
        required_assertions: [],
        fact_revisions: { cecelia: 'stale999' }, // 与合同 base_revision 不对齐
      }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('revision_mismatch'); // 原样透传，非 mapper_stale
    expect(result.retryable).toBe(false);
  });

  test('manifest_digest_mismatch 确定性 retryable=false', async () => {
    const result = await evaluateDiffGate({
      db: contractDb({ projection_digest: null }),
      taskId: 'task-det',
      repo: 'cecelia',
      headRevision: 'headsha',
      mapClient: async () => ({
        freshness: { status: 'fresh' },
        affected_nodes: [],
        required_assertions: [],
        fact_revisions: { cecelia: 'base' },
        manifest_digest: D64('9'), // 与合同 manifest_digest 不一致
      }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('manifest_digest_mismatch');
    expect(result.retryable).toBe(false);
  });

  test('projection_digest_mismatch 确定性 retryable=false', async () => {
    const result = await evaluateDiffGate({
      db: contractDb(),
      taskId: 'task-det',
      repo: 'cecelia',
      headRevision: 'headsha',
      mapClient: async () => ({
        freshness: { status: 'fresh' },
        affected_nodes: [],
        required_assertions: [],
        fact_revisions: { cecelia: 'base' },
        manifest_digest: D64('1'), // 与合同一致
        projection_digest: D64('9'), // 与合同 projection_digest 不一致
      }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('projection_digest_mismatch');
    expect(result.retryable).toBe(false);
  });

  test('contract_missing 确定性 retryable=false（不得回退）', async () => {
    const result = await evaluateDiffGate({
      db: { query: vi.fn(async () => ({ rows: [] })) },
      taskId: 'task-none',
      mapClient: vi.fn(),
    });
    expect(result).toMatchObject({ gate: 'impact_unknown', reason: 'contract_missing', retryable: false });
  });
});

describe('瞬态 stale/unavailable → 有限重试（retryable=true 回归守卫）', () => {
  test('瞬态 mapper_stale（freshness 非 fresh）retryable=true', async () => {
    const result = await evaluateDiffGate({
      db: contractDb(),
      taskId: 'task-det',
      repo: 'cecelia',
      headRevision: 'headsha',
      mapClient: async () => ({
        freshness: { status: 'stale' }, // 刷新中
        affected_nodes: [],
        required_assertions: [],
        fact_revisions: { cecelia: 'base' },
      }),
    });
    expect(result).toMatchObject({ gate: 'impact_unknown', reason: 'mapper_stale', retryable: true });
  });

  test('瞬态 mapper_unavailable（Mapper 抛错）retryable=true', async () => {
    const result = await evaluateDiffGate({
      db: contractDb(),
      taskId: 'task-det',
      repo: 'cecelia',
      headRevision: 'headsha',
      mapClient: async () => { throw new Error('ETIMEDOUT'); },
    });
    expect(result).toMatchObject({ gate: 'impact_unknown', reason: 'mapper_unavailable', retryable: true });
  });

  test('瞬态 revision_evidence_missing retryable=true（防"409 全刷 false"偷懒）', async () => {
    const result = await evaluateDiffGate({
      db: contractDb({ base_revision: 'base', manifest_digest: null, projection_digest: null }),
      taskId: 'task-det',
      repo: 'cecelia',
      headRevision: 'headsha',
      mapClient: async () => ({
        freshness: { status: 'fresh' },
        affected_nodes: [],
        required_assertions: [],
        fact_revisions: {}, // 缺目标 repo 证据 → 瞬态
      }),
    });
    expect(result).toMatchObject({ gate: 'impact_unknown', reason: 'revision_evidence_missing', retryable: true });
  });
});

describe('语义一致铁律：diff-gate ↔ structure-gate 同一 reason_code 同一 retryable 分桶', () => {
  const structTask = { id: 'task-det', change_kind: 'bugfix', task_type: 'harness' };
  const structContract = {
    task_id: 'task-det',
    change_kind: 'bugfix',
    repo: 'cecelia',
    base_revision: 'base',
    contract_body: { affected_capabilities: [], required_assertions: [] },
    affected_capabilities: [],
    required_assertions: [],
  };

  test('语义一致：两端 revision_mismatch 均确定性 retryable=false', async () => {
    const staleMapper = async () => ({
      freshness: { status: 'fresh' },
      affected_nodes: [],
      required_assertions: [],
      fact_revisions: { cecelia: 'stale999' },
    });
    const diff = await evaluateDiffGate({
      db: contractDb({ base_revision: 'base', manifest_digest: null, projection_digest: null }),
      taskId: 'task-det', repo: 'cecelia', headRevision: 'headsha', mapClient: staleMapper,
    });
    const struct = await evaluateStructureGate({
      db: null, task: structTask, contract: structContract, mapClient: staleMapper,
    });
    expect(diff.reason).toBe('revision_mismatch');
    expect(struct.reason).toBe('revision_mismatch');
    // 同一 reason_code → 同一 retryable 分桶（禁两端语义分叉开假绿面）
    expect(diff.retryable).toBe(false);
    expect(struct.retryable).toBe(false);
    expect(diff.retryable).toBe(struct.retryable);
  });

  test('语义一致：两端瞬态 mapper_stale 均 retryable=true', async () => {
    const freshStaleMapper = async () => ({ freshness: { status: 'stale' }, fact_revisions: { cecelia: 'base' } });
    const diff = await evaluateDiffGate({
      db: contractDb(), taskId: 'task-det', repo: 'cecelia', headRevision: 'headsha', mapClient: freshStaleMapper,
    });
    const struct = await evaluateStructureGate({
      db: null, task: structTask, contract: structContract, mapClient: freshStaleMapper,
    });
    expect(diff.reason).toBe('mapper_stale');
    expect(struct.reason).toBe('mapper_stale');
    expect(diff.retryable).toBe(true);
    expect(struct.retryable).toBe(true);
  });
});
