/**
 * Goal Evaluator - Outer Loop
 *
 * Magentic-One 外层评估循环：定期评估每个活跃 KR/Goal 的整体进展，
 * 判断当前计划是否有效，必要时触发重新规划。
 *
 * 与 Progress Ledger（inner loop，评估单个任务步骤）的区别：
 * - Inner loop：微观，每步评估任务执行细节
 * - Outer loop：宏观，评估整个 KR 是否在轨
 *
 * @module goal-evaluator
 */

import pool from './db.js';

const EVAL_WINDOW_DAYS = 7;           // 评估窗口：7天
const STALL_THRESHOLD_DAYS = 7;       // 停滞判定：7天无进展
const COMPLETION_RATE_GOOD = 0.5;     // 良好完成率阈值
const FAILURE_RATE_BAD = 0.4;         // 失败率警戒阈值

// 测试支持：允许重置最后评估时间
let _lastEvalTimes = {}; // { goal_id: timestamp }

export function _resetGoalEvalTimes() {
  _lastEvalTimes = {};
}

export function _getGoalEvalTimes() {
  return { ..._lastEvalTimes };
}

/**
 * 获取单个 goal 的评估指标
 *
 * @param {string} goalId
 * @returns {Promise<Object>} metrics
 */
export async function getGoalMetrics(goalId) {
  const windowStart = new Date(Date.now() - EVAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= $2) AS total_tasks_7d,
      COUNT(*) FILTER (WHERE status = 'completed' AND created_at >= $2) AS completed_tasks_7d,
      COUNT(*) FILTER (WHERE status IN ('failed','quarantined') AND created_at >= $2) AS failed_tasks_7d,
      MAX(completed_at) AS last_completed_at
    FROM tasks
    WHERE goal_id = $1
  `, [goalId, windowStart]);

  const row = result.rows[0] || {};
  const total = parseInt(row.total_tasks_7d || '0', 10);
  const completed = parseInt(row.completed_tasks_7d || '0', 10);
  const failed = parseInt(row.failed_tasks_7d || '0', 10);
  const lastCompletedAt = row.last_completed_at ? new Date(row.last_completed_at) : null;

  const taskCompletionRate = total > 0 ? completed / total : 0;
  const failureRate = total > 0 ? failed / total : 0;

  let daysSinceLastProgress = null;
  if (lastCompletedAt) {
    daysSinceLastProgress = Math.floor((Date.now() - lastCompletedAt.getTime()) / (24 * 60 * 60 * 1000));
  }

  return {
    task_completion_rate: Math.round(taskCompletionRate * 100) / 100,
    failure_rate: Math.round(failureRate * 100) / 100,
    recent_failures: failed,
    total_tasks_7d: total,
    completed_tasks_7d: completed,
    days_since_last_progress: daysSinceLastProgress,
  };
}

/**
 * 根据指标得出评估结论
 *
 * @param {Object} metrics
 * @returns {'on_track'|'needs_attention'|'stalled'}
 */
export function computeVerdict(metrics) {
  const {
    task_completion_rate,
    failure_rate,
    total_tasks_7d,
    days_since_last_progress,
  } = metrics;

  // 停滞：7天无进展 且 有任务存在
  if (days_since_last_progress !== null && days_since_last_progress >= STALL_THRESHOLD_DAYS) {
    return 'stalled';
  }

  // 无任务 = 还没启动，不算停滞，也不算在轨，标记 needs_attention
  if (total_tasks_7d === 0) {
    return 'needs_attention';
  }

  // 失败率过高
  if (failure_rate >= FAILURE_RATE_BAD) {
    return 'needs_attention';
  }

  // 完成率达标
  if (task_completion_rate >= COMPLETION_RATE_GOOD) {
    return 'on_track';
  }

  // 介于中间
  return 'needs_attention';
}

/**
 * 对停滞的 goal 创建 initiative_plan 任务（触发秋米重新规划）
 *
 * @param {string} goalId
 * @param {string} goalTitle
 * @returns {Promise<string|null>} 创建的 task_id
 */
async function createInitiativePlanForStall(goalId, goalTitle) {
  try {
    // 检查是否已有活跃的 initiative_plan 任务
    const existing = await pool.query(`
      SELECT id FROM tasks
      WHERE goal_id = $1
        AND task_type = 'initiative_plan'
        AND status IN ('queued', 'in_progress')
      LIMIT 1
    `, [goalId]);

    if (existing.rows.length > 0) {
      console.log(`[goal-evaluator] goal ${goalId} already has active initiative_plan, skipping`);
      return existing.rows[0].id;
    }

    const result = await pool.query(`
      INSERT INTO tasks (goal_id, title, description, task_type, priority, status)
      VALUES ($1, $2, $3, 'initiative_plan', 'P0', 'queued')
      RETURNING id
    `, [
      goalId,
      `目标重新规划: ${goalTitle}`,
      `目标「${goalTitle}」已停滞 ${STALL_THRESHOLD_DAYS} 天以上，触发自动重新规划。请分析当前进展，拆解新的 Initiative 和 Task。`,
    ]);

    return result.rows[0].id;
  } catch (err) {
    console.error(`[goal-evaluator] Failed to create initiative_plan for goal ${goalId}:`, err.message);
    return null;
  }
}

/**
 * 对 needs_attention 的 goal 写入 suggestion
 *
 * @param {string} goalId
 * @param {string} goalTitle
 * @param {Object} metrics
 * @returns {Promise<string|null>} suggestion_id
 */
async function createAttentionSuggestion(goalId, goalTitle, metrics) {
  try {
    const content = `目标「${goalTitle}」需要关注：` +
      `7天完成率 ${Math.round(metrics.task_completion_rate * 100)}%，` +
      `失败率 ${Math.round(metrics.failure_rate * 100)}%，` +
      `最近 ${metrics.days_since_last_progress ?? '?'} 天无完成任务。` +
      `建议检查任务优先级和派发策略。`;

    const result = await pool.query(`
      INSERT INTO suggestions (content, source, agent_id, suggestion_type, target_entity_type, target_entity_id, priority_score)
      VALUES ($1, 'goal_evaluator', 'system', 'goal_health', 'goal', $2, 0.75)
      RETURNING id
    `, [content, goalId]);

    return result.rows[0].id;
  } catch (err) {
    // suggestions 表可能不存在或其他错误，非致命
    console.error(`[goal-evaluator] Failed to create suggestion for goal ${goalId}:`, err.message);
    return null;
  }
}

/**
 * 评估单个 goal
 *
 * @param {Object} goal - { id, title, status }
 * @returns {Promise<Object>} evaluation result
 */
export async function evaluateGoal(goal) {
  const metrics = await getGoalMetrics(goal.id);
  const verdict = computeVerdict(metrics);

  let actionTaken = 'none';
  let actionDetail = {};

  if (verdict === 'stalled') {
    const taskId = await createInitiativePlanForStall(goal.id, goal.title);
    if (taskId) {
      actionTaken = 'initiative_plan_created';
      actionDetail = { task_id: taskId };
    }
  } else if (verdict === 'needs_attention') {
    const suggestionId = await createAttentionSuggestion(goal.id, goal.title, metrics);
    if (suggestionId) {
      actionTaken = 'suggestion_created';
      actionDetail = { suggestion_id: suggestionId };
    }
  }

  // 写入评估结果
  await pool.query(`
    INSERT INTO goal_evaluations (goal_id, verdict, metrics, action_taken, action_detail)
    VALUES ($1, $2, $3, $4, $5)
  `, [goal.id, verdict, JSON.stringify(metrics), actionTaken, JSON.stringify(actionDetail)]);

  _lastEvalTimes[goal.id] = Date.now();

  return { goal_id: goal.id, verdict, metrics, action_taken: actionTaken };
}

/**
 * 主入口：评估所有活跃 goals
 * 每 goal 独立 24 小时评估周期
 *
 * @param {number} evalIntervalMs - 评估间隔（毫秒），默认 24 小时
 * @returns {Promise<Array>} 评估结果列表
 */
export async function evaluateGoalOuterLoop(evalIntervalMs = 24 * 60 * 60 * 1000) {
  const results = [];

  let goals;
  try {
    const res = await pool.query(`
      SELECT id, title, status, priority, progress
      FROM goals
      WHERE status = 'in_progress'
      ORDER BY priority, starvation_score DESC
    `);
    goals = res.rows;
  } catch (err) {
    console.error('[goal-evaluator] Failed to fetch goals:', err.message);
    return results;
  }

  if (goals.length === 0) {
    return results;
  }

  const now = Date.now();

  for (const goal of goals) {
    const lastEval = _lastEvalTimes[goal.id] || 0;
    if (now - lastEval < evalIntervalMs) {
      // 未到评估周期，跳过
      continue;
    }

    try {
      const result = await evaluateGoal(goal);
      results.push(result);
      console.log(`[goal-evaluator] goal ${goal.id} (${goal.title}): ${result.verdict} | action: ${result.action_taken}`);
    } catch (err) {
      console.error(`[goal-evaluator] Failed to evaluate goal ${goal.id}:`, err.message);
    }
  }

  return results;
}
