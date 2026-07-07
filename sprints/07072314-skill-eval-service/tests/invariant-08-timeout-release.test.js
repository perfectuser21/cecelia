/**
 * INV-08: 超时强杀 & slot 释放
 * 评估超 SKILL_EVAL_TIMEOUT → 强杀容器 → task=failed(reason:timeout) → 释放 slot
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, cleanupTestDb } from './helpers/db.js';
import { createMockBrainTick } from './helpers/brain-mock.js';
import { createMockDockerExecutor } from './helpers/docker-mock.js';

describe('INV-08: 超时强杀 & slot 释放', () => {
  let db;
  let tick;
  let dockerMock;

  beforeEach(async () => {
    db = await createTestDb();
    dockerMock = createMockDockerExecutor();
    tick = createMockBrainTick({
      db,
      SKILL_EVAL_TIMEOUT: 5, // 5 秒（测试用短超时）
      dockerExecutor: dockerMock,
      MAX_CONCURRENT_SKILL_EVAL: 1,
    });
  });

  afterEach(async () => {
    await cleanupTestDb(db);
    vi.restoreAllMocks();
  });

  it('超时任务被标记为 failed，reason=timeout', async () => {
    // 插入一个已运行超时的任务（started_at 在超时时间之前）
    const timeoutSeconds = 5;
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status, started_at)
      VALUES (
        'timeout-task',
        'hash-timeout-aaa',
        'timeout-skill',
        'running',
        NOW() - INTERVAL '${timeoutSeconds + 1} seconds'
      )
    `);

    // 触发超时检查
    await tick.checkTimeouts();

    const task = await db.one(
      `SELECT status, failure_reason FROM skill_eval_tasks WHERE task_id='timeout-task'`
    );

    expect(task.status).toBe('failed');
    expect(task.failure_reason).toBe('timeout');
  });

  it('超时后 slot 释放（running 计数恢复为 0）', async () => {
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status, started_at)
      VALUES (
        'timeout-task',
        'hash-timeout-bbb',
        'slot-skill',
        'running',
        NOW() - INTERVAL '10 seconds'
      )
    `);

    await tick.checkTimeouts();

    const { count } = await db.one(
      `SELECT COUNT(*) as count FROM skill_eval_tasks WHERE status='running'`
    );
    expect(parseInt(count)).toBe(0);
  });

  it('超时后触发飞书告警', async () => {
    const feishuSpy = vi.spyOn(tick, 'sendFeishuAlert').mockResolvedValue(undefined);

    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status, started_at)
      VALUES (
        'timeout-alert-task',
        'hash-timeout-ccc',
        'alert-skill',
        'running',
        NOW() - INTERVAL '10 seconds'
      )
    `);

    await tick.checkTimeouts();

    expect(feishuSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'timeout', task_id: 'timeout-alert-task' })
    );
  });

  it('超时后 docker 容器被强杀', async () => {
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status, started_at, container_id)
      VALUES (
        'timeout-docker-task',
        'hash-timeout-ddd',
        'docker-skill',
        'running',
        NOW() - INTERVAL '10 seconds',
        'container-abc123'
      )
    `);

    await tick.checkTimeouts();

    expect(dockerMock.killed).toContain('container-abc123');
  });

  it('未超时的 running 任务不受影响', async () => {
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status, started_at)
      VALUES (
        'fresh-task',
        'hash-fresh-eee',
        'fresh-skill',
        'running',
        NOW() - INTERVAL '1 second'
      )
    `);

    await tick.checkTimeouts();

    const { status } = await db.one(
      `SELECT status FROM skill_eval_tasks WHERE task_id='fresh-task'`
    );
    expect(status).toBe('running');
  });

  it('超时后 pending 任务可以进入 running（slot 已释放）', async () => {
    // 超时任务
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status, started_at)
      VALUES (
        'timeout-release-task',
        'hash-timeout-fff',
        'timeout-skill',
        'running',
        NOW() - INTERVAL '10 seconds'
      )
    `);

    // pending 任务
    await db.none(`
      INSERT INTO skill_eval_tasks (task_id, zip_hash, skill_name, status)
      VALUES ('next-pending-task', 'hash-next-ggg', 'next-skill', 'pending')
    `);

    // 超时检查 + 调度
    await tick.checkTimeouts();
    await tick.schedule();

    const { status } = await db.one(
      `SELECT status FROM skill_eval_tasks WHERE task_id='next-pending-task'`
    );
    expect(status).toBe('running');
  });
});
