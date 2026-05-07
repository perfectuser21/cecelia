/**
 * active-goals-zero-trigger 单元测试
 *
 * 验证：当 active_goals=0（无 in_progress objective），且无活跃 / 24h 内冷却中的
 * strategy_session 任务时，立即派发新 strategy_session 任务（高优先级、原因可追溯）。
 *
 * 对应 Cortex Insight: 7670a6c3-0455-4831-b1f8-a487a38071fa
 *   "active_goals=0 是方向性崩溃前置信号，OKR 全部完成时应立即触发新 OKR 创建，
 *    不能等任务堆积后才重建"
 */

import { describe, it, expect, vi } from 'vitest';

import { maybeTriggerStrategySession } from '../active-goals-zero-trigger.js';

function makePool({
  activeGoals = 0,
  activeSession = [],
  recentSession = [],
  insertId = 'new-task-uuid',
} = {}) {
  const calls = [];
  const pool = {
    query: vi.fn().mockImplementation(async (sql, params) => {
      calls.push({ sql: sql.trim(), params });
      const s = sql.trim();

      if (s.includes('FROM objectives') && s.includes("status = 'in_progress'")) {
        return { rows: [{ cnt: String(activeGoals) }] };
      }

      if (
        s.includes('FROM tasks') &&
        s.includes("task_type = 'strategy_session'") &&
        s.includes("status IN ('queued', 'in_progress')")
      ) {
        return { rows: activeSession };
      }

      if (
        s.includes('FROM tasks') &&
        s.includes("task_type = 'strategy_session'") &&
        s.includes('created_at')
      ) {
        return { rows: recentSession };
      }

      if (s.includes('INSERT INTO tasks') && s.includes('strategy_session')) {
        return { rows: [{ id: insertId }] };
      }

      return { rows: [], rowCount: 0 };
    }),
  };
  return { pool, calls };
}

describe('maybeTriggerStrategySession', () => {
  it('active_goals > 0 时不创建任务', async () => {
    const { pool, calls } = makePool({ activeGoals: 3 });
    const res = await maybeTriggerStrategySession(pool);
    expect(res.created).toBe(false);
    expect(res.reason).toBe('active_goals_present');
    // 不应该执行 INSERT
    expect(calls.find(c => c.sql.includes('INSERT INTO tasks'))).toBeUndefined();
  });

  it('active_goals = 0 且无活跃 / 冷却中的 strategy_session → 创建新任务', async () => {
    const { pool, calls } = makePool({ activeGoals: 0, activeSession: [], recentSession: [] });
    const res = await maybeTriggerStrategySession(pool);
    expect(res.created).toBe(true);
    expect(res.taskId).toBe('new-task-uuid');

    // 验证 INSERT 执行了，且关键字段正确
    const insert = calls.find(c => c.sql.includes('INSERT INTO tasks'));
    expect(insert).toBeDefined();
    expect(insert.sql).toMatch(/strategy_session/);
    expect(insert.sql).toMatch(/'queued'/);
    // 高优先级 P0 — 方向性崩溃前置信号
    expect(insert.sql).toMatch(/'P0'/);
    // 触发源标记，可追溯
    expect(insert.sql).toMatch(/active_goals_zero/);
  });

  it('已有 queued strategy_session → 跳过（幂等）', async () => {
    const { pool, calls } = makePool({
      activeGoals: 0,
      activeSession: [{ id: 'existing-queued' }],
    });
    const res = await maybeTriggerStrategySession(pool);
    expect(res.created).toBe(false);
    expect(res.reason).toBe('strategy_session_already_active');
    expect(calls.find(c => c.sql.includes('INSERT INTO tasks'))).toBeUndefined();
  });

  it('已有 in_progress strategy_session → 跳过（幂等）', async () => {
    const { pool, calls } = makePool({
      activeGoals: 0,
      activeSession: [{ id: 'existing-running' }],
    });
    const res = await maybeTriggerStrategySession(pool);
    expect(res.created).toBe(false);
    expect(res.reason).toBe('strategy_session_already_active');
    expect(calls.find(c => c.sql.includes('INSERT INTO tasks'))).toBeUndefined();
  });

  it('24h 内已派发过 strategy_session → 跳过（冷却）', async () => {
    const { pool, calls } = makePool({
      activeGoals: 0,
      activeSession: [],
      recentSession: [{ id: 'recent-completed' }],
    });
    const res = await maybeTriggerStrategySession(pool);
    expect(res.created).toBe(false);
    expect(res.reason).toBe('recent_strategy_session_in_cooldown');
    expect(calls.find(c => c.sql.includes('INSERT INTO tasks'))).toBeUndefined();
  });

  it('payload 包含 learning_id 与触发来源（可追溯到 Cortex Insight）', async () => {
    const { pool, calls } = makePool({ activeGoals: 0 });
    await maybeTriggerStrategySession(pool);
    const insert = calls.find(c => c.sql.includes('INSERT INTO tasks'));
    const payloadParam = insert.params.find(p => typeof p === 'string' && p.includes('learning_id'));
    expect(payloadParam).toBeDefined();
    const payload = JSON.parse(payloadParam);
    expect(payload.reason).toBe('active_goals_zero');
    expect(payload.learning_id).toBe('7670a6c3-0455-4831-b1f8-a487a38071fa');
  });
});
