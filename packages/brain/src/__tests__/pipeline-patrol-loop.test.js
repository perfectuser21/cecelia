/**
 * Regression: pipeline-patrol 必须周期性跑（接回 live tick）。
 *
 * 根因（2026-06-27 审计）：runPipelinePatrol 只挂在 Wave-2 废弃的
 * executeTick 上 → runScheduler 迁移后从不调用，卡住的
 * /dev 会话无人救援。仿 recovery-loop 独立 setInterval 接回。
 */
import { describe, it, expect, vi } from 'vitest';
import { runPipelinePatrolOnce, startPipelinePatrolLoop, stopPipelinePatrolLoop } from '../pipeline-patrol-loop.js';

const fakePool = { query: async () => ({ rows: [] }) };

describe('pipeline-patrol-loop', () => {
  it('只救援现役dev会话，返回对应结果', async () => {
    const runPipelinePatrol = vi.fn(async () => ({ rescued: 1 }));
    const r = await runPipelinePatrolOnce({ pool: fakePool, runPipelinePatrol });
    expect(runPipelinePatrol).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ devRescued: 1 });
  });

  it('dev救援失败仍可继续下次巡航', async () => {
    const runPipelinePatrol = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({rescued: 2});
    expect(await runPipelinePatrolOnce({ pool: fakePool, runPipelinePatrol })).toEqual({devRescued:0});
    expect(await runPipelinePatrolOnce({ pool: fakePool, runPipelinePatrol })).toEqual({devRescued:2});
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
