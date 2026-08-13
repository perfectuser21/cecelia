/**
 * Active Goals Zero Trigger — 方向性崩溃前置信号自救
 *
 * 当 active_goals=0（无 in_progress objective）时，立即派发一个高优 strategy_session
 * 任务自动生成新 OKR，避免系统进入"无目标空转 → 任务堆积 → 被动重建"的退化循环。
 *
 * 触发位置：tick-runner.js 在检测到 allGoalIds.length === 0 时调用。
 *
 * 幂等保护：
 *   1. 已有 queued / in_progress strategy_session → 跳过
 *   2. 24h 内已派发过任意 strategy_session（含已完成）→ 跳过冷却
 *
 * Cortex Insight: 7670a6c3-0455-4831-b1f8-a487a38071fa
 */

import { fetchAllLineLedgersDigest } from './daily-review-scheduler.js';
import { createTask } from './actions.js';

const COOLDOWN_HOURS = 24;
const LEARNING_ID = '7670a6c3-0455-4831-b1f8-a487a38071fa';

/**
 * 当 active_goals=0 时派发 strategy_session 任务。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ created: boolean, taskId?: string, reason?: string }>}
 */
export async function maybeTriggerStrategySession(pool, taskCreator = createTask) {
  // 判定点（2026-07-06 P1-PR2 修复）：什么算"活跃 OKR"——生产 objectives 枚举是
  // active/archived/cancelled；旧查询只认 in_progress，枚举漂移后有活跃 OKR 也数到 0，
  // 复活当天 60s 内即误触发 P0 战略会。兼容两种枚举。
  const goalsResult = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM objectives
    WHERE status IN ('active', 'in_progress')
  `);
  const activeGoals = parseInt(goalsResult.rows[0]?.cnt ?? '0', 10);
  if (activeGoals > 0) {
    return { created: false, reason: 'active_goals_present' };
  }

  const activeSession = await pool.query(`
    SELECT id FROM tasks
    WHERE task_type = 'strategy_session'
      AND status IN ('queued', 'in_progress')
    LIMIT 1
  `);
  if (activeSession.rows.length > 0) {
    return { created: false, reason: 'strategy_session_already_active' };
  }

  const recentSession = await pool.query(`
    SELECT id FROM tasks
    WHERE task_type = 'strategy_session'
      AND created_at >= NOW() - ($1 || ' hours')::interval
    ORDER BY created_at DESC
    LIMIT 1
  `, [String(COOLDOWN_HOURS)]);
  if (recentSession.rows.length > 0) {
    return { created: false, reason: 'recent_strategy_session_in_cooldown' };
  }

  const lineContext = await fetchAllLineLedgersDigest(pool).catch(() => '');

  const created = await taskCreator({
    db: pool,
    source: 'scheduler',
    source_id: `active-goals-zero:${new Date().toISOString().slice(0, 13)}`,
    title: 'active_goals=0 自救：召开战略会议生成新 OKR',
    description: 'Brain 检测到 active_goals=0（无 active/in_progress objective），方向性崩溃前置信号触发。请召开战略会议产出新一轮 OKR，恢复系统目标驱动。',
    priority: 'P0',
    task_type: 'strategy_session',
    trigger_source: 'active_goals_zero',
    allow_unscoped: true,
    payload: {
      reason: 'active_goals_zero',
      triggered_by: 'tick-runner',
      learning_id: LEARNING_ID,
      line_context: lineContext,
    },
  });

  return { created: true, taskId: created.task.id };
}
