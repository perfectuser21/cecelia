/**
 * INV-01: 单 slot 串行
 * Brain 同时只运行 1 个 skill_eval 任务（MAX_CONCURRENT_SKILL_EVAL=1）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, cleanupTestDb } from './helpers/db.js';
import { createMockBrainTick } from './helpers/brain-mock.js';

describe('INV-01: 单 slot 串行调度', () => {
  let db;
  let tick;

  beforeEach(async () => {
    db = await createTestDb();
    tick = createMockBrainTick({ db, MAX_CONCURRENT_SKILL_EVAL: 1 });
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  it('同时运行的 skill_eval 任务数不超过 1', async () => {
    // 插入 3 个 pending 任务
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status)
      VALUES
        ('task-001', 'hash-aaa', 'skill-a', 'pending'),
        ('task-002', 'hash-bbb', 'skill-b', 'pending'),
        ('task-003', 'hash-ccc', 'skill-c', 'pending')
    `);

    // 触发 tick 调度
    await tick.schedule();

    // 验证 running 数量 ≤ 1
    const { count } = await db.one(
      `SELECT COUNT(*) as count FROM skill_eval_tasks WHERE status='running'`
    );
    expect(parseInt(count)).toBeLessThanOrEqual(1);
  });

  it('当 slot 被占用时，新 pending 任务不转 running', async () => {
    // 插入 1 个 running 任务（占用 slot）
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status, started_at)
      VALUES ('task-running', 'hash-run', 'skill-running', 'running', NOW())
    `);

    // 插入 1 个 pending 任务
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status)
      VALUES ('task-pending', 'hash-pend', 'skill-pending', 'pending')
    `);

    // 触发 tick
    await tick.schedule();

    // pending 任务应仍为 pending
    const { status } = await db.one(
      `SELECT status FROM skill_eval_tasks WHERE task_id='task-pending'`
    );
    expect(status).toBe('pending');
  });

  it('当 slot 释放后，pending 任务转 running', async () => {
    // 插入 1 个刚完成的任务（slot 空闲）
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status)
      VALUES ('task-completed', 'hash-done', 'skill-done', 'completed')
    `);

    // 插入 1 个 pending 任务
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status)
      VALUES ('task-pending', 'hash-pend', 'skill-pending', 'pending')
    `);

    // 触发 tick
    await tick.schedule();

    // pending 任务应转为 running
    const { status } = await db.one(
      `SELECT status FROM skill_eval_tasks WHERE task_id='task-pending'`
    );
    expect(status).toBe('running');
  });
});
