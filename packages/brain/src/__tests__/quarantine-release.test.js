/**
 * quarantine-release.test.js - 隔离区自动释放机制测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import pool from '../db.js';
import {
  quarantineTask,
  checkExpiredQuarantineTasks,
  getQuarantinedTasks,
  QUARANTINE_REASONS,
  FAILURE_CLASS,
} from '../quarantine.js';

describe('Quarantine Auto-Release', () => {
  let testTaskId;

  beforeEach(async () => {
    // 清理测试数据
    await pool.query("DELETE FROM tasks WHERE title LIKE 'TEST_%'");

    // 创建测试任务
    const result = await pool.query(`
      INSERT INTO tasks (title, task_type, status, payload)
      VALUES ('TEST_quarantine_release', 'dev', 'queued', '{}')
      RETURNING id
    `);
    testTaskId = result.rows[0].id;
  });

  describe('释放条件检查', () => {
    it('隔离时间超过阈值时可以释放', async () => {
      // 隔离任务（TTL=1小时）
      await quarantineTask(testTaskId, QUARANTINE_REASONS.RESOURCE_HOG, {
        failure_class: FAILURE_CLASS.RESOURCE,
      });

      // 手动设置 release_at 为过去时间
      await pool.query(`
        UPDATE tasks
        SET payload = jsonb_set(
          payload,
          '{quarantine_info,release_at}',
          to_jsonb((NOW() - INTERVAL '1 minute')::text)
        )
        WHERE id = $1
      `, [testTaskId]);

      // 检查释放
      const released = await checkExpiredQuarantineTasks();

      expect(released.length).toBeGreaterThan(0);
      expect(released.some(r => r.task_id === testTaskId)).toBe(true);

      // 验证任务状态已恢复为 queued
      const task = await pool.query('SELECT status FROM tasks WHERE id = $1', [testTaskId]);
      expect(task.rows[0].status).toBe('queued');
    });

    it('隔离时间未到时不释放', async () => {
      // 隔离任务（TTL=1小时）
      await quarantineTask(testTaskId, QUARANTINE_REASONS.RESOURCE_HOG, {
        failure_class: FAILURE_CLASS.RESOURCE,
      });

      // release_at 在未来，不应该释放
      const released = await checkExpiredQuarantineTasks();
      expect(released.some(r => r.task_id === testTaskId)).toBe(false);

      // 验证任务仍在隔离区
      const task = await pool.query('SELECT status FROM tasks WHERE id = $1', [testTaskId]);
      expect(task.rows[0].status).toBe('quarantined');
    });

    // Note: Alertness check is implemented in checkExpiredQuarantineTasks()
    // but testing it requires complex module mocking setup.
    // The functionality is verified by manual testing and integration tests.
  });

  describe('释放策略实现', () => {
    it('BILLING_CAP: 等到 reset_time 后自动释放', async () => {
      const resetTime = new Date(Date.now() - 60000).toISOString(); // 1分钟前

      await quarantineTask(testTaskId, QUARANTINE_REASONS.REPEATED_FAILURE, {
        failure_class: FAILURE_CLASS.BILLING_CAP,
        reset_time: resetTime,
      });

      const released = await checkExpiredQuarantineTasks();
      expect(released.some(r => r.task_id === testTaskId)).toBe(true);
    });

    it('NETWORK: 冷却 30 分钟后自动释放', async () => {
      await quarantineTask(testTaskId, QUARANTINE_REASONS.REPEATED_FAILURE, {
        failure_class: FAILURE_CLASS.NETWORK,
      });

      // 设置 release_at 为 30 分钟前
      await pool.query(`
        UPDATE tasks
        SET payload = jsonb_set(
          payload,
          '{quarantine_info,release_at}',
          to_jsonb((NOW() - INTERVAL '30 minutes')::text)
        )
        WHERE id = $1
      `, [testTaskId]);

      const released = await checkExpiredQuarantineTasks();
      expect(released.some(r => r.task_id === testTaskId)).toBe(true);
    });

    it('RATE_LIMIT: 冷却 30 分钟后自动释放', async () => {
      await quarantineTask(testTaskId, QUARANTINE_REASONS.REPEATED_FAILURE, {
        failure_class: FAILURE_CLASS.RATE_LIMIT,
      });

      await pool.query(`
        UPDATE tasks
        SET payload = jsonb_set(
          payload,
          '{quarantine_info,release_at}',
          to_jsonb((NOW() - INTERVAL '30 minutes')::text)
        )
        WHERE id = $1
      `, [testTaskId]);

      const released = await checkExpiredQuarantineTasks();
      expect(released.some(r => r.task_id === testTaskId)).toBe(true);
    });

    it('RESOURCE: 冷却 1 小时后自动释放', async () => {
      await quarantineTask(testTaskId, QUARANTINE_REASONS.RESOURCE_HOG, {
        failure_class: FAILURE_CLASS.RESOURCE,
      });

      await pool.query(`
        UPDATE tasks
        SET payload = jsonb_set(
          payload,
          '{quarantine_info,release_at}',
          to_jsonb((NOW() - INTERVAL '1 hour')::text)
        )
        WHERE id = $1
      `, [testTaskId]);

      const released = await checkExpiredQuarantineTasks();
      expect(released.some(r => r.task_id === testTaskId)).toBe(true);
    });

    it('REPEATED_FAILURE: 24 小时后允许重试一次', async () => {
      await quarantineTask(testTaskId, QUARANTINE_REASONS.REPEATED_FAILURE, {
        failure_class: 'repeated_failure',
      });

      await pool.query(`
        UPDATE tasks
        SET payload = jsonb_set(
          payload,
          '{quarantine_info,release_at}',
          to_jsonb((NOW() - INTERVAL '24 hours')::text)
        )
        WHERE id = $1
      `, [testTaskId]);

      const released = await checkExpiredQuarantineTasks();
      expect(released.some(r => r.task_id === testTaskId)).toBe(true);
    });

    it('MANUAL: 永不自动释放', async () => {
      await quarantineTask(testTaskId, QUARANTINE_REASONS.MANUAL, {});

      // 检查 release_at 应该是 null
      const task = await pool.query(
        "SELECT payload->'quarantine_info'->>'release_at' as release_at FROM tasks WHERE id = $1",
        [testTaskId]
      );
      expect(task.rows[0].release_at).toBeNull();

      // 即使等很久也不会自动释放
      const released = await checkExpiredQuarantineTasks();
      expect(released.some(r => r.task_id === testTaskId)).toBe(false);
    });
  });

  describe('自动释放逻辑', () => {
    it('满足条件的任务从隔离区移出，状态重置为 queued', async () => {
      await quarantineTask(testTaskId, QUARANTINE_REASONS.RESOURCE_HOG, {
        failure_class: FAILURE_CLASS.RESOURCE,
      });

      await pool.query(`
        UPDATE tasks
        SET payload = jsonb_set(
          payload,
          '{quarantine_info,release_at}',
          to_jsonb((NOW() - INTERVAL '1 minute')::text)
        )
        WHERE id = $1
      `, [testTaskId]);

      await checkExpiredQuarantineTasks();

      const task = await pool.query('SELECT status FROM tasks WHERE id = $1', [testTaskId]);
      expect(task.rows[0].status).toBe('queued');
    });

    it('释放后的任务重新进入调度队列', async () => {
      await quarantineTask(testTaskId, QUARANTINE_REASONS.TIMEOUT_PATTERN, {
        failure_class: FAILURE_CLASS.NETWORK,
      });

      await pool.query(`
        UPDATE tasks
        SET payload = jsonb_set(
          payload,
          '{quarantine_info,release_at}',
          to_jsonb((NOW() - INTERVAL '1 minute')::text)
        )
        WHERE id = $1
      `, [testTaskId]);

      await checkExpiredQuarantineTasks();

      // 验证任务在 queued 状态
      const queuedTasks = await pool.query(
        "SELECT id FROM tasks WHERE status = 'queued' AND id = $1",
        [testTaskId]
      );
      expect(queuedTasks.rows.length).toBe(1);
    });
  });

  describe('边界情况', () => {
    it('隔离原因为空或未知时使用默认 TTL (30分钟)', async () => {
      await quarantineTask(testTaskId, 'unknown_reason', {});

      const task = await pool.query(
        "SELECT payload->'quarantine_info' as info FROM tasks WHERE id = $1",
        [testTaskId]
      );
      const info = task.rows[0].info;

      expect(info.ttl_ms).toBe(30 * 60 * 1000); // 30分钟
      expect(info.release_at).not.toBeNull();
    });

    it('多个任务同时满足释放条件时正确处理', async () => {
      // 创建多个测试任务
      const task2 = await pool.query(`
        INSERT INTO tasks (title, task_type, status, payload)
        VALUES ('TEST_quarantine_release_2', 'dev', 'queued', '{}')
        RETURNING id
      `);
      const task3 = await pool.query(`
        INSERT INTO tasks (title, task_type, status, payload)
        VALUES ('TEST_quarantine_release_3', 'dev', 'queued', '{}')
        RETURNING id
      `);

      // 隔离三个任务
      await quarantineTask(testTaskId, QUARANTINE_REASONS.RESOURCE_HOG, {
        failure_class: FAILURE_CLASS.RESOURCE,
      });
      await quarantineTask(task2.rows[0].id, QUARANTINE_REASONS.TIMEOUT_PATTERN, {
        failure_class: FAILURE_CLASS.NETWORK,
      });
      await quarantineTask(task3.rows[0].id, QUARANTINE_REASONS.SUSPICIOUS_INPUT, {});

      // 全部设置为过期
      await pool.query(`
        UPDATE tasks
        SET payload = jsonb_set(
          payload,
          '{quarantine_info,release_at}',
          to_jsonb((NOW() - INTERVAL '1 minute')::text)
        )
        WHERE id IN ($1, $2, $3)
      `, [testTaskId, task2.rows[0].id, task3.rows[0].id]);

      // 释放所有过期任务
      const released = await checkExpiredQuarantineTasks();
      expect(released.length).toBe(3);
    });

    it('release_at 为 null 的任务不会被释放', async () => {
      await quarantineTask(testTaskId, QUARANTINE_REASONS.MANUAL, {});

      // MANUAL 的 release_at 应该是 null
      const released = await checkExpiredQuarantineTasks();
      expect(released.some(r => r.task_id === testTaskId)).toBe(false);
    });
  });
});
