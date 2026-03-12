/**
 * insight-to-task.js 单元测试
 * 覆盖：hasCodeFixSignal、triggerInsightTask（创建/去重/跳过/applied 标记）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool — hoisted
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

import { hasCodeFixSignal, triggerInsightTask } from '../insight-to-task.js';

describe('hasCodeFixSignal', () => {
  it('内容含 ≥2 个关键词时返回 true', () => {
    expect(hasCodeFixSignal('需要修复代码中的 bug')).toBe(true);
    expect(hasCodeFixSignal('fix the broken error handling')).toBe(true);
    expect(hasCodeFixSignal('重构优化这段逻辑')).toBe(true);
  });

  it('内容含 <2 个关键词时返回 false', () => {
    expect(hasCodeFixSignal('系统运行正常，观察中')).toBe(false);
    expect(hasCodeFixSignal('需要增加监控')).toBe(false);
    expect(hasCodeFixSignal('fix')).toBe(false); // 只有 1 个
  });

  it('内容为空或非字符串时返回 false', () => {
    expect(hasCodeFixSignal('')).toBe(false);
    expect(hasCodeFixSignal(null)).toBe(false);
    expect(hasCodeFixSignal(undefined)).toBe(false);
  });
});

describe('triggerInsightTask', () => {
  const mockPool = { query: mockQuery };
  const LEARNING_ID = 'test-learning-uuid-001';
  const TITLE = 'Cortex Insight: 代码存在bug需要修复';
  const CONTENT = '代码中存在多个bug，需要修复并重构相关逻辑';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('内容无代码修复信号时返回 skipped', async () => {
    const result = await triggerInsightTask(LEARNING_ID, '普通观察', '系统状态良好，继续监控', mockPool);
    expect(result).toEqual({ skipped: true, reason: 'no_code_fix_signal' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('已有 queued task 时返回 task_already_exists', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'existing-task-id' }],
    });

    const result = await triggerInsightTask(LEARNING_ID, TITLE, CONTENT, mockPool);

    expect(result).toEqual({
      skipped: true,
      reason: 'task_already_exists',
      task_id: 'existing-task-id',
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/source_learning_id.*queued.*in_progress/s);
  });

  it('无重复时创建 task 并标记 applied=true', async () => {
    // 1. dedup 查询 → 无结果
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 2. INSERT tasks → 返回新 task
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'new-task-id' }] });
    // 3. UPDATE learnings applied=true
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await triggerInsightTask(LEARNING_ID, TITLE, CONTENT, mockPool);

    expect(result).toEqual({ created: true, task_id: 'new-task-id' });
    expect(mockQuery).toHaveBeenCalledTimes(3);

    // 验证 INSERT SQL 包含关键字段
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO tasks/);
    expect(insertCall[0]).toMatch(/source_learning_id/);
    expect(insertCall[0]).toMatch(/trigger_source/);
    expect(insertCall[1][2]).toBe(LEARNING_ID); // source_learning_id 参数

    // 验证 applied 更新
    const updateCall = mockQuery.mock.calls[2];
    expect(updateCall[0]).toMatch(/UPDATE learnings.*applied.*true/s);
    expect(updateCall[1][0]).toBe(LEARNING_ID);
  });

  it('task 标题去掉 "Cortex Insight:" 前缀', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'task-id' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await triggerInsightTask(LEARNING_ID, 'Cortex Insight: 代码bug需要修复重构', CONTENT, mockPool);

    const insertCall = mockQuery.mock.calls[1];
    const taskTitle = insertCall[1][0];
    expect(taskTitle).toMatch(/^\[Insight\]/);
    expect(taskTitle).not.toMatch(/Cortex Insight:/);
  });

  it('数据库异常时返回 skipped error（不抛出）', async () => {
    // dedup 成功
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT 失败
    mockQuery.mockRejectedValueOnce(new Error('DB connection error'));

    const result = await triggerInsightTask(LEARNING_ID, TITLE, CONTENT, mockPool);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('error');
    expect(result.error).toMatch(/DB connection error/);
  });
});
