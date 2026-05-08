/**
 * W8 Acceptance v7 — Workstream 2
 * BEHAVIOR：PgCheckpointer 真持久化（≥14 行 + ≥12 distinct happy nodes）+ 源码无 MemorySaver fallback
 *
 * 红阶段证据：import 'acceptance/checkpoint-inspector.js' 失败（模块未实现）。
 * Generator 实现后必须满足以下 4 条 it()。
 */
import { describe, it, expect } from 'vitest';

const HAPPY_NODES = [
  'prep', 'planner', 'parsePrd', 'ganLoop',
  'inferTaskPlan', 'dbUpsert',
  'pick_sub_task', 'run_sub_task', 'evaluate', 'advance',
  'final_evaluate', 'report',
];

describe('W8 Acceptance v7 / WS2 — PgCheckpointer persistence inspector [BEHAVIOR]', () => {
  it('listCheckpointsByThread 在跑完 traversal smoke 后返回 ≥14 行（10 分钟时间窗内）', async () => {
    const { runWithTraversalObserver } = await import(
      '../../../../packages/brain/src/workflows/acceptance/traversal-observer.js'
    );
    const { listCheckpointsByThread } = await import(
      '../../../../packages/brain/src/workflows/acceptance/checkpoint-inspector.js'
    );
    const threadId = `ws2-pg-persist-${Date.now()}`;
    await runWithTraversalObserver({
      taskId: '00000000-0000-0000-0000-000000000010',
      threadId,
      minimal: true,
    });
    const rows = await listCheckpointsByThread(threadId, { withinMinutes: 10 });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(14);
  });

  it('listDistinctNodesByThread 返回的 happy 节点集合 size ≥ 12', async () => {
    const { runWithTraversalObserver } = await import(
      '../../../../packages/brain/src/workflows/acceptance/traversal-observer.js'
    );
    const { listDistinctNodesByThread } = await import(
      '../../../../packages/brain/src/workflows/acceptance/checkpoint-inspector.js'
    );
    const threadId = `ws2-pg-distinct-${Date.now()}`;
    await runWithTraversalObserver({
      taskId: '00000000-0000-0000-0000-000000000011',
      threadId,
      minimal: true,
    });
    const distinct = await listDistinctNodesByThread(threadId, { withinMinutes: 10 });
    const happyHit = HAPPY_NODES.filter(n => distinct.includes(n));
    expect(happyHit.length).toBeGreaterThanOrEqual(12);
  });

  it('listCheckpointsByThread 在不存在的 thread_id 上返回空数组（不抛错）', async () => {
    const { listCheckpointsByThread } = await import(
      '../../../../packages/brain/src/workflows/acceptance/checkpoint-inspector.js'
    );
    const rows = await listCheckpointsByThread('thread-id-that-never-existed-xyz', {
      withinMinutes: 10,
    });
    expect(rows).toEqual([]);
  });

  it('inspector 函数对 SQL 注入 thread_id 安全（参数化查询）', async () => {
    const { listCheckpointsByThread } = await import(
      '../../../../packages/brain/src/workflows/acceptance/checkpoint-inspector.js'
    );
    const malicious = `evil'; DROP TABLE checkpoints; --`;
    const rows = await listCheckpointsByThread(malicious, { withinMinutes: 1 });
    expect(rows).toEqual([]);
    const { listDistinctNodesByThread } = await import(
      '../../../../packages/brain/src/workflows/acceptance/checkpoint-inspector.js'
    );
    const distinct = await listDistinctNodesByThread(malicious, { withinMinutes: 1 });
    expect(distinct).toEqual([]);
  });
});
