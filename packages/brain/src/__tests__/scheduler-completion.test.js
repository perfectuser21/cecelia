import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOBS, SERIAL_JOBS, startSchedulerJobsLoop, stopSchedulerJobsLoop } from '../scheduler-jobs.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

describe('脚本收尾独立周期', () => {
  let pool;
  let originals;
  let pending;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('BRAIN_PREVIEW', '');
    originals = JOBS.map(job => ({ job, handler: job.handler, timeoutMs: job.timeoutMs }));
    for (const job of JOBS) job.handler = vi.fn().mockResolvedValue({});
    pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    pending = [];
  });
  afterEach(async () => {
    stopSchedulerJobsLoop();
    for (const item of pending) item.resolve({});
    await vi.advanceTimersByTimeAsync(0);
    for (const saved of originals) Object.assign(saved.job, { handler: saved.handler, timeoutMs: saved.timeoutMs });
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });
  const job = name => JOBS.find(item => item.name === name);
  function hang(target) {
    const item = deferred(); pending.push(item);
    target.handler.mockImplementation(() => item.promise);
    return item;
  }

  it('无关串行 job 真挂起时，90秒鲜度预算内仍触发收割与observer对账', async () => {
    hang(job('machine-vitals'));
    startSchedulerJobsLoop(pool);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(job('machine-vitals').handler).toHaveBeenCalledTimes(1);
    job('script-reaper').handler.mockClear();
    job('node-onboarding').handler.mockClear();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(job('script-reaper').handler).toHaveBeenCalled();
    expect(job('node-onboarding').handler).toHaveBeenCalled();
  });

  it('收尾任务只进入独立周期，不能同时进入serial产生双写', () => {
    expect(SERIAL_JOBS.map(item => item.name)).not.toContain('script-reaper');
    expect(SERIAL_JOBS.map(item => item.name)).not.toContain('node-onboarding');
  });

  it('managed收割和Linux外部phase各自挂起，不阻塞legacy与observer收账', async () => {
    const managed = job('managed-script-reaper');
    const execution = job('node-execution-onboarding');
    expect(managed).toBeDefined();
    expect(execution).toBeDefined();
    hang(managed); hang(execution);
    startSchedulerJobsLoop(pool);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(managed.handler).toHaveBeenCalledTimes(1);
    expect(execution.handler).toHaveBeenCalledTimes(1);
    expect(job('script-reaper').handler).toHaveBeenCalledTimes(3);
    expect(job('node-onboarding').handler).toHaveBeenCalledTimes(3);
    expect(SERIAL_JOBS).not.toContain(managed);
    expect(SERIAL_JOBS).not.toContain(execution);
  });

  it('handler超时但尚未settle时保留互斥，实际结束后才允许下一轮', async () => {
    const reaper = job('script-reaper');
    reaper.timeoutMs = 100;
    const first = hang(reaper);
    startSchedulerJobsLoop(pool);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(reaper.handler).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls.some(([, args]) => args?.[0] === 'scheduler_job_last_run:script-reaper'
      && JSON.parse(args[1]).timedOut === true)).toBe(true);
    first.resolve({});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reaper.handler).toHaveBeenCalledTimes(2);
  });

  it('stop后不再发起收割，stop/start不清仍未结束的同job锁', async () => {
    const reaper = job('script-reaper');
    hang(reaper);
    startSchedulerJobsLoop(pool);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reaper.handler).toHaveBeenCalledTimes(1);
    stopSchedulerJobsLoop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reaper.handler).toHaveBeenCalledTimes(1);
    startSchedulerJobsLoop(pool);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reaper.handler).toHaveBeenCalledTimes(1);
  });

  it('preview不收割；正式环境tick disabled与drain不阻止既有任务收尾', async () => {
    vi.stubEnv('BRAIN_PREVIEW', '1');
    expect(startSchedulerJobsLoop(pool)).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(job('script-reaper').handler).not.toHaveBeenCalled();
    vi.stubEnv('BRAIN_PREVIEW', '');
    // 收尾调度不读派发开关；这些行若被查询必须保留disabled/draining。
    pool.query.mockResolvedValue({ rows: [{ tick_enabled: false, draining: true }] });
    startSchedulerJobsLoop(pool);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(job('script-reaper').handler).toHaveBeenCalled();
  });
});
