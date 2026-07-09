import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../daily-review-scheduler.js', () => ({
  triggerArchReview: vi.fn().mockResolvedValue({ triggered: false, skipped_window: true }),
  triggerCiPatrol: vi.fn().mockResolvedValue({ triggered: false, skipped_window: true }),
}));
vi.mock('../active-goals-zero-trigger.js', () => ({
  maybeTriggerStrategySession: vi.fn().mockResolvedValue({ created: false, reason: 'active_goals_present' }),
}));
vi.mock('../conversation-digest.js', () => ({
  runConversationDigest: vi.fn().mockResolvedValue({ digested: 0 }),
}));
vi.mock('../capture-digestion.js', () => ({
  runCaptureDigestion: vi.fn().mockResolvedValue({ processed: 0 }),
}));
vi.mock('../daily-backup-scheduler.js', () => ({
  scheduleDailyBackup: vi.fn().mockResolvedValue({ inWindow: false, triggered: false, alreadyDone: false }),
}));
vi.mock('../battle-report.js', () => ({
  maybeGenerateBattleReport: vi.fn().mockResolvedValue({ skipped: true, reason: 'outside_window' }),
}));
vi.mock('../line-dreaming.js', () => ({
  maybeRunLineDreaming: vi.fn().mockResolvedValue({ created: false, reason: 'outside_window' }),
}));

import {
  runSchedulerJobsOnce,
  startSchedulerJobsLoop,
  stopSchedulerJobsLoop,
  JOBS,
  SENTINEL_KEY_PREFIX,
} from '../scheduler-jobs.js';
import { triggerArchReview, triggerCiPatrol } from '../daily-review-scheduler.js';
import { maybeTriggerStrategySession } from '../active-goals-zero-trigger.js';
import { runConversationDigest } from '../conversation-digest.js';
import { runCaptureDigestion } from '../capture-digestion.js';
import { scheduleDailyBackup } from '../daily-backup-scheduler.js';
import { maybeGenerateBattleReport } from '../battle-report.js';
import { maybeRunLineDreaming } from '../line-dreaming.js';

function makePool() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

describe('scheduler-jobs 注册表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('JOBS 注册了 8 个 job', () => {
    expect(JOBS.map((j) => j.name)).toEqual([
      'arch-review', 'ci-patrol', 'strategy-trigger', 'conversation-digest', 'capture-digestion', 'daily-backup', 'line-dreaming', 'battle-report',
    ]);
  });

  it('runSchedulerJobsOnce 调用全部 job，needsPool 决定传参', async () => {
    const pool = makePool();
    const results = await runSchedulerJobsOnce(pool);
    expect(triggerArchReview).toHaveBeenCalledWith(pool);
    expect(triggerCiPatrol).toHaveBeenCalledWith(pool);
    expect(maybeTriggerStrategySession).toHaveBeenCalledWith(pool);
    expect(runConversationDigest).toHaveBeenCalledWith();
    expect(runCaptureDigestion).toHaveBeenCalledWith();
    expect(scheduleDailyBackup).toHaveBeenCalledWith(pool);
    expect(maybeRunLineDreaming).toHaveBeenCalledWith(pool);
    expect(maybeGenerateBattleReport).toHaveBeenCalledWith(pool);
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('单 job reject 不影响其余 job，且结果记录 ok:false', async () => {
    const pool = makePool();
    triggerArchReview.mockRejectedValueOnce(new Error('boom'));
    const results = await runSchedulerJobsOnce(pool);
    expect(results[0]).toMatchObject({ name: 'arch-review', ok: false, error: 'boom' });
    expect(results.slice(1).every((r) => r.ok)).toBe(true);
    expect(results).toHaveLength(8);
    expect(runCaptureDigestion).toHaveBeenCalled();
  });

  it('handler 永挂时按 timeoutMs 标记 timedOut 并继续', async () => {
    const pool = makePool();
    const hangJobs = [
      { name: 'hang', needsPool: false, timeoutMs: 10, handler: () => new Promise(() => {}) },
      { name: 'after', needsPool: false, timeoutMs: 1000, handler: vi.fn().mockResolvedValue('ok') },
    ];
    const results = await runSchedulerJobsOnce(pool, hangJobs);
    expect(results[0]).toMatchObject({ name: 'hang', ok: false, timedOut: true });
    expect(results[1].ok).toBe(true);
  });

  it('哨兵用 ON CONFLICT upsert 写 working_memory，key 带前缀', async () => {
    const pool = makePool();
    await runSchedulerJobsOnce(pool);
    const sentinelCalls = pool.query.mock.calls.filter(([sql]) => sql.includes('working_memory'));
    expect(sentinelCalls).toHaveLength(8);
    expect(sentinelCalls[0][0]).toMatch(/ON CONFLICT \(key\) DO UPDATE/);
    expect(sentinelCalls[0][1][0]).toBe(`${SENTINEL_KEY_PREFIX}arch-review`);
    const payload = JSON.parse(sentinelCalls[0][1][1]);
    expect(payload).toHaveProperty('at');
    expect(payload).toHaveProperty('ok');
  });

  it('哨兵写入失败不影响 job 结果也不抛', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    const results = await runSchedulerJobsOnce(pool);
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

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
    expect(runConversationDigest).toHaveBeenCalledTimes(1);
    expect(runCaptureDigestion).toHaveBeenCalledTimes(1);
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

describe('line-dreaming job 注册', () => {
  it('JOBS 里存在 line-dreaming，且排在 battle-report 之前', () => {
    const dreamIdx = JOBS.findIndex((j) => j.name === 'line-dreaming');
    const reportIdx = JOBS.findIndex((j) => j.name === 'battle-report');
    expect(dreamIdx).toBeGreaterThanOrEqual(0);
    expect(reportIdx).toBeGreaterThanOrEqual(0);
    expect(dreamIdx).toBeLessThan(reportIdx);
  });
});
