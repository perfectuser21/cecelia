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

const COOLDOWN_HOURS = 24;
const LEARNING_ID = '7670a6c3-0455-4831-b1f8-a487a38071fa';

/**
 * 当 active_goals=0 时派发 strategy_session 任务。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ created: boolean, taskId?: string, reason?: string }>}
 */
export async function maybeTriggerStrategySession(pool) {
  const goalsResult = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM objectives
    WHERE status = 'in_progress'
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

  const insertResult = await pool.query(`
    INSERT INTO tasks (title, description, status, priority, task_type, payload, trigger_source)
    VALUES ($1, $2, 'queued', 'P0', 'strategy_session', $3, 'active_goals_zero')
    RETURNING id
  `, [
    'active_goals=0 自救：召开战略会议生成新 OKR',
    'Brain 检测到 active_goals=0（无 in_progress objective），方向性崩溃前置信号触发。请召开战略会议产出新一轮 OKR，恢复系统目标驱动。',
    JSON.stringify({
      reason: 'active_goals_zero',
      triggered_by: 'tick-runner',
      learning_id: LEARNING_ID,
    }),
  ]);

  return { created: true, taskId: insertResult.rows[0].id };
}
