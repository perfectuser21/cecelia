/**
 * insight-action-bridge.test.js
 *
 * 测试 cortex_insight → dev task 自动闭合机制
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  containsCodeFixSignal,
  taskExistsForLearning,
  checkAndCreateTask,
  CODE_FIX_SIGNALS,
} from '../insight-action-bridge.js';

// ─────────────────────────────────────────────
// Mock db.js（避免真实数据库依赖）
// ─────────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

import pool from '../db.js';

beforeEach(() => {
  vi.resetAllMocks();
});

// ─────────────────────────────────────────────
// containsCodeFixSignal
// ─────────────────────────────────────────────

describe('containsCodeFixSignal', () => {
  it('含英文 bug → true', () => {
    expect(containsCodeFixSignal('There is a bug in the dispatch logic')).toBe(true);
  });

  it('含中文 修复 → true', () => {
    expect(containsCodeFixSignal('需要修复调度器的内存泄漏')).toBe(true);
  });

  it('含中文 没有机制 → true', () => {
    expect(containsCodeFixSignal('没有自动触发修复的机制')).toBe(true);
  });

  it('含 fix → true', () => {
    expect(containsCodeFixSignal('We should fix the timeout handling')).toBe(true);
  });

  it('纯观察性内容 → false', () => {
    expect(containsCodeFixSignal('Today is a good day, all tasks completed successfully')).toBe(false);
  });

  it('空字符串 → false', () => {
    expect(containsCodeFixSignal('')).toBe(false);
  });

  it('null → false', () => {
    expect(containsCodeFixSignal(null)).toBe(false);
  });

  it('CODE_FIX_SIGNALS 数组非空', () => {
    expect(CODE_FIX_SIGNALS.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────
// taskExistsForLearning
// ─────────────────────────────────────────────

describe('taskExistsForLearning', () => {
  it('数据库返回 row → true（已存在）', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'task-001' }] }),
    };
    const result = await taskExistsForLearning('learning-abc', mockPool);
    expect(result).toBe(true);
    expect(mockPool.query.mock.calls[0][1]).toEqual(['learning-abc']);
  });

  it('数据库返回空 rows → false（不存在）', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const result = await taskExistsForLearning('learning-xyz', mockPool);
    expect(result).toBe(false);
  });

  it('数据库抛出异常 → false（降级处理）', async () => {
    const mockPool = {
      query: vi.fn().mockRejectedValue(new Error('DB connection error')),
    };
    const result = await taskExistsForLearning('learning-err', mockPool);
    expect(result).toBe(false);
  });
});

// ─────────────────────────────────────────────
// checkAndCreateTask — 完整链路
// ─────────────────────────────────────────────

describe('checkAndCreateTask', () => {
  it('含代码修复信号 + 无重复 → 创建 task 并标记 applied', async () => {
    const mockPool = {
      query: vi.fn()
        // dedup check: 无已有 task
        .mockResolvedValueOnce({ rows: [] })
        // INSERT task
        .mockResolvedValueOnce({ rows: [{ id: 'new-task-001' }] })
        // UPDATE applied=true
        .mockResolvedValueOnce({ rowCount: 1 }),
    };

    const result = await checkAndCreateTask(
      'learning-001',
      'There is a bug in the cortex dispatch loop',
      'Cortex Insight: dispatch bug',
      mockPool
    );

    expect(result.created).toBe(true);
    expect(result.task_id).toBe('new-task-001');

    // 验证 INSERT 包含 source_learning_id
    const insertCall = mockPool.query.mock.calls[1];
    expect(insertCall[1][2]).toBe('learning-001'); // source_learning_id 参数
    expect(insertCall[1][0]).toContain('[insight-action]'); // title 前缀

    // 验证 UPDATE applied=true
    const updateCall = mockPool.query.mock.calls[2];
    expect(updateCall[1][0]).toBe('learning-001');
  });

  it('无代码修复信号 → 跳过，created=false', async () => {
    const mockPool = { query: vi.fn() };

    const result = await checkAndCreateTask(
      'learning-002',
      'All tasks completed successfully today, performance looks good',
      'Cortex Insight: daily summary',
      mockPool
    );

    expect(result.created).toBe(false);
    expect(result.reason).toBe('no_code_fix_signal');
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('已有重复 task → 跳过，created=false', async () => {
    const mockPool = {
      query: vi.fn()
        // dedup check: 已有 task
        .mockResolvedValueOnce({ rows: [{ id: 'existing-task' }] }),
    };

    const result = await checkAndCreateTask(
      'learning-003',
      'need to fix the memory leak in brain tick',
      'Cortex Insight: memory leak',
      mockPool
    );

    expect(result.created).toBe(false);
    expect(result.reason).toBe('task_already_exists');
    // 只查询了一次（dedup），没有 INSERT
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('task 创建失败 → created=false，reason=task_create_failed', async () => {
    const mockPool = {
      query: vi.fn()
        // dedup check: 无重复
        .mockResolvedValueOnce({ rows: [] })
        // INSERT 失败
        .mockRejectedValueOnce(new Error('INSERT failed')),
    };

    const result = await checkAndCreateTask(
      'learning-004',
      'fix the broken scheduler',
      'Cortex Insight: scheduler broken',
      mockPool
    );

    expect(result.created).toBe(false);
    expect(result.reason).toBe('task_create_failed');
  });

  it('applied 更新失败 → 不影响 task 创建结果', async () => {
    const mockPool = {
      query: vi.fn()
        // dedup check
        .mockResolvedValueOnce({ rows: [] })
        // INSERT task 成功
        .mockResolvedValueOnce({ rows: [{ id: 'task-005' }] })
        // UPDATE applied 失败（非致命）
        .mockRejectedValueOnce(new Error('UPDATE failed')),
    };

    const result = await checkAndCreateTask(
      'learning-005',
      'There is an issue with the retry logic',
      'Cortex Insight: retry issue',
      mockPool
    );

    expect(result.created).toBe(true);
    expect(result.task_id).toBe('task-005');
  });
});
