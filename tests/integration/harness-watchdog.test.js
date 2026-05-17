/**
 * harness-watchdog.test.js — W3 验证（AbortSignal 级 abort）
 *
 * Spec: docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §W3
 *
 * 验证：runHarnessInitiativeRouter 收到 deadline_at 已过的 initiative_run，
 *       AbortController 触发 abort，runner 标 task.failure_class='watchdog_deadline'
 *       且返回 { ok:false, error:'watchdog_deadline' }，不抛错。
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

// Slow stream — 永远不 resolve，但响应 AbortSignal
function makeSlowStreamFromSignal(signal) {
  return (async function* () {
    await new Promise((resolve, reject) => {
      const onAbort = () => {
        const e = new Error(signal.reason?.message || 'aborted');
        e.name = 'AbortError';
        reject(e);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
    yield { dummy: true };
  })();
}

let runHarnessInitiativeRouter;

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
});

describe('harness watchdog AbortSignal（W3）', () => {
  it('deadline_at 已过 → AbortController 触发 → 返回 watchdog_deadline 不抛错', async () => {
    // 用 fake timer 跳过 60s floor — runner 内 setTimeout 跑满后 abort
    vi.useFakeTimers();
    try {
      mockPoolQuery.mockImplementation(async (sql) => {
        if (typeof sql === 'string' && /SELECT\s+deadline_at/i.test(sql)) {
          return { rows: [{ deadline_at: new Date(Date.now() - 60_000).toISOString() }] };
        }
        return { rows: [] };
      });

      mockGraphStream.mockImplementation(async (_input, opts) => makeSlowStreamFromSignal(opts.signal));

      const task = {
        id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        task_type: 'harness_initiative',
        execution_attempts: 0,
        payload: {},
      };

      const promise = runHarnessInitiativeRouter(task);
      // 让 microtasks 跑（getCheckpointer / SELECT / setTimeout 注册），再推进 60s
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_001);

      const r = await promise;
      expect(r.ok).toBe(false);
      expect(r.error).toBe('watchdog_deadline');

      const failClassCalls = mockPoolQuery.mock.calls.filter(c =>
        typeof c[0] === 'string' && /failure_class.*watchdog_deadline/i.test(c[0])
      );
      expect(failClassCalls.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('正常完成 stream → ok=true 无 abort', async () => {
    mockPoolQuery.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && /SELECT\s+deadline_at/i.test(sql)) {
        return { rows: [{ deadline_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString() }] };
      }
      return { rows: [] };
    });

    // 一个发出一个 update 然后结束的 stream
    mockGraphStream.mockImplementation(async () => (async function* () {
      yield { prepInitiative: { initiativeId: 'x' } };
    })());

    const task = {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      task_type: 'harness_initiative',
      execution_attempts: 0,
      payload: {},
    };

    const r = await runHarnessInitiativeRouter(task);
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
    expect(mockEmitGraphNodeUpdate).toHaveBeenCalled();
  });
});
