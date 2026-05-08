/**
 * W8 Acceptance v7 — Workstream 1
 * BEHAVIOR：14 节点 happy path 全程命中 + retry/terminal_fail 合法跳过 + PgCheckpointer 自动注入观测
 *
 * 红阶段证据：import 'acceptance/traversal-observer.js' 失败（模块未实现）。
 * Generator 实现后必须满足以下 4 条 it()。
 */
import { describe, it, expect } from 'vitest';

const HAPPY_NODES = [
  'prep', 'planner', 'parsePrd', 'ganLoop',
  'inferTaskPlan', 'dbUpsert',
  'pick_sub_task', 'run_sub_task', 'evaluate', 'advance',
  'final_evaluate', 'report',
];
const SKIP_NODES = ['retry', 'terminal_fail'];

describe('W8 Acceptance v7 / WS1 — 14-node traversal observer [BEHAVIOR]', () => {
  it('runWithTraversalObserver 跑完最小 Initiative 后，事件流含 12 个 happy path 节点 enter+exit 事件', async () => {
    const { runWithTraversalObserver } = await import(
      '../../../../packages/brain/src/workflows/acceptance/traversal-observer.js'
    );
    const result = await runWithTraversalObserver({
      taskId: '00000000-0000-0000-0000-000000000001',
      threadId: 'ws1-traversal-happy',
      minimal: true,
    });
    const visited = new Set(result.events.filter(e => e.type === 'enter').map(e => e.node));
    for (const n of HAPPY_NODES) {
      expect(visited.has(n), `happy 节点未被命中：${n}`).toBe(true);
    }
    const exitedHappy = result.events.filter(e => e.type === 'exit' && HAPPY_NODES.includes(e.node));
    expect(exitedHappy.length).toBeGreaterThanOrEqual(HAPPY_NODES.length);
  });

  it('事件流不含 retry / terminal_fail 节点 enter 事件（happy path 合法跳过）', async () => {
    const { runWithTraversalObserver } = await import(
      '../../../../packages/brain/src/workflows/acceptance/traversal-observer.js'
    );
    const result = await runWithTraversalObserver({
      taskId: '00000000-0000-0000-0000-000000000002',
      threadId: 'ws1-traversal-skip',
      minimal: true,
    });
    const enteredNodes = new Set(result.events.filter(e => e.type === 'enter').map(e => e.node));
    for (const n of SKIP_NODES) {
      expect(enteredNodes.has(n), `非 happy 节点不应被命中：${n}`).toBe(false);
    }
    expect(result.skippedNodes).toEqual(expect.arrayContaining(SKIP_NODES));
  });

  it('observer 报告 pgCheckpointerInjected === true（hotfix #2846 路径生效）', async () => {
    const { runWithTraversalObserver } = await import(
      '../../../../packages/brain/src/workflows/acceptance/traversal-observer.js'
    );
    const result = await runWithTraversalObserver({
      taskId: '00000000-0000-0000-0000-000000000003',
      threadId: 'ws1-traversal-pgcheckpointer',
      minimal: true,
    });
    expect(result.pgCheckpointerInjected).toBe(true);
  });

  it('observer 报告的 threadId 等于传入的 threadId（用于 WS2 跨用例 checkpoints 表查询）', async () => {
    const { runWithTraversalObserver } = await import(
      '../../../../packages/brain/src/workflows/acceptance/traversal-observer.js'
    );
    const expected = 'ws1-traversal-thread-echo';
    const result = await runWithTraversalObserver({
      taskId: '00000000-0000-0000-0000-000000000004',
      threadId: expected,
      minimal: true,
    });
    expect(result.threadId).toBe(expected);
  });
});
