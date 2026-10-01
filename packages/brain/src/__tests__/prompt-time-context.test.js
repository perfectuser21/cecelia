/**
 * Executor Prompt 时间上下文注入测试
 *
 * DoD 覆盖: D1-D4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock task-router.js
vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  getTaskLocation: vi.fn(() => 'us'),
  isValidTaskType: vi.fn(() => true),
  getSkillForTaskType: vi.fn(() => '/okr'),
  getPermissionModeForTaskType: vi.fn(() => 'bypassPermissions'),
}));

import { buildTimeContext, preparePrompt } from '../executor.js';
import pool from '../db.js';

describe('buildTimeContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('D1: 返回包含 KR 剩余天数的时间上下文', async () => {
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    pool.query = vi.fn(async (sql) => {
      if (sql.includes('FROM objectives')) {
        return { rows: [{ title: 'KR-1', target_date: futureDate, time_budget_days: null }] };
      }
      if (sql.includes('FROM projects')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await buildTimeContext('kr-1');
    expect(result).toContain('时间上下文');
    expect(result).toContain('KR 目标日期');
    expect(result).toContain('KR 剩余天数');
    expect(result).toContain('所有 Project 的 time_budget_days 之和不应超过 KR 剩余天数');
  });

  it('D2: 返回包含顺序提示的上下文', async () => {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    pool.query = vi.fn(async (sql) => {
      if (sql.includes('FROM objectives')) {
        return { rows: [{ title: 'KR-1', target_date: null, time_budget_days: null }] };
      }
      if (sql.includes('FROM projects')) {
        return {
          rows: [
            {
              id: 'proj-1', name: 'Project 1', status: 'completed', sequence_order: 1,
              time_budget_days: 14, created_at: tenDaysAgo.toISOString(), completed_at: now.toISOString(),
            },
            {
              id: 'proj-2', name: 'Project 2', status: 'planning', sequence_order: 2,
              time_budget_days: 14, created_at: null, completed_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await buildTimeContext('kr-1');
    expect(result).toContain('顺序提示');
    expect(result).toContain('这是第 2/3 个 Project');
    expect(result).toContain('1/2 完成');
    expect(result).toContain('[completed] Project 1 (序号 1), 预算 14 天, 实际 10 天');
    expect(result).toContain('[planning] Project 2 (序号 2), 预算 14 天');
    const projectRead = pool.query.mock.calls.find(([sql]) => sql.includes('FROM projects'));
    expect(projectRead[1]).toEqual(['kr-1']);
    expect(projectRead[0]).toContain("op.metadata->>'sequence_order'");
    expect(projectRead[0]).toContain("op.metadata->>'time_budget_days'");
  });

  it('D3: 返回包含已完成 Project 摘要的上下文', async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    pool.query = vi.fn(async (sql) => {
      if (sql.includes('FROM objectives')) {
        return { rows: [{ title: 'KR-1', target_date: null, time_budget_days: null }] };
      }
      if (sql.includes('FROM projects')) {
        return {
          rows: [{
            id: 'proj-1', name: 'Project Alpha', status: 'completed', sequence_order: 1,
            time_budget_days: 14, created_at: sevenDaysAgo.toISOString(), completed_at: now.toISOString(),
          }],
        };
      }
      return { rows: [] };
    });

    const result = await buildTimeContext('kr-1');
    expect(result).toContain('[completed] Project Alpha');
    expect(result).toContain('实际 7 天');
    expect(result).toContain('前 1 个已完成');
    const projectRead = pool.query.mock.calls.find(([sql]) => sql.includes('FROM projects'));
    expect(projectRead[0]).toContain('MAX(t.completed_at)');
    expect(projectRead[0]).toContain('t.project_id = op.id');
    expect(projectRead[0]).toContain("t.task_type <> 'project'");
  });

  it('D4: 返回包含 sequence_order 约束的上下文', async () => {
    pool.query = vi.fn(async (sql) => {
      if (sql.includes('FROM objectives')) {
        return { rows: [{ title: 'KR-1', target_date: null, time_budget_days: null }] };
      }
      if (sql.includes('FROM projects')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await buildTimeContext('kr-1');
    expect(result).toContain('sequence_order');
    expect(result).toContain('time_budget_days');
    expect(result).toContain('约束');
  });

  it('krId 为空 → 返回空字符串', async () => {
    const result = await buildTimeContext('');
    expect(result).toBe('');
  });

  it('KR 不存在 → 返回空字符串', async () => {
    pool.query = vi.fn(async () => ({ rows: [] }));
    const result = await buildTimeContext('nonexistent');
    expect(result).toBe('');
  });

  it('DB 查询异常 → 返回空字符串（non-fatal）', async () => {
    pool.query = vi.fn(async () => { throw new Error('DB down'); });
    const result = await buildTimeContext('kr-1');
    expect(result).toBe('');
  });

  it('紧急标记：KR 剩余 < 7 天时显示警告', async () => {
    const threeDaysLater = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    pool.query = vi.fn(async (sql) => {
      if (sql.includes('FROM objectives')) {
        return { rows: [{ title: 'KR-1', target_date: threeDaysLater, time_budget_days: null }] };
      }
      if (sql.includes('FROM projects')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await buildTimeContext('kr-1');
    expect(result).toContain('紧急');
  });
});

describe('preparePrompt with time context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('OKR 拆解 prompt 包含时间上下文 section', async () => {
    pool.query = vi.fn(async (sql) => {
      if (sql.includes('FROM objectives')) {
        return { rows: [{ title: 'KR-1', target_date: new Date(Date.now() + 14 * 86400000).toISOString(), time_budget_days: null }] };
      }
      if (sql.includes('FROM projects')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const prompt = await preparePrompt({
      task_type: 'dev',
      goal_id: 'kr-1',
      title: 'OKR 拆解: Test KR',
      description: 'Test KR Description',
      payload: { decomposition: 'true' },
    });

    expect(prompt).toContain('时间上下文');
    expect(prompt).toContain('/decomp');
    expect(prompt).toContain('OKR 拆解: Test KR');
  });

  it('continue 拆解不注入时间上下文', async () => {
    const prompt = await preparePrompt({
      task_type: 'dev',
      goal_id: 'kr-1',
      title: '继续拆解: Test',
      project_id: 'project-1',
      description: 'Continue',
      payload: {
        decomposition: 'continue',
        initiative_id: 'init-1',
        previous_result: 'Some result',
      },
    });

    // 继续棒明确挂原 Project，携带前棒事实；旧子层 ID 不决定新归属。
    expect(prompt).toContain('GET /api/brain/projects/project-1');
    expect(prompt).toContain('Some result');
    expect(prompt).toContain('"project_id": "project-1"');
    expect(prompt).not.toContain('init-1');
    expect(prompt).not.toContain('POST /api/brain/action/create-project');
    expect(prompt).not.toContain('时间上下文');
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('FROM projects'))).toBe(false);
  });
});
