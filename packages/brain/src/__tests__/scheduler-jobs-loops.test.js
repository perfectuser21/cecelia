import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePool } from "./helpers/scheduler-jobs-fixture.js";
import { startSchedulerJobsLoop, stopSchedulerJobsLoop, JOBS } from '../scheduler-jobs.js';
import * as schedulerJobsModule from '../scheduler-jobs.js';
import { scheduleDailyBackup } from '../daily-backup-scheduler.js';
const { startProjectionJobsLoop, stopProjectionJobsLoop } = schedulerJobsModule;
describe('scheduler-jobs loop 幂等与重入守卫', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    stopSchedulerJobsLoop();
    vi.useRealTimers();
  });

  it('start 发布实际 JOBS 的预期数与唯一具名声明', async () => {
    const pool = makePool();
    startSchedulerJobsLoop(pool);
    await Promise.resolve();
    await Promise.resolve();
    const call = pool.query.mock.calls.find(
      ([sql, params]) => sql.includes('working_memory') && Array.isArray(params) && params[0] === 'scheduler_jobs_expected',
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(call[1][1])).toEqual({ count: JOBS.length, names: JOBS.map(job => job.name) });
  });

  it('重复调用 startSchedulerJobsLoop 返回同一 timer', () => {
    const pool = makePool();
    const t1 = startSchedulerJobsLoop(pool);
    const t2 = startSchedulerJobsLoop(pool);
    expect(t2).toBe(t1);
  });

  it('前进 60s 触发一轮，各 handler 各被调用一次', async () => {
    const pool = makePool();
    startSchedulerJobsLoop(pool);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(scheduleDailyBackup).toHaveBeenCalledTimes(1);
  });

  it('重入守卫：慢 handler 挂起时前进 120s 不叠加并发', async () => {
    const pool = makePool();
    scheduleDailyBackup.mockImplementationOnce(() => new Promise(() => {}));
    startSchedulerJobsLoop(pool);
    await vi.advanceTimersByTimeAsync(120 * 1000);
    // 首轮在 daily-backup 处挂起，running 仍为 true，第二次 tick 应被守卫短路，
    // daily-backup 只被调用一次（无守卫则会被第二轮再调一次）。
    expect(scheduleDailyBackup).toHaveBeenCalledTimes(1);
  });

  it('stopSchedulerJobsLoop 后前进 60s 不再触发', async () => {
    const pool = makePool();
    startSchedulerJobsLoop(pool);
    stopSchedulerJobsLoop();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(scheduleDailyBackup).not.toHaveBeenCalled();
  });

  it('停止后重新启动只保留新一条循环，并恢复预期计数', async () => {
    const pool = makePool();
    const firstTimer = startSchedulerJobsLoop(pool);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scheduleDailyBackup).toHaveBeenCalledTimes(1);
    stopSchedulerJobsLoop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scheduleDailyBackup).toHaveBeenCalledTimes(1);
    const secondTimer = startSchedulerJobsLoop(pool);
    expect(secondTimer).not.toBe(firstTimer);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scheduleDailyBackup).toHaveBeenCalledTimes(2);
    const expectedWrites = pool.query.mock.calls.filter(([, args]) => args?.[0] === 'scheduler_jobs_expected');
    expect(expectedWrites).toHaveLength(2);
    expect(expectedWrites.map(([, args]) => JSON.parse(args[1]))).toEqual([{ count: JOBS.length }, { count: JOBS.length }]);
  });
});

describe('projection 独立调度 loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    schedulerJobsModule.stopProjectionJobsLoop?.();
    stopSchedulerJobsLoop();
    vi.useRealTimers();
  });

  it('projection jobs 不进入慢速串行队列，但仍保留在总注册表和哨兵计数中', () => {
    expect(schedulerJobsModule.SERIAL_JOBS).toBeInstanceOf(Array);
    const independentNames = schedulerJobsModule.PROJECTION_JOBS.map(job => job.name);
    expect(independentNames).toEqual([
      'notion-task-command-ingest',
      'projection-command-apply',
      'projection-outbox',
      'notion-company-key-results',
      'notion-kr-projection',
    ]);
    expect(schedulerJobsModule.SERIAL_JOBS.map(job => job.name)).not.toEqual(
      expect.arrayContaining(independentNames),
    );
    expect(JOBS.map(job => job.name)).toEqual(expect.arrayContaining(independentNames));
  });

  it('慢速串行 job 挂起时，projection 仍在独立 loop 立即执行并按 60s 继续', async () => {
    expect(schedulerJobsModule.startProjectionJobsLoop).toBeTypeOf('function');
    const pool = makePool();
    scheduleDailyBackup.mockImplementationOnce(() => new Promise(() => {}));
    const projectionRunner = vi.fn().mockResolvedValue([]);

    startSchedulerJobsLoop(pool);
    schedulerJobsModule.startProjectionJobsLoop(pool, { runOnce: projectionRunner });
    await Promise.resolve();
    await Promise.resolve();
    expect(projectionRunner).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(scheduleDailyBackup).toHaveBeenCalledTimes(1);
    expect(projectionRunner).toHaveBeenCalledTimes(2);
    expect(projectionRunner.mock.calls[0][1].map(job => job.name)).toEqual([
      'notion-task-command-ingest',
      'projection-command-apply',
      'projection-outbox',
      'notion-company-key-results',
      'notion-kr-projection',
    ]);
  });

  it('上一轮 projection 未结束时不叠加下一轮', async () => {
    expect(schedulerJobsModule.startProjectionJobsLoop).toBeTypeOf('function');
    const projectionRunner = vi.fn(() => new Promise(() => {}));
    schedulerJobsModule.startProjectionJobsLoop(makePool(), { runOnce: projectionRunner });
    await vi.advanceTimersByTimeAsync(120 * 1000);
    expect(projectionRunner).toHaveBeenCalledTimes(1);
  });
});

describe('capture-triage job 注册', () => {
  it('capture-triage 已注册（needsPool=true）', () => {
    const job = JOBS.find((j) => j.name === 'capture-triage');
    expect(job).toBeTruthy();
    expect(job.needsPool).toBe(true);
    expect(typeof job.handler).toBe('function');
  });
});

// [BEHAVIOR] B-1~B-4: Preview Brain 隔离守卫
// 防并发重复派发：BRAIN_PREVIEW=1 时 scheduler-jobs loop 不启动
describe('scheduler-jobs Preview Brain 隔离（BRAIN_PREVIEW=1 幂等保护）', () => {
  let consoleSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    delete process.env.BRAIN_PREVIEW;
  });

  afterEach(() => {
    stopSchedulerJobsLoop();
    stopProjectionJobsLoop?.();
    vi.useRealTimers();
    consoleSpy.mockRestore();
    delete process.env.BRAIN_PREVIEW;
  });

  // [BEHAVIOR] B-1
  it('BRAIN_PREVIEW=1 时 startSchedulerJobsLoop 返回 null，不启动 setInterval', () => {
    process.env.BRAIN_PREVIEW = '1';
    const pool = makePool();
    const timer = startSchedulerJobsLoop(pool);
    expect(timer).toBeNull();
  });

  // [BEHAVIOR] B-2
  it('BRAIN_PREVIEW=1 时 startProjectionJobsLoop 返回 null，不启动 setInterval', () => {
    process.env.BRAIN_PREVIEW = '1';
    const pool = makePool();
    const timer = startProjectionJobsLoop(pool);
    expect(timer).toBeNull();
  });

  // [BEHAVIOR] B-3: 非 Preview 时正常启动（零回归）
  it('BRAIN_PREVIEW 未设置时 startSchedulerJobsLoop 正常启动，前进 60s 触发 handler', async () => {
    const pool = makePool();
    const timer = startSchedulerJobsLoop(pool);
    expect(timer).not.toBeNull();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(scheduleDailyBackup).toHaveBeenCalledTimes(1);
  });

  // [BEHAVIOR] B-4: Preview 模式打印含 "BRAIN_PREVIEW" 字样的日志
  it('BRAIN_PREVIEW=1 时 startSchedulerJobsLoop 打印含 BRAIN_PREVIEW 的日志', () => {
    process.env.BRAIN_PREVIEW = '1';
    const pool = makePool();
    startSchedulerJobsLoop(pool);
    const logged = consoleSpy.mock.calls.flat().join(' ');
    expect(logged).toMatch(/BRAIN_PREVIEW/);
  });
});
