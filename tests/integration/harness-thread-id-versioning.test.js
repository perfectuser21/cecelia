/**
 * harness-thread-id-versioning.test.js — W1 验证
 *
 * Spec: docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §W1
 *
 * 验证：
 *  - attemptN=1 第一次跑：fresh start 用 thread :1
 *  - 同 attemptN 已有 checkpoint + resume_from_checkpoint=false → 升 :N+1 fresh
 *  - payload.resume_from_checkpoint=true 显式续 → input=null 用旧 thread
 *
 * ── 2026-07-05 更新（orchestrator 硬校验落地后）──────────────────
 * `_driveHarnessInitiative` 加了 orchestrator 硬校验：task.payload.orchestrator
 * !== 'skill-relay' 会在函数最顶部被拒绝（terminal failed，
 * failure_class='missing_orchestrator_flag'），不再到达本文件测试的 W1
 * thread_id 版本化图内部行为。本文件 3 个用例测的场景（task 不带
 * orchestrator 时仍能到达 thread_id 版本化逻辑）在新现实下已不可能发生，
 * 现在是永久不可达代码（保留待观察期后物理清理），已改为 it.skip 并说明
 * 原因，不删除，保留骨架待未来这套保护迁移到 skill-relay 路径时复用。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks
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

// helper：返回一个空 async iterable stream（让 for-await 立即结束）
function emptyStream() {
  return (async function* () {})();
}

let runHarnessInitiativeRouter;

beforeEach(async () => {
  vi.resetModules();
  mockPoolQuery.mockReset();
  mockCheckpointerGet.mockReset();
  mockGraphStream.mockReset();
  mockEmitGraphNodeUpdate.mockReset();

  // SELECT deadline_at → 默认 NULL（fallback 6h）；UPDATE tasks → ok
  mockPoolQuery.mockImplementation(async (sql) => {
    if (typeof sql === 'string' && /SELECT\s+deadline_at/i.test(sql)) {
      return { rows: [{ deadline_at: null }] };
    }
    return { rows: [] };
  });

  mockGraphStream.mockResolvedValue(emptyStream());

  const mod = await import('../../packages/brain/src/executor.js');
  runHarnessInitiativeRouter = mod.runHarnessInitiativeRouter;
});

describe('harness initiative thread_id 版本化（W1）', () => {
  it.skip('attemptN=1 第一次跑：fresh start 用 thread :1，input={task}（2026-07-05 orchestrator 硬校验后已不可达，skip）', async () => {
    mockCheckpointerGet.mockResolvedValueOnce(null);  // 无 checkpoint

    const task = {
      id: '11111111-2222-3333-4444-555555555555',
      task_type: 'harness_initiative',
      execution_attempts: 0,
      payload: {},
    };

    const r = await runHarnessInitiativeRouter(task);

    expect(r.attemptN).toBe(1);
    expect(r.threadId).toBe(`harness-initiative:${task.id}:1`);
    expect(mockGraphStream).toHaveBeenCalledTimes(1);
    const [input, config] = mockGraphStream.mock.calls[0];
    expect(input).toEqual({ task });
    expect(config.configurable.thread_id).toBe(`harness-initiative:${task.id}:1`);
    expect(config.streamMode).toBe('updates');
  });

  it.skip('同 attemptN 已有 checkpoint + resume_from_checkpoint=false → 升 :N+1 fresh（2026-07-05 orchestrator 硬校验后已不可达，skip）', async () => {
    // execution_attempts=1 → baseAttemptN=2，先 checkpointer.get 命中 → 升到 :3
    mockCheckpointerGet.mockResolvedValueOnce({ v: 1 });  // 有 checkpoint

    const task = {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      task_type: 'harness_initiative',
      execution_attempts: 1,
      payload: {},
    };

    const r = await runHarnessInitiativeRouter(task);

    expect(r.attemptN).toBe(3);  // baseAttemptN=2 + 1
    expect(r.threadId).toBe(`harness-initiative:${task.id}:3`);

    // 验证升级时 UPDATE tasks 被调
    const updateCalls = mockPoolQuery.mock.calls.filter(c =>
      typeof c[0] === 'string' && /UPDATE\s+tasks\s+SET\s+execution_attempts/i.test(c[0])
    );
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0][1]).toEqual([3, task.id]);

    // 验证 stream 用 :3 fresh input
    const [input, config] = mockGraphStream.mock.calls[0];
    expect(input).toEqual({ task });
    expect(config.configurable.thread_id).toBe(`harness-initiative:${task.id}:3`);
  });

  it.skip('payload.resume_from_checkpoint=true 显式续 → input=null 用旧 thread（2026-07-05 orchestrator 硬校验后已不可达，skip）', async () => {
    mockCheckpointerGet.mockResolvedValueOnce({ v: 1 });  // 有 checkpoint

    const task = {
      id: 'cafe1234-5678-90ab-cdef-1234567890ab',
      task_type: 'harness_initiative',
      execution_attempts: 0,  // baseAttemptN=1
      payload: { resume_from_checkpoint: true },
    };

    const r = await runHarnessInitiativeRouter(task);

    expect(r.attemptN).toBe(1);
    expect(r.threadId).toBe(`harness-initiative:${task.id}:1`);

    const [input, config] = mockGraphStream.mock.calls[0];
    expect(input).toBeNull();  // 显式 resume — input=null
    expect(config.configurable.thread_id).toBe(`harness-initiative:${task.id}:1`);

    // 不应触发 UPDATE execution_attempts
    const updateCalls = mockPoolQuery.mock.calls.filter(c =>
      typeof c[0] === 'string' && /UPDATE\s+tasks\s+SET\s+execution_attempts/i.test(c[0])
    );
    expect(updateCalls.length).toBe(0);
  });
});
