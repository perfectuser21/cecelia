/**
 * Tests for P0 FIX: Watchdog kill 竞态条件 — 任务非 in_progress 时仍能 quarantine
 *
 * 根因：requeueTask 要求 status='in_progress'，但 liveness probe 或
 * execution-callback 可能先改了状态，导致 watchdog_retry_count 永不递增，
 * quarantine 永不触发，形成死循环。
 *
 * 修复：requeueTask 在 not_in_progress 时仍递增 watchdog_retry_count，
 * 超限时做 fallback quarantine。
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';

let pool, requeueTask;

beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../db.js')).default;
  requeueTask = (await import('../executor.js')).requeueTask;
});

describe('watchdog-quarantine-race (竞态条件修复)', () => {
  let testTaskId;

  beforeEach(async () => {
    const result = await pool.query(`
      INSERT INTO tasks (title, status, payload)
      VALUES ('test-watchdog-race', 'failed', '{}'::jsonb)
      RETURNING id
    `);
    testTaskId = result.rows[0].id;
  });

  afterEach(async () => {
    await pool.query('DELETE FROM tasks WHERE title LIKE $1', ['test-watchdog-race%']);
  });

  it('should increment watchdog_retry_count even when task is failed (not in_progress)', async () => {
    // 任务已经是 failed 状态（被 liveness probe 改了）
    const result = await requeueTask(testTaskId, 'Crisis: pressure=1.11', { rss_mb: 1 });

    expect(result.requeued).toBe(false);
    expect(result.reason).toBe('not_in_progress');

    // 关键验证：counter 仍然递增了
    const task = await pool.query('SELECT payload FROM tasks WHERE id = $1', [testTaskId]);
    expect(task.rows[0].payload.watchdog_retry_count).toBe(1);
  });

  it('should fallback quarantine after 2 kills even when never in_progress', async () => {
    // 模拟连续两次 watchdog kill，任务始终不是 in_progress
    // 第一次 kill
    await requeueTask(testTaskId, 'Crisis: pressure=1.2', { rss_mb: 1 });

    // 任务仍然是 failed（没有回到 in_progress）
    const afterFirst = await pool.query('SELECT status, payload FROM tasks WHERE id = $1', [testTaskId]);
    expect(afterFirst.rows[0].status).toBe('failed'); // 状态没变
    expect(afterFirst.rows[0].payload.watchdog_retry_count).toBe(1);

    // 第二次 kill — 应该触发 fallback quarantine
    const result2 = await requeueTask(testTaskId, 'Crisis: pressure=1.3', { rss_mb: 1 });

    expect(result2.requeued).toBe(false);
    expect(result2.quarantined).toBe(true);
    expect(result2.reason).toBe('fallback_quarantine');

    // 验证 DB 状态
    const task = await pool.query('SELECT status, payload, error_message FROM tasks WHERE id = $1', [testTaskId]);
    expect(task.rows[0].status).toBe('quarantined');
    expect(task.rows[0].payload.quarantine_info.reason).toBe('resource_hog_race_condition');
    expect(task.rows[0].payload.quarantine_info.details.previous_status).toBe('failed');
    expect(task.rows[0].error_message).toContain('watchdog-fallback');
  });

  it('should NOT touch completed/cancelled tasks', async () => {
    // 把任务改为 completed
    await pool.query(`UPDATE tasks SET status = 'completed' WHERE id = $1`, [testTaskId]);

    const result = await requeueTask(testTaskId, 'Crisis', {});

    expect(result.requeued).toBe(false);
    expect(result.reason).toBe('not_in_progress');
    // 不应该 quarantine（completed 任务不应被动）
    expect(result.quarantined).toBeUndefined();

    // 状态应保持 completed
    const task = await pool.query('SELECT status FROM tasks WHERE id = $1', [testTaskId]);
    expect(task.rows[0].status).toBe('completed');
  });

  it('should handle queued tasks (dispatch → immediate kill race)', async () => {
    // 任务在 queued 状态（刚被 dispatch 回来但还没变成 in_progress）
    await pool.query(`UPDATE tasks SET status = 'queued' WHERE id = $1`, [testTaskId]);

    // 第一次 kill
    const result1 = await requeueTask(testTaskId, 'Crisis', {});
    expect(result1.requeued).toBe(false);
    expect(result1.reason).toBe('not_in_progress');

    // counter 已递增
    const after1 = await pool.query('SELECT payload FROM tasks WHERE id = $1', [testTaskId]);
    expect(after1.rows[0].payload.watchdog_retry_count).toBe(1);

    // 第二次 kill → quarantine
    const result2 = await requeueTask(testTaskId, 'Crisis', {});
    expect(result2.quarantined).toBe(true);

    const after2 = await pool.query('SELECT status FROM tasks WHERE id = $1', [testTaskId]);
    expect(after2.rows[0].status).toBe('quarantined');
  });

  it('should preserve existing watchdog_retry_count from previous in_progress kills', async () => {
    // 模拟：第一次 kill 走了正常路径（in_progress），counter=1
    // 然后状态被改成 failed（竞态）
    // 第二次 kill 走 fallback 路径 → 应该读到 counter=1 → 递增到 2 → quarantine
    await pool.query(`
      UPDATE tasks SET payload = '{"watchdog_retry_count": 1}'::jsonb
      WHERE id = $1
    `, [testTaskId]);

    const result = await requeueTask(testTaskId, 'Crisis', {});

    expect(result.quarantined).toBe(true);
    expect(result.reason).toBe('fallback_quarantine');
  });
});
