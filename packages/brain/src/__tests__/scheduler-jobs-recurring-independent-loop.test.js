/**
 * scheduler-jobs-recurring-independent-loop.test.js — 定时引擎不能排在串行慢轮后面（任务 942491c2 / c8320370）
 *
 * 生产实证（10-11）：recurring-tasks 挂在 SERIAL_JOBS 串行轮里，一轮 3-9 分钟，
 * 定时实例建单比时间点晚 58s~517s——定时精度=轮长。OpenClaw 业务定时（晨会 08:45、
 * 班会 11:50 等）搬进 Brain 后，这个延迟直接变成业务延迟。
 * 修法：recurring-tasks 进独立的 completion 循环（10s 轮询、按 job 防重入），30s 一跑。
 */
import { describe, it, expect } from 'vitest';
import { JOBS, SERIAL_JOBS, COMPLETION_JOBS } from '../scheduler-jobs.js';

describe('recurring-tasks 走独立循环，不受串行慢轮拖累', () => {
  it('登记在 COMPLETION_JOBS，不在 SERIAL_JOBS', () => {
    expect(JOBS.some((j) => j.name === 'recurring-tasks')).toBe(true);
    expect(COMPLETION_JOBS.some((j) => j.name === 'recurring-tasks')).toBe(true);
    expect(SERIAL_JOBS.some((j) => j.name === 'recurring-tasks')).toBe(false);
  });

  it('独立循环里至多 30s 跑一次（定时精度 ≤ 30s+单轮耗时）', () => {
    const j = COMPLETION_JOBS.find((x) => x.name === 'recurring-tasks');
    expect(j.completionCadenceMs).toBeGreaterThan(0);
    expect(j.completionCadenceMs).toBeLessThanOrEqual(30_000);
  });
});
