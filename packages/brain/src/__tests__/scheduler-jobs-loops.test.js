import { makePool } from './scheduler-jobs.mock-setup.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startSchedulerJobsLoop, stopSchedulerJobsLoop, JOBS } from '../scheduler-jobs.js';
import * as schedulerJobsModule from '../scheduler-jobs.js';
const { startProjectionJobsLoop, stopProjectionJobsLoop } = schedulerJobsModule;
import { triggerArchReview } from '../daily-review-scheduler.js';
import { maybeTriggerStrategySession } from '../active-goals-zero-trigger.js';
import { runImageRetentionJanitor } from '../image-retention-scheduler.js';
import { runPreviewCacheJanitor } from '../preview-cache-scheduler.js';

describe('scheduler-jobs loop 幂等与重入守卫', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    stopSchedulerJobsLoop();
    vi.useRealTimers();
  });

  it('start 时写入 scheduler_jobs_expected 预期数（供死人开关比对）', async () => {
    const pool = makePool();
    startSchedulerJobsLoop(pool);
    await Promise.resolve();
    await Promise.resolve();
    const call = pool.query.mock.calls.find(
      ([sql, params]) => sql.includes('working_memory') && Array.isArray(params) && params[0] === 'scheduler_jobs_expected',
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(call[1][1])).toEqual({ count: JOBS.length });
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
    expect(triggerArchReview).toHaveBeenCalledTimes(1);
    expect(maybeTriggerStrategySession).toHaveBeenCalledTimes(1);
  });

  it('重入守卫：慢 handler 挂起时前进 120s 不叠加并发', async () => {
    const pool = makePool();
    triggerArchReview.mockImplementationOnce(() => new Promise(() => {}));
    startSchedulerJobsLoop(pool);
    await vi.advanceTimersByTimeAsync(120 * 1000);
    // 首轮在 arch-review 处挂起，running 仍为 true，第二次 tick 应被守卫短路，
    // arch-review 只被调用一次（无守卫则会被第二轮再调一次）。
    expect(triggerArchReview).toHaveBeenCalledTimes(1);
  });

  it('stopSchedulerJobsLoop 后前进 60s 不再触发', async () => {
    const pool = makePool();
    startSchedulerJobsLoop(pool);
    stopSchedulerJobsLoop();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(triggerArchReview).not.toHaveBeenCalled();
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
    triggerArchReview.mockImplementationOnce(() => new Promise(() => {}));
    const projectionRunner = vi.fn().mockResolvedValue([]);

    startSchedulerJobsLoop(pool);
    schedulerJobsModule.startProjectionJobsLoop(pool, { runOnce: projectionRunner });
    await Promise.resolve();
    await Promise.resolve();
    expect(projectionRunner).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(triggerArchReview).toHaveBeenCalledTimes(1);
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

describe('line-dreaming job 注册', () => {
  it('JOBS 里存在 line-dreaming，且排在 battle-report 之前', () => {
    const dreamIdx = JOBS.findIndex((j) => j.name === 'line-dreaming');
    const reportIdx = JOBS.findIndex((j) => j.name === 'battle-report');
    expect(dreamIdx).toBeGreaterThanOrEqual(0);
    expect(reportIdx).toBeGreaterThanOrEqual(0);
    expect(dreamIdx).toBeLessThan(reportIdx);
  });
});

describe('conversation-ttl-archiver job 注册', () => {
  it('conversation-ttl-archiver 已注册（needsPool=true）', () => {
    const job = JOBS.find((j) => j.name === 'conversation-ttl-archiver');
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
    const { triggerArchReview } = await import('../daily-review-scheduler.js');
    expect(triggerArchReview).toHaveBeenCalledTimes(1);
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

it('专属cache scheduler需要pool并进入默认停用Janitor合同', async () => {
  const job = JOBS.find(row => row.name === 'preview-owned-cache-janitor');
  expect(job).toMatchObject({ needsPool: true });
  const pool = {}; await job.handler(pool);
  expect(runPreviewCacheJanitor).toHaveBeenCalledWith(pool);
});
it('机器体征始终先采集，Janitor网络等待不能排在体征前', () => {
  expect(JOBS[0].name).toBe('machine-vitals');
  expect(JOBS.findIndex(job => job.name === 'preview-owned-cache-janitor')).toBeGreaterThan(0);
});

it('US固定镜像策略进入默认停用Janitor合同且在体征采样之后',async()=>{
 const job=JOBS.find(row=>row.name==='us-brain-image-janitor');expect(job).toMatchObject({needsPool:true});
 const pool={};await job.handler(pool);expect(runImageRetentionJanitor).toHaveBeenCalledWith(pool);
 expect(JOBS.findIndex(row=>row===job)).toBeGreaterThan(0);
});
