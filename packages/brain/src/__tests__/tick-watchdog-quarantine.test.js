/**
 * Tests for P0 FIX #3: Watchdog kill inherits failure_count and eventually quarantines
 *
 * Before fix: watchdog_retry_count and failure_count were separate, leading to infinite loop
 * After fix: Watchdog kill increments both watchdog_retry_count AND failure_count
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';

// isolate:false 修复：延迟导入，确保获取真实 pool 而非其他文件残留的 mock
import { openDebt08Scratch } from './debt-08-scratch.js';
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn(() => { throw new Error('禁止模型调用'); }) }));
vi.mock('child_process', () => ({
  execFile: vi.fn(() => { throw new Error('禁止子进程'); }),
  exec: vi.fn(() => { throw new Error('禁止子进程'); }),
  execSync: vi.fn(() => { throw new Error('禁止子进程'); }),
  spawn: vi.fn(() => { throw new Error('禁止子进程'); }),
}));
// 本组只测 watchdog 状态/计数/事件/learning；统一收件箱在其专属回归验收。
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn(async () => null) }));
let scratch;
let pool, requeueTask;

beforeAll(async () => {
  vi.resetModules();
  scratch = await openDebt08Scratch(['001_cecelia_architecture_upgrade.sql', '142_tasks_error_message.sql', '234_add_tasks_claim_columns.sql', '268_task_events.sql', '012_learnings_table.sql', '063_learnings_dedup.sql', '073_desire_system.sql', '079_rumination.sql', '083_layered_memory_summary.sql', '271_learnings_task_id_binding.sql']);
  pool = scratch.pool;
  vi.doMock('../db.js', () => ({ default: pool }));
  requeueTask = (await import('../executor.js')).requeueTask;
});

afterAll(async () => { if (scratch) await scratch.close(); });

describe('tick-watchdog-quarantine (P0 Fix #3)', () => {
  let testTaskId;

  beforeEach(async () => {
    // Create a test task in in_progress state
    const result = await pool.query(`
      INSERT INTO tasks (title, status, payload)
      VALUES ('test-watchdog-kill', 'in_progress', '{}'::jsonb)
      RETURNING id
    `);
    testTaskId = result.rows[0].id;
  });

  afterEach(async () => {
    await pool.query('DELETE FROM tasks WHERE title LIKE $1', ['test-watchdog-kill%']);
  });

  it('should increment both watchdog_retry_count and failure_count on first kill', async () => {
    const killResult = await requeueTask(testTaskId, 'RSS exceeded', {
      rss_mb: 3000,
      threshold_mb: 2400
    });

    expect(killResult.requeued).toBe(true);
    expect(killResult.retry_count).toBe(1);

    // Check database
    const task = await pool.query('SELECT payload FROM tasks WHERE id = $1', [testTaskId]);
    const payload = task.rows[0].payload;

    expect(payload.watchdog_retry_count).toBe(1);
    expect(payload.failure_count).toBe(1); // P0 FIX: failure_count should also increment
    const events = await pool.query('SELECT event_type FROM task_events WHERE task_id = $1', [testTaskId]);
    expect(events.rows.map(r => r.event_type)).toContain('watchdog_requeue');
    const learnings = await pool.query('SELECT task_id FROM learnings WHERE task_id = $1', [testTaskId]);
    expect(learnings.rows).toHaveLength(1);
  });

  it('should quarantine task after 2 watchdog kills', async () => {
    // First kill
    await requeueTask(testTaskId, 'RSS exceeded', { rss_mb: 3000 });

    // Update task back to in_progress (simulate retry)
    await pool.query(`UPDATE tasks SET status = 'in_progress' WHERE id = $1`, [testTaskId]);

    // Second kill
    const killResult = await requeueTask(testTaskId, 'RSS exceeded', { rss_mb: 3200 });

    expect(killResult.requeued).toBe(false);
    expect(killResult.quarantined).toBe(true);

    // Check database
    const task = await pool.query('SELECT status, payload FROM tasks WHERE id = $1', [testTaskId]);
    expect(task.rows[0].status).toBe('quarantined');
    expect(task.rows[0].payload.quarantine_info?.reason).toBe('resource_hog');
    expect(task.rows[0].payload.failure_count).toBe(2); // P0 FIX: both kills counted
  });

  it('should preserve failure_count across watchdog kills and normal failures', async () => {
    // Simulate: 1 normal failure + 1 watchdog kill → total 2 failures
    // This tests that the two counters work together

    // First: add a normal failure
    await pool.query(`
      UPDATE tasks
      SET payload = COALESCE(payload, '{}'::jsonb) || '{"failure_count": 1}'::jsonb
      WHERE id = $1
    `, [testTaskId]);

    // Then: watchdog kill (should increment to 2)
    await requeueTask(testTaskId, 'CPU exceeded', { cpu_pct: 98 });

    const task = await pool.query('SELECT payload FROM tasks WHERE id = $1', [testTaskId]);
    const payload = task.rows[0].payload;

    // P0 FIX: failure_count should be 2 (1 existing + 1 from watchdog kill)
    expect(payload.failure_count).toBe(2);
    expect(payload.watchdog_retry_count).toBe(1);
  });

  it('should include total_failures in quarantine details', async () => {
    // Kill twice to quarantine
    await requeueTask(testTaskId, 'RSS exceeded', { rss_mb: 3000 });
    await pool.query(`UPDATE tasks SET status = 'in_progress' WHERE id = $1`, [testTaskId]);
    await requeueTask(testTaskId, 'RSS exceeded', { rss_mb: 3000 });

    const task = await pool.query('SELECT payload FROM tasks WHERE id = $1', [testTaskId]);
    const details = task.rows[0].payload.quarantine_info?.details;

    expect(details).toBeDefined();
    expect(details.watchdog_retries).toBe(2);
    expect(details.total_failures).toBe(2); // P0 FIX: total_failures tracked
  });

  it('没有资源实证时达到重试阈值仍不误隔离', async () => {
    await requeueTask(testTaskId, 'RSS exceeded', {});
    await pool.query("UPDATE tasks SET status = 'in_progress' WHERE id = $1", [testTaskId]);
    const result = await requeueTask(testTaskId, 'RSS exceeded', {});
    expect(result.requeued).toBe(true);
    expect(result.quarantined).toBeUndefined();
    const { rows: [task] } = await pool.query('SELECT status, payload FROM tasks WHERE id = $1', [testTaskId]);
    expect(task.status).toBe('queued');
    expect(task.payload.failure_count).toBe(2);
    expect(task.payload.quarantine_info).toBeUndefined();
  });

  it('should NOT requeue if task is no longer in_progress', async () => {
    // Change task to completed
    await pool.query(`UPDATE tasks SET status = 'completed' WHERE id = $1`, [testTaskId]);

    const killResult = await requeueTask(testTaskId, 'RSS exceeded', {});

    expect(killResult.requeued).toBe(false);
    expect(killResult.reason).toBe('not_in_progress');
  });
});
