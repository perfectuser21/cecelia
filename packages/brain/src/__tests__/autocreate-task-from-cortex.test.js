import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreateTask, mockQuery } = vi.hoisted(() => ({
  mockCreateTask: vi.fn(),
  mockQuery: vi.fn(() => { throw new Error('未配置的数据库访问'); }),
}));
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../actions.js', () => ({ createTask: mockCreateTask, updateTask: vi.fn() }));
vi.mock('../lib/task-terminal.js', () => ({ finalizeTask: vi.fn() }));
vi.mock('../quarantine.js', () => ({ handleTaskFailure: vi.fn() }));
vi.mock('../slot-allocator.js', () => ({ shouldBypassBackpressure: vi.fn() }));
import { autoCreateTasksFromCortex } from '../dispatch-helpers.js';

beforeEach(() => {
  mockCreateTask.mockReset();
  mockCreateTask.mockRejectedValue(new Error('未配置的任务写入'));
  mockQuery.mockClear();
});

// ---- 测试套件 ----
describe('autoCreateTasksFromCortex', () => {
  it('无 create_task 建议时返回 empty 数组', async () => {
    const rcaResult = {
      recommended_actions: [
        { type: 'adjust_strategy', params: { key: 'retry.max_attempts', new_value: 5 } },
        { type: 'record_learning', params: {} },
      ],
    };

    const result = await autoCreateTasksFromCortex(rcaResult, {});
    expect(result).toEqual([]);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('有 create_task 建议时调用 createTask()', async () => {
    mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'task-001' }, deduplicated: false });

    const rcaResult = {
      recommended_actions: [
        {
          type: 'create_task',
          params: { title: '修复任务超时问题', task_type: 'dev', priority: 'P1' },
        },
      ],
    };

    const result = await autoCreateTasksFromCortex(rcaResult, { goal_id: 'goal-123' });

    expect(mockCreateTask).toHaveBeenCalledWith({
      title: '修复任务超时问题',
      description: '',
      priority: 'P1',
      task_type: 'dev',
      trigger_source: 'cortex',
      goal_id: 'goal-123',
      project_id: null,
    });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('修复任务超时问题');
    expect(result[0].deduplicated).toBe(false);
  });

  it('dedup：createTask 返回 deduplicated: true 时正常处理', async () => {
    const existingTask = { id: 'existing-001', title: '修复内存泄漏', status: 'queued' };
    mockCreateTask.mockResolvedValueOnce({ success: true, task: existingTask, deduplicated: true });

    const rcaResult = {
      recommended_actions: [
        { type: 'create_task', params: { title: '修复内存泄漏', task_type: 'dev' } },
      ],
    };

    const result = await autoCreateTasksFromCortex(rcaResult, {});
    expect(result).toHaveLength(1);
    expect(result[0].deduplicated).toBe(true);
    // 不应该抛出错误
  });

  it('createTask 抛出 error 时只 log，不崩溃，跳过该条目', async () => {
    mockCreateTask.mockRejectedValueOnce(new Error('DB error'));

    const rcaResult = {
      recommended_actions: [
        { type: 'create_task', params: { title: '失败的创建任务' } },
      ],
    };

    // 不应该抛出异常
    const result = await autoCreateTasksFromCortex(rcaResult, {});
    expect(result).toHaveLength(0); // 失败的任务被跳过
  });

  it('多个 create_task 建议时全部处理', async () => {
    mockCreateTask
      .mockResolvedValueOnce({ success: true, task: { id: 't1' }, deduplicated: false })
      .mockResolvedValueOnce({ success: true, task: { id: 't2' }, deduplicated: false });

    const rcaResult = {
      recommended_actions: [
        { type: 'create_task', params: { title: '任务 A', task_type: 'dev' } },
        { type: 'adjust_strategy', params: {} },
        { type: 'create_task', params: { title: '任务 B', task_type: 'research' } },
      ],
    };

    const result = await autoCreateTasksFromCortex(rcaResult, {});
    expect(result).toHaveLength(2);
    expect(mockCreateTask).toHaveBeenCalledTimes(2);
  });

  it('缺少 title 的 create_task 建议被过滤', async () => {
    const rcaResult = {
      recommended_actions: [
        { type: 'create_task', params: { description: '没有标题' } }, // 无 title
      ],
    };

    const result = await autoCreateTasksFromCortex(rcaResult, {});
    expect(result).toHaveLength(0);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });
});

describe('Cortex 自动建单的来源字段', () => {
  it('无父级上下文时将 cortex 来源及空关联传入 createTask', async () => {
    mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'sys-task' }, deduplicated: false });

    const rcaResult = {
      recommended_actions: [
        { type: 'create_task', params: { title: '系统任务', task_type: 'research' } },
      ],
    };

    const result = await autoCreateTasksFromCortex(rcaResult, {});
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ trigger_source: 'cortex', goal_id: null, project_id: null })
    );
    expect(result).toHaveLength(1);
  });
});

describe('真实 Cortex 建单上下文与故障隔离', () => {
  it('建议参数优先于父级上下文，缺省项继承父级', async () => {
    mockCreateTask.mockResolvedValue({ deduplicated: false });
    const result = await autoCreateTasksFromCortex({ recommended_actions: [
      { type: 'create_task', params: { title: '覆盖', description: '真实描述', priority: 'P0', task_type: 'research', goal_id: 'own-goal', project_id: 'own-project' } },
      { type: 'create_task', params: { title: '继承' } },
    ] }, { goal_id: 'parent-goal', project_id: 'parent-project' });
    expect(mockCreateTask).toHaveBeenNthCalledWith(1, { title: '覆盖', description: '真实描述', priority: 'P0', task_type: 'research', trigger_source: 'cortex', goal_id: 'own-goal', project_id: 'own-project' });
    expect(mockCreateTask).toHaveBeenNthCalledWith(2, { title: '继承', description: '', priority: 'P1', task_type: 'dev', trigger_source: 'cortex', goal_id: 'parent-goal', project_id: 'parent-project' });
    expect(result).toEqual([{ title: '覆盖', deduplicated: false }, { title: '继承', deduplicated: false }]);
  });

  it('第一项失败后继续建第二项，返回值只包含成功项', async () => {
    mockCreateTask.mockRejectedValueOnce(new Error('fixture_write_failed')).mockResolvedValueOnce({ deduplicated: true });
    const result = await autoCreateTasksFromCortex({ recommended_actions: [
      { type: 'create_task', params: { title: '失败' } },
      { type: 'create_task', params: { title: '成功' } },
    ] });
    expect(mockCreateTask).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ title: '成功', deduplicated: true }]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
