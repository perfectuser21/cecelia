/**
 * INV-03: 额度预检拦截
 * Brain 在将 pending→running 转换前验证 Claude 额度；
 * 不足则拦截并将 task 保持 pending（写入 pending_reason='quota_insufficient'）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, cleanupTestDb } from './helpers/db.js';
import { createMockBrainTick } from './helpers/brain-mock.js';

/**
 * Mock quota provider 工厂
 * @param {number} pct5h  5h 池剩余百分比（0-100）
 * @param {number} pct7d  7d 池剩余百分比（0-100）
 */
function makeQuotaProvider(pct5h, pct7d) {
  return {
    async getSonnetQuota() {
      return { remaining_5h_pct: pct5h, remaining_7d_pct: pct7d };
    },
  };
}

describe('INV-03: 额度预检拦截', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDb();
    // 准备一个 pending 任务
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status)
      VALUES ('task-quota-test', 'hash-quota-aaa', 'quota-skill', 'pending')
    `);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  it('5h 池 < 85% 时，pending 任务不转 running，并写入 pending_reason', async () => {
    const quota = makeQuotaProvider(80, 95); // 5h 不足
    const tick = createMockBrainTick({ db, quotaProvider: quota });

    await tick.schedule();

    const row = await db.oneOrNone(
      `SELECT status, pending_reason FROM skill_eval_tasks WHERE task_id='task-quota-test'`
    );
    expect(row).not.toBeNull();
    expect(row.status).toBe('pending');
    expect(row.pending_reason).toMatch(/quota/i);
  });

  it('7d 池 < 90% 时，pending 任务不转 running，并写入 pending_reason', async () => {
    const quota = makeQuotaProvider(90, 85); // 7d 不足
    const tick = createMockBrainTick({ db, quotaProvider: quota });

    await tick.schedule();

    const row = await db.oneOrNone(
      `SELECT status, pending_reason FROM skill_eval_tasks WHERE task_id='task-quota-test'`
    );
    expect(row).not.toBeNull();
    expect(row.status).toBe('pending');
    expect(row.pending_reason).toMatch(/quota/i);
  });

  it('两池均不足时，pending_reason 包含额度详情', async () => {
    const quota = makeQuotaProvider(70, 75); // 两池都不足
    const tick = createMockBrainTick({ db, quotaProvider: quota });

    await tick.schedule();

    const row = await db.oneOrNone(
      `SELECT status, pending_reason FROM skill_eval_tasks WHERE task_id='task-quota-test'`
    );
    expect(row.status).toBe('pending');
    expect(row.pending_reason).toBeTruthy();
  });

  it('两池均满足时（5h≥85%, 7d≥90%），pending 任务正常转 running', async () => {
    const quota = makeQuotaProvider(90, 95); // 两池均满足
    const tick = createMockBrainTick({ db, quotaProvider: quota });

    await tick.schedule();

    const row = await db.oneOrNone(
      `SELECT status FROM skill_eval_tasks WHERE task_id='task-quota-test'`
    );
    expect(row).not.toBeNull();
    expect(row.status).toBe('running');
  });

  it('额度不足时应触发飞书告警记录', async () => {
    const alerts = [];
    const quota = makeQuotaProvider(60, 75);
    const tick = createMockBrainTick({
      db,
      quotaProvider: quota,
      onAlert: (alert) => alerts.push(alert),
    });

    await tick.schedule();

    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]).toMatchObject({ type: expect.stringMatching(/quota/i) });
  });
});
