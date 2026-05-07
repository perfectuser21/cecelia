/**
 * harness-stream-events.test.js — W4 验证
 *
 * Spec: docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §W4
 *
 * 验证：runHarnessInitiativeRouter 用 streamMode='updates'，每个 node 完成
 *       emitGraphNodeUpdate 被调一次，写一条 task_events 行。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPoolQuery = vi.hoisted(() => vi.fn());
const mockCheckpointerGet = vi.hoisted(() => vi.fn());
const mockGraphStream = vi.hoisted(() => vi.fn());
const mockEmitGraphNodeUpdate = vi.hoisted(() => vi.fn());

vi.mock('../../packages/brain/src/db.js', () => ({
  default: { query: mockPoolQuery },
}));

vi.mock('../../packages/brain/src/orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: async () => ({ get: mockCheckpointerGet }),
  _resetPgCheckpointerForTests: () => {},
}));

vi.mock('../../packages/brain/src/workflows/harness-initiative.graph.js', () => ({
  compileHarnessFullGraph: async () => ({ stream: mockGraphStream }),
}));

vi.mock('../../packages/brain/src/events/taskEvents.js', () => ({
  emitGraphNodeUpdate: mockEmitGraphNodeUpdate,
  publishTaskCreated: vi.fn(),
  publishTaskStarted: vi.fn(),
  publishTaskProgress: vi.fn(),
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
  publishExecutorStatus: vi.fn(),
}));

let runHarnessInitiativeRouter;
let summarizeNodeState;

beforeEach(async () => {
  vi.resetModules();
  mockPoolQuery.mockReset();
  mockCheckpointerGet.mockReset();
  mockGraphStream.mockReset();
  mockEmitGraphNodeUpdate.mockReset();

  mockCheckpointerGet.mockResolvedValue(null);
  mockPoolQuery.mockImplementation(async () => ({ rows: [] }));

  const mod = await import('../../packages/brain/src/executor.js');
  runHarnessInitiativeRouter = mod.runHarnessInitiativeRouter;
  summarizeNodeState = mod.summarizeNodeState;
});

describe('harness streamMode events（W4）', () => {
  it('5 节点 stream → emitGraphNodeUpdate 被调 5 次', async () => {
    mockGraphStream.mockImplementation(async () => (async function* () {
      yield { prepInitiative: { initiativeId: 'x' } };
      yield { runPlanner: { planner_done: true } };
      yield { parsePrd: { prd_parsed: true } };
      yield { dbUpsert: { upserted: true } };
      yield { fanoutSubTasks: { count: 3 } };
    })());

    const task = {
      id: 'feedface-cafe-babe-dead-beefdeadbeef',
      task_type: 'harness_initiative',
      execution_attempts: 0,
      payload: {},
    };

    const r = await runHarnessInitiativeRouter(task);
    expect(r.ok).toBe(true);
    expect(mockEmitGraphNodeUpdate).toHaveBeenCalledTimes(5);
    expect(mockEmitGraphNodeUpdate.mock.calls[0][0].nodeName).toBe('prepInitiative');
    expect(mockEmitGraphNodeUpdate.mock.calls[4][0].nodeName).toBe('fanoutSubTasks');
    expect(mockEmitGraphNodeUpdate.mock.calls[0][0].attemptN).toBe(1);
    expect(mockEmitGraphNodeUpdate.mock.calls[0][0].threadId).toContain(task.id);
  });

  it('emit 失败被 catch，不阻断 stream', async () => {
    mockEmitGraphNodeUpdate.mockRejectedValueOnce(new Error('DB temporarily down'));
    mockGraphStream.mockImplementation(async () => (async function* () {
      yield { nodeA: { ok: true } };
      yield { nodeB: { ok: true } };
    })());

    const task = {
      id: 'baadf00d-baad-f00d-baad-f00dbaadf00d',
      task_type: 'harness_initiative',
      execution_attempts: 0,
      payload: {},
    };

    // 不应抛
    await expect(runHarnessInitiativeRouter(task)).resolves.toBeTruthy();
    expect(mockEmitGraphNodeUpdate).toHaveBeenCalledTimes(2);
  });

  it('stream config 必含 streamMode=updates', async () => {
    mockGraphStream.mockImplementation(async () => (async function* () {})());

    const task = {
      id: '00000000-0000-0000-0000-000000000001',
      task_type: 'harness_initiative',
      execution_attempts: 0,
      payload: {},
    };

    await runHarnessInitiativeRouter(task);
    expect(mockGraphStream).toHaveBeenCalledTimes(1);
    const [, config] = mockGraphStream.mock.calls[0];
    expect(config.streamMode).toBe('updates');
    expect(config.recursionLimit).toBe(500);
    expect(config.signal).toBeDefined();
  });
});

describe('summarizeNodeState helper', () => {
  it('截断长字符串 / 标 Array length / 标 Object key count', () => {
    const longStr = 'x'.repeat(500);
    const r = summarizeNodeState({
      shortStr: 'hello',
      longStr,
      num: 42,
      bool: true,
      arr: [1, 2, 3, 4],
      obj: { a: 1, b: 2 },
      empty: null,
    });
    expect(r.shortStr).toBe('hello');
    expect(r.longStr.length).toBeLessThan(longStr.length);
    expect(r.num).toBe(42);
    expect(r.bool).toBe(true);
    expect(r.arr).toMatch(/Array 4/);
    expect(r.obj).toMatch(/Object 2 keys/);
    expect(r.empty).toBeUndefined();
  });
});
