/**
 * Regression: pipeline-patrol 必须周期性跑（接回 live tick）。
 *
 * 根因（2026-06-27 审计）：runPipelinePatrol / runHarnessInitiativePatrol 只挂在 Wave-2 废弃的
 * executeTick 上 → runScheduler 迁移后从不调用，harness_intervention 干预通道整条死代码、卡住的
 * /dev 会话无人救援。仿 recovery-loop 独立 setInterval 接回。
 */
import { describe, it, expect, vi } from 'vitest';
import { runPipelinePatrolOnce, startPipelinePatrolLoop, stopPipelinePatrolLoop } from '../pipeline-patrol-loop.js';

const fakePool = { query: async () => ({ rows: [] }) };

describe('pipeline-patrol-loop', () => {
  it('一次执行同时调 runPipelinePatrol（dev 救援）+ runHarnessInitiativePatrol（harness 干预）', async () => {
    const runPipelinePatrol = vi.fn(async () => ({ rescued: 1 }));
    const runHarnessInitiativePatrol = vi.fn(async () => ({ intervened: 2 }));
    const r = await runPipelinePatrolOnce({ pool: fakePool, runPipelinePatrol, runHarnessInitiativePatrol });
    expect(runPipelinePatrol).toHaveBeenCalledTimes(1);
    expect(runHarnessInitiativePatrol).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ devRescued: 1, harnessIntervened: 2 });
  });

  it('其中一条抛错不影响另一条（non-fatal 容错，绝不让 loop 崩）', async () => {
    const runPipelinePatrol = vi.fn(async () => { throw new Error('boom'); });
    const runHarnessInitiativePatrol = vi.fn(async () => ({ intervened: 3 }));
    const r = await runPipelinePatrolOnce({ pool: fakePool, runPipelinePatrol, runHarnessInitiativePatrol });
    expect(runHarnessInitiativePatrol).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ devRescued: 0, harnessIntervened: 3 });
  });
});

describe('pipeline-patrol-loop start/stop（独立 setInterval，重复启动幂等）', () => {
  it('startPipelinePatrolLoop 首次 true、重复 false；stop 后可再启动', () => {
    const first = startPipelinePatrolLoop({ intervalMs: 999999 });
    const second = startPipelinePatrolLoop({ intervalMs: 999999 });
    expect(first).toBe(true);
    expect(second).toBe(false);
    stopPipelinePatrolLoop();
    const third = startPipelinePatrolLoop({ intervalMs: 999999 });
    expect(third).toBe(true);
    stopPipelinePatrolLoop();
  });
});
