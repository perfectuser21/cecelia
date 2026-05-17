/**
 * Tests for suggest_task_type action
 * DoD: thalamus-suggest-task-type
 *
 * 验证：
 * 1. suggest_task_type 在 ACTION_WHITELIST 中存在
 * 2. suggest_task_type 调用后 learnings 表有记录
 * 3. suggest_task_type 不修改原 task 的 task_type
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ACTION_WHITELIST } from '../thalamus.js';
import { actionHandlers } from '../decision-executor.js';

// Mock database pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: {
    query: (...args) => mockQuery(...args),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  }
}));

// Mock actions.js
vi.mock('../actions.js', () => ({
  createTask: vi.fn().mockResolvedValue({ success: true, task: { id: 'new-task-id' } }),
  updateTask: vi.fn().mockResolvedValue({ success: true })
}));

// Mock tick.js
vi.mock('../tick.js', () => ({
  dispatchNextTask: vi.fn().mockResolvedValue({ dispatched: true, task_id: 'dispatched-task' })
}));

describe('suggest_task_type action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：INSERT INTO learnings 返回新 id
    mockQuery.mockResolvedValue({ rows: [{ id: 'learning-123' }] });
  });

  it('suggest-task-type 在 ACTION_WHITELIST 中存在', () => {
    expect(ACTION_WHITELIST['suggest_task_type']).toBeDefined();
    expect(ACTION_WHITELIST['suggest_task_type'].dangerous).toBe(false);
    expect(typeof ACTION_WHITELIST['suggest_task_type'].description).toBe('string');
  });

  it('suggest-task-type 调用后 learnings 表有记录', async () => {
    const handler = actionHandlers['suggest_task_type'];
    expect(handler).toBeDefined();

    const params = {
      task_id: 'task-abc-123',
      current_type: 'dev',
      suggested_type: 'research',
      reason: 'failure_rate > 30%，可能 task_type 选错了'
    };

    const result = await handler(params, {});

    // 验证返回值
    expect(result.action).toBe('suggested');
    expect(result.task_id).toBe('task-abc-123');
    expect(result.suggested_type).toBe('research');
    expect(result.learning_id).toBe('learning-123');

    // 验证 INSERT INTO learnings 被调用
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO learnings'),
      expect.arrayContaining([
        expect.stringContaining('task_type 建议修正'),
        expect.anything(),  // tags JSON
        'task-abc-123'      // source_task_id
      ])
    );
  });

  it('suggest-task-type 不修改原 task 的 task_type', async () => {
    const handler = actionHandlers['suggest_task_type'];

    const params = {
      task_id: 'task-xyz-456',
      current_type: 'dev',
      suggested_type: 'exploratory',
      reason: 'exploratory 任务被误判为 dev'
    };

    await handler(params, {});

    // 验证没有任何 UPDATE tasks 调用（不修改 task_type）
    const allCalls = mockQuery.mock.calls;
    const updateTaskCalls = allCalls.filter(call =>
      typeof call[0] === 'string' &&
      call[0].toLowerCase().includes('update') &&
      call[0].toLowerCase().includes('task')
    );

    expect(updateTaskCalls).toHaveLength(0);

    // 验证只有 INSERT INTO learnings 调用
    const insertCalls = allCalls.filter(call =>
      typeof call[0] === 'string' &&
      call[0].toLowerCase().includes('insert into learnings')
    );
    expect(insertCalls).toHaveLength(1);
  });
});
