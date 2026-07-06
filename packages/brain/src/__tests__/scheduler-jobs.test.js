import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../daily-review-scheduler.js', () => ({
  triggerArchReview: vi.fn().mockResolvedValue({ triggered: false, skipped_window: true }),
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

import { runSchedulerJobsOnce, JOBS, SENTINEL_KEY_PREFIX } from '../scheduler-jobs.js';
import { triggerArchReview } from '../daily-review-scheduler.js';
import { maybeTriggerStrategySession } from '../active-goals-zero-trigger.js';
import { runConversationDigest } from '../conversation-digest.js';
import { runCaptureDigestion } from '../capture-digestion.js';

function makePool() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

describe('scheduler-jobs 注册表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('JOBS 注册了 4 个首批 job', () => {
    expect(JOBS.map((j) => j.name)).toEqual([
      'arch-review', 'strategy-trigger', 'conversation-digest', 'capture-digestion',
    ]);
  });

  it('runSchedulerJobsOnce 调用全部 job，needsPool 决定传参', async () => {
    const pool = makePool();
    const results = await runSchedulerJobsOnce(pool);
    expect(triggerArchReview).toHaveBeenCalledWith(pool);
    expect(maybeTriggerStrategySession).toHaveBeenCalledWith(pool);
    expect(runConversationDigest).toHaveBeenCalledWith();
    expect(runCaptureDigestion).toHaveBeenCalledWith();
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('单 job reject 不影响其余 job，且结果记录 ok:false', async () => {
    const pool = makePool();
    triggerArchReview.mockRejectedValueOnce(new Error('boom'));
    const results = await runSchedulerJobsOnce(pool);
    expect(results[0]).toMatchObject({ name: 'arch-review', ok: false, error: 'boom' });
    expect(results.slice(1).every((r) => r.ok)).toBe(true);
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
    expect(sentinelCalls).toHaveLength(4);
    expect(sentinelCalls[0][0]).toMatch(/ON CONFLICT \(key\) DO UPDATE/);
    expect(sentinelCalls[0][1][0]).toBe(`${SENTINEL_KEY_PREFIX}arch-review`);
    const payload = JSON.parse(sentinelCalls[0][1][1]);
    expect(payload).toHaveProperty('at');
    expect(payload).toHaveProperty('ok');
  });

  it('哨兵写入失败不影响 job 结果也不抛', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    const results = await runSchedulerJobsOnce(pool);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
