/**
 * actions.js domain/owner_role 自动填充测试
 *
 * 验证 createTask() 在未显式传入 domain/owner_role 时能自动检测填充，
 * 以及显式传入时优先使用传入值。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// Mock broadcastTaskState
vi.mock('../task-updater.js', () => ({ broadcastTaskState: vi.fn().mockResolvedValue(undefined) }));

// Mock domain-map.js (让我们控制返回值，同时也测试真实行为)
const { createTask } = await import('../actions.js');

describe('createTask — domain/owner_role 自动填充', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('title 含 Brain 关键词 → 自动检测为 agent_ops + vp_agent_ops', async () => {
    const fakeTask = { id: 'task-1', title: 'Brain 调度优化', status: 'queued', domain: 'agent_ops', owner_role: 'vp_agent_ops' };
    mockQuery.mockResolvedValueOnce({ rows: [] }); // dedup check
    mockQuery.mockResolvedValueOnce({ rows: [fakeTask] }); // INSERT

    const result = await createTask({
      title: 'Brain 调度优化',
      goal_id: 'goal-1',
      task_type: 'dev',
      trigger_source: 'brain_auto',
    });

    expect(result.success).toBe(true);

    // 验证 INSERT 语句包含 domain 和 owner_role 参数
    const insertCall = mockQuery.mock.calls[1];
    const insertParams = insertCall[1];
    // domain 在第 12 个参数（index 11），owner_role 在第 13 个参数（index 12）
    expect(insertParams[11]).toBe('agent_ops');
    expect(insertParams[12]).toBe('vp_agent_ops');
  });

  it('title 含 bug 关键词 → 自动检测为 coding + cto', async () => {
    const fakeTask = { id: 'task-2', title: '修复登录 bug', status: 'queued', domain: 'coding', owner_role: 'cto' };
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

    await createTask({
      title: '修复登录 bug',
      goal_id: 'goal-1',
      task_type: 'dev',
      trigger_source: 'manual',
    });

    const insertParams = mockQuery.mock.calls[1][1];
    expect(insertParams[11]).toBe('coding');
    expect(insertParams[12]).toBe('cto');
  });

  it('显式传入 domain/owner_role 时优先使用传入值', async () => {
    const fakeTask = { id: 'task-3', title: '修复 bug', status: 'queued', domain: 'quality', owner_role: 'vp_qa' };
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

    await createTask({
      title: '修复 bug',
      goal_id: 'goal-1',
      task_type: 'dev',
      trigger_source: 'manual',
      domain: 'quality',
      owner_role: 'vp_qa',
    });

    const insertParams = mockQuery.mock.calls[1][1];
    expect(insertParams[11]).toBe('quality');
    expect(insertParams[12]).toBe('vp_qa');
  });

  it('INSERT 语句包含 domain 和 owner_role 列', async () => {
    const fakeTask = { id: 'task-4', title: '测试', status: 'queued' };
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

    await createTask({
      title: '测试任务',
      goal_id: 'goal-1',
      task_type: 'dev',
      trigger_source: 'manual',
    });

    const insertSql = mockQuery.mock.calls[1][0];
    expect(insertSql).toContain('domain');
    expect(insertSql).toContain('owner_role');
    expect(insertSql).toContain('$12');
    expect(insertSql).toContain('$13');
  });
});
