/**
 * harness-initiative-create-fix-task.test.js
 *
 * 回归测试：createFixTask() 不再向 tasks 表 INSERT harness_task 行。
 *
 * 背景（2026-04-28 RCA）：runPhaseCIfReady 路径已被 Sprint 1 full graph 废弃，
 * 但 createFixTask 仍 INSERT harness_task → 立即 retired failed。
 * 修复：加早返回 guard，返回 noop UUID，不写 DB。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
}));
vi.mock('../harness-dag.js', () => ({
  parseTaskPlan: vi.fn(),
  upsertTaskPlan: vi.fn().mockResolvedValue({ idMap: {}, insertedTaskIds: [] }),
  topologicalOrder: vi.fn(),
  detectCycle: vi.fn(),
  nextRunnableTask: vi.fn(),
}));
vi.mock('../harness-final-e2e.js', () => ({
  runScenarioCommand: vi.fn(),
  bootstrapE2E: vi.fn(),
  teardownE2E: vi.fn(),
  normalizeAcceptance: vi.fn(),
}));
vi.mock('@langchain/langgraph', () => {
  // Annotation must be callable as function AND have .Root
  function Annotation(x) { return x; }
  Annotation.Root = (fields) => fields;
  return {
    StateGraph: class { addNode() { return this; } addEdge() { return this; } addConditionalEdges() { return this; } compile() { return { invoke: vi.fn() }; } },
    Annotation,
    START: '__start__',
    END: '__end__',
    Send: class { constructor(n, s) { this.node = n; this.state = s; } },
    MemorySaver: class {},
  };
});
vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({
  PostgresSaver: class { static fromConnString() { return { setup: vi.fn() }; } },
}));
vi.mock('../harness-gan-graph.js', () => ({
  runGanContractGraph: vi.fn(),
  buildHarnessGanGraph: vi.fn(),
}));
vi.mock('../pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({}),
}));

import { createFixTask } from '../workflows/harness-initiative.graph.js';

describe('createFixTask — Sprint 1 retired guard', () => {
  it('调用后不向 tasks 表 INSERT', async () => {
    const taskInsertCalls = [];
    const mockClient = {
      query: vi.fn((sql, _params) => {
        if (/INSERT INTO tasks/i.test(sql)) {
          taskInsertCalls.push(sql);
          return Promise.resolve({ rows: [{ id: 'should-not-happen' }] });
        }
        return Promise.resolve({ rows: [{ title: 'Task ws1', description: 'desc', payload: {} }], rowCount: 0 });
      }),
    };

    const result = await createFixTask({
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskId: 'task-uuid-1',
      fixRound: 1,
      failureScenarios: [{ name: 'scenario-1', exitCode: 1 }],
      client: mockClient,
    });

    expect(taskInsertCalls).toHaveLength(0);
    // 返回 noop UUID（字符串，不是 undefined）
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^[0-9a-f-]{36}$/);
  });
});
