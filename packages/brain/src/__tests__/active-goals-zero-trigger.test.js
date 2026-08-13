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
  const taskCreator = vi.fn().mockResolvedValue({ task: { id: insertId } });
  const pool = {
    query: vi.fn().mockImplementation(async (sql, params) => {
      calls.push({ sql: sql.trim(), params });
      const s = sql.trim();

      if (s.includes('FROM objectives') && s.includes("status IN ('active', 'in_progress')")) {
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
  return { pool, calls, taskCreator };
}

describe('maybeTriggerStrategySession', () => {
  it('active_goals > 0 时不创建任务', async () => {
    const { pool, taskCreator } = makePool({ activeGoals: 3 });
    const res = await maybeTriggerStrategySession(pool, taskCreator);
    expect(res.created).toBe(false);
    expect(res.reason).toBe('active_goals_present');
    // 不应该执行 INSERT
    expect(taskCreator).not.toHaveBeenCalled();
  });

  it('active_goals = 0 且无活跃 / 冷却中的 strategy_session → 创建新任务', async () => {
    const { pool, taskCreator } = makePool({ activeGoals: 0, activeSession: [], recentSession: [] });
    const res = await maybeTriggerStrategySession(pool, taskCreator);
    expect(res.created).toBe(true);
    expect(res.taskId).toBe('new-task-uuid');

    expect(taskCreator).toHaveBeenCalledWith(expect.objectContaining({
      db: pool,
      task_type: 'strategy_session',
      priority: 'P0',
      trigger_source: 'active_goals_zero',
    }));
  });

  it('已有 queued strategy_session → 跳过（幂等）', async () => {
    const { pool, taskCreator } = makePool({
      activeGoals: 0,
      activeSession: [{ id: 'existing-queued' }],
    });
    const res = await maybeTriggerStrategySession(pool, taskCreator);
    expect(res.created).toBe(false);
    expect(res.reason).toBe('strategy_session_already_active');
    expect(taskCreator).not.toHaveBeenCalled();
  });

  it('已有 in_progress strategy_session → 跳过（幂等）', async () => {
    const { pool, taskCreator } = makePool({
      activeGoals: 0,
      activeSession: [{ id: 'existing-running' }],
    });
    const res = await maybeTriggerStrategySession(pool, taskCreator);
    expect(res.created).toBe(false);
    expect(res.reason).toBe('strategy_session_already_active');
    expect(taskCreator).not.toHaveBeenCalled();
  });

  it('24h 内已派发过 strategy_session → 跳过（冷却）', async () => {
    const { pool, taskCreator } = makePool({
      activeGoals: 0,
      activeSession: [],
      recentSession: [{ id: 'recent-completed' }],
    });
    const res = await maybeTriggerStrategySession(pool, taskCreator);
    expect(res.created).toBe(false);
    expect(res.reason).toBe('recent_strategy_session_in_cooldown');
    expect(taskCreator).not.toHaveBeenCalled();
  });

  it('payload 包含 learning_id 与触发来源（可追溯到 Cortex Insight）', async () => {
    const { pool, taskCreator } = makePool({ activeGoals: 0 });
    await maybeTriggerStrategySession(pool, taskCreator);
    const payload = taskCreator.mock.calls[0][0].payload;
    expect(payload.reason).toBe('active_goals_zero');
    expect(payload.learning_id).toBe('7670a6c3-0455-4831-b1f8-a487a38071fa');
  });
});

// ─── 回归：objectives 状态枚举漂移（2026-07-06 生产实况误触发，P1-PR2 修复）──────
// 生产 objectives 表的活跃枚举是 'active'（active/archived/cancelled），不是 'in_progress'。
// 旧 gate 只查 in_progress → 永远数到 0 → 有活跃 OKR 也误触发 P0 战略会。
describe('枚举漂移回归（judgment point：什么算活跃 OKR）', () => {
  it("生产实况：2 条 status='active' 的 objectives 存在时，不得触发战略会", async () => {
    const pool = {
      query: vi.fn().mockImplementation(async (sql) => {
        const s = sql.trim();
        if (s.includes('FROM objectives')) {
          // 模拟真实库：只有当查询把 'active' 计入活跃时才能数到 2
          const countsActiveEnum = s.includes("'active'");
          return { rows: [{ cnt: countsActiveEnum ? '2' : '0' }] };
        }
        if (s.includes('INSERT INTO tasks')) {
          return { rows: [{ id: 'should-not-happen' }] };
        }
        return { rows: [] };
      }),
    };
    const taskCreator = vi.fn();
    const result = await maybeTriggerStrategySession(pool, taskCreator);
    expect(result).toEqual({ created: false, reason: 'active_goals_present' });
    expect(taskCreator).not.toHaveBeenCalled();
  });
});

// ─── line_ledger 上下文注入（Task 9）────────────────────────────────────────
describe('maybeTriggerStrategySession — payload 携带 line_context', () => {
  it('active_goals=0 时建任务，payload.line_context 来自 line_ledger digest', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM objectives/.test(sql)) return { rows: [{ cnt: '0' }] };
        if (/task_type = 'strategy_session'/.test(sql)) return { rows: [] };
        if (/FROM design_docs/.test(sql)) return { rows: [{ title: 'Line A — 24h 账本', content: '摘要A' }] };
        if (/INSERT INTO tasks/.test(sql)) return { rows: [{ id: 'task-1' }] };
        return { rows: [] };
      }),
    };
    const taskCreator = vi.fn().mockResolvedValue({ task: { id: 'task-1' } });
    await maybeTriggerStrategySession(pool, taskCreator);
    const payload = taskCreator.mock.calls[0][0].payload;
    expect(payload.line_context).toContain('Line A — 24h 账本');
  });
});
